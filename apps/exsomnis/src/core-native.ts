import type { FrameStats } from '@exsomnis/core';
import { Screen, cellWidth, coreVersion } from '@exsomnis/core';
import { Context, Effect, Layer, Schema } from 'effect';
import type { Scope } from 'effect';
import { serializeUnknownError } from '@/errors.ts';

export type { FrameStats };

export class NativeCoreError extends Schema.TaggedError<NativeCoreError>()('NativeCoreError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => NativeCoreError.make({ operation, message: serializeUnknownError(cause) }),
  });

export interface NativeScreen {
  readonly resize: (columns: number, rows: number) => Effect.Effect<void, NativeCoreError>;
  readonly setCapabilities: (flags: number) => Effect.Effect<void, NativeCoreError>;
  readonly invalidate: Effect.Effect<void, NativeCoreError>;
  readonly present: (
    ops: Int32Array,
    opCount: number,
    text: Uint8Array,
    textLength: number,
  ) => Effect.Effect<number, NativeCoreError>;
  readonly takeStats: Effect.Effect<FrameStats, NativeCoreError>;
}

const wrap = (screen: Screen): NativeScreen => ({
  resize: (columns, rows) => attempt('resize', () => screen.resize(columns, rows)),
  setCapabilities: (flags) => attempt('setCapabilities', () => screen.setCapabilities(flags)),
  invalidate: attempt('invalidate', () => {
    screen.invalidate();
  }),
  present: (ops, opCount, text, textLength) =>
    attempt('present', () => screen.present(ops, opCount, text, textLength)),
  takeStats: attempt('takeStats', () => screen.takeStats()),
});

export class CoreNative extends Context.Service<
  CoreNative,
  {
    readonly version: string;
    readonly cellWidth: (text: string) => number;
    readonly openScreen: (
      columns: number,
      rows: number,
    ) => Effect.Effect<NativeScreen, NativeCoreError, Scope.Scope>;
  }
>()('exsomnis/core-native/CoreNative', {
  make: Effect.sync(() => ({
    version: coreVersion(),
    cellWidth,
    openScreen: (columns: number, rows: number) =>
      Effect.acquireRelease(
        attempt('openScreen', () => new Screen(columns, rows)),
        (screen) =>
          Effect.ignore(
            attempt('shutdown', () => {
              screen.shutdown();
            }),
          ),
      ).pipe(Effect.map(wrap)),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
