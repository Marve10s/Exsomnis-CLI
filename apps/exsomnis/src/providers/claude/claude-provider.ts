import { Context, Deferred, Effect, Layer, Option, Queue, Result, Schema, Stream } from 'effect';
import type { Cause } from 'effect';
import {
  query as createSdkQuery,
  type CanUseTool,
  type Options as SdkOptions,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { RequestId } from '@/domain/ids.ts';
import type {
  ApprovalDecision,
  ApprovalDimension,
  ApprovalKind,
  ApprovalSettings,
  ModelInfo,
  NativeCommand,
  ProviderEvent,
  ProviderTurnRef,
  TimelineItemPayload,
} from '@/domain/provider.ts';
import { serializeUnknownError } from '@/errors.ts';
import {
  ProviderError,
  ProviderUnavailableError,
  type ProviderDriver,
  type ProviderInstall,
  type ProviderSession,
  type SessionOptions,
} from '@/providers/provider.ts';

const sdkClaudeCodeVersion = '2.1.245';

// @effect-diagnostics cryptoRandomUUID:off -- the Claude Agent SDK requires an RFC 4122 UUID as the session id
const newUuid = () => crypto.randomUUID();

const permissionModeSchema = Schema.Literals([
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto',
]);

const messageHeaderSchema = Schema.Struct({
  type: Schema.String,
  subtype: Schema.optionalKey(Schema.String),
});

const assistantMessageSchema = Schema.Struct({
  type: Schema.Literal('assistant'),
  message: Schema.Struct({ content: Schema.Array(Schema.Unknown) }),
  uuid: Schema.String,
});

const userMessageSchema = Schema.Struct({
  type: Schema.Literal('user'),
  message: Schema.Struct({ content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]) }),
});

const textBlockSchema = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
});

const toolUseBlockSchema = Schema.Struct({
  type: Schema.Literal('tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Record(Schema.String, Schema.Unknown),
});

const toolResultBlockSchema = Schema.Struct({
  type: Schema.Literal('tool_result'),
  tool_use_id: Schema.String,
  content: Schema.optionalKey(Schema.Unknown),
  is_error: Schema.optionalKey(Schema.Boolean),
});

const streamEventSchema = Schema.Struct({
  type: Schema.Literal('stream_event'),
  event: Schema.Unknown,
  uuid: Schema.String,
});

const textDeltaEventSchema = Schema.Struct({
  type: Schema.Literal('content_block_delta'),
  delta: Schema.Struct({ type: Schema.Literal('text_delta'), text: Schema.String }),
});

const usageSchema = Schema.Struct({
  input_tokens: Schema.Finite,
  output_tokens: Schema.Finite,
});

const modelUsageSchema = Schema.Record(
  Schema.String,
  Schema.Struct({ contextWindow: Schema.Finite }),
);

const resultMessageSchema = Schema.Struct({
  type: Schema.Literal('result'),
  subtype: Schema.String,
  is_error: Schema.Boolean,
  result: Schema.optionalKey(Schema.String),
  errors: Schema.optionalKey(Schema.Array(Schema.String)),
  terminal_reason: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(usageSchema),
  modelUsage: Schema.optionalKey(modelUsageSchema),
  uuid: Schema.String,
});

const initMessageSchema = Schema.Struct({
  type: Schema.Literal('system'),
  subtype: Schema.Literal('init'),
  terminal_slash_commands: Schema.optionalKey(Schema.Array(Schema.String)),
});

const conversationResetSchema = Schema.Struct({
  type: Schema.Literal('conversation_reset'),
  new_conversation_id: Schema.String,
  uuid: Schema.String,
});

const sdkModelSchema = Schema.Struct({
  value: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
});

const decodeMessageHeader = Schema.decodeUnknownOption(messageHeaderSchema);
const decodeAssistantMessage = Schema.decodeUnknownOption(assistantMessageSchema);
const decodeUserMessage = Schema.decodeUnknownOption(userMessageSchema);
const decodeTextBlock = Schema.decodeUnknownOption(textBlockSchema);
const decodeToolUseBlock = Schema.decodeUnknownOption(toolUseBlockSchema);
const decodeToolResultBlock = Schema.decodeUnknownOption(toolResultBlockSchema);
const decodeStreamEvent = Schema.decodeUnknownOption(streamEventSchema);
const decodeTextDeltaEvent = Schema.decodeUnknownOption(textDeltaEventSchema);
const decodeResultMessage = Schema.decodeUnknownOption(resultMessageSchema);
const decodeInitMessage = Schema.decodeUnknownOption(initMessageSchema);
const decodeConversationReset = Schema.decodeUnknownOption(conversationResetSchema);
const decodeSdkModel = Schema.decodeUnknownOption(sdkModelSchema);
const decodePermissionMode = Schema.decodeUnknownOption(permissionModeSchema);

const claudeApprovalDimensions: ReadonlyArray<ApprovalDimension> = [
  {
    id: 'permissionMode',
    label: 'Permission mode',
    options: [
      { value: 'default' },
      { value: 'acceptEdits' },
      { value: 'plan' },
      { value: 'bypassPermissions' },
      { value: 'dontAsk' },
      { value: 'auto' },
    ],
    defaultValue: 'default',
  },
];

type SessionOutput =
  | { readonly kind: 'event'; readonly event: ProviderEvent }
  | {
      readonly kind: 'debug';
      readonly messageType: string;
      readonly messageSubtype?: string;
    };

interface ActiveTurn {
  readonly turn: ProviderTurnRef;
  hasAssistantText: boolean;
}

interface PendingTool {
  readonly item: TimelineItemPayload;
  readonly changesWorkingTree: boolean;
}

interface ApprovalWaiter {
  readonly requestId: RequestId;
  readonly deferred: Deferred.Deferred<PermissionResult>;
  readonly resolve: (result: PermissionResult) => void;
  readonly signal: AbortSignal;
  readonly abort: () => void;
}

interface PendingApproval {
  readonly deferred: Deferred.Deferred<PermissionResult>;
  readonly input: Record<string, unknown>;
  readonly toolUseId: string;
  readonly suggestions: ReadonlyArray<PermissionUpdate>;
}

interface SessionState {
  resumeId: string;
  activeTurn: ActiveTurn | undefined;
  interrupting: boolean;
  closing: boolean;
  closed: boolean;
  streaming: { readonly id: string; text: string } | undefined;
  readonly pendingTools: Map<string, PendingTool>;
  readonly pendingApprovals: Map<RequestId, PendingApproval>;
  readonly terminalCommands: Set<string>;
}

const providerError = (operation: string, error: unknown) =>
  ProviderError.make({
    provider: 'claude',
    operation,
    message: serializeUnknownError(error),
  });

const resolveExecutable = Effect.fn('ClaudeProvider.resolveExecutable')(function* () {
  const executable = yield* Effect.try({
    try: () => Bun.which('claude'),
    catch: (error) =>
      ProviderError.make({
        provider: 'claude',
        operation: 'resolveExecutable',
        message: serializeUnknownError(error),
      }),
  });
  return yield* executable === null
    ? Effect.fail(
        ProviderUnavailableError.make({
          provider: 'claude',
          reason: 'claude was not found on PATH',
        }),
      )
    : Effect.succeed(executable);
});

const readInstalledVersion = Effect.fn('ClaudeProvider.readInstalledVersion')(
  (executable: string) =>
    Effect.try({
      try: () => {
        const result = Bun.spawnSync([executable, '--version'], { stdout: 'pipe', stderr: 'pipe' });
        const output = (result.exitCode === 0 ? result.stdout : result.stderr).toString().trim();
        return { exitCode: result.exitCode, output };
      },
      catch: (error) =>
        ProviderError.make({
          provider: 'claude',
          operation: 'detect',
          message: serializeUnknownError(error),
        }),
    }).pipe(
      Effect.flatMap(({ exitCode, output }) =>
        exitCode === 0
          ? Effect.succeed(output)
          : Effect.fail(
              providerError(
                'detect',
                output.length > 0 ? output : `claude exited with code ${exitCode}`,
              ),
            ),
      ),
    ),
);

const detectInstall = Effect.fn('ClaudeProvider.detectInstall')(function* () {
  const executable = yield* resolveExecutable();
  const version = yield* readInstalledVersion(executable);
  return {
    provider: 'claude',
    executable,
    version,
  } satisfies ProviderInstall;
});

const cleanVersion = (version: string) => version.match(/\d+\.\d+\.\d+/u)?.[0] ?? version;

const versionWarning = (installedVersion: string) => {
  const installed = cleanVersion(installedVersion);
  return installed === sdkClaudeCodeVersion
    ? Option.none<string>()
    : Option.some(
        `Claude Code ${installed} differs from the SDK bundled version ${sdkClaudeCodeVersion}`,
      );
};

const approvalMode = (settings: ApprovalSettings) =>
  decodePermissionMode(settings['permissionMode'] ?? 'default');

const normalizeCommandName = (name: string) => name.trim().replace(/^\/+/, '').toLocaleLowerCase();

const makeUserMessage = (text: string): SDKUserMessage => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
});

const inputString = (input: Record<string, unknown>, key: string) => {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
};

const approvalKind = (toolName: string): ApprovalKind => {
  if (toolName === 'Bash') {
    return 'command';
  }
  if (['Edit', 'MultiEdit', 'NotebookEdit', 'Write'].includes(toolName)) {
    return 'fileChange';
  }
  return 'tool';
};

const toolItem = (name: string, input: Record<string, unknown>): PendingTool => {
  const detail = Bun.inspect(input);
  if (name === 'Bash') {
    const cwd = inputString(input, 'cwd');
    return {
      item: {
        kind: 'command',
        command: inputString(input, 'command') ?? detail,
        ...(cwd === undefined ? {} : { cwd }),
        output: '',
      },
      changesWorkingTree: false,
    };
  }
  if (['Edit', 'MultiEdit', 'NotebookEdit', 'Write'].includes(name)) {
    return {
      item: {
        kind: 'fileChange',
        path:
          inputString(input, 'file_path') ?? inputString(input, 'notebook_path') ?? 'unknown path',
        change: 'modified',
        patch: detail,
      },
      changesWorkingTree: true,
    };
  }
  if (name === 'WebFetch' || name === 'WebSearch') {
    return {
      item: {
        kind: 'webSearch',
        query: inputString(input, 'query') ?? inputString(input, 'url') ?? detail,
      },
      changesWorkingTree: false,
    };
  }
  return {
    item: { kind: 'toolCall', name, input: detail },
    changesWorkingTree: false,
  };
};

const completedToolItem = (pending: PendingTool, output: string): TimelineItemPayload => {
  if (pending.item.kind === 'command') {
    return { ...pending.item, output };
  }
  if (pending.item.kind === 'toolCall') {
    return { ...pending.item, output };
  }
  return pending.item;
};

const renderToolResult = (content: unknown) =>
  typeof content === 'string' ? content : content === undefined ? '' : Bun.inspect(content);

const permissionResult = (
  decision: ApprovalDecision,
  pending: PendingApproval,
): PermissionResult => {
  if (decision === 'accept') {
    return {
      behavior: 'allow',
      updatedInput: pending.input,
      toolUseID: pending.toolUseId,
      decisionClassification: 'user_temporary',
    };
  }
  if (decision === 'acceptForSession') {
    return {
      behavior: 'allow',
      updatedInput: pending.input,
      toolUseID: pending.toolUseId,
      decisionClassification: 'user_permanent',
      updatedPermissions: pending.suggestions.filter(
        (suggestion) => suggestion.destination === 'session',
      ),
    };
  }
  if (decision === 'cancel') {
    return { behavior: 'deny', message: 'Cancelled by the user', interrupt: true };
  }
  return { behavior: 'deny', message: 'Declined by the user' };
};

const openSdkQuery = Effect.fn('ClaudeProvider.openSdkQuery')(
  (prompt: AsyncIterable<SDKUserMessage>, options: SdkOptions) =>
    Effect.try({
      try: () => createSdkQuery({ prompt, options }),
      catch: (error) =>
        ProviderError.make({
          provider: 'claude',
          operation: 'openSession',
          message: serializeUnknownError(error),
        }),
    }),
);

const closeSdkQuery = Effect.fn('ClaudeProvider.closeSdkQuery')((sdkQuery: Query) =>
  Effect.try({
    try: () => sdkQuery.close(),
    catch: (error) =>
      ProviderError.make({
        provider: 'claude',
        operation: 'close',
        message: serializeUnknownError(error),
      }),
  }),
);

const supportedSdkCommands = Effect.fn('ClaudeProvider.supportedCommands')((sdkQuery: Query) =>
  Effect.tryPromise({
    try: () => sdkQuery.supportedCommands(),
    catch: (error) =>
      ProviderError.make({
        provider: 'claude',
        operation: 'listCommands',
        message: serializeUnknownError(error),
      }),
  }),
);

const supportedSdkModels = Effect.fn('ClaudeProvider.supportedModels')((sdkQuery: Query) =>
  Effect.tryPromise({
    try: () => sdkQuery.supportedModels(),
    catch: (error) =>
      ProviderError.make({
        provider: 'claude',
        operation: 'listModels',
        message: serializeUnknownError(error),
      }),
  }),
);

const interruptSdkQuery = Effect.fn('ClaudeProvider.interruptSdkQuery')((sdkQuery: Query) =>
  Effect.tryPromise({
    try: () => sdkQuery.interrupt(),
    catch: (error) =>
      ProviderError.make({
        provider: 'claude',
        operation: 'interrupt',
        message: serializeUnknownError(error),
      }),
  }),
);

const setSdkModel = Effect.fn('ClaudeProvider.setSdkModel')((sdkQuery: Query, model: string) =>
  Effect.tryPromise({
    try: () => sdkQuery.setModel(model),
    catch: (error) =>
      ProviderError.make({
        provider: 'claude',
        operation: 'setModel',
        message: serializeUnknownError(error),
      }),
  }),
);

const setSdkPermissionMode = Effect.fn('ClaudeProvider.setSdkPermissionMode')(
  (sdkQuery: Query, mode: PermissionMode) =>
    Effect.tryPromise({
      try: () => sdkQuery.setPermissionMode(mode),
      catch: (error) =>
        ProviderError.make({
          provider: 'claude',
          operation: 'setApproval',
          message: serializeUnknownError(error),
        }),
    }),
);

const mapModels = (models: ReadonlyArray<unknown>): ReadonlyArray<ModelInfo> =>
  models.flatMap((candidate) =>
    Option.match(decodeSdkModel(candidate), {
      onNone: () => [],
      onSome: (model) => [
        {
          provider: 'claude',
          id: model.value,
          displayName: model.displayName,
          description: model.description,
          isDefault: model.value === 'default',
          reasoningEfforts: [],
        },
      ],
    }),
  );

const queryOptions = (
  options: SessionOptions,
  executable: string,
  sessionId: string,
  mode: PermissionMode,
  canUseTool: CanUseTool,
): SdkOptions => ({
  cwd: options.cwd,
  model: options.model.model,
  permissionMode: mode,
  includePartialMessages: true,
  pathToClaudeCodeExecutable: executable,
  env: { ...Bun.env },
  canUseTool,
  ...(mode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
  ...Option.match(options.resume, {
    onNone: () => ({ sessionId }),
    onSome: (resume) => ({ resume: resume.id }),
  }),
});

const probeModels = Effect.fn('ClaudeProvider.listModels')(function* () {
  const executable = yield* resolveExecutable().pipe(
    Effect.catchTag('ProviderUnavailableError', (error) =>
      Effect.fail(providerError('listModels', error.reason)),
    ),
  );
  const inputQueue = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
  const prompt = Stream.toAsyncIterable(Stream.fromQueue(inputQueue));
  const sdkQuery = yield* openSdkQuery(prompt, {
    cwd: Bun.env['PWD'] ?? '.',
    model: 'default',
    permissionMode: 'default',
    includePartialMessages: true,
    pathToClaudeCodeExecutable: executable,
    env: { ...Bun.env },
    persistSession: false,
    sessionId: newUuid(),
  });
  return yield* supportedSdkModels(sdkQuery).pipe(
    Effect.map(mapModels),
    Effect.ensuring(closeSdkQuery(sdkQuery).pipe(Effect.ignore)),
  );
});

const openSession = Effect.fn('ClaudeProvider.openSession')(function* (options: SessionOptions) {
  const executable = yield* resolveExecutable();
  const installedVersion = yield* readInstalledVersion(executable);
  const mode = yield* Option.match(approvalMode(options.approval), {
    onNone: () =>
      Effect.fail(
        providerError(
          'openSession',
          `unsupported permission mode: ${options.approval['permissionMode'] ?? ''}`,
        ),
      ),
    onSome: Effect.succeed,
  });
  const sessionId = Option.match(options.resume, {
    onNone: () => newUuid(),
    onSome: (resume) => resume.id,
  });
  const state: SessionState = {
    resumeId: sessionId,
    activeTurn: undefined,
    interrupting: false,
    closing: false,
    closed: false,
    streaming: undefined,
    pendingTools: new Map(),
    pendingApprovals: new Map(),
    terminalCommands: new Set(),
  };
  const inputQueue = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
  const outputQueue = yield* Queue.unbounded<SessionOutput, ProviderError | Cause.Done>();
  const approvalQueue = yield* Queue.unbounded<ApprovalWaiter>();
  const queryDone = yield* Deferred.make<void>();
  const initReady = yield* Deferred.make<void>();
  const emit = (event: ProviderEvent) => Queue.offerUnsafe(outputQueue, { kind: 'event', event });
  const emitDebug = (messageType: string, messageSubtype?: string) =>
    Queue.offerUnsafe(outputQueue, {
      kind: 'debug',
      messageType,
      ...(messageSubtype === undefined ? {} : { messageSubtype }),
    });
  const finishActiveTurn = (outcome: 'completed' | 'interrupted' | 'failed', reason?: string) => {
    const active = state.activeTurn;
    if (active === undefined) {
      return;
    }
    state.activeTurn = undefined;
    const streaming = state.streaming;
    if (streaming !== undefined) {
      state.streaming = undefined;
      emit({
        _tag: 'ItemCompleted',
        providerItemId: streaming.id,
        status: 'completed',
        item: { kind: 'assistantMessage', text: streaming.text },
      });
    }
    emit({
      _tag: 'TurnCompleted',
      turn: active.turn,
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  };
  const handleToolResult = (block: typeof toolResultBlockSchema.Type) => {
    const pending = state.pendingTools.get(block.tool_use_id);
    if (pending === undefined) {
      return;
    }
    state.pendingTools.delete(block.tool_use_id);
    emit({
      _tag: 'ItemCompleted',
      providerItemId: block.tool_use_id,
      status: block.is_error === true ? 'failed' : 'completed',
      item: completedToolItem(pending, renderToolResult(block.content)),
    });
    if (pending.changesWorkingTree) {
      emit({ _tag: 'WorkingTreeChanged' });
    }
  };
  const completeAssistantText = (messageUuid: string, text: string) => {
    const active = state.activeTurn;
    if (active !== undefined) {
      active.hasAssistantText = true;
    }
    const streaming = state.streaming;
    state.streaming = undefined;
    if (streaming === undefined) {
      emit({
        _tag: 'ItemStarted',
        providerItemId: messageUuid,
        item: { kind: 'assistantMessage', text },
      });
    }
    emit({
      _tag: 'ItemCompleted',
      providerItemId: streaming === undefined ? messageUuid : streaming.id,
      status: 'completed',
      item: { kind: 'assistantMessage', text },
    });
  };
  const handleContentBlock = (block: unknown) => {
    const toolUse = decodeToolUseBlock(block);
    if (Option.isSome(toolUse)) {
      const pending = toolItem(toolUse.value.name, toolUse.value.input);
      state.pendingTools.set(toolUse.value.id, pending);
      emit({ _tag: 'ItemStarted', providerItemId: toolUse.value.id, item: pending.item });
      return;
    }
    const toolResult = decodeToolResultBlock(block);
    if (Option.isSome(toolResult)) {
      handleToolResult(toolResult.value);
    }
  };
  const handleMessage = (message: unknown) => {
    const header = decodeMessageHeader(message);
    if (Option.isNone(header)) {
      emitDebug('invalid');
      return;
    }
    if (header.value.type === 'assistant') {
      const assistant = decodeAssistantMessage(message);
      if (Option.isNone(assistant)) {
        emitDebug(header.value.type, header.value.subtype);
        return;
      }
      const completedText = assistant.value.message.content.flatMap((block) => {
        const decoded = decodeTextBlock(block);
        return Option.isSome(decoded) ? [decoded.value.text] : [];
      });
      if (completedText.length > 0) {
        completeAssistantText(assistant.value.uuid, completedText.join(''));
      }
      for (const block of assistant.value.message.content) {
        if (Option.isNone(decodeTextBlock(block))) {
          handleContentBlock(block);
        }
      }
      return;
    }
    if (header.value.type === 'user') {
      const user = decodeUserMessage(message);
      if (Option.isNone(user)) {
        emitDebug(header.value.type, header.value.subtype);
        return;
      }
      if (typeof user.value.message.content !== 'string') {
        for (const block of user.value.message.content) {
          const toolResult = decodeToolResultBlock(block);
          if (Option.isSome(toolResult)) {
            handleToolResult(toolResult.value);
          }
        }
      }
      return;
    }
    if (header.value.type === 'stream_event') {
      const streamEvent = decodeStreamEvent(message);
      if (Option.isNone(streamEvent)) {
        emitDebug(header.value.type, header.value.subtype);
        return;
      }
      const deltaEvent = decodeTextDeltaEvent(streamEvent.value.event);
      if (Option.isNone(deltaEvent)) {
        return;
      }
      const streaming = state.streaming ?? { id: streamEvent.value.uuid, text: '' };
      if (state.streaming === undefined) {
        state.streaming = streaming;
        emit({
          _tag: 'ItemStarted',
          providerItemId: streaming.id,
          item: { kind: 'assistantMessage', text: '' },
        });
      }
      streaming.text += deltaEvent.value.delta.text;
      emit({
        _tag: 'ItemDelta',
        providerItemId: streaming.id,
        part: 'text',
        delta: deltaEvent.value.delta.text,
      });
      return;
    }
    if (header.value.type === 'result') {
      const result = decodeResultMessage(message);
      if (Option.isNone(result)) {
        emitDebug(header.value.type, header.value.subtype);
        return;
      }
      const active = state.activeTurn;
      if (active === undefined) {
        return;
      }
      const diagnostic = result.value.result?.startsWith('[ede_diagnostic]') === true;
      const interrupted =
        result.value.terminal_reason === 'aborted_tools' ||
        result.value.terminal_reason === 'aborted_streaming';
      const failed = result.value.subtype !== 'success' || result.value.is_error;
      const resultDetail = diagnostic
        ? undefined
        : (result.value.result ?? result.value.errors?.join('\n') ?? result.value.subtype);
      if (
        !active.hasAssistantText &&
        !failed &&
        !diagnostic &&
        result.value.result !== undefined &&
        result.value.result.length > 0
      ) {
        emit({
          _tag: 'ItemStarted',
          providerItemId: result.value.uuid,
          item: { kind: 'assistantMessage', text: result.value.result },
        });
        emit({
          _tag: 'ItemCompleted',
          providerItemId: result.value.uuid,
          status: 'completed',
          item: { kind: 'assistantMessage', text: result.value.result },
        });
      }
      if (failed && resultDetail !== undefined) {
        emit({
          _tag: 'ItemStarted',
          providerItemId: result.value.uuid,
          item: { kind: 'error', message: resultDetail },
        });
        emit({
          _tag: 'ItemCompleted',
          providerItemId: result.value.uuid,
          status: 'failed',
          item: { kind: 'error', message: resultDetail },
        });
      }
      if (result.value.usage !== undefined) {
        const used = result.value.usage.input_tokens + result.value.usage.output_tokens;
        const contextWindows = Object.values(result.value.modelUsage ?? {}).map(
          (usage) => usage.contextWindow,
        );
        const contextWindow = contextWindows.length === 0 ? undefined : Math.max(...contextWindows);
        emit({
          _tag: 'TokenUsage',
          used,
          total: used,
          ...(contextWindow === undefined ? {} : { contextWindow }),
        });
      }
      finishActiveTurn(
        interrupted ? 'interrupted' : failed ? 'failed' : 'completed',
        interrupted || failed ? resultDetail : undefined,
      );
      return;
    }
    if (header.value.type === 'system' && header.value.subtype === 'init') {
      const init = decodeInitMessage(message);
      if (Option.isNone(init)) {
        emitDebug(header.value.type, header.value.subtype);
        return;
      }
      state.terminalCommands.clear();
      for (const command of init.value.terminal_slash_commands ?? []) {
        state.terminalCommands.add(normalizeCommandName(command));
      }
      Deferred.doneUnsafe(initReady, Effect.void);
      return;
    }
    if (header.value.type === 'conversation_reset') {
      const reset = decodeConversationReset(message);
      if (Option.isNone(reset)) {
        emitDebug(header.value.type, header.value.subtype);
        return;
      }
      state.resumeId = reset.value.new_conversation_id;
      emit({
        _tag: 'ItemStarted',
        providerItemId: reset.value.uuid,
        item: { kind: 'notice', text: 'Claude Code started a new conversation' },
      });
      emit({
        _tag: 'ItemCompleted',
        providerItemId: reset.value.uuid,
        status: 'completed',
        item: { kind: 'notice', text: 'Claude Code started a new conversation' },
      });
      finishActiveTurn('completed', 'conversation reset');
      return;
    }
    emitDebug(header.value.type, header.value.subtype);
  };
  const canUseTool: CanUseTool = (toolName, input, sdkOptions) => {
    const requestId = RequestId.make(newUuid());
    const deferred = Deferred.makeUnsafe<PermissionResult>();
    const pending: PendingApproval = {
      deferred,
      input,
      toolUseId: sdkOptions.toolUseID,
      suggestions: sdkOptions.suggestions ?? [],
    };
    state.pendingApprovals.set(requestId, pending);
    emit({
      _tag: 'ApprovalRequested',
      request: {
        requestId,
        kind: approvalKind(toolName),
        title:
          sdkOptions.title ??
          sdkOptions.description ??
          sdkOptions.decisionReason ??
          `Allow ${toolName}`,
        detail: Bun.inspect(input),
        decisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
      },
    });
    const promise = globalThis.Promise.withResolvers<PermissionResult>();
    const abort = () => {
      Deferred.doneUnsafe(deferred, Effect.succeed(permissionResult('cancel', pending)));
    };
    if (sdkOptions.signal.aborted) {
      abort();
    } else {
      sdkOptions.signal.addEventListener('abort', abort, { once: true });
    }
    Queue.offerUnsafe(approvalQueue, {
      requestId,
      deferred,
      resolve: promise.resolve,
      signal: sdkOptions.signal,
      abort,
    });
    return promise.promise;
  };
  const prompt = Stream.toAsyncIterable(Stream.fromQueue(inputQueue));
  const sdkQuery = yield* openSdkQuery(
    prompt,
    queryOptions(options, executable, sessionId, mode, canUseTool),
  );
  const approvalDispatcher = Effect.forever(
    Queue.take(approvalQueue).pipe(
      Effect.flatMap((waiter) =>
        Deferred.await(waiter.deferred).pipe(
          Effect.flatMap((result) =>
            Effect.sync(() => {
              state.pendingApprovals.delete(waiter.requestId);
              waiter.signal.removeEventListener('abort', waiter.abort);
              emit({ _tag: 'ApprovalResolved', requestId: waiter.requestId });
              waiter.resolve(result);
            }),
          ),
          Effect.forkChild,
        ),
      ),
    ),
  );
  yield* Effect.forkScoped(approvalDispatcher);
  const consumeQuery = Stream.fromAsyncIterable(sdkQuery, (error) =>
    ProviderError.make({
      provider: 'claude',
      operation: 'messageStream',
      message: serializeUnknownError(error),
    }),
  ).pipe(
    Stream.runForEach((message) => Effect.sync(() => handleMessage(message))),
    Effect.tapError((error) =>
      Effect.sync(() => {
        finishActiveTurn(state.interrupting ? 'interrupted' : 'failed', error.message);
        emit({ _tag: 'SessionClosed', reason: 'error', detail: error.message });
      }).pipe(Effect.andThen(Queue.fail(outputQueue, error))),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        if (state.activeTurn !== undefined) {
          finishActiveTurn(
            state.interrupting ? 'interrupted' : 'failed',
            state.interrupting ? 'interrupted by the user' : 'query exited before a result',
          );
        }
        if (!state.closing) {
          emit({ _tag: 'SessionClosed', reason: 'exit' });
        }
        Deferred.doneUnsafe(queryDone, Effect.void);
        Queue.endUnsafe(outputQueue);
      }),
    ),
  );
  yield* Effect.forkScoped(consumeQuery);
  const closeQuery = Effect.fn('ClaudeProvider.closeSessionQuery')(function* () {
    if (state.closed) {
      return;
    }
    state.closed = true;
    yield* Queue.end(inputQueue);
    yield* closeSdkQuery(sdkQuery);
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      state.closing = true;
      for (const pending of state.pendingApprovals.values()) {
        Deferred.doneUnsafe(pending.deferred, Effect.succeed(permissionResult('cancel', pending)));
      }
    }).pipe(
      Effect.andThen(closeQuery()),
      Effect.catchTag('ProviderError', (error) =>
        Effect.logWarning('Failed to close Claude Code session').pipe(
          Effect.annotateLogs({ operation: error.operation, message: error.message }),
        ),
      ),
    ),
  );
  Option.map(versionWarning(installedVersion), (message) => emit({ _tag: 'Warning', message }));
  const events = Stream.fromQueue(outputQueue).pipe(
    Stream.filterMapEffect((output) =>
      output.kind === 'event'
        ? Effect.succeed(Result.succeed(output.event))
        : Effect.logDebug('Ignored Claude Code SDK message').pipe(
            Effect.annotateLogs({
              messageType: output.messageType,
              ...(output.messageSubtype === undefined
                ? {}
                : { messageSubtype: output.messageSubtype }),
            }),
            Effect.as(Result.fail(undefined)),
          ),
    ),
  );
  const beginTurn = Effect.fn('ClaudeProvider.beginTurn')(function* (text: string) {
    if (state.closed) {
      return yield* providerError('startTurn', 'session is closed');
    }
    if (state.activeTurn !== undefined) {
      return yield* providerError('startTurn', 'a turn is already active');
    }
    const turn = { id: newUuid() } satisfies ProviderTurnRef;
    state.activeTurn = { turn, hasAssistantText: false };
    emit({ _tag: 'TurnStarted', turn });
    yield* Queue.offer(inputQueue, makeUserMessage(text));
    return turn;
  });
  const listCommands = Effect.fn('ClaudeProvider.listCommands')(function* () {
    const commands = yield* supportedSdkCommands(sdkQuery);
    yield* Deferred.await(initReady).pipe(Effect.timeoutOption('10 seconds'));
    const seen = new Set<string>();
    return commands.flatMap((command): ReadonlyArray<NativeCommand> => {
      const normalized = normalizeCommandName(command.name);
      if (
        normalized.length === 0 ||
        seen.has(normalized) ||
        state.terminalCommands.has(normalized)
      ) {
        return [];
      }
      seen.add(normalized);
      const argumentHint = command.argumentHint.trim();
      return [
        {
          name: command.name.trim().replace(/^\/+/, ''),
          description: command.description,
          ...(argumentHint.length === 0 ? {} : { argumentHint }),
        },
      ];
    });
  });
  const interrupt = Effect.fn('ClaudeProvider.interrupt')(function* () {
    if (state.closed) {
      return;
    }
    state.interrupting = true;
    yield* interruptSdkQuery(sdkQuery).pipe(
      Effect.ensuring(
        closeQuery().pipe(
          Effect.catchTag('ProviderError', (error) =>
            Effect.logWarning('Claude Code query close failed').pipe(
              Effect.annotateLogs({ operation: error.operation, message: error.message }),
            ),
          ),
        ),
      ),
      Effect.andThen(Deferred.await(queryDone)),
      Effect.timeoutOption('10 seconds'),
      Effect.catchTag('ProviderError', (error) =>
        Effect.logWarning('Claude Code interrupt cleanup failed').pipe(
          Effect.annotateLogs({ operation: error.operation, message: error.message }),
          Effect.as(Option.none()),
        ),
      ),
    );
    finishActiveTurn('interrupted', 'interrupted by the user');
  });
  const runCommand = Effect.fn('ClaudeProvider.runCommand')(function* (
    command: NativeCommand,
    args: string,
  ) {
    const suffix = args.trim();
    yield* beginTurn(`/${command.name}${suffix.length === 0 ? '' : ` ${suffix}`}`);
  });
  const setModel = Effect.fn('ClaudeProvider.setModel')(function* (model: string) {
    yield* setSdkModel(sdkQuery, model);
    emit({ _tag: 'ModelChanged', selection: { model } });
  });
  const setApproval = Effect.fn('ClaudeProvider.setApproval')(function* (
    settings: ApprovalSettings,
  ) {
    const nextMode = approvalMode(settings);
    if (Option.isNone(nextMode)) {
      return yield* providerError(
        'setApproval',
        `unsupported permission mode: ${settings['permissionMode'] ?? ''}`,
      );
    }
    yield* setSdkPermissionMode(sdkQuery, nextMode.value);
  });
  const respond = Effect.fn('ClaudeProvider.respond')(function* (
    requestId: RequestId,
    decision: ApprovalDecision,
  ) {
    const pending = state.pendingApprovals.get(requestId);
    if (pending === undefined) {
      return yield* providerError('respond', `approval request ${requestId} is not pending`);
    }
    yield* Deferred.succeed(pending.deferred, permissionResult(decision, pending));
  });
  return {
    get resumeRef() {
      return { provider: 'claude', id: state.resumeId } as const;
    },
    events,
    listCommands: listCommands(),
    startTurn: (input) => beginTurn(input.text),
    interrupt: interrupt(),
    runCommand,
    setModel: (selection) => setModel(selection.model),
    setApproval,
    respond,
  } satisfies ProviderSession;
});

export class ClaudeProvider extends Context.Service<ClaudeProvider, ProviderDriver>()(
  'exsomnis/providers/claude/claude-provider/ClaudeProvider',
  {
    make: Effect.succeed({
      id: 'claude',
      detect: detectInstall().pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          ProviderError: () => Effect.succeed(Option.none()),
          ProviderUnavailableError: () => Effect.succeed(Option.none()),
        }),
      ),
      listModels: probeModels(),
      approvalDimensions: claudeApprovalDimensions,
      openSession,
    } satisfies ProviderDriver),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
