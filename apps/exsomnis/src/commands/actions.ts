import { Effect, Option, Result } from 'effect';
import { AtomRegistry } from 'effect/unstable/reactivity';
import type { ProviderId, ThreadId } from '@/domain/ids.ts';
import type {
  ApprovalDecision,
  ApprovalSettings,
  ModelSelection,
  NativeCommand,
} from '@/domain/provider.ts';
import type { Thread } from '@/domain/thread.ts';
import type { GitError } from '@/git/git.ts';
import type { WorktreeError } from '@/git/worktree.ts';
import { ModelService } from '@/orchestration/model-service.ts';
import { ThreadService } from '@/orchestration/thread-service.ts';
import type { PersistenceError } from '@/persistence/database.ts';
import type { ProviderError, ProviderUnavailableError } from '@/providers/provider.ts';
import { ProviderRegistry } from '@/providers/registry.ts';
import {
  composerAtom,
  defaultProviderAtom,
  emptyComposer,
  helpVisibleAtom,
  modelsAtom,
  nativeCommandsAtom,
  nativeCommandsLoadedAtom,
  paletteAtom,
  pendingRequestAtom,
  projectsAtom,
  selectedThreadIdAtom,
  statusMessageAtom,
  threadsAtom,
  transcriptFollowAtom,
} from '@/state/atoms.ts';

export type InterfaceError =
  | PersistenceError
  | GitError
  | WorktreeError
  | ProviderError
  | ProviderUnavailableError;

const describeError = (error: InterfaceError): string => {
  switch (error['_tag']) {
    case 'PersistenceError':
      return `${error.operation}: ${error.message}`;
    case 'GitError':
      return `${error.command}: ${error.message}`;
    case 'WorktreeError':
      return `${error.operation}: ${error.message}`;
    case 'ProviderError':
      return `${error.provider} ${error.operation}: ${error.message}`;
    case 'ProviderUnavailableError':
      return `${error.provider} unavailable: ${error.reason}`;
  }
};

export interface InterfaceActions {
  readonly selectThread: (threadId: ThreadId) => Effect.Effect<void>;
  readonly createThread: Effect.Effect<void>;
  readonly sendComposer: Effect.Effect<void>;
  readonly interrupt: Effect.Effect<void>;
  readonly respond: (decision: ApprovalDecision) => Effect.Effect<void>;
  readonly runNative: (command: NativeCommand, args: string) => Effect.Effect<void>;
  readonly applyModel: (selection: ModelSelection) => Effect.Effect<void>;
  readonly applyApproval: (approval: ApprovalSettings) => Effect.Effect<void>;
  readonly loadCommands: Effect.Effect<void>;
  readonly loadModels: (provider: ProviderId) => Effect.Effect<void>;
}

export const makeActions = Effect.fn('Interface.makeActions')(function* () {
  const registry = yield* AtomRegistry.AtomRegistry;
  const threads = yield* ThreadService;
  const models = yield* ModelService;
  const providers = yield* ProviderRegistry;
  const scope = yield* Effect.scope;

  const setStatus = (message: string) =>
    Effect.sync(() => registry.set(statusMessageAtom, Option.some(message)));
  const clearStatus = Effect.sync(() => registry.set(statusMessageAtom, Option.none()));

  const report = <A>(effect: Effect.Effect<A, InterfaceError>) =>
    effect.pipe(
      Effect.result,
      Effect.flatMap((result) =>
        Result.isFailure(result) ? setStatus(describeError(result.failure)) : clearStatus,
      ),
    );

  const spawn = <A>(effect: Effect.Effect<A, InterfaceError>) =>
    Effect.forkIn(report(effect), scope).pipe(Effect.asVoid);

  const currentThread = (): Thread | undefined => {
    const selected = registry.get(selectedThreadIdAtom);
    if (Option.isNone(selected)) {
      return undefined;
    }
    return registry.get(threadsAtom).find((thread) => thread.id === selected.value);
  };

  const withThread = (run: (thread: Thread) => Effect.Effect<void, InterfaceError>) =>
    Effect.suspend(() => {
      const thread = currentThread();
      return thread === undefined ? Effect.void : spawn(run(thread));
    });

  const selectThread = (threadId: ThreadId) =>
    Effect.suspend(() => {
      registry.set(selectedThreadIdAtom, Option.some(threadId));
      registry.set(paletteAtom, Option.none());
      registry.set(helpVisibleAtom, false);
      registry.set(transcriptFollowAtom(threadId), true);
      return spawn(threads.viewThread(threadId).pipe(Effect.asVoid));
    });

  const createThread = Effect.suspend(() => {
    const provider = registry.get(defaultProviderAtom);
    const projects = registry.get(projectsAtom);
    const projectId = currentThread()?.projectId ?? projects[0]?.id;
    if (projectId === undefined) {
      return setStatus('no project is open');
    }
    return spawn(
      Effect.gen(function* () {
        const available = yield* models.listModels(provider, { force: false });
        const chosen = available.find((model) => model.isDefault) ?? available[0];
        if (chosen === undefined) {
          return yield* setStatus(`${provider} reported no models`);
        }
        const driver = yield* providers.get(provider);
        const approval: Record<string, string> = {};
        for (const dimension of driver.approvalDimensions) {
          approval[dimension.id] = dimension.defaultValue;
        }
        const count =
          registry.get(threadsAtom).filter((thread) => thread.projectId === projectId).length + 1;
        const thread = yield* threads.createThread({
          projectId,
          title: `thread ${count}`,
          provider,
          model: {
            model: chosen.id,
            ...(chosen.defaultReasoningEffort === undefined
              ? {}
              : { reasoningEffort: chosen.defaultReasoningEffort }),
          },
          approval,
        });
        yield* selectThread(thread.id);
      }),
    );
  });

  const sendComposer = Effect.suspend(() => {
    const thread = currentThread();
    if (thread === undefined) {
      return Effect.void;
    }
    const composer = registry.get(composerAtom(thread.id));
    if (composer.text.trim().length === 0) {
      return Effect.void;
    }
    registry.set(composerAtom(thread.id), emptyComposer);
    registry.set(transcriptFollowAtom(thread.id), true);
    return spawn(threads.submitMessage(thread.id, composer.text).pipe(Effect.asVoid));
  });

  const interrupt = withThread((thread) => threads.interruptTurn(thread.id));

  const respond = (decision: ApprovalDecision) =>
    Effect.suspend(() => {
      const thread = currentThread();
      if (thread === undefined) {
        return Effect.void;
      }
      const request = registry.get(pendingRequestAtom(thread.id));
      if (Option.isNone(request)) {
        return Effect.void;
      }
      return spawn(threads.respondApproval(thread.id, request.value.id, decision));
    });

  const runNative = (command: NativeCommand, args: string) =>
    Effect.suspend(() => {
      const thread = currentThread();
      if (thread === undefined) {
        return Effect.void;
      }
      registry.set(composerAtom(thread.id), emptyComposer);
      registry.set(transcriptFollowAtom(thread.id), true);
      return spawn(threads.runCommand(thread.id, command, args));
    });

  const applyModel = (selection: ModelSelection) =>
    withThread((thread) => threads.setModel(thread.id, selection));

  const applyApproval = (approval: ApprovalSettings) =>
    withThread((thread) => threads.setApproval(thread.id, approval));

  const loadCommands = Effect.suspend(() => {
    const thread = currentThread();
    if (thread === undefined || registry.get(nativeCommandsLoadedAtom(thread.id))) {
      return Effect.void;
    }
    registry.set(nativeCommandsLoadedAtom(thread.id), true);
    return spawn(
      threads.listCommands(thread.id).pipe(
        Effect.tap((commands) =>
          Effect.sync(() => registry.set(nativeCommandsAtom(thread.id), commands)),
        ),
        Effect.tapError(() =>
          Effect.sync(() => registry.set(nativeCommandsLoadedAtom(thread.id), false)),
        ),
        Effect.asVoid,
      ),
    );
  });

  const loadModels = (provider: ProviderId) =>
    Effect.suspend(() =>
      registry.get(modelsAtom(provider)).length > 0
        ? Effect.void
        : spawn(models.listModels(provider, { force: false }).pipe(Effect.asVoid)),
    );

  return {
    selectThread,
    createThread,
    sendComposer,
    interrupt,
    respond,
    runNative,
    applyModel,
    applyApproval,
    loadCommands,
    loadModels,
  } satisfies InterfaceActions;
});
