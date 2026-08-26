import { Schema } from 'effect';

export const RpcId = Schema.Union([Schema.Finite, Schema.String]);

export const RpcErrorBody = Schema.Struct({
  code: Schema.Finite,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Unknown),
});

export const IncomingMessage = Schema.Struct({
  id: Schema.optionalKey(RpcId),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(RpcErrorBody),
});

export const MethodProbe = Schema.Struct({
  method: Schema.optionalKey(Schema.String),
});

export const EmptyResponse = Schema.Struct({});

export const ThreadResponse = Schema.Struct({
  thread: Schema.Struct({ id: Schema.String }),
});

export const TurnStartResponse = Schema.Struct({
  turn: Schema.Struct({ id: Schema.String }),
});

export const ReasoningEffortOption = Schema.Struct({
  reasoningEffort: Schema.String,
});

export const ModelListResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      model: Schema.String,
      displayName: Schema.String,
      description: Schema.String,
      isDefault: Schema.Boolean,
      supportedReasoningEfforts: Schema.Array(ReasoningEffortOption),
      defaultReasoningEffort: Schema.String,
    }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});

export const TurnStatus = Schema.Literals(['completed', 'interrupted', 'failed', 'inProgress']);

export const Turn = Schema.Struct({
  id: Schema.String,
  status: TurnStatus,
  error: Schema.NullOr(Schema.Struct({ message: Schema.String })),
});

export const TurnStartedParams = Schema.Struct({
  threadId: Schema.String,
  turn: Turn,
});

export const TurnCompletedParams = Schema.Struct({
  threadId: Schema.String,
  turn: Turn,
});

export const ItemEnvelope = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  item: Schema.Unknown,
});

export const DeltaParams = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  itemId: Schema.String,
  delta: Schema.String,
});

export const TurnDiffUpdatedParams = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  diff: Schema.String,
});

export const TokenUsageParams = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  tokenUsage: Schema.Struct({
    total: Schema.Struct({ totalTokens: Schema.Finite }),
    last: Schema.Struct({ totalTokens: Schema.Finite }),
    modelContextWindow: Schema.NullOr(Schema.Finite),
  }),
});

export type TokenUsageParams = typeof TokenUsageParams.Type;

export const ErrorNotificationParams = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
  willRetry: Schema.Boolean,
  threadId: Schema.String,
  turnId: Schema.String,
});

export const ServerRequestResolvedParams = Schema.Struct({
  threadId: Schema.String,
  requestId: RpcId,
});

export const ItemBase = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
});

export const AgentMessageItem = Schema.Struct({
  type: Schema.Literal('agentMessage'),
  id: Schema.String,
  text: Schema.String,
});

export const ReasoningItem = Schema.Struct({
  type: Schema.Literal('reasoning'),
  id: Schema.String,
  summary: Schema.Array(Schema.String),
  content: Schema.Array(Schema.String),
});

export const CommandStatus = Schema.Literals(['inProgress', 'completed', 'failed', 'declined']);

export const CommandExecutionItem = Schema.Struct({
  type: Schema.Literal('commandExecution'),
  id: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  status: CommandStatus,
  aggregatedOutput: Schema.NullOr(Schema.String),
  exitCode: Schema.NullOr(Schema.Finite),
});

export const PatchChangeKind = Schema.Union([
  Schema.Struct({ type: Schema.Literal('add') }),
  Schema.Struct({ type: Schema.Literal('delete') }),
  Schema.Struct({ type: Schema.Literal('update'), move_path: Schema.NullOr(Schema.String) }),
]);

export const FileChangeItem = Schema.Struct({
  type: Schema.Literal('fileChange'),
  id: Schema.String,
  status: CommandStatus,
  changes: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      kind: PatchChangeKind,
      diff: Schema.String,
    }),
  ),
});

export const McpToolCallItem = Schema.Struct({
  type: Schema.Literal('mcpToolCall'),
  id: Schema.String,
  server: Schema.String,
  tool: Schema.String,
  status: Schema.Literals(['inProgress', 'completed', 'failed']),
  arguments: Schema.Unknown,
  error: Schema.NullOr(Schema.Struct({ message: Schema.String })),
});

export const DynamicToolCallItem = Schema.Struct({
  type: Schema.Literal('dynamicToolCall'),
  id: Schema.String,
  namespace: Schema.NullOr(Schema.String),
  tool: Schema.String,
  arguments: Schema.Unknown,
  status: Schema.Literals(['inProgress', 'completed', 'failed']),
  success: Schema.NullOr(Schema.Boolean),
});

export const WebSearchItem = Schema.Struct({
  type: Schema.Literal('webSearch'),
  id: Schema.String,
  query: Schema.String,
});

export const CommandApprovalParams = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  itemId: Schema.String,
  approvalId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  command: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cwd: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const FileChangeApprovalParams = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  itemId: Schema.String,
  reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  grantRoot: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const AdditionalFileSystemPermissions = Schema.Struct({
  read: Schema.NullOr(Schema.Array(Schema.String)),
  write: Schema.NullOr(Schema.Array(Schema.String)),
  globScanMaxDepth: Schema.optionalKey(Schema.Finite),
  entries: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

export const AdditionalNetworkPermissions = Schema.Struct({
  enabled: Schema.NullOr(Schema.Boolean),
});

export const RequestedPermissionProfile = Schema.Struct({
  network: Schema.NullOr(AdditionalNetworkPermissions),
  fileSystem: Schema.NullOr(AdditionalFileSystemPermissions),
});

export type RequestedPermissionProfile = typeof RequestedPermissionProfile.Type;

export const PermissionsApprovalParams = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  itemId: Schema.String,
  cwd: Schema.String,
  reason: Schema.NullOr(Schema.String),
  permissions: RequestedPermissionProfile,
});

export const SkillsListResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      cwd: Schema.String,
      skills: Schema.Array(Schema.Struct({ name: Schema.String })),
    }),
  ),
});

export const AccountUsageResponse = Schema.Struct({
  summary: Schema.Struct({
    lifetimeTokens: Schema.NullOr(Schema.Finite),
    peakDailyTokens: Schema.NullOr(Schema.Finite),
  }),
});

export const RateLimitWindow = Schema.Struct({
  usedPercent: Schema.Finite,
  windowDurationMins: Schema.NullOr(Schema.Finite),
  resetsAt: Schema.NullOr(Schema.Finite),
});

export const AccountRateLimitsResponse = Schema.Struct({
  rateLimits: Schema.Struct({
    primary: Schema.NullOr(RateLimitWindow),
    secondary: Schema.NullOr(RateLimitWindow),
  }),
});
