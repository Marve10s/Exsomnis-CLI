import { Context, Effect, Layer, Option, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { serializeUnknownError } from '@/errors.ts';

export class GitError extends Schema.TaggedError<GitError>()('GitError', {
  command: Schema.String,
  cwd: Schema.String,
  exitCode: Schema.OptionFromNullOr(Schema.Int),
  message: Schema.String,
}) {}

const platformFailure = (command: string, cwd: string) => (error: unknown) =>
  GitError.make({
    command,
    cwd,
    exitCode: Option.none(),
    message: serializeUnknownError(error),
  });

export class GitService extends Context.Service<
  GitService,
  {
    readonly run: (cwd: string, args: ReadonlyArray<string>) => Effect.Effect<string, GitError>;
    readonly topLevel: (cwd: string) => Effect.Effect<string, GitError>;
    readonly currentBranch: (cwd: string) => Effect.Effect<string, GitError>;
    readonly remoteDefaultBranch: (cwd: string) => Effect.Effect<string, GitError>;
    readonly resolveCommit: (cwd: string, ref: string) => Effect.Effect<string, GitError>;
  }
>()('exsomnis/git/git/GitService', {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const run = Effect.fn('GitService.run')(function* (cwd: string, args: ReadonlyArray<string>) {
      const commandText = `git ${args.join(' ')}`;
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(ChildProcess.make('git', args, { cwd }));
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
              handle.exitCode,
            ],
            { concurrency: 3 },
          );
          return { stdout, stderr, exitCode };
        }),
      ).pipe(Effect.mapError(platformFailure(commandText, cwd)));
      if (result.exitCode !== 0) {
        const stderr = result.stderr.trim();
        return yield* GitError.make({
          command: commandText,
          cwd,
          exitCode: Option.some(result.exitCode),
          message: stderr.length > 0 ? stderr : `git exited with code ${result.exitCode}`,
        });
      }
      return result.stdout.trimEnd();
    });
    const topLevel = Effect.fn('GitService.topLevel')((cwd: string) =>
      run(cwd, ['rev-parse', '--show-toplevel']),
    );
    const currentBranch = Effect.fn('GitService.currentBranch')((cwd: string) =>
      run(cwd, ['symbolic-ref', '--short', 'HEAD']),
    );
    const remoteDefaultBranch = Effect.fn('GitService.remoteDefaultBranch')((cwd: string) =>
      run(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD']).pipe(
        Effect.catchTag('GitError', () => currentBranch(cwd)),
      ),
    );
    const resolveCommit = Effect.fn('GitService.resolveCommit')((cwd: string, ref: string) =>
      run(cwd, ['rev-parse', ref]),
    );
    return { run, topLevel, currentBranch, remoteDefaultBranch, resolveCommit };
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies;
}
