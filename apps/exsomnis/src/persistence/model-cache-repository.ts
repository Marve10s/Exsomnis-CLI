import { Context, Effect, Layer, Option, Schema } from 'effect';
import type { ProviderId } from '@/domain/ids.ts';
import type { ModelInfo } from '@/domain/provider.ts';
import { encodeModels, ModelCacheRow } from '@/persistence/codecs.ts';
import { DatabaseService, PersistenceError } from '@/persistence/database.ts';
import { serializeUnknownError } from '@/errors.ts';

export interface ModelCacheEntry {
  readonly provider: ProviderId;
  readonly models: ReadonlyArray<ModelInfo>;
  readonly fetchedAt: number;
}

const persistenceFailure = (operation: string) => (error: unknown) =>
  PersistenceError.make({ operation, message: serializeUnknownError(error) });

export class ModelCacheRepository extends Context.Service<
  ModelCacheRepository,
  {
    readonly get: (
      provider: ProviderId,
    ) => Effect.Effect<Option.Option<ModelCacheEntry>, PersistenceError>;
    readonly put: (
      provider: ProviderId,
      models: ReadonlyArray<ModelInfo>,
      fetchedAt: number,
    ) => Effect.Effect<void, PersistenceError>;
  }
>()('exsomnis/persistence/model-cache-repository/ModelCacheRepository', {
  make: Effect.gen(function* () {
    const database = yield* DatabaseService;
    const sql = database.sql;
    const get = Effect.fn('ModelCacheRepository.get')(function* (provider: ProviderId) {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT provider, models_json, fetched_at
        FROM model_cache
        WHERE provider = ${provider}
      `.pipe(Effect.mapError(persistenceFailure('ModelCacheRepository.get')));
      const row = rows[0];
      if (row === undefined) {
        return Option.none();
      }
      const decoded = yield* Schema.decodeUnknownEffect(ModelCacheRow)(row).pipe(
        Effect.mapError(persistenceFailure('ModelCacheRepository.decode')),
      );
      return Option.some({
        provider: decoded.provider,
        models: decoded.models_json,
        fetchedAt: decoded.fetched_at,
      });
    });
    const put = Effect.fn('ModelCacheRepository.put')(function* (
      provider: ProviderId,
      models: ReadonlyArray<ModelInfo>,
      fetchedAt: number,
    ) {
      const modelsJson = yield* encodeModels(models).pipe(
        Effect.mapError(persistenceFailure('ModelCacheRepository.encode')),
      );
      yield* sql`
        INSERT INTO model_cache (provider, models_json, fetched_at)
        VALUES (${provider}, ${modelsJson}, ${fetchedAt})
        ON CONFLICT(provider) DO UPDATE SET
          models_json = excluded.models_json,
          fetched_at = excluded.fetched_at
      `.pipe(Effect.mapError(persistenceFailure('ModelCacheRepository.put')));
    });
    return { get, put };
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies;
}
