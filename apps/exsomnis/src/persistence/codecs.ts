import { Effect, Option, Schema } from 'effect';
import { ProviderId } from '@/domain/ids.ts';
import {
  ApprovalKind,
  ApprovalRequest,
  ApprovalSettings,
  ItemStatus,
  ModelInfo,
  ModelSelection,
  ResumeRef,
  TimelineItemPayload,
} from '@/domain/provider.ts';
import {
  PendingRequest,
  PendingRequestStatus,
  Project,
  Thread,
  TimelineItem,
  Turn,
  TurnState,
} from '@/domain/thread.ts';
import { PersistenceError } from '@/persistence/database.ts';
import { serializeUnknownError } from '@/errors.ts';

const ProjectRow = Schema.Struct({
  id: Schema.String,
  root_path: Schema.String,
  name: Schema.String,
  created_at: Schema.Finite,
});

const ThreadRow = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  title: Schema.String,
  provider: ProviderId,
  model_json: Schema.fromJsonString(ModelSelection),
  approval_json: Schema.fromJsonString(ApprovalSettings),
  branch: Schema.String,
  worktree_path: Schema.String,
  base_ref: Schema.String,
  base_commit: Schema.String,
  resume_ref_json: Schema.OptionFromNullOr(Schema.fromJsonString(ResumeRef)),
  created_at: Schema.Finite,
  updated_at: Schema.Finite,
  last_viewed_at: Schema.Finite,
  archived_at: Schema.OptionFromNullOr(Schema.Finite),
});

const TurnRow = Schema.Struct({
  id: Schema.String,
  thread_id: Schema.String,
  ordinal: Schema.Int,
  state: TurnState,
  queue_position: Schema.OptionFromNullOr(Schema.Int),
  provider_turn_ref: Schema.OptionFromNullOr(Schema.String),
  started_at: Schema.OptionFromNullOr(Schema.Finite),
  finished_at: Schema.OptionFromNullOr(Schema.Finite),
  failure_json: Schema.OptionFromNullOr(Schema.fromJsonString(Schema.String)),
});

const TimelineItemRow = Schema.Struct({
  id: Schema.String,
  thread_id: Schema.String,
  turn_id: Schema.String,
  ordinal: Schema.Int,
  kind: Schema.String,
  status: ItemStatus,
  provider_item_ref: Schema.OptionFromNullOr(Schema.String),
  payload_json: Schema.fromJsonString(TimelineItemPayload),
  created_at: Schema.Finite,
  updated_at: Schema.Finite,
});

const PendingRequestRow = Schema.Struct({
  id: Schema.String,
  thread_id: Schema.String,
  turn_id: Schema.String,
  kind: ApprovalKind,
  payload_json: Schema.fromJsonString(ApprovalRequest),
  status: PendingRequestStatus,
  resumable: Schema.BooleanFromBit,
  created_at: Schema.Finite,
  answered_at: Schema.OptionFromNullOr(Schema.Finite),
});

export const ModelCacheRow = Schema.Struct({
  provider: ProviderId,
  models_json: Schema.fromJsonString(Schema.Array(ModelInfo)),
  fetched_at: Schema.Finite,
});

const decodeFailure = (operation: string) => (error: unknown) =>
  PersistenceError.make({ operation, message: serializeUnknownError(error) });

export const decodeProjectRow = (row: unknown) =>
  Schema.decodeUnknownEffect(ProjectRow)(row).pipe(
    Effect.flatMap((decoded) =>
      Schema.decodeEffect(Project)({
        id: decoded.id,
        rootPath: decoded.root_path,
        name: decoded.name,
        createdAt: decoded.created_at,
      }),
    ),
    Effect.mapError(decodeFailure('ProjectRepository.decode')),
  );

export const decodeThreadRow = (row: unknown) =>
  Schema.decodeUnknownEffect(ThreadRow)(row).pipe(
    Effect.flatMap((decoded) =>
      Schema.decodeEffect(Thread)({
        id: decoded.id,
        projectId: decoded.project_id,
        title: decoded.title,
        provider: decoded.provider,
        model: decoded.model_json,
        approval: decoded.approval_json,
        branch: decoded.branch,
        worktreePath: decoded.worktree_path,
        baseRef: decoded.base_ref,
        baseCommit: decoded.base_commit,
        resumeRef: Option.getOrNull(decoded.resume_ref_json),
        createdAt: decoded.created_at,
        updatedAt: decoded.updated_at,
        lastViewedAt: decoded.last_viewed_at,
        archivedAt: Option.getOrNull(decoded.archived_at),
      }),
    ),
    Effect.mapError(decodeFailure('ThreadRepository.decodeThread')),
  );

export const decodeTurnRow = (row: unknown) =>
  Schema.decodeUnknownEffect(TurnRow)(row).pipe(
    Effect.flatMap((decoded) =>
      Schema.decodeEffect(Turn)({
        id: decoded.id,
        threadId: decoded.thread_id,
        ordinal: decoded.ordinal,
        state: decoded.state,
        queuePosition: Option.getOrNull(decoded.queue_position),
        providerTurnId: Option.getOrNull(decoded.provider_turn_ref),
        startedAt: Option.getOrNull(decoded.started_at),
        finishedAt: Option.getOrNull(decoded.finished_at),
        failure: Option.getOrNull(decoded.failure_json),
      }),
    ),
    Effect.mapError(decodeFailure('ThreadRepository.decodeTurn')),
  );

export const decodeTimelineItemRow = (row: unknown) =>
  Schema.decodeUnknownEffect(TimelineItemRow)(row).pipe(
    Effect.flatMap((decoded) =>
      Schema.decodeEffect(TimelineItem)({
        id: decoded.id,
        threadId: decoded.thread_id,
        turnId: decoded.turn_id,
        ordinal: decoded.ordinal,
        status: decoded.status,
        providerItemId: Option.getOrNull(decoded.provider_item_ref),
        payload: decoded.payload_json,
        createdAt: decoded.created_at,
        updatedAt: decoded.updated_at,
      }),
    ),
    Effect.mapError(decodeFailure('ThreadRepository.decodeTimelineItem')),
  );

export const decodePendingRequestRow = (row: unknown) =>
  Schema.decodeUnknownEffect(PendingRequestRow)(row).pipe(
    Effect.flatMap((decoded) =>
      Schema.decodeEffect(PendingRequest)({
        id: decoded.id,
        threadId: decoded.thread_id,
        turnId: decoded.turn_id,
        request: decoded.payload_json,
        status: decoded.status,
        resumable: decoded.resumable,
        createdAt: decoded.created_at,
        answeredAt: Option.getOrNull(decoded.answered_at),
      }),
    ),
    Effect.mapError(decodeFailure('ThreadRepository.decodePendingRequest')),
  );

export const encodeModelSelection = Schema.encodeEffect(Schema.fromJsonString(ModelSelection));
export const encodeApprovalSettings = Schema.encodeEffect(Schema.fromJsonString(ApprovalSettings));
export const encodeResumeRef = Schema.encodeEffect(Schema.fromJsonString(ResumeRef));
export const encodeTimelinePayload = Schema.encodeEffect(
  Schema.fromJsonString(TimelineItemPayload),
);
export const encodeApprovalRequest = Schema.encodeEffect(Schema.fromJsonString(ApprovalRequest));
export const encodeFailure = Schema.encodeEffect(Schema.fromJsonString(Schema.String));
export const encodeModels = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ModelInfo)));
