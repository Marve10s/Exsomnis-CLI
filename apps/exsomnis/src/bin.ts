import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { Command } from 'effect/unstable/cli';
import { CoreNative } from './core-native';

const exsomnis = Command.make('exsomnis', {}, () =>
  Effect.gen(function* () {
    const core = yield* CoreNative;
    yield* Effect.log('exsomnis starting').pipe(Effect.annotateLogs({ coreVersion: core.version }));
  }),
).pipe(Command.withDescription('Terminal workspace for the agent CLIs installed on this machine.'));

const program = Command.run(exsomnis, { version: '0.0.0' });

BunRuntime.runMain(
  program.pipe(Effect.provide(Layer.mergeAll(BunServices.layer, CoreNative.layer))),
);
