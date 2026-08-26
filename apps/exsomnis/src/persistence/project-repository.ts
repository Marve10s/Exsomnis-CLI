import { Clock, Context, Effect, Layer, Path, Random } from 'effect';
import { GitService } from '@/git/git.ts';
import type { GitError } from '@/git/git.ts';
import { decodeProjectRow } from '@/persistence/codecs.ts';
import { DatabaseService, PersistenceError } from '@/persistence/database.ts';
import type { ProjectId } from '@/domain/ids.ts';
import type { Project } from '@/domain/thread.ts';
import { serializeUnknownError } from '@/errors.ts';

const persistenceFailure = (operation: string) => (error: unknown) =>
  PersistenceError.make({ operation, message: serializeUnknownError(error) });

export class ProjectRepository extends Context.Service<
  ProjectRepository,
  {
    readonly ensureProject: (
      rootPath: string,
    ) => Effect.Effect<Project, PersistenceError | GitError>;
    readonly get: (projectId: ProjectId) => Effect.Effect<Project, PersistenceError>;
    readonly list: Effect.Effect<ReadonlyArray<Project>, PersistenceError>;
  }
>()('exsomnis/persistence/project-repository/ProjectRepository', {
  make: Effect.gen(function* () {
    const database = yield* DatabaseService;
    const git = yield* GitService;
    const path = yield* Path.Path;
    const sql = database.sql;
    const get = Effect.fn('ProjectRepository.get')(function* (projectId: ProjectId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT id, root_path, name, created_at
        FROM projects
        WHERE id = ${projectId}
      `.pipe(Effect.mapError(persistenceFailure('ProjectRepository.get')));
      const row = rows[0];
      if (row === undefined) {
        return yield* PersistenceError.make({
          operation: 'ProjectRepository.get',
          message: `project row missing for ${projectId}`,
        });
      }
      return yield* decodeProjectRow(row);
    });
    const ensureProject = Effect.fn('ProjectRepository.ensureProject')(function* (
      rootPath: string,
    ) {
      const resolvedRoot = yield* git.topLevel(rootPath);
      const createdAt = yield* Clock.currentTimeMillis;
      const id = `${createdAt}-${yield* Random.nextInt}`;
      yield* sql`
        INSERT INTO projects (id, root_path, name, created_at)
        VALUES (${id}, ${resolvedRoot}, ${path.basename(resolvedRoot)}, ${createdAt})
        ON CONFLICT(root_path) DO NOTHING
      `.pipe(Effect.mapError(persistenceFailure('ProjectRepository.insert')));
      const rows = yield* sql<Record<string, unknown>>`
        SELECT id, root_path, name, created_at
        FROM projects
        WHERE root_path = ${resolvedRoot}
      `.pipe(Effect.mapError(persistenceFailure('ProjectRepository.select')));
      const row = rows[0];
      if (row === undefined) {
        return yield* PersistenceError.make({
          operation: 'ProjectRepository.ensureProject',
          message: `project row missing for ${resolvedRoot}`,
        });
      }
      return yield* decodeProjectRow(row);
    });
    const list = Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT id, root_path, name, created_at
        FROM projects
        ORDER BY created_at, id
      `.pipe(Effect.mapError(persistenceFailure('ProjectRepository.list')));
      return yield* Effect.forEach(rows, decodeProjectRow);
    }).pipe(Effect.withSpan('ProjectRepository.list'));
    return { ensureProject, get, list };
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies;
}
