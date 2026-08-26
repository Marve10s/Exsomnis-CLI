import { Config, Context, Effect, FileSystem, Layer, Option, Path, Random, Schema } from 'effect';
import { serializeUnknownError } from '@/errors.ts';
import { GitService } from '@/git/git.ts';
import type { GitError } from '@/git/git.ts';

export const WorktreeInfo = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  baseRef: Schema.String,
  baseCommit: Schema.String,
});
export type WorktreeInfo = typeof WorktreeInfo.Type;

export const WorktreeChangeCounts = Schema.Struct({
  tracked: Schema.Int,
  untracked: Schema.Int,
});
export type WorktreeChangeCounts = typeof WorktreeChangeCounts.Type;

export class WorktreeError extends Schema.TaggedError<WorktreeError>()('WorktreeError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

const countChanges = (status: string): WorktreeChangeCounts => {
  const lines = status.split('\n').filter((line) => line.length > 0);
  return lines.reduce(
    (counts, line) =>
      line.startsWith('??')
        ? { tracked: counts.tracked, untracked: counts.untracked + 1 }
        : { tracked: counts.tracked + 1, untracked: counts.untracked },
    { tracked: 0, untracked: 0 },
  );
};

export class WorktreeService extends Context.Service<
  WorktreeService,
  {
    readonly create: (
      repositoryRoot: string,
    ) => Effect.Effect<WorktreeInfo, GitError | WorktreeError>;
    readonly inspectRemoval: (
      worktreePath: string,
    ) => Effect.Effect<WorktreeChangeCounts, GitError>;
    readonly remove: (
      repositoryRoot: string,
      worktreePath: string,
    ) => Effect.Effect<void, GitError>;
  }
>()('exsomnis/git/worktree/WorktreeService', {
  make: Effect.gen(function* () {
    const git = yield* GitService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* Config.string('HOME');
    const configuredDirectory = yield* Config.option(Config.string('EXSOMNIS_WORKTREES_DIR'));
    const worktreesDirectory = Option.getOrElse(configuredDirectory, () =>
      path.join(home, '.exsomnis', 'worktrees'),
    );
    const create = Effect.fn('WorktreeService.create')(function* (repositoryRoot: string) {
      const baseRef = yield* git.remoteDefaultBranch(repositoryRoot);
      const baseCommit = yield* git.resolveCommit(repositoryRoot, baseRef);
      const branchId = yield* Random.nextIntBetween(0, 0xff_ff_ff_ff);
      const branch = `exsomnis/${branchId.toString(16).padStart(8, '0')}`;
      const targetPath = path.join(
        worktreesDirectory,
        path.basename(repositoryRoot),
        branch.replaceAll('/', '-'),
      );
      yield* fs.makeDirectory(path.dirname(targetPath), { recursive: true }).pipe(
        Effect.mapError((error) =>
          WorktreeError.make({
            operation: 'WorktreeService.create',
            message: serializeUnknownError(error),
          }),
        ),
      );
      yield* git.run(repositoryRoot, ['worktree', 'add', '-b', branch, targetPath, baseCommit]);
      return { path: targetPath, branch, baseRef, baseCommit };
    });
    const inspectRemoval = Effect.fn('WorktreeService.inspectRemoval')(function* (
      worktreePath: string,
    ) {
      const status = yield* git.run(worktreePath, ['status', '--porcelain']);
      return countChanges(status);
    });
    const remove = Effect.fn('WorktreeService.remove')(function* (
      repositoryRoot: string,
      worktreePath: string,
    ) {
      yield* git.run(repositoryRoot, ['worktree', 'remove', '--force', worktreePath]);
    });
    return { create, inspectRemoval, remove };
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies;
}
