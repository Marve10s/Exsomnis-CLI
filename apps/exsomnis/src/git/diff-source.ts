import { Context, Effect, Layer } from 'effect';
import type { DiffDocument, NativeCoreError } from '@/core-native.ts';
import { CoreNative } from '@/core-native.ts';
import type { GitError } from '@/git/git.ts';
import { GitService } from '@/git/git.ts';

const NO_INDEX_ALIAS =
  '!f() { git diff --no-index "$@"; code=$?; if [ "$code" -eq 1 ]; then exit 0; fi; exit "$code"; }; f';

export interface DiffSourceResult {
  readonly document: DiffDocument;
  readonly trackedFileCount: number;
  readonly untrackedFileCount: number;
}

const countNumstatFiles = (output: string): number => {
  if (output.length === 0) {
    return 0;
  }
  return output.split('\n').filter((line) => line.length > 0).length;
};

const parseNullList = (output: string): ReadonlyArray<string> =>
  output.split('\0').filter((path) => path.length > 0);

const parseUntrackedStatus = (output: string): ReadonlySet<string> => {
  const paths = new Set<string>();
  for (const record of output.split('\0')) {
    if (record.startsWith('? ')) {
      paths.add(record.slice(2));
    }
  }
  return paths;
};

export class DiffSource extends Context.Service<
  DiffSource,
  {
    readonly load: (cwd: string) => Effect.Effect<DiffSourceResult, GitError | NativeCoreError>;
  }
>()('exsomnis/git/diff-source/DiffSource', {
  make: Effect.gen(function* () {
    const git = yield* GitService;
    const core = yield* CoreNative;
    const hasHead = Effect.fn('DiffSource.hasHead')((cwd: string) =>
      git.run(cwd, ['rev-parse', '--verify', 'HEAD']).pipe(
        Effect.as(true),
        Effect.catchTag('GitError', () => Effect.succeed(false)),
      ),
    );
    const untrackedPatch = Effect.fn('DiffSource.untrackedPatch')((cwd: string, path: string) =>
      git.run(cwd, [
        '-c',
        `alias.diff-untracked=${NO_INDEX_ALIAS}`,
        'diff-untracked',
        '--',
        '/dev/null',
        path,
      ]),
    );
    const load = Effect.fn('DiffSource.load')(function* (cwd: string) {
      const headExists = yield* hasHead(cwd);
      const patchArgs = headExists
        ? [
            'diff',
            '--patch',
            '--no-color',
            '--no-ext-diff',
            '--no-textconv',
            '--minimal',
            'HEAD',
            '--',
          ]
        : [
            'diff',
            '--cached',
            '--patch',
            '--no-color',
            '--no-ext-diff',
            '--no-textconv',
            '--minimal',
            '--',
          ];
      const numstatArgs = headExists
        ? ['diff', 'HEAD', '--numstat', '--']
        : ['diff', '--cached', '--numstat', '--'];
      const [trackedPatch, numstat, untrackedOutput, statusOutput] = yield* Effect.all(
        [
          git.run(cwd, patchArgs),
          git.run(cwd, numstatArgs),
          git.run(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
          git.run(cwd, ['status', '--porcelain=2', '-z', '--untracked-files=all']),
        ],
        { concurrency: 4 },
      );
      const statusPaths = parseUntrackedStatus(statusOutput);
      const untrackedPaths = parseNullList(untrackedOutput).filter((path) => statusPaths.has(path));
      const untrackedPatches = yield* Effect.forEach(
        untrackedPaths,
        (path) => untrackedPatch(cwd, path),
        { concurrency: 4 },
      );
      const patch = [trackedPatch, ...untrackedPatches]
        .filter((section) => section.length > 0)
        .join('\n');
      const document = yield* core.parseUnifiedDiff(patch);
      return {
        document,
        trackedFileCount: countNumstatFiles(numstat),
        untrackedFileCount: statusPaths.size,
      };
    });
    return { load };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
