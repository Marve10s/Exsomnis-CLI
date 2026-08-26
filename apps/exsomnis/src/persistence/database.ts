import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-bun';
import { Config, Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect';
import { Reactivity } from 'effect/unstable/reactivity';
import { Migrator, SqlClient } from 'effect/unstable/sql';
import { serializeUnknownError } from '@/errors.ts';

export class PersistenceError extends Schema.TaggedError<PersistenceError>()('PersistenceError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

const migrations = Migrator.fromRecord({
  '1_initial': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        root_path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
    yield* sql`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_json TEXT NOT NULL,
        approval_json TEXT NOT NULL,
        branch TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        resume_ref_json TEXT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_viewed_at INTEGER NOT NULL,
        archived_at INTEGER NULL
      )
    `;
    yield* sql`
      CREATE TABLE turns (
        id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        state TEXT NOT NULL,
        queue_position INTEGER NULL,
        provider_turn_ref TEXT NULL,
        started_at INTEGER NULL,
        finished_at INTEGER NULL,
        failure_json TEXT NULL,
        UNIQUE(thread_id, ordinal)
      )
    `;
    yield* sql`
      CREATE TABLE timeline_items (
        id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_item_ref TEXT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(thread_id, ordinal)
      )
    `;
    yield* sql`
      CREATE TABLE pending_requests (
        id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        resumable INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        answered_at INTEGER NULL
      )
    `;
    yield* sql`
      CREATE TABLE model_cache (
        provider TEXT PRIMARY KEY NOT NULL,
        models_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      )
    `;
    yield* sql`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL
      )
    `;
    yield* sql`CREATE INDEX turns_thread_state ON turns(thread_id, state)`;
    yield* sql`CREATE INDEX timeline_items_thread_ordinal ON timeline_items(thread_id, ordinal)`;
    yield* sql`CREATE INDEX pending_requests_thread_status ON pending_requests(thread_id, status)`;
  }),
});

const persistenceFailure = (operation: string) => (error: unknown) =>
  PersistenceError.make({ operation, message: serializeUnknownError(error) });

export class DatabaseService extends Context.Service<
  DatabaseService,
  {
    readonly sql: SqlClient.SqlClient;
    readonly filename: string;
  }
>()('exsomnis/persistence/database/DatabaseService', {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* Config.string('HOME');
    const configuredDataDirectory = yield* Config.option(Config.string('EXSOMNIS_DATA_DIR'));
    const dataDirectory = Option.getOrElse(configuredDataDirectory, () =>
      path.join(home, 'Library', 'Application Support', 'exsomnis'),
    );
    const filename = path.join(dataDirectory, 'exsomnis.sqlite');
    yield* fs
      .makeDirectory(dataDirectory, { recursive: true })
      .pipe(Effect.mapError(persistenceFailure('DatabaseService.makeDirectory')));
    const sql = yield* SqliteClient.make({ filename }).pipe(
      Effect.mapError(persistenceFailure('DatabaseService.open')),
    );
    yield* SqliteMigrator.run({ loader: migrations }).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.mapError(persistenceFailure('DatabaseService.migrate')),
    );
    yield* sql`PRAGMA foreign_keys = ON`.pipe(
      Effect.mapError(persistenceFailure('DatabaseService.foreignKeys')),
    );
    return { sql, filename };
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies.pipe(Layer.provide(Reactivity.layer));
}
