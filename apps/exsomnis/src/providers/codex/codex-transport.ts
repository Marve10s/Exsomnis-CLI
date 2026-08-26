import type { Cause } from 'effect';
import { Deferred, Effect, Option, Queue, Ref, Schedule, Schema, Semaphore, Stream } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import type { ChildProcessSpawner } from 'effect/unstable/process';
import { serializeUnknownError } from '@/errors.ts';
import { IncomingMessage, MethodProbe, type RpcId } from '@/providers/codex/codex-schemas.ts';
import { ProviderError } from '@/providers/provider.ts';

export class RpcResponseError extends Schema.TaggedError<RpcResponseError>()('RpcResponseError', {
  method: Schema.String,
  code: Schema.Finite,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Unknown),
}) {}

export type CodexInbound =
  | { readonly kind: 'Notification'; readonly method: string; readonly params: unknown }
  | {
      readonly kind: 'Request';
      readonly id: typeof RpcId.Type;
      readonly method: string;
      readonly params: unknown;
    }
  | {
      readonly kind: 'Closed';
      readonly reason: 'exit' | 'error';
      readonly detail: string;
    };

interface PendingRpc {
  readonly method: string;
  readonly deferred: Deferred.Deferred<unknown, ProviderError | RpcResponseError>;
}

export interface CodexTransport {
  readonly inbound: Stream.Stream<CodexInbound>;
  readonly request: (method: string, params: unknown) => Effect.Effect<unknown, ProviderError>;
  readonly notify: (method: string, params?: unknown) => Effect.Effect<void, ProviderError>;
  readonly respond: (id: typeof RpcId.Type, result: unknown) => Effect.Effect<void, ProviderError>;
  readonly respondError: (
    id: typeof RpcId.Type,
    code: number,
    message: string,
  ) => Effect.Effect<void, ProviderError>;
}

const providerError = (operation: string, message: string) =>
  ProviderError.make({ provider: 'codex', operation, message });

const UnknownJson = Schema.fromJsonString(Schema.Unknown);

const cloneWithout = <K, V>(source: Map<K, V>, key: K) => {
  const next = new Map(source);
  next.delete(key);
  return next;
};

const methodName = (input: unknown) =>
  Schema.decodeUnknownOption(MethodProbe)(input).pipe(
    Option.flatMap((message) => Option.fromNullishOr(message.method)),
    Option.getOrElse(() => 'unknown'),
  );

export const makeCodexTransport = Effect.fn('CodexTransport.make')(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner['Service'],
  cwd?: string,
) {
  const options = {
    extendEnv: true,
    stdin: { stream: 'pipe' as const, endOnDone: false },
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
    forceKillAfter: '2 seconds' as const,
  };
  const command =
    cwd === undefined
      ? ChildProcess.make('codex', ['app-server'], options)
      : ChildProcess.make('codex', ['app-server'], { ...options, cwd });
  const handle = yield* spawner.spawn(command).pipe(
    Effect.mapError((error) => providerError('spawn', serializeUnknownError(error))),
    Effect.withSpan('codex.spawn'),
  );
  const nextId = yield* Ref.make(1);
  const pending = yield* Ref.make(new Map<string, PendingRpc>());
  const inboundQueue = yield* Queue.unbounded<CodexInbound, Cause.Done>();
  const writeLock = yield* Semaphore.make(1);
  const closed = yield* Ref.make(false);

  const failPending = Effect.fn('CodexTransport.failPending')(function* (error: ProviderError) {
    const entries = yield* Ref.getAndSet(pending, new Map<string, PendingRpc>());
    yield* Effect.forEach(entries.values(), (entry) => Deferred.fail(entry.deferred, error), {
      discard: true,
    });
  });

  const closeUnexpected = Effect.fn('CodexTransport.closeUnexpected')(function* (
    reason: 'exit' | 'error',
    detail: string,
  ) {
    const wasClosed = yield* Ref.getAndSet(closed, true);
    if (wasClosed) {
      return;
    }
    yield* failPending(providerError('transport', detail));
    yield* Queue.offer(inboundQueue, { kind: 'Closed', reason, detail });
    yield* Queue.end(inboundQueue);
  });

  const write = Effect.fn('CodexTransport.write')(function* (message: unknown) {
    const encoded = yield* Schema.encodeEffect(UnknownJson)(message).pipe(
      Effect.mapError((error) => providerError('encode', serializeUnknownError(error))),
    );
    const bytes = new TextEncoder().encode(`${encoded}\n`);
    yield* writeLock.withPermit(
      Stream.run(Stream.succeed(bytes), handle.stdin).pipe(
        Effect.mapError((error) => providerError('write', serializeUnknownError(error))),
      ),
    );
  });

  const takePending = Effect.fn('CodexTransport.takePending')(function* (id: typeof RpcId.Type) {
    return yield* Ref.modify(pending, (entries) => {
      const key = String(id);
      const entry = entries.get(key);
      return [Option.fromNullishOr(entry), cloneWithout(entries, key)];
    });
  });

  const handleDecoded = Effect.fn('CodexTransport.handleDecoded')(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(IncomingMessage)(input).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.logWarning('Codex message failed to decode').pipe(
            Effect.annotateLogs({ method: methodName(input), error: serializeUnknownError(error) }),
            Effect.as(Option.none()),
          ),
        onSuccess: (message) => Effect.succeed(Option.some(message)),
      }),
    );
    if (Option.isNone(decoded)) {
      return;
    }
    const message = decoded.value;
    if (message.method !== undefined) {
      const params = message.params ?? {};
      if (message.id === undefined) {
        yield* Queue.offer(inboundQueue, {
          kind: 'Notification',
          method: message.method,
          params,
        });
        return;
      }
      yield* Queue.offer(inboundQueue, {
        kind: 'Request',
        id: message.id,
        method: message.method,
        params,
      });
      return;
    }
    if (message.id === undefined) {
      yield* Effect.logWarning('Codex message has neither an id nor a method');
      return;
    }
    const entry = yield* takePending(message.id);
    if (Option.isNone(entry)) {
      yield* Effect.logDebug('Codex response has no pending request').pipe(
        Effect.annotateLogs({ requestId: String(message.id) }),
      );
      return;
    }
    if (message.error === undefined) {
      yield* Deferred.succeed(entry.value.deferred, message.result);
      return;
    }
    const responseError =
      message.error.data === undefined
        ? RpcResponseError.make({
            method: entry.value.method,
            code: message.error.code,
            message: message.error.message,
          })
        : RpcResponseError.make({
            method: entry.value.method,
            code: message.error.code,
            message: message.error.message,
            data: message.error.data,
          });
    yield* Deferred.fail(entry.value.deferred, responseError);
  });

  const handleLine = Effect.fn('CodexTransport.handleLine')((line: string) =>
    Schema.decodeEffect(UnknownJson)(line).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.logWarning('Codex JSON line failed to decode').pipe(
            Effect.annotateLogs({ method: 'unknown', error: serializeUnknownError(error) }),
          ),
        onSuccess: handleDecoded,
      }),
    ),
  );

  yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach(handleLine),
    Effect.mapError((error) => providerError('read', serializeUnknownError(error))),
    Effect.catchTag('ProviderError', (error) => closeUnexpected('error', error.message)),
    Effect.forkScoped,
  );

  yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) =>
      Effect.logDebug('Codex stderr').pipe(Effect.annotateLogs({ line })),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );

  yield* handle.exitCode.pipe(
    Effect.matchEffect({
      onFailure: (error) => closeUnexpected('error', serializeUnknownError(error)),
      onSuccess: (exitCode) =>
        closeUnexpected(
          exitCode === 0 ? 'exit' : 'error',
          `codex app-server exited with code ${String(exitCode)}`,
        ),
    }),
    Effect.forkScoped,
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const wasClosed = yield* Ref.getAndSet(closed, true);
      if (!wasClosed) {
        yield* failPending(providerError('close', 'Codex session closed'));
        yield* Queue.end(inboundQueue);
      }
    }),
  );

  const requestOnce = Effect.fn('CodexTransport.requestOnce')(function* (
    method: string,
    params: unknown,
  ) {
    const id = yield* Ref.getAndUpdate(nextId, (value) => value + 1);
    const deferred = yield* Deferred.make<unknown, ProviderError | RpcResponseError>();
    yield* Ref.update(pending, (entries) => new Map(entries).set(String(id), { method, deferred }));
    return yield* Effect.gen(function* () {
      yield* write({ id, method, params });
      const result = yield* Deferred.await(deferred).pipe(Effect.timeoutOption('30 seconds'));
      return yield* Option.match(result, {
        onNone: () =>
          Effect.fail(providerError(method, `request ${String(id)} timed out after 30 seconds`)),
        onSome: Effect.succeed,
      });
    }).pipe(Effect.ensuring(Ref.update(pending, (entries) => cloneWithout(entries, String(id)))));
  });

  const request = Effect.fn('CodexTransport.request')((method: string, params: unknown) =>
    requestOnce(method, params).pipe(
      Effect.retry({
        times: 3,
        while: (error) => Schema.is(RpcResponseError)(error) && error.code === -32001,
        schedule: Schedule.exponential('100 millis').pipe(Schedule.jittered),
      }),
      Effect.catchTag('RpcResponseError', (error) =>
        Effect.fail(providerError(method, `${error.message} (RPC ${String(error.code)})`)),
      ),
      Effect.withSpan(`codex.rpc.${method}`),
    ),
  );

  const notify = Effect.fn('CodexTransport.notify')((method: string, params?: unknown) =>
    write(params === undefined ? { method } : { method, params }),
  );

  const respond = Effect.fn('CodexTransport.respond')((id: typeof RpcId.Type, result: unknown) =>
    write({ id, result }),
  );

  const respondError = Effect.fn('CodexTransport.respondError')(
    (id: typeof RpcId.Type, code: number, message: string) =>
      write({ id, error: { code, message } }),
  );

  return {
    inbound: Stream.fromQueue(inboundQueue),
    request,
    notify,
    respond,
    respondError,
  } satisfies CodexTransport;
});
