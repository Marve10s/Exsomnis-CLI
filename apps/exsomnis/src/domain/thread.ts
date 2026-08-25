import { Schema } from 'effect';
import {
  ProjectId,
  ProviderId,
  RequestId,
  ThreadId,
  TimelineItemId,
  TurnId,
} from '@/domain/ids.ts';
import {
  ApprovalRequest,
  ApprovalSettings,
  ItemStatus,
  ModelSelection,
  ResumeRef,
  TimelineItemPayload,
} from '@/domain/provider.ts';

export const Project = Schema.Struct({
  id: ProjectId,
  rootPath: Schema.String,
  name: Schema.String,
  createdAt: Schema.Finite,
});
export type Project = typeof Project.Type;

export const Thread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  provider: ProviderId,
  model: ModelSelection,
  approval: ApprovalSettings,
  branch: Schema.String,
  worktreePath: Schema.String,
  baseRef: Schema.String,
  baseCommit: Schema.String,
  resumeRef: Schema.OptionFromNullOr(ResumeRef),
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
  lastViewedAt: Schema.Finite,
  archivedAt: Schema.OptionFromNullOr(Schema.Finite),
});
export type Thread = typeof Thread.Type;

export const TurnState = Schema.Literals([
  'queued',
  'starting',
  'running',
  'finalizing',
  'completed',
  'interrupted',
  'failed',
  'cancelled',
]);
export type TurnState = typeof TurnState.Type;

export const Turn = Schema.Struct({
  id: TurnId,
  threadId: ThreadId,
  ordinal: Schema.Int,
  state: TurnState,
  queuePosition: Schema.OptionFromNullOr(Schema.Int),
  providerTurnId: Schema.OptionFromNullOr(Schema.String),
  startedAt: Schema.OptionFromNullOr(Schema.Finite),
  finishedAt: Schema.OptionFromNullOr(Schema.Finite),
  failure: Schema.OptionFromNullOr(Schema.String),
});
export type Turn = typeof Turn.Type;

export const TimelineItem = Schema.Struct({
  id: TimelineItemId,
  threadId: ThreadId,
  turnId: TurnId,
  ordinal: Schema.Int,
  status: ItemStatus,
  providerItemId: Schema.OptionFromNullOr(Schema.String),
  payload: TimelineItemPayload,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
});
export type TimelineItem = typeof TimelineItem.Type;

export const PendingRequestStatus = Schema.Literals(['pending', 'answered', 'stale']);
export type PendingRequestStatus = typeof PendingRequestStatus.Type;

export const PendingRequest = Schema.Struct({
  id: RequestId,
  threadId: ThreadId,
  turnId: TurnId,
  request: ApprovalRequest,
  status: PendingRequestStatus,
  resumable: Schema.Boolean,
  createdAt: Schema.Finite,
  answeredAt: Schema.OptionFromNullOr(Schema.Finite),
});
export type PendingRequest = typeof PendingRequest.Type;

export const Attention = Schema.Literals(['none', 'approval', 'input', 'failed', 'completed']);
export type Attention = typeof Attention.Type;

export const ActiveView = Schema.Literals(['chat', 'diff']);
export type ActiveView = typeof ActiveView.Type;

export const FocusRegion = Schema.Literals(['sidebar', 'chat', 'diff', 'palette', 'approval']);
export type FocusRegion = typeof FocusRegion.Type;
