import { coreVersion } from '@exsomnis/core';
import { Context, Effect, Layer } from 'effect';

export class CoreNative extends Context.Service<
  CoreNative,
  {
    readonly version: string;
  }
>()('@exsomnis/app/CoreNative', {
  make: Effect.sync(() => ({ version: coreVersion() })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
