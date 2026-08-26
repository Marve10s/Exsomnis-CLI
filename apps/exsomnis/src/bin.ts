import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, Layer, Logger } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';
import { AtomRegistry } from 'effect/unstable/reactivity';
import { CoreNative } from '@/core-native.ts';
import { GitService } from '@/git/git.ts';
import { WorktreeService } from '@/git/worktree.ts';
import { ModelService } from '@/orchestration/model-service.ts';
import { ThreadService } from '@/orchestration/thread-service.ts';
import { DatabaseService } from '@/persistence/database.ts';
import { ModelCacheRepository } from '@/persistence/model-cache-repository.ts';
import { ProjectRepository } from '@/persistence/project-repository.ts';
import { ThreadRepository } from '@/persistence/thread-repository.ts';
import { ProviderRegistry } from '@/providers/registry.ts';
import { formatDemoReport, runRenderDemo } from '@/render/demo.ts';
import { HostTerminal } from '@/terminal/host-terminal.ts';
import { runApp } from '@/widgets/app.ts';

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

const exsomnis = Command.make('exsomnis', {}, () => Effect.scoped(runApp())).pipe(
  Command.withDescription('Terminal workspace for the agent CLIs installed on this machine.'),
  Command.provide(HostTerminal.layer),
  Command.withSubcommands([renderDemo]),
);

const program = Command.run(exsomnis, { version: '0.0.0' });

const infrastructure = Layer.mergeAll(BunServices.layer, AtomRegistry.layer);
const gitLayer = GitService.layer.pipe(Layer.provide(infrastructure));
const database = DatabaseService.layer.pipe(Layer.provide(infrastructure));
const repositories = Layer.mergeAll(
  ProjectRepository.layer,
  ThreadRepository.layer,
  ModelCacheRepository.layer,
).pipe(Layer.provide(Layer.mergeAll(database, gitLayer, infrastructure)));
const worktrees = WorktreeService.layer.pipe(
  Layer.provide(Layer.mergeAll(gitLayer, infrastructure)),
);
const providers = ProviderRegistry.layer.pipe(Layer.provide(infrastructure));
const services = Layer.mergeAll(ThreadService.layer, ModelService.layer).pipe(
  Layer.provide(Layer.mergeAll(repositories, worktrees, gitLayer, providers, infrastructure)),
);

// @effect-diagnostics strictEffectProvide:off -- the entrypoint is the one place every layer is provided at once
BunRuntime.runMain(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        infrastructure,
        CoreNative.layer,
        gitLayer,
        providers,
        services,
        Layer.succeed(Logger.LogToStderr, true),
      ),
    ),
  ),
);
