import { Effect, Queue } from 'effect';
import type { Atom } from 'effect/unstable/reactivity';
import { AtomRegistry } from 'effect/unstable/reactivity';
import type { NativeScreen } from '@/core-native.ts';
import type { FrameBuilder } from '@/render/frame.ts';
import { makeFrameBuilder } from '@/render/frame.ts';
import type { StatsCollector } from '@/render/stats.ts';
import type { TerminalSize } from '@/terminal/host-terminal.ts';
import { HostTerminal } from '@/terminal/host-terminal.ts';

export const FRAME_INTERVAL_NANOS = 16_000_000;
export const INPUT_INTERVAL_NANOS = 4_000_000;
export const POLL_INTERVAL_MILLIS = 1;

export interface RenderLoopOptions {
  readonly screen: NativeScreen;
  readonly paint: (builder: FrameBuilder, size: TerminalSize) => void;
  readonly sources: ReadonlyArray<Atom.Atom<unknown>>;
  readonly stats: StatsCollector;
  readonly onResize: (size: TerminalSize) => void;
}

export const runRenderLoop = Effect.fn('RenderLoop.run')(function* (options: RenderLoopOptions) {
  const terminal = yield* HostTerminal;
  const registry = yield* AtomRegistry.AtomRegistry;
  const initial = yield* terminal.size;
  const screen = options.screen;

  const builder = makeFrameBuilder();
  let dirty = true;
  let size = initial;
  let lastFrameAt = 0;
  let inputStamp: number | undefined = undefined;

  for (const atom of options.sources) {
    const unsubscribe = registry.subscribe(atom, () => {
      dirty = true;
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  }

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        const next = yield* Queue.take(terminal.resizes);
        size = next;
        yield* screen.resize(next.columns, next.rows);
        options.onResize(next);
        dirty = true;
      }),
    ),
  );

  return yield* Effect.forever(
    Effect.gen(function* () {
      yield* Effect.sleep(`${POLL_INTERVAL_MILLIS} millis`);
      yield* terminal.flushInput;
      if (!dirty) {
        return;
      }
      inputStamp ??= terminal.takeInputStamp();
      const startedAt = Bun.nanoseconds();
      const gap = inputStamp === undefined ? FRAME_INTERVAL_NANOS : INPUT_INTERVAL_NANOS;
      if (startedAt - lastFrameAt < gap) {
        return;
      }
      dirty = false;
      builder.begin();
      options.paint(builder, size);
      const builtAt = Bun.nanoseconds();
      yield* screen.present(
        builder.ops(),
        builder.opCount(),
        builder.textBytes(),
        builder.textLength(),
      );
      lastFrameAt = Bun.nanoseconds();
      options.stats.recordFrame(builtAt - startedAt, lastFrameAt, inputStamp);
      inputStamp = undefined;
    }),
  );
});
