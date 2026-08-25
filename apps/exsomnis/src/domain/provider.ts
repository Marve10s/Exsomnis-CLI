import { Schema } from 'effect';
import { ProviderId, RequestId } from '@/domain/ids.ts';

export const ModelInfo = Schema.Struct({
  provider: ProviderId,
  id: Schema.String,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  isDefault: Schema.Boolean,
  reasoningEfforts: Schema.Array(Schema.String),
  defaultReasoningEffort: Schema.optionalKey(Schema.String),
});
export type ModelInfo = typeof ModelInfo.Type;

export const ModelSelection = Schema.Struct({
  model: Schema.String,
  reasoningEffort: Schema.optionalKey(Schema.String),
});
export type ModelSelection = typeof ModelSelection.Type;

export const ApprovalOption = Schema.Struct({
  value: Schema.String,
  description: Schema.optionalKey(Schema.String),
});
export type ApprovalOption = typeof ApprovalOption.Type;

export const ApprovalDimension = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  options: Schema.Array(ApprovalOption),
  defaultValue: Schema.String,
});
export type ApprovalDimension = typeof ApprovalDimension.Type;

export const ApprovalSettings = Schema.Record(Schema.String, Schema.String);
export type ApprovalSettings = typeof ApprovalSettings.Type;

export const NativeCommand = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  argumentHint: Schema.optionalKey(Schema.String),
});
export type NativeCommand = typeof NativeCommand.Type;

export const ResumeRef = Schema.Struct({
  provider: ProviderId,
  id: Schema.String,
});
export type ResumeRef = typeof ResumeRef.Type;

export const ProviderTurnRef = Schema.Struct({
  id: Schema.String,
});
export type ProviderTurnRef = typeof ProviderTurnRef.Type;

export const TurnInput = Schema.Struct({
  text: Schema.String,
});
export type TurnInput = typeof TurnInput.Type;

export const ApprovalDecision = Schema.Literals([
  'accept',
  'acceptForSession',
  'decline',
  'cancel',
]);
export type ApprovalDecision = typeof ApprovalDecision.Type;

export const ApprovalKind = Schema.Literals(['command', 'fileChange', 'permission', 'tool']);
export type ApprovalKind = typeof ApprovalKind.Type;

export const ApprovalRequest = Schema.Struct({
  requestId: RequestId,
  kind: ApprovalKind,
  title: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  decisions: Schema.Array(ApprovalDecision),
});
export type ApprovalRequest = typeof ApprovalRequest.Type;

export const ItemStatus = Schema.Literals(['inProgress', 'completed', 'failed']);
export type ItemStatus = typeof ItemStatus.Type;

export const FileChangeKind = Schema.Literals(['added', 'modified', 'deleted', 'renamed']);
export type FileChangeKind = typeof FileChangeKind.Type;

export const TimelineItemPayload = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('userMessage'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('assistantMessage'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('reasoning'), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('command'),
    command: Schema.String,
    cwd: Schema.optionalKey(Schema.String),
    output: Schema.String,
    exitCode: Schema.optionalKey(Schema.Finite),
  }),
  Schema.Struct({
    kind: Schema.Literal('fileChange'),
    path: Schema.String,
    change: FileChangeKind,
    patch: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal('toolCall'),
    name: Schema.String,
    input: Schema.String,
    output: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal('webSearch'), query: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('approval'),
    request: ApprovalRequest,
    decision: Schema.optionalKey(ApprovalDecision),
  }),
  Schema.Struct({ kind: Schema.Literal('error'), message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('notice'), text: Schema.String }),
]);
export type TimelineItemPayload = typeof TimelineItemPayload.Type;
export type TimelineItemKind = TimelineItemPayload['kind'];

export const TurnOutcome = Schema.Literals(['completed', 'interrupted', 'failed']);
export type TurnOutcome = typeof TurnOutcome.Type;

export const DeltaPart = Schema.Literals(['text', 'reasoning', 'output']);
export type DeltaPart = typeof DeltaPart.Type;

export const SessionCloseReason = Schema.Literals(['exit', 'error', 'closed']);
export type SessionCloseReason = typeof SessionCloseReason.Type;

export const ProviderEvent = Schema.Union([
  Schema.TaggedStruct('TurnStarted', { turn: ProviderTurnRef }),
  Schema.TaggedStruct('TurnCompleted', {
    turn: ProviderTurnRef,
    outcome: TurnOutcome,
    reason: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct('ItemStarted', {
    providerItemId: Schema.String,
    item: TimelineItemPayload,
  }),
  Schema.TaggedStruct('ItemDelta', {
    providerItemId: Schema.String,
    part: DeltaPart,
    delta: Schema.String,
  }),
  Schema.TaggedStruct('ItemCompleted', {
    providerItemId: Schema.String,
    status: ItemStatus,
    item: TimelineItemPayload,
  }),
  Schema.TaggedStruct('ApprovalRequested', { request: ApprovalRequest }),
  Schema.TaggedStruct('ApprovalResolved', { requestId: RequestId }),
  Schema.TaggedStruct('ModelChanged', { selection: ModelSelection }),
  Schema.TaggedStruct('TokenUsage', {
    used: Schema.Finite,
    contextWindow: Schema.optionalKey(Schema.Finite),
    total: Schema.optionalKey(Schema.Finite),
  }),
  Schema.TaggedStruct('WorkingTreeChanged', {}),
  Schema.TaggedStruct('Warning', { message: Schema.String }),
  Schema.TaggedStruct('SessionClosed', {
    reason: SessionCloseReason,
    detail: Schema.optionalKey(Schema.String),
  }),
]);
export type ProviderEvent = typeof ProviderEvent.Type;
