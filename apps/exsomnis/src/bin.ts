import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, Layer, Logger } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';
import { AtomRegistry } from 'effect/unstable/reactivity';
import { CoreNative } from '@/core-native.ts';
import { ProviderRegistry } from '@/providers/registry.ts';
import { formatDemoReport, runRenderDemo } from '@/render/demo.ts';
import { HostTerminal } from '@/terminal/host-terminal.ts';

const renderDemo = Command.make(
  'render-demo',
  {
    calibrate: Flag.boolean('calibrate').pipe(
      Flag.withDescription('Compare grapheme widths against the terminal before drawing.'),
      Flag.withDefault(false),
    ),
    duration: Flag.integer('duration').pipe(
      Flag.withDescription('Quit automatically after this many seconds.'),
      Flag.withDefault(0),
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        runRenderDemo({ calibrate: config.calibrate, durationSeconds: config.duration }),
      );
      yield* Effect.log(formatDemoReport(result)).pipe(Effect.annotateLogs({ ...result.summary }));
    }),
).pipe(
  Command.withDescription('Draw the three-column shell and report rendering measurements.'),
  Command.provide(HostTerminal.layer),
);

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
).pipe(
  Command.withDescription('Terminal workspace for the agent CLIs installed on this machine.'),
  Command.withSubcommands([renderDemo]),
);

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
        Layer.succeed(Logger.LogToStderr, true),
      ),
    ),
  ),
);
