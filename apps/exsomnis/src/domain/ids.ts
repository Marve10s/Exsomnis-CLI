import { Schema } from 'effect';

export const ProjectId = Schema.String.pipe(Schema.brand('ProjectId'));
export type ProjectId = typeof ProjectId.Type;

export const ThreadId = Schema.String.pipe(Schema.brand('ThreadId'));
export type ThreadId = typeof ThreadId.Type;

export const TurnId = Schema.String.pipe(Schema.brand('TurnId'));
export type TurnId = typeof TurnId.Type;

export const TimelineItemId = Schema.String.pipe(Schema.brand('TimelineItemId'));
export type TimelineItemId = typeof TimelineItemId.Type;

export const RequestId = Schema.String.pipe(Schema.brand('RequestId'));
export type RequestId = typeof RequestId.Type;

export const ProviderId = Schema.Literals(['codex', 'claude']);
export type ProviderId = typeof ProviderId.Type;
