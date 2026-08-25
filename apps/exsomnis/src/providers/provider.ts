import type { Effect, Option, Scope, Stream } from 'effect';
import { Schema } from 'effect';
import { ProviderId } from '@/domain/ids.ts';
import type { RequestId } from '@/domain/ids.ts';
import type {
  ApprovalDecision,
  ApprovalDimension,
  ApprovalSettings,
  ModelInfo,
  ModelSelection,
  NativeCommand,
  ProviderEvent,
  ProviderTurnRef,
  ResumeRef,
  TurnInput,
} from '@/domain/provider.ts';

export class ProviderError extends Schema.TaggedError<ProviderError>()('ProviderError', {
  provider: ProviderId,
  operation: Schema.String,
  message: Schema.String,
}) {}

export class ProviderUnavailableError extends Schema.TaggedError<ProviderUnavailableError>()(
  'ProviderUnavailableError',
  {
    provider: ProviderId,
    reason: Schema.String,
  },
) {}

export const ProviderInstall = Schema.Struct({
  provider: ProviderId,
  executable: Schema.String,
  version: Schema.String,
});
export type ProviderInstall = typeof ProviderInstall.Type;

export interface SessionOptions {
  readonly cwd: string;
  readonly model: ModelSelection;
  readonly approval: ApprovalSettings;
  readonly resume: Option.Option<ResumeRef>;
}

export interface ProviderSession {
  readonly resumeRef: ResumeRef;
  readonly events: Stream.Stream<ProviderEvent, ProviderError>;
  readonly listCommands: Effect.Effect<ReadonlyArray<NativeCommand>, ProviderError>;
  readonly startTurn: (input: TurnInput) => Effect.Effect<ProviderTurnRef, ProviderError>;
  readonly interrupt: Effect.Effect<void, ProviderError>;
  readonly runCommand: (command: NativeCommand, args: string) => Effect.Effect<void, ProviderError>;
  readonly setModel: (selection: ModelSelection) => Effect.Effect<void, ProviderError>;
  readonly setApproval: (settings: ApprovalSettings) => Effect.Effect<void, ProviderError>;
  readonly respond: (
    requestId: RequestId,
    decision: ApprovalDecision,
  ) => Effect.Effect<void, ProviderError>;
}

export interface ProviderDriver {
  readonly id: ProviderId;
  readonly detect: Effect.Effect<Option.Option<ProviderInstall>>;
  readonly listModels: Effect.Effect<ReadonlyArray<ModelInfo>, ProviderError>;
  readonly approvalDimensions: ReadonlyArray<ApprovalDimension>;
  readonly openSession: (
    options: SessionOptions,
  ) => Effect.Effect<ProviderSession, ProviderError | ProviderUnavailableError, Scope.Scope>;
}
