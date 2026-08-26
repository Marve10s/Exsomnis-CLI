import { Config, Context, Effect, Layer, Option, Queue, Schema } from 'effect';
import { serializeUnknownError } from '@/errors.ts';
import type { InputDecoder, TerminalInput } from '@/terminal/input-decoder.ts';
import { makeInputDecoder } from '@/terminal/input-decoder.ts';

export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

export interface TerminalCapabilities {
  readonly trueColor: boolean;
  readonly indexedColor: boolean;
  readonly synchronizedOutput: boolean;
  readonly kittyKeyboard: boolean;
}

export const CAP_TRUE_COLOR = 1;
export const CAP_INDEXED_COLOR = 2;
export const CAP_SYNCHRONIZED_OUTPUT = 4;

export const capabilityFlags = (capabilities: TerminalCapabilities): number =>
  (capabilities.trueColor ? CAP_TRUE_COLOR : 0) |
  (capabilities.indexedColor ? CAP_INDEXED_COLOR : 0) |
  (capabilities.synchronizedOutput ? CAP_SYNCHRONIZED_OUTPUT : 0);

export class HostTerminalError extends Schema.TaggedError<HostTerminalError>()(
  'HostTerminalError',
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

const CSI = '\u001b[';
const ENTER = `${CSI}?1049h${CSI}?25l${CSI}?7l${CSI}?2004h${CSI}?1004h${CSI}?1000h${CSI}?1002h${CSI}?1006h${CSI}2J${CSI}H`;
const LEAVE = `${CSI}?1006l${CSI}?1002l${CSI}?1000l${CSI}?1004l${CSI}?2004l${CSI}?7h${CSI}m${CSI}?25h${CSI}?1049l`;
const KITTY_PUSH = `${CSI}>1u`;
const KITTY_POP = `${CSI}<u`;
const HANDSHAKE_QUERY = `${CSI}?u${CSI}?2026$p${CSI}18t${CSI}c`;
const CURSOR_POSITION_QUERY = `${CSI}6n`;
const TEXT_AREA_SIZE_QUERY = `${CSI}18t`;
const HANDSHAKE_EVENT_LIMIT = 64;
const INPUT_CAPACITY = 4096;

interface Session {
  readonly decoder: InputDecoder;
  readonly size: () => TerminalSize;
  readonly takeInputStamp: () => number | undefined;
  readonly write: (value: string) => void;
  readonly enableKitty: () => void;
  readonly restore: () => void;
}

const writeOut = (value: string) => {
  process.stdout.write(value);
};

const currentSize = (): TerminalSize => ({
  columns: process.stdout.columns ?? 80,
  rows: process.stdout.rows ?? 24,
});

const openSession = (
  events: Queue.Queue<TerminalInput>,
  resizes: Queue.Queue<TerminalSize>,
): Session => {
  const decoder = makeInputDecoder();
  let kittyPushed = false;
  let restored = false;
  let reported: TerminalSize | undefined = undefined;
  let inputStamp: number | undefined = undefined;

  const write = writeOut;

  const onData = (chunk: Uint8Array) => {
    if (inputStamp === undefined) {
      inputStamp = Bun.nanoseconds();
    }
    for (const event of decoder.decode(chunk)) {
      if (event.type === 'textAreaSize' && event.columns > 0 && event.rows > 0) {
        reported = { columns: event.columns, rows: event.rows };
        Queue.offerUnsafe(resizes, reported);
      } else {
        Queue.offerUnsafe(events, event);
      }
    }
  };

  const onResize = () => {
    Queue.offerUnsafe(resizes, currentSize());
    write(TEXT_AREA_SIZE_QUERY);
  };

  const onHangup = () => {
    restore();
    process.kill(process.pid, 'SIGHUP');
  };

  function restore() {
    if (restored) {
      return;
    }
    restored = true;
    if (kittyPushed) {
      write(KITTY_POP);
    }
    write(LEAVE);
    process.stdin.off('data', onData);
    process.off('SIGWINCH', onResize);
    process.off('exit', restore);
    process.off('SIGINT', restore);
    process.off('SIGTERM', restore);
    process.off('SIGHUP', onHangup);
    process.off('uncaughtException', restore);
    process.off('unhandledRejection', restore);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', onData);
  process.on('SIGWINCH', onResize);
  process.on('exit', restore);
  process.on('SIGINT', restore);
  process.on('SIGTERM', restore);
  process.on('SIGHUP', onHangup);
  process.on('uncaughtException', restore);
  process.on('unhandledRejection', restore);
  write(ENTER);

  return {
    decoder,
    size: () => reported ?? currentSize(),
    takeInputStamp: () => {
      const stamp = inputStamp;
      inputStamp = undefined;
      return stamp;
    },
    write,
    enableKitty: () => {
      if (!kittyPushed) {
        kittyPushed = true;
        write(KITTY_PUSH);
      }
    },
    restore,
  };
};

const colorSupport = Effect.gen(function* () {
  const colorTerm = yield* Config.string('COLORTERM').pipe(Config.option);
  const term = yield* Config.string('TERM').pipe(Config.option);
  const colorTermValue = Option.getOrElse(colorTerm, () => '');
  const termValue = Option.getOrElse(term, () => '');
  const trueColor =
    colorTermValue.includes('truecolor') ||
    colorTermValue.includes('24bit') ||
    termValue.includes('direct');
  const indexedColor = trueColor || termValue.includes('256') || termValue.length > 0;
  return { trueColor, indexedColor };
});

const readHandshake = (events: Queue.Queue<TerminalInput>) =>
  Effect.gen(function* () {
    const deferred: Array<TerminalInput> = [];
    let kittyKeyboard = false;
    let synchronizedOutput = false;
    let finished = false;
    for (let index = 0; index < HANDSHAKE_EVENT_LIMIT && !finished; index += 1) {
      const next = yield* Queue.take(events).pipe(Effect.timeoutOption('200 millis'));
      if (Option.isNone(next)) {
        break;
      }
      const event = next.value;
      if (event.type === 'kittyFlags') {
        kittyKeyboard = true;
      } else if (event.type === 'modeReport') {
        if (event.mode === 2026 && (event.value === 1 || event.value === 2)) {
          synchronizedOutput = true;
        }
      } else if (event.type === 'deviceAttributes') {
        finished = true;
      } else {
        deferred.push(event);
      }
    }
    for (const event of deferred) {
      Queue.offerUnsafe(events, event);
    }
    return { kittyKeyboard, synchronizedOutput };
  });

export interface HostTerminalShape {
  readonly size: Effect.Effect<TerminalSize>;
  readonly capabilities: TerminalCapabilities;
  readonly events: Queue.Dequeue<TerminalInput>;
  readonly resizes: Queue.Dequeue<TerminalSize>;
  readonly write: (value: string) => Effect.Effect<void, HostTerminalError>;
  readonly flushInput: Effect.Effect<void>;
  readonly takeInputStamp: () => number | undefined;
  readonly requestCursorPosition: Effect.Effect<void, HostTerminalError>;
}

export class HostTerminal extends Context.Service<HostTerminal, HostTerminalShape>()(
  'exsomnis/terminal/host-terminal/HostTerminal',
  {
    make: Effect.gen(function* () {
      const events = yield* Queue.sliding<TerminalInput>(INPUT_CAPACITY);
      const resizes = yield* Queue.sliding<TerminalSize>(16);
      const color = yield* colorSupport;
      const session = yield* Effect.acquireRelease(
        Effect.try({
          try: () => openSession(events, resizes),
          catch: (cause) =>
            HostTerminalError.make({
              operation: 'enter',
              message: serializeUnknownError(cause),
            }),
        }),
        (open) =>
          Effect.sync(() => {
            open.restore();
          }),
      );
      yield* Effect.try({
        try: () => {
          session.write(HANDSHAKE_QUERY);
        },
        catch: (cause) =>
          HostTerminalError.make({
            operation: 'handshake',
            message: serializeUnknownError(cause),
          }),
      });
      const probed = yield* readHandshake(events);
      if (probed.kittyKeyboard) {
        yield* Effect.sync(() => {
          session.enableKitty();
        });
      }
      const capabilities: TerminalCapabilities = {
        trueColor: color.trueColor,
        indexedColor: color.indexedColor,
        synchronizedOutput: probed.synchronizedOutput,
        kittyKeyboard: probed.kittyKeyboard,
      };
      return {
        size: Effect.sync(session.size),
        capabilities,
        events,
        resizes,
        write: (value: string) =>
          Effect.try({
            try: () => {
              session.write(value);
            },
            catch: (cause) =>
              HostTerminalError.make({
                operation: 'write',
                message: serializeUnknownError(cause),
              }),
          }),
        takeInputStamp: session.takeInputStamp,
        flushInput: Effect.sync(() => {
          for (const event of session.decoder.flush()) {
            Queue.offerUnsafe(events, event);
          }
        }),
        requestCursorPosition: Effect.try({
          try: () => {
            session.decoder.expectCursorPosition();
            session.write(CURSOR_POSITION_QUERY);
          },
          catch: (cause) =>
            HostTerminalError.make({
              operation: 'requestCursorPosition',
              message: serializeUnknownError(cause),
            }),
        }),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
