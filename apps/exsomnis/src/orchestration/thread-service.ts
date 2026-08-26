import { Context, Effect, Layer, Option, Scope, Schema, Semaphore, Stream } from 'effect';
import { AtomRegistry } from 'effect/unstable/reactivity';
import type { RequestId, ThreadId } from '@/domain/ids.ts';
import { ProjectId as ProjectIdSchema, ProviderId } from '@/domain/ids.ts';
import { ApprovalSettings, ModelSelection } from '@/domain/provider.ts';
import type {
  ApprovalDecision as ApprovalDecisionType,
  ApprovalSettings as ApprovalSettingsType,
  ModelSelection as ModelSelectionType,
  NativeCommand,
  ProviderEvent,
} from '@/domain/provider.ts';
import type { Project, Thread, Turn } from '@/domain/thread.ts';
import type { GitError } from '@/git/git.ts';
import { WorktreeService } from '@/git/worktree.ts';
import type { WorktreeChangeCounts, WorktreeError } from '@/git/worktree.ts';
import type { PersistenceError } from '@/persistence/database.ts';
import { ProjectRepository } from '@/persistence/project-repository.ts';
import { ThreadRepository } from '@/persistence/thread-repository.ts';
import type {
  ProviderError,
  ProviderSession,
  ProviderUnavailableError,
} from '@/providers/provider.ts';
import { ProviderRegistry } from '@/providers/registry.ts';
import {
  attentionAtom,
  pendingRequestAtom,
  projectsAtom,
  threadsAtom,
  timelineAtom,
  tokenUsageAtom,
  turnsAtom,
  workingTreeVersionAtom,
} from '@/state/atoms.ts';

export const CreateThreadRequest = Schema.Struct({
  projectId: ProjectIdSchema,
  title: Schema.String,
  provider: ProviderId,
  model: ModelSelection,
  approval: ApprovalSettings,
});
export type CreateThreadRequest = typeof CreateThreadRequest.Type;

export type ThreadServiceError =
  | PersistenceError
  | GitError
  | WorktreeError
  | ProviderError
  | ProviderUnavailableError;

export class ThreadService extends Context.Service<
  ThreadService,
  {
    readonly ensureProject: (rootPath: string) => Effect.Effect<Project, ThreadServiceError>;
    readonly createThread: (
      request: CreateThreadRequest,
    ) => Effect.Effect<Thread, ThreadServiceError>;
    readonly submitMessage: (
      threadId: ThreadId,
      text: string,
    ) => Effect.Effect<Turn, ThreadServiceError>;
    readonly respondApproval: (
      threadId: ThreadId,
      requestId: RequestId,
      decision: ApprovalDecisionType,
    ) => Effect.Effect<void, ThreadServiceError>;
    readonly viewThread: (threadId: ThreadId) => Effect.Effect<Thread, ThreadServiceError>;
    readonly interruptTurn: (threadId: ThreadId) => Effect.Effect<void, ThreadServiceError>;
    readonly setModel: (
      threadId: ThreadId,
      selection: ModelSelectionType,
    ) => Effect.Effect<void, ThreadServiceError>;
    readonly setApproval: (
      threadId: ThreadId,
      approval: ApprovalSettingsType,
    ) => Effect.Effect<void, ThreadServiceError>;
    readonly listCommands: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<NativeCommand>, ThreadServiceError>;
    readonly runCommand: (
      threadId: ThreadId,
      command: NativeCommand,
      args: string,
    ) => Effect.Effect<void, ThreadServiceError>;
    readonly refreshThreads: Effect.Effect<ReadonlyArray<Thread>, ThreadServiceError>;
    readonly reconcileStartup: Effect.Effect<ReadonlyArray<ThreadId>, ThreadServiceError>;
    readonly inspectWorktreeRemoval: (
      threadId: ThreadId,
    ) => Effect.Effect<WorktreeChangeCounts, ThreadServiceError>;
    readonly removeWorktree: (threadId: ThreadId) => Effect.Effect<void, ThreadServiceError>;
    readonly deleteThread: (threadId: ThreadId) => Effect.Effect<void, ThreadServiceError>;
  }
>()('exsomnis/orchestration/thread-service/ThreadService', {
  make: Effect.gen(function* () {
    const providers = yield* ProviderRegistry;
    const projects = yield* ProjectRepository;
    const threads = yield* ThreadRepository;
    const worktrees = yield* WorktreeService;
    const atoms = yield* AtomRegistry.AtomRegistry;
    const serviceScope = yield* Effect.scope;
    const sessionSemaphore = yield* Semaphore.make(1);
    const sessions = new Map<ThreadId, ProviderSession>();

    const syncProjects = Effect.gen(function* () {
      const rows = yield* projects.list;
      yield* Effect.sync(() => atoms.set(projectsAtom, rows));
    }).pipe(Effect.withSpan('ThreadService.syncProjects'));

    const syncThread = Effect.fn('ThreadService.syncThread')(function* (threadId: ThreadId) {
      const [allThreads, timeline, turnsForThread, request, attention] = yield* Effect.all([
        threads.list,
        threads.listTimeline(threadId),
        threads.listTurns(threadId),
        threads.pendingRequest(threadId),
        threads.attention(threadId),
      ]);
      yield* Effect.sync(() => {
        atoms.set(threadsAtom, allThreads);
        atoms.set(timelineAtom(threadId), timeline);
        atoms.set(turnsAtom(threadId), turnsForThread);
        atoms.set(pendingRequestAtom(threadId), request);
        atoms.set(attentionAtom(threadId), attention);
      });
    });

    const startTurn: (threadId: ThreadId, turn: Turn) => Effect.Effect<void, ThreadServiceError> =
      Effect.fn('ThreadService.startTurn')(function* (threadId: ThreadId, turn: Turn) {
        const thread = yield* threads.get(threadId);
        const session = yield* ensureSession(thread);
        const text = yield* threads.userInput(turn.id);
        const providerTurn = yield* session.startTurn({ text });
        yield* threads.markRunning(turn.id, providerTurn.id);
        yield* syncThread(threadId);
      });

    const failActive: (
      threadId: ThreadId,
      reason: string,
    ) => Effect.Effect<void, ThreadServiceError> = Effect.fn('ThreadService.failActive')(function* (
      threadId: ThreadId,
      reason: string,
    ) {
      const active = yield* threads.activeTurn(threadId);
      if (Option.isNone(active)) {
        return;
      }
      yield* threads.markFinalizing(active.value.id);
      yield* threads.staleRequests(active.value.id);
      const promoted = yield* threads.finishAndPromote(active.value.id, 'failed', reason);
      yield* syncThread(threadId);
      if (Option.isSome(promoted)) {
        yield* startTurn(threadId, promoted.value);
      }
    });

    const handleEvent: (
      threadId: ThreadId,
      event: ProviderEvent,
    ) => Effect.Effect<void, ThreadServiceError> = Effect.fn('ThreadService.handleEvent')(
      function* (threadId: ThreadId, event: ProviderEvent) {
        if (event['_tag'] === 'ModelChanged') {
          yield* threads.updateModel(threadId, event.selection);
          yield* syncThread(threadId);
          return;
        }
        const active = yield* threads.activeTurn(threadId);
        if (Option.isNone(active)) {
          if (event['_tag'] === 'SessionClosed') {
            yield* Effect.sync(() => sessions.delete(threadId));
          }
          return;
        }
        const turn = active.value;
        switch (event['_tag']) {
          case 'TurnStarted': {
            yield* threads.markRunning(turn.id, event.turn.id);
            const session = sessions.get(threadId);
            if (session !== undefined) {
              yield* threads.updateResumeRef(threadId, session.resumeRef);
            }
            break;
          }
          case 'TurnCompleted': {
            yield* threads.markFinalizing(turn.id);
            yield* threads.staleRequests(turn.id);
            yield* syncThread(threadId);
            const promoted = yield* threads.finishAndPromote(turn.id, event.outcome, event.reason);
            yield* syncThread(threadId);
            if (Option.isSome(promoted)) {
              yield* startTurn(threadId, promoted.value);
            }
            return;
          }
          case 'ItemStarted':
            yield* threads.startItem(threadId, turn.id, event.providerItemId, event.item);
            break;
          case 'ItemDelta':
            yield* threads.appendItemDelta(turn.id, event.providerItemId, event.part, event.delta);
            break;
          case 'ItemCompleted':
            yield* threads.completeItem(
              threadId,
              turn.id,
              event.providerItemId,
              event.status,
              event.item,
            );
            break;
          case 'ApprovalRequested':
            yield* threads.addApproval(threadId, turn.id, event.request);
            break;
          case 'ApprovalResolved':
            break;
          case 'TokenUsage':
            yield* Effect.sync(() =>
              atoms.set(
                tokenUsageAtom(threadId),
                Option.some({
                  used: event.used,
                  ...(event.contextWindow === undefined
                    ? {}
                    : { contextWindow: event.contextWindow }),
                  ...(event.total === undefined ? {} : { total: event.total }),
                }),
              ),
            );
            return;
          case 'WorkingTreeChanged':
            yield* Effect.sync(() => {
              const versionAtom = workingTreeVersionAtom(threadId);
              atoms.set(versionAtom, atoms.get(versionAtom) + 1);
            });
            return;
          case 'Warning':
            yield* threads.addNotice(threadId, turn.id, event.message);
            break;
          case 'SessionClosed':
            yield* Effect.sync(() => sessions.delete(threadId));
            yield* failActive(threadId, event.detail ?? `provider session ${event.reason}`);
            return;
        }
        yield* syncThread(threadId);
      },
    );

    const ensureSession: (thread: Thread) => Effect.Effect<ProviderSession, ThreadServiceError> =
      Effect.fn('ThreadService.ensureSession')(function* (thread: Thread) {
        return yield* sessionSemaphore.withPermit(
          Effect.gen(function* () {
            const existing = sessions.get(thread.id);
            if (existing !== undefined) {
              return existing;
            }
            const driver = yield* providers.get(thread.provider);
            const open = (resume: Thread['resumeRef']) =>
              driver
                .openSession({
                  cwd: thread.worktreePath,
                  model: thread.model,
                  approval: thread.approval,
                  resume,
                })
                .pipe(Scope.provide(serviceScope));
            const session = yield* open(thread.resumeRef).pipe(
              Effect.catchTag('ProviderError', (error) =>
                Option.isNone(thread.resumeRef)
                  ? Effect.fail(error)
                  : Effect.gen(function* () {
                      yield* Effect.logWarning('Provider conversation could not be resumed').pipe(
                        Effect.annotateLogs({ threadId: thread.id, message: error.message }),
                      );
                      yield* threads.clearResumeRef(thread.id);
                      const active = yield* threads.activeTurn(thread.id);
                      if (Option.isSome(active)) {
                        yield* threads.addNotice(
                          thread.id,
                          active.value.id,
                          `The previous provider conversation could not be resumed (${error.message}). A new one starts here.`,
                        );
                      }
                      return yield* open(Option.none());
                    }),
              ),
            );
            yield* Effect.sync(() => sessions.set(thread.id, session));
            const consume: Effect.Effect<void, ThreadServiceError> = Stream.runForEach(
              session.events,
              (event) => handleEvent(thread.id, event),
            ).pipe(
              Effect.catchTag('ProviderError', (error) => failActive(thread.id, error.message)),
              Effect.ensuring(
                Effect.sync(() => {
                  if (sessions.get(thread.id) === session) {
                    sessions.delete(thread.id);
                  }
                }),
              ),
            );
            yield* Effect.forkIn(consume, serviceScope);
            return session;
          }),
        );
      });

    const ensureProject = Effect.fn('ThreadService.ensureProject')(function* (rootPath: string) {
      const project = yield* projects.ensureProject(rootPath);
      yield* syncProjects;
      return project;
    });

    const createThread = Effect.fn('ThreadService.createThread')(function* (
      request: CreateThreadRequest,
    ) {
      const project = yield* projects.get(request.projectId);
      const createdWorktree = yield* worktrees.create(project.rootPath);
      const createRow = threads.create({
        projectId: request.projectId,
        title: request.title,
        provider: request.provider,
        model: request.model,
        approval: request.approval,
        branch: createdWorktree.branch,
        worktreePath: createdWorktree.path,
        baseRef: createdWorktree.baseRef,
        baseCommit: createdWorktree.baseCommit,
      });
      const thread = yield* createRow.pipe(
        Effect.onError(() =>
          worktrees
            .remove(project.rootPath, createdWorktree.path)
            .pipe(Effect.result, Effect.asVoid),
        ),
      );
      yield* syncThread(thread.id);
      return thread;
    });

    const submitMessage = Effect.fn('ThreadService.submitMessage')(function* (
      threadId: ThreadId,
      text: string,
    ) {
      const turn = yield* threads.submitMessage(threadId, text);
      yield* syncThread(threadId);
      if (turn.state === 'starting') {
        yield* startTurn(threadId, turn).pipe(
          Effect.catchTags({
            ProviderError: (error) => failActive(threadId, error.message),
            ProviderUnavailableError: (error) => failActive(threadId, error.reason),
          }),
        );
      }
      return turn;
    });

    const respondApproval = Effect.fn('ThreadService.respondApproval')(function* (
      threadId: ThreadId,
      requestId: RequestId,
      decision: ApprovalDecisionType,
    ) {
      const session = sessions.get(threadId);
      if (session === undefined) {
        yield* threads.staleRequest(requestId);
        yield* syncThread(threadId);
        return;
      }
      const accepted = yield* session.respond(requestId, decision).pipe(
        Effect.as(true),
        Effect.catchTag('ProviderError', () => Effect.succeed(false)),
      );
      if (accepted) {
        yield* threads.answerApproval(requestId, decision);
        if (decision === 'cancel') {
          yield* session.interrupt;
        }
      } else {
        yield* threads.staleRequest(requestId);
      }
      yield* syncThread(threadId);
    });

    const interruptTurn = Effect.fn('ThreadService.interruptTurn')(function* (threadId: ThreadId) {
      const session = sessions.get(threadId);
      if (session !== undefined) {
        yield* session.interrupt;
      }
    });

    const setModel = Effect.fn('ThreadService.setModel')(function* (
      threadId: ThreadId,
      selection: ModelSelectionType,
    ) {
      yield* threads.updateModel(threadId, selection);
      const session = sessions.get(threadId);
      if (session !== undefined) {
        yield* session.setModel(selection);
      }
      yield* syncThread(threadId);
    });

    const setApproval = Effect.fn('ThreadService.setApproval')(function* (
      threadId: ThreadId,
      approval: ApprovalSettingsType,
    ) {
      yield* threads.updateApproval(threadId, approval);
      const session = sessions.get(threadId);
      if (session !== undefined) {
        yield* session.setApproval(approval);
      }
      yield* syncThread(threadId);
    });

    const listCommands = Effect.fn('ThreadService.listCommands')(function* (threadId: ThreadId) {
      const thread = yield* threads.get(threadId);
      const session = yield* ensureSession(thread);
      return yield* session.listCommands;
    });

    const runCommand = Effect.fn('ThreadService.runCommand')(function* (
      threadId: ThreadId,
      command: NativeCommand,
      args: string,
    ) {
      const suffix = args.trim();
      const turn = yield* threads.submitMessage(
        threadId,
        `/${command.name}${suffix.length === 0 ? '' : ` ${suffix}`}`,
      );
      yield* syncThread(threadId);
      if (turn.state !== 'starting') {
        return;
      }
      const thread = yield* threads.get(threadId);
      yield* ensureSession(thread).pipe(
        Effect.flatMap((session) => session.runCommand(command, args)),
        Effect.catchTags({
          ProviderError: (error) => failActive(threadId, error.message),
          ProviderUnavailableError: (error) => failActive(threadId, error.reason),
        }),
      );
    });

    const viewThread = Effect.fn('ThreadService.viewThread')(function* (threadId: ThreadId) {
      const thread = yield* threads.markViewed(threadId);
      yield* syncThread(threadId);
      return thread;
    });

    const refreshThreads = Effect.gen(function* () {
      const all = yield* threads.list;
      yield* Effect.sync(() => atoms.set(threadsAtom, all));
      yield* Effect.forEach(all, (thread) => syncThread(thread.id), { discard: true });
      return all;
    }).pipe(Effect.withSpan('ThreadService.refreshThreads'));

    const reconcileStartup = threads.reconcileStartup.pipe(
      Effect.tap((threadIds) => Effect.forEach(threadIds, syncThread, { discard: true })),
      Effect.withSpan('ThreadService.reconcileStartup'),
    );

    const inspectWorktreeRemoval = Effect.fn('ThreadService.inspectWorktreeRemoval')(function* (
      threadId: ThreadId,
    ) {
      const thread = yield* threads.get(threadId);
      return yield* worktrees.inspectRemoval(thread.worktreePath);
    });

    const removeWorktree = Effect.fn('ThreadService.removeWorktree')(function* (
      threadId: ThreadId,
    ) {
      const thread = yield* threads.get(threadId);
      const project = yield* projects.get(thread.projectId);
      yield* worktrees.remove(project.rootPath, thread.worktreePath);
    });

    const deleteThread = Effect.fn('ThreadService.deleteThread')(function* (threadId: ThreadId) {
      yield* threads.delete(threadId);
      const allThreads = yield* threads.list;
      yield* Effect.sync(() => atoms.set(threadsAtom, allThreads));
    });

    return {
      ensureProject,
      createThread,
      submitMessage,
      respondApproval,
      viewThread,
      interruptTurn,
      setModel,
      setApproval,
      listCommands,
      runCommand,
      refreshThreads,
      reconcileStartup,
      inspectWorktreeRemoval,
      removeWorktree,
      deleteThread,
    };
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies;
}
