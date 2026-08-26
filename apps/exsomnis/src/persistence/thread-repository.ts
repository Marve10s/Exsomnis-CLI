import { Clock, Context, Effect, Layer, Option, Random, Schema } from 'effect';
import type { RequestId, ThreadId, TurnId } from '@/domain/ids.ts';
import {
  ProjectId as ProjectIdSchema,
  ProviderId,
  ThreadId as ThreadIdSchema,
  TurnId as TurnIdSchema,
} from '@/domain/ids.ts';
import { ApprovalDecision, ApprovalSettings, ModelSelection } from '@/domain/provider.ts';
import type {
  ApprovalDecision as ApprovalDecisionType,
  ApprovalRequest as ApprovalRequestType,
  DeltaPart as DeltaPartType,
  ItemStatus as ItemStatusType,
  ApprovalSettings as ApprovalSettingsType,
  ModelSelection as ModelSelectionType,
  ResumeRef as ResumeRefType,
  TimelineItemPayload as TimelineItemPayloadType,
  TurnOutcome as TurnOutcomeType,
} from '@/domain/provider.ts';
import type {
  Attention,
  PendingRequest,
  Thread,
  TimelineItem,
  Turn,
  TurnState,
} from '@/domain/thread.ts';
import { serializeUnknownError } from '@/errors.ts';
import {
  decodePendingRequestRow,
  decodeThreadRow,
  decodeTimelineItemRow,
  decodeTurnRow,
  encodeApprovalRequest,
  encodeApprovalSettings,
  encodeFailure,
  encodeModelSelection,
  encodeResumeRef,
  encodeTimelinePayload,
} from '@/persistence/codecs.ts';
import { DatabaseService, PersistenceError } from '@/persistence/database.ts';

export const CreateThreadInput = Schema.Struct({
  projectId: ProjectIdSchema,
  title: Schema.String,
  provider: ProviderId,
  model: ModelSelection,
  approval: ApprovalSettings,
  branch: Schema.String,
  worktreePath: Schema.String,
  baseRef: Schema.String,
  baseCommit: Schema.String,
});
export type CreateThreadInput = typeof CreateThreadInput.Type;

const AggregateRow = Schema.Struct({ value: Schema.Finite });
const IdRow = Schema.Struct({ id: ThreadIdSchema });

const persistenceFailure = (operation: string) => (error: unknown) =>
  PersistenceError.make({ operation, message: serializeUnknownError(error) });

const firstOrFail = <A>(values: ReadonlyArray<A>, operation: string) => {
  const value = values[0];
  return value === undefined
    ? Effect.fail(PersistenceError.make({ operation, message: 'expected row was not found' }))
    : Effect.succeed(value);
};

const terminalState = (outcome: TurnOutcomeType): TurnState => {
  switch (outcome) {
    case 'completed':
      return 'completed';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
      return 'failed';
  }
};

const appendDelta = (
  payload: TimelineItemPayloadType,
  part: DeltaPartType,
  delta: string,
): TimelineItemPayloadType => {
  switch (payload.kind) {
    case 'assistantMessage':
      return part === 'text' ? { ...payload, text: payload.text + delta } : payload;
    case 'reasoning':
      return part === 'reasoning' ? { ...payload, text: payload.text + delta } : payload;
    case 'command':
      return part === 'output' ? { ...payload, output: payload.output + delta } : payload;
    case 'toolCall':
      return part === 'output' ? { ...payload, output: (payload.output ?? '') + delta } : payload;
    case 'notice':
      return part === 'text' ? { ...payload, text: payload.text + delta } : payload;
    case 'approval':
    case 'error':
    case 'fileChange':
    case 'userMessage':
    case 'webSearch':
      return payload;
  }
};

export class ThreadRepository extends Context.Service<
  ThreadRepository,
  {
    readonly create: (input: CreateThreadInput) => Effect.Effect<Thread, PersistenceError>;
    readonly get: (threadId: ThreadId) => Effect.Effect<Thread, PersistenceError>;
    readonly list: Effect.Effect<ReadonlyArray<Thread>, PersistenceError>;
    readonly markViewed: (threadId: ThreadId) => Effect.Effect<Thread, PersistenceError>;
    readonly delete: (threadId: ThreadId) => Effect.Effect<void, PersistenceError>;
    readonly clearResumeRef: (threadId: ThreadId) => Effect.Effect<void, PersistenceError>;
    readonly updateResumeRef: (
      threadId: ThreadId,
      resumeRef: ResumeRefType,
    ) => Effect.Effect<void, PersistenceError>;
    readonly updateModel: (
      threadId: ThreadId,
      model: ModelSelectionType,
    ) => Effect.Effect<void, PersistenceError>;
    readonly updateApproval: (
      threadId: ThreadId,
      approval: ApprovalSettingsType,
    ) => Effect.Effect<void, PersistenceError>;
    readonly submitMessage: (
      threadId: ThreadId,
      text: string,
    ) => Effect.Effect<Turn, PersistenceError>;
    readonly getTurn: (turnId: TurnId) => Effect.Effect<Turn, PersistenceError>;
    readonly activeTurn: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<Turn>, PersistenceError>;
    readonly userInput: (turnId: TurnId) => Effect.Effect<string, PersistenceError>;
    readonly listTurns: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<Turn>, PersistenceError>;
    readonly listTimeline: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<TimelineItem>, PersistenceError>;
    readonly pendingRequest: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<PendingRequest>, PersistenceError>;
    readonly listRequests: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<PendingRequest>, PersistenceError>;
    readonly markRunning: (
      turnId: TurnId,
      providerTurnRef: string,
    ) => Effect.Effect<Turn, PersistenceError>;
    readonly markFinalizing: (turnId: TurnId) => Effect.Effect<void, PersistenceError>;
    readonly finishAndPromote: (
      turnId: TurnId,
      outcome: TurnOutcomeType,
      reason: string | undefined,
    ) => Effect.Effect<Option.Option<Turn>, PersistenceError>;
    readonly startItem: (
      threadId: ThreadId,
      turnId: TurnId,
      providerItemId: string,
      payload: TimelineItemPayloadType,
    ) => Effect.Effect<TimelineItem, PersistenceError>;
    readonly appendItemDelta: (
      turnId: TurnId,
      providerItemId: string,
      part: DeltaPartType,
      delta: string,
    ) => Effect.Effect<void, PersistenceError>;
    readonly completeItem: (
      threadId: ThreadId,
      turnId: TurnId,
      providerItemId: string,
      status: ItemStatusType,
      payload: TimelineItemPayloadType,
    ) => Effect.Effect<TimelineItem, PersistenceError>;
    readonly addApproval: (
      threadId: ThreadId,
      turnId: TurnId,
      request: ApprovalRequestType,
    ) => Effect.Effect<PendingRequest, PersistenceError>;
    readonly staleRequests: (turnId: TurnId) => Effect.Effect<void, PersistenceError>;
    readonly staleRequest: (requestId: RequestId) => Effect.Effect<void, PersistenceError>;
    readonly answerApproval: (
      requestId: RequestId,
      decision: ApprovalDecisionType,
    ) => Effect.Effect<void, PersistenceError>;
    readonly addNotice: (
      threadId: ThreadId,
      turnId: TurnId,
      text: string,
    ) => Effect.Effect<TimelineItem, PersistenceError>;
    readonly reconcileStartup: Effect.Effect<ReadonlyArray<ThreadId>, PersistenceError>;
    readonly attention: (threadId: ThreadId) => Effect.Effect<Attention, PersistenceError>;
  }
>()('exsomnis/persistence/thread-repository/ThreadRepository', {
  make: Effect.gen(function* () {
    const database = yield* DatabaseService;
    const sql = database.sql;

    const get = Effect.fn('ThreadRepository.get')(function* (threadId: ThreadId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM threads WHERE id = ${threadId}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.get')));
      return yield* firstOrFail(
        yield* Effect.forEach(rows, decodeThreadRow),
        'ThreadRepository.get',
      );
    });

    const list = Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM threads ORDER BY updated_at DESC, id
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.list')));
      return yield* Effect.forEach(rows, decodeThreadRow);
    }).pipe(Effect.withSpan('ThreadRepository.list'));

    const create = Effect.fn('ThreadRepository.create')(function* (input: CreateThreadInput) {
      const decodedInput = yield* Schema.decodeEffect(CreateThreadInput)(input).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.createInput')),
      );
      const now = yield* Clock.currentTimeMillis;
      const id = `${now}-${yield* Random.nextInt}`;
      const modelJson = yield* encodeModelSelection(decodedInput.model).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.encodeModel')),
      );
      const approvalJson = yield* encodeApprovalSettings(decodedInput.approval).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.encodeApproval')),
      );
      yield* sql`
        INSERT INTO threads (
          id, project_id, title, provider, model_json, approval_json, branch,
          worktree_path, base_ref, base_commit, resume_ref_json, created_at,
          updated_at, last_viewed_at, archived_at
        ) VALUES (
          ${id}, ${decodedInput.projectId}, ${decodedInput.title}, ${decodedInput.provider},
          ${modelJson}, ${approvalJson}, ${decodedInput.branch}, ${decodedInput.worktreePath},
          ${decodedInput.baseRef}, ${decodedInput.baseCommit}, ${null}, ${now}, ${now}, ${now}, ${null}
        )
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.create')));
      return yield* get(
        yield* Schema.decodeEffect(ThreadIdSchema)(id).pipe(
          Effect.mapError(persistenceFailure('ThreadRepository.decodeThreadId')),
        ),
      );
    });

    const markViewed = Effect.fn('ThreadRepository.markViewed')(function* (threadId: ThreadId) {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`UPDATE threads SET last_viewed_at = ${now} WHERE id = ${threadId}`.pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.markViewed')),
      );
      return yield* get(threadId);
    });

    const deleteThread = Effect.fn('ThreadRepository.delete')(function* (threadId: ThreadId) {
      yield* sql`DELETE FROM threads WHERE id = ${threadId}`.pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.delete')),
      );
    });

    const clearResumeRef = Effect.fn('ThreadRepository.clearResumeRef')(function* (
      threadId: ThreadId,
    ) {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE threads SET resume_ref_json = ${null}, updated_at = ${now}
        WHERE id = ${threadId}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.clearResumeRef')));
    });

    const updateResumeRef = Effect.fn('ThreadRepository.updateResumeRef')(function* (
      threadId: ThreadId,
      resumeRef: ResumeRefType,
    ) {
      const resumeRefJson = yield* encodeResumeRef(resumeRef).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.encodeResumeRef')),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE threads
        SET resume_ref_json = ${resumeRefJson}, updated_at = ${now}
        WHERE id = ${threadId}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.updateResumeRef')));
    });

    const updateModel = Effect.fn('ThreadRepository.updateModel')(function* (
      threadId: ThreadId,
      model: ModelSelectionType,
    ) {
      const modelJson = yield* encodeModelSelection(model).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.encodeUpdatedModel')),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE threads SET model_json = ${modelJson}, updated_at = ${now}
        WHERE id = ${threadId}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.updateModel')));
    });

    const updateApproval = Effect.fn('ThreadRepository.updateApproval')(function* (
      threadId: ThreadId,
      approval: ApprovalSettingsType,
    ) {
      const approvalJson = yield* encodeApprovalSettings(approval).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.encodeUpdatedApproval')),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE threads SET approval_json = ${approvalJson}, updated_at = ${now}
        WHERE id = ${threadId}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.updateApproval')));
    });

    const listTurns = Effect.fn('ThreadRepository.listTurns')(function* (threadId: ThreadId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM turns WHERE thread_id = ${threadId} ORDER BY ordinal
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.listTurns')));
      return yield* Effect.forEach(rows, decodeTurnRow);
    });

    const listTimeline = Effect.fn('ThreadRepository.listTimeline')(function* (threadId: ThreadId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM timeline_items WHERE thread_id = ${threadId} ORDER BY ordinal
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.listTimeline')));
      return yield* Effect.forEach(rows, decodeTimelineItemRow);
    });

    const getTurn = Effect.fn('ThreadRepository.getTurn')(function* (turnId: TurnId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM turns WHERE id = ${turnId}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.getTurn')));
      return yield* firstOrFail(
        yield* Effect.forEach(rows, decodeTurnRow),
        'ThreadRepository.getTurn',
      );
    });

    const activeTurn = Effect.fn('ThreadRepository.activeTurn')(function* (threadId: ThreadId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM turns
        WHERE thread_id = ${threadId} AND state IN ('starting', 'running', 'finalizing')
        ORDER BY ordinal
        LIMIT 1
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.activeTurn')));
      const turns = yield* Effect.forEach(rows, decodeTurnRow);
      return Option.fromNullishOr(turns[0]);
    });

    const userInput = Effect.fn('ThreadRepository.userInput')(function* (turnId: TurnId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM timeline_items
        WHERE turn_id = ${turnId} AND kind = 'userMessage'
        ORDER BY ordinal
        LIMIT 1
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.userInput')));
      const item = yield* firstOrFail(
        yield* Effect.forEach(rows, decodeTimelineItemRow),
        'ThreadRepository.userInput',
      );
      if (item.payload.kind !== 'userMessage') {
        return yield* PersistenceError.make({
          operation: 'ThreadRepository.userInput',
          message: 'turn user message payload has the wrong kind',
        });
      }
      return item.payload.text;
    });

    const submitMessage = Effect.fn('ThreadRepository.submitMessage')(function* (
      threadId: ThreadId,
      text: string,
    ) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const ordinalRows = yield* sql<Record<string, unknown>>`
            SELECT COALESCE(MAX(ordinal), 0) + 1 AS value FROM turns WHERE thread_id = ${threadId}
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextTurnOrdinal')));
            const ordinal = (yield* Schema.decodeUnknownEffect(AggregateRow)(
              yield* firstOrFail(ordinalRows, 'ThreadRepository.nextTurnOrdinal'),
            ).pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextTurnOrdinal')))).value;
            const activeRows = yield* sql<Record<string, unknown>>`
            SELECT COUNT(*) AS value FROM turns
            WHERE thread_id = ${threadId} AND state IN ('starting', 'running', 'finalizing')
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.activeCount')));
            const activeCount = (yield* Schema.decodeUnknownEffect(AggregateRow)(
              yield* firstOrFail(activeRows, 'ThreadRepository.activeCount'),
            ).pipe(Effect.mapError(persistenceFailure('ThreadRepository.activeCount')))).value;
            const queueRows = yield* sql<Record<string, unknown>>`
            SELECT COALESCE(MAX(queue_position), 0) + 1 AS value FROM turns WHERE thread_id = ${threadId}
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextQueuePosition')));
            const queuePosition = (yield* Schema.decodeUnknownEffect(AggregateRow)(
              yield* firstOrFail(queueRows, 'ThreadRepository.nextQueuePosition'),
            ).pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextQueuePosition'))))
              .value;
            const state: TurnState = activeCount > 0 ? 'queued' : 'starting';
            const turnId = `${now}-${yield* Random.nextInt}`;
            yield* sql`
            INSERT INTO turns (
              id, thread_id, ordinal, state, queue_position, provider_turn_ref,
              started_at, finished_at, failure_json
            ) VALUES (
              ${turnId}, ${threadId}, ${ordinal}, ${state},
              ${state === 'queued' ? queuePosition : null}, ${null}, ${null}, ${null}, ${null}
            )
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.insertTurn')));
            const timelineRows = yield* sql<Record<string, unknown>>`
            SELECT COALESCE(MAX(ordinal), 0) + 1 AS value
            FROM timeline_items
            WHERE thread_id = ${threadId}
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextTimelineOrdinal')));
            const timelineOrdinal = (yield* Schema.decodeUnknownEffect(AggregateRow)(
              yield* firstOrFail(timelineRows, 'ThreadRepository.nextTimelineOrdinal'),
            ).pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextTimelineOrdinal'))))
              .value;
            const payloadJson = yield* encodeTimelinePayload({ kind: 'userMessage', text }).pipe(
              Effect.mapError(persistenceFailure('ThreadRepository.encodeUserMessage')),
            );
            yield* sql`
            INSERT INTO timeline_items (
              id, thread_id, turn_id, ordinal, kind, status, provider_item_ref,
              payload_json, created_at, updated_at
            ) VALUES (
              ${`${now}-${yield* Random.nextInt}`}, ${threadId}, ${turnId}, ${timelineOrdinal},
              ${'userMessage'}, ${'completed'}, ${null}, ${payloadJson}, ${now}, ${now}
            )
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.insertUserMessage')));
            yield* sql`UPDATE threads SET updated_at = ${now} WHERE id = ${threadId}`.pipe(
              Effect.mapError(persistenceFailure('ThreadRepository.touchThread')),
            );
            return yield* getTurn(
              yield* Schema.decodeEffect(TurnIdSchema)(turnId).pipe(
                Effect.mapError(persistenceFailure('ThreadRepository.decodeTurnId')),
              ),
            );
          }),
        )
        .pipe(Effect.catchTag('SqlError', persistenceFailure('ThreadRepository.submitMessage')));
    });

    const pendingRequest = Effect.fn('ThreadRepository.pendingRequest')(function* (
      threadId: ThreadId,
    ) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM pending_requests
        WHERE thread_id = ${threadId} AND status = 'pending'
        ORDER BY created_at
        LIMIT 1
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.pendingRequest')));
      const requests = yield* Effect.forEach(rows, decodePendingRequestRow);
      return Option.fromNullishOr(requests[0]);
    });

    const listRequests = Effect.fn('ThreadRepository.listRequests')(function* (threadId: ThreadId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM pending_requests
        WHERE thread_id = ${threadId}
        ORDER BY created_at, id
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.listRequests')));
      return yield* Effect.forEach(rows, decodePendingRequestRow);
    });

    const markRunning = Effect.fn('ThreadRepository.markRunning')(function* (
      turnId: TurnId,
      providerTurnRef: string,
    ) {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE turns
        SET state = 'running', provider_turn_ref = ${providerTurnRef}, started_at = COALESCE(started_at, ${now})
        WHERE id = ${turnId} AND state IN ('starting', 'running')
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.markRunning')));
      return yield* getTurn(turnId);
    });

    const markFinalizing = Effect.fn('ThreadRepository.markFinalizing')(function* (turnId: TurnId) {
      yield* sql`UPDATE turns SET state = 'finalizing' WHERE id = ${turnId}`.pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.markFinalizing')),
      );
    });

    const finishAndPromote = Effect.fn('ThreadRepository.finishAndPromote')(function* (
      turnId: TurnId,
      outcome: TurnOutcomeType,
      reason: string | undefined,
    ) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const turn = yield* getTurn(turnId);
            const now = yield* Clock.currentTimeMillis;
            const failureJson =
              reason === undefined
                ? null
                : yield* encodeFailure(reason).pipe(
                    Effect.mapError(persistenceFailure('ThreadRepository.encodeFailure')),
                  );
            yield* sql`
            UPDATE turns
            SET state = ${terminalState(outcome)}, finished_at = ${now}, failure_json = ${failureJson}
            WHERE id = ${turnId}
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.finish')));
            const queuedRows = yield* sql<Record<string, unknown>>`
            SELECT * FROM turns
            WHERE thread_id = ${turn.threadId} AND state = 'queued'
            ORDER BY queue_position, ordinal
            LIMIT 1
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextQueued')));
            const queued = yield* Effect.forEach(queuedRows, decodeTurnRow);
            const promoted = queued[0];
            if (promoted === undefined) {
              return Option.none();
            }
            yield* sql`
            UPDATE turns SET state = 'starting', queue_position = ${null}
            WHERE id = ${promoted.id}
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.promote')));
            yield* sql`
            UPDATE turns SET queue_position = queue_position - 1
            WHERE thread_id = ${turn.threadId} AND state = 'queued'
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.reorderQueue')));
            return Option.some(yield* getTurn(promoted.id));
          }),
        )
        .pipe(Effect.catchTag('SqlError', persistenceFailure('ThreadRepository.finishAndPromote')));
    });

    const nextTimelineOrdinal = Effect.fn('ThreadRepository.nextTimelineOrdinal')(function* (
      threadId: ThreadId,
    ) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT COALESCE(MAX(ordinal), 0) + 1 AS value
        FROM timeline_items WHERE thread_id = ${threadId}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextTimelineOrdinal')));
      return (yield* Schema.decodeUnknownEffect(AggregateRow)(
        yield* firstOrFail(rows, 'ThreadRepository.nextTimelineOrdinal'),
      ).pipe(Effect.mapError(persistenceFailure('ThreadRepository.nextTimelineOrdinal')))).value;
    });

    const insertItem = Effect.fn('ThreadRepository.insertItem')(function* (
      threadId: ThreadId,
      turnId: TurnId,
      providerItemId: string | null,
      status: ItemStatusType,
      payload: TimelineItemPayloadType,
    ) {
      const now = yield* Clock.currentTimeMillis;
      const ordinal = yield* nextTimelineOrdinal(threadId);
      const payloadJson = yield* encodeTimelinePayload(payload).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.encodeTimelineItem')),
      );
      const id = `${now}-${yield* Random.nextInt}`;
      yield* sql`
        INSERT INTO timeline_items (
          id, thread_id, turn_id, ordinal, kind, status, provider_item_ref,
          payload_json, created_at, updated_at
        ) VALUES (
          ${id}, ${threadId}, ${turnId}, ${ordinal}, ${payload.kind}, ${status},
          ${providerItemId}, ${payloadJson}, ${now}, ${now}
        )
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.insertItem')));
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM timeline_items WHERE id = ${id}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.selectItem')));
      return yield* firstOrFail(
        yield* Effect.forEach(rows, decodeTimelineItemRow),
        'ThreadRepository.insertItem',
      );
    });

    const startItem = Effect.fn('ThreadRepository.startItem')(
      (
        threadId: ThreadId,
        turnId: TurnId,
        providerItemId: string,
        payload: TimelineItemPayloadType,
      ) => insertItem(threadId, turnId, providerItemId, 'inProgress', payload),
    );

    const appendItemDelta = Effect.fn('ThreadRepository.appendItemDelta')(function* (
      turnId: TurnId,
      providerItemId: string,
      part: DeltaPartType,
      delta: string,
    ) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM timeline_items
        WHERE turn_id = ${turnId} AND provider_item_ref = ${providerItemId}
        LIMIT 1
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.findDeltaItem')));
      const item = yield* firstOrFail(
        yield* Effect.forEach(rows, decodeTimelineItemRow),
        'ThreadRepository.appendItemDelta',
      );
      const payloadJson = yield* encodeTimelinePayload(appendDelta(item.payload, part, delta)).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.encodeDelta')),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE timeline_items SET payload_json = ${payloadJson}, updated_at = ${now}
        WHERE id = ${item.id}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.appendItemDelta')));
    });

    const completeItem = Effect.fn('ThreadRepository.completeItem')(function* (
      threadId: ThreadId,
      turnId: TurnId,
      providerItemId: string,
      status: ItemStatusType,
      payload: TimelineItemPayloadType,
    ) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM timeline_items
        WHERE turn_id = ${turnId} AND provider_item_ref = ${providerItemId}
        LIMIT 1
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.findCompletedItem')));
      const existing = yield* Effect.forEach(rows, decodeTimelineItemRow);
      const item = existing[0];
      if (item === undefined) {
        return yield* insertItem(threadId, turnId, providerItemId, status, payload);
      }
      const payloadJson = yield* encodeTimelinePayload(payload).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.encodeCompletedItem')),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE timeline_items
        SET status = ${status}, payload_json = ${payloadJson}, updated_at = ${now}
        WHERE id = ${item.id}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.completeItem')));
      const updatedRows = yield* sql<Record<string, unknown>>`
        SELECT * FROM timeline_items WHERE id = ${item.id}
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.selectCompletedItem')));
      return yield* firstOrFail(
        yield* Effect.forEach(updatedRows, decodeTimelineItemRow),
        'ThreadRepository.completeItem',
      );
    });

    const addApproval = Effect.fn('ThreadRepository.addApproval')(function* (
      threadId: ThreadId,
      turnId: TurnId,
      request: ApprovalRequestType,
    ) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const requestJson = yield* encodeApprovalRequest(request).pipe(
              Effect.mapError(persistenceFailure('ThreadRepository.encodeApprovalRequest')),
            );
            const now = yield* Clock.currentTimeMillis;
            yield* sql`
            INSERT INTO pending_requests (
              id, thread_id, turn_id, kind, payload_json, status, resumable,
              created_at, answered_at
            ) VALUES (
              ${request.requestId}, ${threadId}, ${turnId}, ${request.kind}, ${requestJson},
              ${'pending'}, ${true}, ${now}, ${null}
            )
            ON CONFLICT(id) DO UPDATE SET
              thread_id = excluded.thread_id,
              turn_id = excluded.turn_id,
              kind = excluded.kind,
              payload_json = excluded.payload_json,
              status = 'pending',
              resumable = 1,
              created_at = excluded.created_at,
              answered_at = NULL
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.addApproval')));
            yield* insertItem(threadId, turnId, null, 'inProgress', {
              kind: 'approval',
              request,
            });
            const rows = yield* sql<Record<string, unknown>>`
            SELECT * FROM pending_requests WHERE id = ${request.requestId}
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.selectApproval')));
            return yield* firstOrFail(
              yield* Effect.forEach(rows, decodePendingRequestRow),
              'ThreadRepository.addApproval',
            );
          }),
        )
        .pipe(Effect.catchTag('SqlError', persistenceFailure('ThreadRepository.addApproval')));
    });

    const staleRequests = Effect.fn('ThreadRepository.staleRequests')(function* (turnId: TurnId) {
      yield* sql`
        UPDATE pending_requests
        SET status = 'stale', resumable = ${false}
        WHERE turn_id = ${turnId} AND status = 'pending'
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.staleRequests')));
    });

    const staleRequest = Effect.fn('ThreadRepository.staleRequest')(function* (
      requestId: RequestId,
    ) {
      yield* sql`
        UPDATE pending_requests
        SET status = 'stale', resumable = ${false}
        WHERE id = ${requestId} AND status = 'pending'
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.staleRequest')));
    });

    const answerApproval = Effect.fn('ThreadRepository.answerApproval')(function* (
      requestId: RequestId,
      decision: ApprovalDecisionType,
    ) {
      yield* Schema.decodeEffect(ApprovalDecision)(decision).pipe(
        Effect.mapError(persistenceFailure('ThreadRepository.decodeDecision')),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE pending_requests
        SET status = 'answered', answered_at = ${now}
        WHERE id = ${requestId} AND status = 'pending'
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.answerApproval')));
      const rows = yield* sql<Record<string, unknown>>`
        SELECT * FROM timeline_items
        WHERE kind = 'approval' AND status = 'inProgress'
        ORDER BY created_at DESC
      `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.findApprovalItem')));
      const items = yield* Effect.forEach(rows, decodeTimelineItemRow);
      const item = items.find(
        (candidate) =>
          candidate.payload.kind === 'approval' &&
          candidate.payload.request.requestId === requestId,
      );
      if (item !== undefined && item.payload.kind === 'approval') {
        const payloadJson = yield* encodeTimelinePayload({
          ...item.payload,
          decision,
        }).pipe(Effect.mapError(persistenceFailure('ThreadRepository.encodeApprovalDecision')));
        yield* sql`
          UPDATE timeline_items
          SET status = 'completed', payload_json = ${payloadJson}, updated_at = ${now}
          WHERE id = ${item.id}
        `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.updateApprovalItem')));
      }
    });

    const addNotice = Effect.fn('ThreadRepository.addNotice')(
      (threadId: ThreadId, turnId: TurnId, text: string) =>
        insertItem(threadId, turnId, null, 'completed', { kind: 'notice', text }),
    );

    const reconcileStartup = sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<Record<string, unknown>>`
            SELECT DISTINCT thread_id AS id FROM turns
            WHERE state IN ('starting', 'running', 'finalizing')
            UNION
            SELECT DISTINCT thread_id AS id FROM pending_requests
            WHERE status = 'pending'
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.reconciliationThreads')));
          const ids = yield* Effect.forEach(rows, (row) =>
            Schema.decodeUnknownEffect(IdRow)(row).pipe(
              Effect.map((decoded) => decoded.id),
              Effect.mapError(persistenceFailure('ThreadRepository.decodeReconciliationThread')),
            ),
          );
          const now = yield* Clock.currentTimeMillis;
          const failureJson = yield* encodeFailure('session unavailable after restart').pipe(
            Effect.mapError(persistenceFailure('ThreadRepository.encodeInterruption')),
          );
          yield* sql`
            UPDATE turns
            SET state = 'interrupted', finished_at = ${now}, failure_json = ${failureJson}
            WHERE state IN ('starting', 'running', 'finalizing')
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.interruptOrphans')));
          yield* sql`
            UPDATE pending_requests
            SET status = 'stale', resumable = 0
            WHERE status = 'pending'
          `.pipe(Effect.mapError(persistenceFailure('ThreadRepository.staleRequests')));
          return ids;
        }),
      )
      .pipe(
        Effect.catchTag('SqlError', persistenceFailure('ThreadRepository.reconcileStartup')),
        Effect.withSpan('ThreadRepository.reconcileStartup'),
      );

    const attention = Effect.fn('ThreadRepository.attention')(function* (threadId: ThreadId) {
      const request = yield* pendingRequest(threadId);
      if (Option.isSome(request)) {
        return 'approval' as const;
      }
      const thread = yield* get(threadId);
      const turns = yield* listTurns(threadId);
      const latest = turns.at(-1);
      if (latest === undefined || Option.isNone(latest.finishedAt)) {
        return 'none' as const;
      }
      if (latest.finishedAt.value <= thread.lastViewedAt) {
        return 'none' as const;
      }
      return latest.state === 'failed'
        ? ('failed' as const)
        : latest.state === 'completed'
          ? ('completed' as const)
          : ('none' as const);
    });

    return {
      create,
      get,
      list,
      markViewed,
      delete: deleteThread,
      clearResumeRef,
      updateResumeRef,
      updateModel,
      updateApproval,
      submitMessage,
      getTurn,
      activeTurn,
      userInput,
      listTurns,
      listTimeline,
      pendingRequest,
      listRequests,
      markRunning,
      markFinalizing,
      finishAndPromote,
      startItem,
      appendItemDelta,
      completeItem,
      addApproval,
      staleRequests,
      staleRequest,
      answerApproval,
      addNotice,
      reconcileStartup,
      attention,
    };
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies;
}
