import { BunServices } from '@effect/platform-bun';
import {
  type Cause,
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { RequestId } from '@/domain/ids.ts';
import type {
  ApprovalDecision,
  ApprovalDimension,
  ApprovalRequest,
  ApprovalSettings,
  ItemStatus,
  ModelInfo,
  ModelSelection,
  NativeCommand,
  ProviderEvent,
  TimelineItemPayload,
} from '@/domain/provider.ts';
import { serializeUnknownError } from '@/errors.ts';
import {
  AccountRateLimitsResponse,
  AccountUsageResponse,
  AgentMessageItem,
  CommandApprovalParams,
  CommandExecutionItem,
  DeltaParams,
  DynamicToolCallItem,
  EmptyResponse,
  ErrorNotificationParams,
  FileChangeApprovalParams,
  FileChangeItem,
  ItemBase,
  ItemEnvelope,
  McpToolCallItem,
  ModelListResponse,
  PermissionsApprovalParams,
  ReasoningItem,
  ServerRequestResolvedParams,
  SkillsListResponse,
  ThreadResponse,
  TokenUsageParams,
  TurnCompletedParams,
  TurnDiffUpdatedParams,
  TurnStartedParams,
  TurnStartResponse,
  WebSearchItem,
  type RequestedPermissionProfile,
} from '@/providers/codex/codex-schemas.ts';
import {
  makeCodexTransport,
  type CodexInbound,
  type CodexTransport,
} from '@/providers/codex/codex-transport.ts';
import {
  ProviderError,
  ProviderUnavailableError,
  type ProviderDriver,
  type ProviderSession,
  type SessionOptions,
} from '@/providers/provider.ts';

const codexApprovalDimensions: ReadonlyArray<ApprovalDimension> = [
  {
    id: 'approvalPolicy',
    label: 'Approval policy',
    options: [{ value: 'untrusted' }, { value: 'on-request' }, { value: 'never' }],
    defaultValue: 'on-request',
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    options: [
      { value: 'read-only' },
      { value: 'workspace-write' },
      { value: 'danger-full-access' },
    ],
    defaultValue: 'workspace-write',
  },
];

const codexCommands: ReadonlyArray<NativeCommand> = [
  { name: 'compact', description: 'Compact the conversation context' },
  { name: 'review', description: 'Review working changes', argumentHint: '[instructions]' },
  { name: 'skills', description: 'List available skills' },
  { name: 'status', description: 'Show thread and token status' },
  { name: 'usage', description: 'Show account usage and rate limits' },
  { name: 'rename', description: 'Rename the conversation', argumentHint: '<name>' },
];

const ApprovalPolicy = Schema.Literals(['untrusted', 'on-request', 'never']);
const Sandbox = Schema.Literals(['read-only', 'workspace-write', 'danger-full-access']);
const CodexApprovalSettings = Schema.Struct({
  approvalPolicy: ApprovalPolicy,
  sandbox: Sandbox,
});
type CodexApprovalSettings = typeof CodexApprovalSettings.Type;

const UnknownJson = Schema.fromJsonString(Schema.Unknown);

interface CommandResult {
  readonly stdout: string;
  readonly exitCode: number;
}

interface PendingApproval {
  readonly requestId: RequestId;
  readonly transportId: number | string;
  readonly kind: 'command' | 'fileChange' | 'permission';
  readonly turnId: string;
  readonly permissions?: RequestedPermissionProfile;
  readonly decision: Deferred.Deferred<ApprovalDecision>;
}

const providerError = (operation: string, message: string) =>
  ProviderError.make({ provider: 'codex', operation, message });

const decodeProvider = <A>(schema: Schema.Decoder<A>, input: unknown, operation: string) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((error) => providerError(operation, serializeUnknownError(error))),
  );

const requestDecoded = <A>(
  transport: CodexTransport,
  method: string,
  params: unknown,
  schema: Schema.Decoder<A>,
) =>
  transport
    .request(method, params)
    .pipe(Effect.flatMap((response) => decodeProvider(schema, response, method)));

const serializeJson = (value: unknown, operation: string) =>
  Schema.encodeEffect(UnknownJson)(value).pipe(
    Effect.mapError((error) => providerError(operation, serializeUnknownError(error))),
  );

const sandboxPolicy = (sandbox: CodexApprovalSettings['sandbox']) => {
  switch (sandbox) {
    case 'read-only':
      return { type: 'readOnly' } as const;
    case 'workspace-write':
      return { type: 'workspaceWrite' } as const;
    case 'danger-full-access':
      return { type: 'dangerFullAccess' } as const;
  }
};

const itemStatus = (status: 'inProgress' | 'completed' | 'failed' | 'declined'): ItemStatus => {
  switch (status) {
    case 'inProgress':
      return 'inProgress';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'declined':
      return 'failed';
  }
};

const fileChangeKind = (kind: (typeof FileChangeItem.Type)['changes'][number]['kind']) => {
  switch (kind.type) {
    case 'add':
      return 'added' as const;
    case 'delete':
      return 'deleted' as const;
    case 'update':
      return kind.move_path === null ? ('modified' as const) : ('renamed' as const);
  }
};

const turnOutcome = (status: (typeof TurnCompletedParams.Type)['turn']['status']) => {
  switch (status) {
    case 'completed':
      return 'completed' as const;
    case 'interrupted':
      return 'interrupted' as const;
    case 'failed':
    case 'inProgress':
      return 'failed' as const;
  }
};

const conversationIsGone = (message: string) => {
  const lower = message.toLowerCase();
  const namesConversationData = lower.includes('thread') || lower.includes('rollout');
  const reportsMissing =
    lower.includes('not found') ||
    lower.includes('missing') ||
    lower.includes('does not exist') ||
    lower.includes('no such');
  return namesConversationData && reportsMissing;
};

const mapItem = Effect.fn('CodexProvider.mapItem')(function* (input: unknown) {
  const base = yield* decodeProvider(ItemBase, input, 'item');
  switch (base.type) {
    case 'userMessage':
      return undefined;
    case 'contextCompaction':
      return {
        providerItemId: base.id,
        status: 'completed' as const,
        item: {
          kind: 'notice',
          text: 'Codex compacted the conversation context.',
        } satisfies TimelineItemPayload,
      };
    case 'agentMessage': {
      const item = yield* decodeProvider(AgentMessageItem, input, 'item/agentMessage');
      return {
        providerItemId: item.id,
        status: 'completed' as const,
        item: { kind: 'assistantMessage', text: item.text } satisfies TimelineItemPayload,
      };
    }
    case 'reasoning': {
      const item = yield* decodeProvider(ReasoningItem, input, 'item/reasoning');
      const summary = item.summary.length > 0 ? item.summary : item.content;
      return {
        providerItemId: item.id,
        status: 'completed' as const,
        item: { kind: 'reasoning', text: summary.join('\n') } satisfies TimelineItemPayload,
      };
    }
    case 'commandExecution': {
      const item = yield* decodeProvider(CommandExecutionItem, input, 'item/commandExecution');
      return {
        providerItemId: item.id,
        status: itemStatus(item.status),
        item: {
          kind: 'command',
          command: item.command,
          cwd: item.cwd,
          output: item.aggregatedOutput ?? '',
          ...(item.exitCode === null ? {} : { exitCode: item.exitCode }),
        } satisfies TimelineItemPayload,
      };
    }
    case 'fileChange': {
      const item = yield* decodeProvider(FileChangeItem, input, 'item/fileChange');
      const first = item.changes[0];
      if (first === undefined) {
        return {
          providerItemId: item.id,
          status: itemStatus(item.status),
          item: {
            kind: 'notice',
            text: 'File change contained no paths.',
          } satisfies TimelineItemPayload,
        };
      }
      return {
        providerItemId: item.id,
        status: itemStatus(item.status),
        item: {
          kind: 'fileChange',
          path: item.changes.map((change) => change.path).join(', '),
          change: fileChangeKind(first.kind),
          patch: item.changes.map((change) => change.diff).join('\n'),
        } satisfies TimelineItemPayload,
      };
    }
    case 'mcpToolCall': {
      const item = yield* decodeProvider(McpToolCallItem, input, 'item/mcpToolCall');
      const encoded = yield* serializeJson(item.arguments, 'item/mcpToolCall');
      return {
        providerItemId: item.id,
        status: itemStatus(item.status),
        item: {
          kind: 'toolCall',
          name: `${item.server}/${item.tool}`,
          input: encoded,
          ...(item.error === null ? {} : { output: item.error.message }),
        } satisfies TimelineItemPayload,
      };
    }
    case 'dynamicToolCall': {
      const item = yield* decodeProvider(DynamicToolCallItem, input, 'item/dynamicToolCall');
      const encoded = yield* serializeJson(item.arguments, 'item/dynamicToolCall');
      return {
        providerItemId: item.id,
        status: itemStatus(item.status),
        item: {
          kind: 'toolCall',
          name: item.namespace === null ? item.tool : `${item.namespace}/${item.tool}`,
          input: encoded,
        } satisfies TimelineItemPayload,
      };
    }
    case 'webSearch': {
      const item = yield* decodeProvider(WebSearchItem, input, 'item/webSearch');
      return {
        providerItemId: item.id,
        status: 'completed' as const,
        item: { kind: 'webSearch', query: item.query } satisfies TimelineItemPayload,
      };
    }
    default:
      return {
        providerItemId: base.id,
        status: 'completed' as const,
        item: {
          kind: 'notice',
          text: `Unsupported provider item: ${base.type}`,
        } satisfies TimelineItemPayload,
      };
  }
});

const approvalDetail = (values: ReadonlyArray<string | null | undefined>) => {
  const present = values.filter((value): value is string => value !== null && value !== undefined);
  return present.length === 0 ? undefined : present.join('\n');
};

const grantedPermissions = (permissions: RequestedPermissionProfile) => ({
  ...(permissions.network === null ? {} : { network: permissions.network }),
  ...(permissions.fileSystem === null ? {} : { fileSystem: permissions.fileSystem }),
});

const approvalResponse = (pending: PendingApproval, decision: ApprovalDecision) =>
  pending.kind === 'permission'
    ? {
        permissions:
          decision === 'accept' || decision === 'acceptForSession'
            ? grantedPermissions(pending.permissions ?? { network: null, fileSystem: null })
            : {},
        scope: decision === 'acceptForSession' ? ('session' as const) : ('turn' as const),
      }
    : { decision };

const noticeEvent = (providerItemId: string, text: string): ProviderEvent => ({
  _tag: 'ItemCompleted',
  providerItemId,
  status: 'completed',
  item: { kind: 'notice', text },
});

const formatTokenUsage = (usage: TokenUsageParams | undefined) =>
  usage === undefined
    ? 'Token usage is not available yet.'
    : `Tokens: ${String(usage.tokenUsage.last.totalTokens)} current, ${String(usage.tokenUsage.total.totalTokens)} total${usage.tokenUsage.modelContextWindow === null ? '' : `, ${String(usage.tokenUsage.modelContextWindow)} context window`}.`;

const formatRateWindow = (
  label: string,
  window: (typeof AccountRateLimitsResponse.Type)['rateLimits']['primary'],
) =>
  window === null
    ? `${label}: unavailable`
    : `${label}: ${String(window.usedPercent)}% used${window.windowDurationMins === null ? '' : ` over ${String(window.windowDurationMins)} minutes`}`;

const initialize = Effect.fn('CodexProvider.initialize')(function* (transport: CodexTransport) {
  yield* requestDecoded(
    transport,
    'initialize',
    {
      clientInfo: { name: 'exsomnis', title: 'Exsomnis', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    },
    EmptyResponse,
  );
  yield* transport.notify('initialized');
});

const openInitializedTransport = Effect.fn('CodexProvider.openTransport')(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner['Service'],
  cwd?: string,
) {
  const transport = yield* makeCodexTransport(spawner, cwd);
  yield* initialize(transport);
  return transport;
});

const collectModelsPage = (
  transport: CodexTransport,
  cursor: string | null,
  page: number,
): Effect.Effect<Array<ModelInfo>, ProviderError> =>
  Effect.gen(function* () {
    if (page >= 100) {
      return yield* providerError('model/list', 'model pagination exceeded 100 pages');
    }
    const response = yield* requestDecoded(
      transport,
      'model/list',
      cursor === null ? {} : { cursor },
      ModelListResponse,
    );
    const models: Array<ModelInfo> = response.data.map((model) => ({
      provider: 'codex',
      id: model.model,
      displayName: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      reasoningEfforts: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
      defaultReasoningEffort: model.defaultReasoningEffort,
    }));
    if (response.nextCursor === null) {
      return models;
    }
    const remaining = yield* collectModelsPage(transport, response.nextCursor, page + 1);
    return [...models, ...remaining];
  });

const collectModels = Effect.fn('CodexProvider.collectModels')(collectModelsPage);

const makeSession = Effect.fn('CodexProvider.makeSession')(function* (
  transport: CodexTransport,
  options: SessionOptions,
  threadId: string,
  initialApproval: CodexApprovalSettings,
) {
  const model = yield* Ref.make(options.model);
  const approval = yield* Ref.make(initialApproval);
  const activeTurn = yield* Ref.make(Option.none<string>());
  const tokenUsage = yield* Ref.make<TokenUsageParams | undefined>(undefined);
  const nextApprovalId = yield* Ref.make(1);
  const nextNoticeId = yield* Ref.make(1);
  const pendingApprovals = yield* Ref.make(new Map<RequestId, PendingApproval>());
  const resolutionIds = yield* Ref.make(new Map<string, RequestId>());
  const eventsQueue = yield* Queue.unbounded<ProviderEvent, Cause.Done>();
  const eventStreamClosed = yield* Ref.make(false);

  const emit = Effect.fn('CodexProvider.emit')((event: ProviderEvent) =>
    Queue.offer(eventsQueue, event).pipe(Effect.asVoid),
  );

  const emitNotice = Effect.fn('CodexProvider.emitNotice')(function* (text: string) {
    const id = yield* Ref.getAndUpdate(nextNoticeId, (value) => value + 1);
    const turn = { id: `codex-command-${String(id)}` };
    yield* emit({ _tag: 'TurnStarted', turn });
    yield* emit(noticeEvent(`codex-command-${String(id)}`, text));
    yield* emit({ _tag: 'TurnCompleted', turn, outcome: 'completed' });
  });

  const finishApprovals = Effect.fn('CodexProvider.finishApprovals')(function* () {
    const entries = yield* Ref.getAndSet(pendingApprovals, new Map<RequestId, PendingApproval>());
    yield* Ref.set(resolutionIds, new Map<string, RequestId>());
    yield* Effect.forEach(
      entries.values(),
      (entry) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entry.decision, 'cancel');
          yield* transport
            .respond(entry.transportId, approvalResponse(entry, 'cancel'))
            .pipe(Effect.ignore);
        }),
      { discard: true },
    );
  });

  const closeEvents = Effect.fn('CodexProvider.closeEvents')(function* (
    reason: 'exit' | 'error' | 'closed',
    detail?: string,
  ) {
    const wasClosed = yield* Ref.getAndSet(eventStreamClosed, true);
    if (wasClosed) {
      return;
    }
    yield* finishApprovals();
    yield* emit({
      _tag: 'SessionClosed',
      reason,
      ...(detail === undefined ? {} : { detail }),
    });
    yield* Queue.end(eventsQueue);
  });

  const interruptTurn = Effect.fn('CodexProvider.interruptTurn')(function* (turnId: string) {
    yield* requestDecoded(transport, 'turn/interrupt', { threadId, turnId }, EmptyResponse);
  });

  const awaitApproval = Effect.fn('CodexProvider.awaitApproval')(function* (
    pending: PendingApproval,
    request: ApprovalRequest,
  ) {
    yield* Ref.update(pendingApprovals, (entries) =>
      new Map(entries).set(pending.requestId, pending),
    );
    yield* Ref.update(resolutionIds, (entries) =>
      new Map(entries).set(String(pending.transportId), pending.requestId),
    );
    yield* emit({ _tag: 'ApprovalRequested', request });
    const decision = yield* Deferred.await(pending.decision);
    const ownsResponse = yield* Ref.modify(pendingApprovals, (entries) => {
      const next = new Map(entries);
      const owned = next.delete(pending.requestId);
      return [owned, next];
    });
    if (!ownsResponse) {
      return;
    }
    yield* transport.respond(pending.transportId, approvalResponse(pending, decision));
    if (decision === 'cancel') {
      yield* interruptTurn(pending.turnId);
    }
  });

  const registerApproval = Effect.fn('CodexProvider.registerApproval')(function* (
    transportId: number | string,
    kind: PendingApproval['kind'],
    turnId: string,
    title: string,
    detail?: string,
    permissions?: RequestedPermissionProfile,
  ) {
    const ordinal = yield* Ref.getAndUpdate(nextApprovalId, (value) => value + 1);
    const requestId = RequestId.make(`codex-approval-${String(ordinal)}`);
    const decision = yield* Deferred.make<ApprovalDecision>();
    const pending: PendingApproval = {
      requestId,
      transportId,
      kind,
      turnId,
      decision,
      ...(permissions === undefined ? {} : { permissions }),
    };
    const request: ApprovalRequest = {
      requestId,
      kind,
      title,
      decisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
      ...(detail === undefined ? {} : { detail }),
    };
    yield* awaitApproval(pending, request);
  });

  const handleServerRequest = Effect.fn('CodexProvider.handleServerRequest')(function* (
    message: Extract<CodexInbound, { readonly kind: 'Request' }>,
  ) {
    switch (message.method) {
      case 'item/commandExecution/requestApproval': {
        const params = yield* decodeProvider(CommandApprovalParams, message.params, message.method);
        yield* registerApproval(
          message.id,
          'command',
          params.turnId,
          params.command ?? 'Run command',
          approvalDetail([params.cwd, params.reason]),
        );
        return;
      }
      case 'item/fileChange/requestApproval': {
        const params = yield* decodeProvider(
          FileChangeApprovalParams,
          message.params,
          message.method,
        );
        yield* registerApproval(
          message.id,
          'fileChange',
          params.turnId,
          params.grantRoot === null || params.grantRoot === undefined
            ? 'Apply file changes'
            : `Write under ${params.grantRoot}`,
          approvalDetail([params.reason]),
        );
        return;
      }
      case 'item/permissions/requestApproval': {
        const params = yield* decodeProvider(
          PermissionsApprovalParams,
          message.params,
          message.method,
        );
        yield* registerApproval(
          message.id,
          'permission',
          params.turnId,
          'Grant additional permissions',
          approvalDetail([params.cwd, params.reason]),
          params.permissions,
        );
        return;
      }
      default:
        yield* Effect.logDebug('Rejecting unknown Codex server request').pipe(
          Effect.annotateLogs({ method: message.method }),
        );
        yield* transport.respondError(message.id, -32601, 'Method not found');
    }
  });

  const decodeNotification = <A>(
    method: string,
    schema: Schema.Decoder<A>,
    params: unknown,
    onSuccess: (value: A) => Effect.Effect<void, ProviderError>,
  ) =>
    decodeProvider(schema, params, method).pipe(
      Effect.flatMap(onSuccess),
      Effect.catchTag('ProviderError', (error) =>
        Effect.logWarning('Codex notification failed to decode').pipe(
          Effect.annotateLogs({ method, error: error.message }),
        ),
      ),
    );

  const handleNotification = Effect.fn('CodexProvider.handleNotification')((
    method: string,
    params: unknown,
  ) => {
    switch (method) {
      case 'turn/started':
        return decodeNotification(method, TurnStartedParams, params, (value) =>
          Ref.set(activeTurn, Option.some(value.turn.id)).pipe(
            Effect.andThen(emit({ _tag: 'TurnStarted', turn: { id: value.turn.id } })),
          ),
        );
      case 'item/started':
        return decodeNotification(method, ItemEnvelope, params, (value) =>
          mapItem(value.item).pipe(
            Effect.flatMap((mapped) =>
              mapped === undefined
                ? Effect.void
                : emit({
                    _tag: 'ItemStarted',
                    providerItemId: mapped.providerItemId,
                    item: mapped.item,
                  }),
            ),
          ),
        );
      case 'item/agentMessage/delta':
        return decodeNotification(method, DeltaParams, params, (value) =>
          emit({
            _tag: 'ItemDelta',
            providerItemId: value.itemId,
            part: 'text',
            delta: value.delta,
          }),
        );
      case 'item/reasoning/summaryTextDelta':
        return decodeNotification(method, DeltaParams, params, (value) =>
          emit({
            _tag: 'ItemDelta',
            providerItemId: value.itemId,
            part: 'reasoning',
            delta: value.delta,
          }),
        );
      case 'item/commandExecution/outputDelta':
        return decodeNotification(method, DeltaParams, params, (value) =>
          emit({
            _tag: 'ItemDelta',
            providerItemId: value.itemId,
            part: 'output',
            delta: value.delta,
          }),
        );
      case 'item/completed':
        return decodeNotification(method, ItemEnvelope, params, (value) =>
          mapItem(value.item).pipe(
            Effect.flatMap((mapped) =>
              mapped === undefined
                ? Effect.void
                : emit({
                    _tag: 'ItemCompleted',
                    providerItemId: mapped.providerItemId,
                    status: mapped.status,
                    item: mapped.item,
                  }),
            ),
          ),
        );
      case 'turn/diff/updated':
        return decodeNotification(method, TurnDiffUpdatedParams, params, () =>
          emit({ _tag: 'WorkingTreeChanged' }),
        );
      case 'thread/tokenUsage/updated':
        return decodeNotification(method, TokenUsageParams, params, (value) =>
          Ref.set(tokenUsage, value).pipe(
            Effect.andThen(
              emit({
                _tag: 'TokenUsage',
                used: value.tokenUsage.last.totalTokens,
                total: value.tokenUsage.total.totalTokens,
                ...(value.tokenUsage.modelContextWindow === null
                  ? {}
                  : { contextWindow: value.tokenUsage.modelContextWindow }),
              }),
            ),
          ),
        );
      case 'error':
        return decodeNotification(method, ErrorNotificationParams, params, (value) =>
          emit({
            _tag: 'Warning',
            message: value.willRetry
              ? `${value.error.message} The provider will retry.`
              : value.error.message,
          }),
        );
      case 'turn/completed':
        return decodeNotification(method, TurnCompletedParams, params, (value) =>
          Ref.update(activeTurn, (current) =>
            Option.exists(current, (id) => id === value.turn.id) ? Option.none() : current,
          ).pipe(
            Effect.andThen(
              emit({
                _tag: 'TurnCompleted',
                turn: { id: value.turn.id },
                outcome: turnOutcome(value.turn.status),
                ...(value.turn.error === null ? {} : { reason: value.turn.error.message }),
              }),
            ),
          ),
        );
      case 'serverRequest/resolved':
        return decodeNotification(method, ServerRequestResolvedParams, params, (value) =>
          Ref.modify(resolutionIds, (entries) => {
            const key = String(value.requestId);
            const requestId = entries.get(key);
            const next = new Map(entries);
            next.delete(key);
            return [Option.fromNullishOr(requestId), next];
          }).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (requestId) => emit({ _tag: 'ApprovalResolved', requestId }),
              }),
            ),
          ),
        );
      default:
        return Effect.logDebug('Ignoring unknown Codex notification').pipe(
          Effect.annotateLogs({ method }),
        );
    }
  });

  const handleInbound = Effect.fn('CodexProvider.handleInbound')((message: CodexInbound) => {
    switch (message.kind) {
      case 'Notification':
        return handleNotification(message.method, message.params);
      case 'Request':
        return handleServerRequest(message).pipe(
          Effect.catchTag('ProviderError', (error) =>
            Effect.logWarning('Codex server request failed').pipe(
              Effect.annotateLogs({ method: message.method, error: error.message }),
              Effect.andThen(transport.respondError(message.id, -32602, 'Invalid params')),
            ),
          ),
          Effect.forkScoped,
          Effect.asVoid,
        );
      case 'Closed':
        return closeEvents(message.reason, message.detail);
    }
  });

  yield* transport.inbound.pipe(Stream.runForEach(handleInbound), Effect.forkScoped);

  yield* Effect.addFinalizer(() => closeEvents('closed'));

  const startTurn = Effect.fn('CodexProvider.startTurn')(function* (input: {
    readonly text: string;
  }) {
    const selectedModel = yield* Ref.get(model);
    const selectedApproval = yield* Ref.get(approval);
    const response = yield* requestDecoded(
      transport,
      'turn/start',
      {
        threadId,
        input: [{ type: 'text', text: input.text }],
        cwd: options.cwd,
        model: selectedModel.model,
        effort: selectedModel.reasoningEffort ?? null,
        approvalPolicy: selectedApproval.approvalPolicy,
        approvalsReviewer: 'user',
        sandboxPolicy: sandboxPolicy(selectedApproval.sandbox),
      },
      TurnStartResponse,
    );
    return { id: response.turn.id };
  });

  const interrupt = Effect.fn('CodexProvider.interrupt')(function* () {
    const current = yield* Ref.get(activeTurn);
    if (Option.isSome(current)) {
      yield* interruptTurn(current.value);
    }
  });

  const runCommand = Effect.fn('CodexProvider.runCommand')(function* (
    command: NativeCommand,
    args: string,
  ) {
    switch (command.name) {
      case 'compact':
        yield* requestDecoded(transport, 'thread/compact/start', { threadId }, EmptyResponse);
        return;
      case 'review':
        yield* requestDecoded(
          transport,
          'review/start',
          {
            threadId,
            target:
              args.trim().length === 0
                ? { type: 'uncommittedChanges' }
                : { type: 'custom', instructions: args.trim() },
            delivery: 'inline',
          },
          EmptyResponse,
        );
        return;
      case 'status': {
        const response = yield* requestDecoded(
          transport,
          'thread/read',
          { threadId, includeTurns: false },
          ThreadResponse,
        );
        const usage = yield* Ref.get(tokenUsage);
        yield* emitNotice(`Thread ${response.thread.id}. ${formatTokenUsage(usage)}`);
        return;
      }
      case 'usage': {
        const usage = yield* requestDecoded(
          transport,
          'account/usage/read',
          { threadId },
          AccountUsageResponse,
        );
        const limits = yield* requestDecoded(
          transport,
          'account/rateLimits/read',
          {},
          AccountRateLimitsResponse,
        );
        yield* emitNotice(
          [
            `Lifetime tokens: ${usage.summary.lifetimeTokens === null ? 'unavailable' : String(usage.summary.lifetimeTokens)}.`,
            formatRateWindow('Primary limit', limits.rateLimits.primary),
            formatRateWindow('Secondary limit', limits.rateLimits.secondary),
          ].join('\n'),
        );
        return;
      }
      case 'rename': {
        const name = args.trim();
        if (name.length === 0) {
          return yield* providerError('thread/name/set', 'a new name is required');
        }
        yield* requestDecoded(transport, 'thread/name/set', { threadId, name }, EmptyResponse);
        return;
      }
      case 'skills': {
        const response = yield* requestDecoded(
          transport,
          'skills/list',
          { cwds: [options.cwd], forceReload: false },
          SkillsListResponse,
        );
        const names = [
          ...new Set(response.data.flatMap((entry) => entry.skills.map((skill) => skill.name))),
        ];
        yield* emitNotice(
          names.length === 0 ? 'No skills are available.' : `Skills: ${names.join(', ')}`,
        );
        return;
      }
      default:
        return yield* providerError('runCommand', `unsupported Codex command: ${command.name}`);
    }
  });

  const setModel = Effect.fn('CodexProvider.setModel')(function* (selection: ModelSelection) {
    yield* Ref.set(model, selection);
    yield* emit({ _tag: 'ModelChanged', selection });
  });

  const setApproval = Effect.fn('CodexProvider.setApproval')(function* (
    settings: ApprovalSettings,
  ) {
    const decoded = yield* decodeProvider(CodexApprovalSettings, settings, 'setApproval');
    yield* Ref.set(approval, decoded);
  });

  const respond = Effect.fn('CodexProvider.respond')(function* (
    requestId: RequestId,
    decision: ApprovalDecision,
  ) {
    const entries = yield* Ref.get(pendingApprovals);
    const pending = entries.get(requestId);
    if (pending === undefined) {
      return yield* providerError('respond', `approval request ${requestId} is no longer pending`);
    }
    yield* Deferred.succeed(pending.decision, decision);
  });

  return {
    resumeRef: { provider: 'codex', id: threadId },
    events: Stream.fromQueue(eventsQueue),
    listCommands: Effect.succeed(codexCommands),
    startTurn,
    interrupt: interrupt(),
    runCommand,
    setModel,
    setApproval,
    respond,
  } satisfies ProviderSession;
});

export class CodexProvider extends Context.Service<CodexProvider, ProviderDriver>()(
  'exsomnis/providers/codex/codex-provider/CodexProvider',
  {
    make: Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const collectCommand = Effect.fn('CodexProvider.collectCommand')(function* (
        executable: string,
        args: ReadonlyArray<string>,
      ) {
        const handle = yield* spawner.spawn(ChildProcess.make(executable, args));
        const stdout = yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString);
        const exitCode = yield* handle.exitCode;
        return { stdout, exitCode } satisfies CommandResult;
      });

      const detect = Effect.fn('CodexProvider.detect')(function* () {
        const result = yield* Effect.option(
          Effect.scoped(
            Effect.gen(function* () {
              const resolved = yield* collectCommand('which', ['codex']);
              const executable = resolved.stdout.trim().split('\n')[0] ?? '';
              if (resolved.exitCode !== 0 || executable.length === 0) {
                return Option.none();
              }
              const versionResult = yield* collectCommand(executable, ['--version']);
              if (versionResult.exitCode !== 0) {
                return Option.none();
              }
              const output = versionResult.stdout.trim();
              const version = output.split(/\s+/).at(-1) ?? output;
              return Option.some({ provider: 'codex' as const, executable, version });
            }),
          ),
        );
        return Option.flatten(result);
      });

      const listModels = Effect.fn('CodexProvider.listModels')(() =>
        Effect.scoped(
          Effect.gen(function* () {
            const installation = yield* detect();
            if (Option.isNone(installation)) {
              return yield* providerError('listModels', 'codex is not available on PATH');
            }
            const transport = yield* openInitializedTransport(spawner);
            return yield* collectModels(transport, null, 0);
          }),
        ),
      );

      const openSession = Effect.fn('CodexProvider.openSession')(function* (
        options: SessionOptions,
      ) {
        const installation = yield* detect();
        if (Option.isNone(installation)) {
          return yield* ProviderUnavailableError.make({
            provider: 'codex',
            reason: 'codex is not available on PATH',
          });
        }
        const approval = yield* decodeProvider(
          CodexApprovalSettings,
          options.approval,
          'openSession',
        );
        const transport = yield* openInitializedTransport(spawner, options.cwd);
        const startParams = {
          cwd: options.cwd,
          model: options.model.model,
          approvalPolicy: approval.approvalPolicy,
          approvalsReviewer: 'user',
          sandbox: approval.sandbox,
        };
        const response = yield* Option.match(options.resume, {
          onNone: () => requestDecoded(transport, 'thread/start', startParams, ThreadResponse),
          onSome: (resume) =>
            requestDecoded(
              transport,
              'thread/resume',
              { threadId: resume.id, ...startParams },
              ThreadResponse,
            ).pipe(
              Effect.catchTag('ProviderError', (error) =>
                conversationIsGone(error.message)
                  ? Effect.fail(
                      providerError(
                        'thread/resume',
                        'The conversation is gone because its saved thread or rollout is missing.',
                      ),
                    )
                  : Effect.fail(error),
              ),
            ),
        });
        return yield* makeSession(transport, options, response.thread.id, approval);
      });

      return {
        id: 'codex',
        detect: detect(),
        listModels: listModels(),
        approvalDimensions: codexApprovalDimensions,
        openSession,
      } satisfies ProviderDriver;
    }),
  },
) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies.pipe(Layer.provide(BunServices.layer));
}
