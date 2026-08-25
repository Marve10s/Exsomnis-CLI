import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { Command } from 'effect/unstable/cli';
import { AtomRegistry } from 'effect/unstable/reactivity';
import { CoreNative } from '@/core-native.ts';
import { ProviderRegistry } from '@/providers/registry.ts';

const exsomnis = Command.make('exsomnis', {}, () =>
  Effect.gen(function* () {
    const core = yield* CoreNative;
    const providers = yield* ProviderRegistry;
    yield* Effect.log('exsomnis starting').pipe(
      Effect.annotateLogs({
        coreVersion: core.version,
        providers: providers.drivers.map((driver) => driver.id).join(','),
      }),
    );
  }),
).pipe(Command.withDescription('Terminal workspace for the agent CLIs installed on this machine.'));

const program = Command.run(exsomnis, { version: '0.0.0' });

// @effect-diagnostics strictEffectProvide:off -- the entrypoint is the one place every layer is provided at once
BunRuntime.runMain(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        BunServices.layer,
        CoreNative.layer,
        ProviderRegistry.layer,
        AtomRegistry.layer,
      ),
    ),
  ),
);
