import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { AtomRegistry } from 'effect/unstable/reactivity';
import type { ProviderId } from '@/domain/ids.ts';
import type { ModelInfo } from '@/domain/provider.ts';
import type { PersistenceError } from '@/persistence/database.ts';
import { ModelCacheRepository } from '@/persistence/model-cache-repository.ts';
import type { ProviderError, ProviderUnavailableError } from '@/providers/provider.ts';
import { ProviderRegistry } from '@/providers/registry.ts';
import { modelsAtom } from '@/state/atoms.ts';

export const ListModelsOptions = Schema.Struct({ force: Schema.Boolean });
export type ListModelsOptions = typeof ListModelsOptions.Type;

const cacheLifetimeMilliseconds = 10 * 60 * 1_000;

export class ModelService extends Context.Service<
  ModelService,
  {
    readonly listModels: (
      provider: ProviderId,
      options: ListModelsOptions,
    ) => Effect.Effect<
      ReadonlyArray<ModelInfo>,
      PersistenceError | ProviderError | ProviderUnavailableError
    >;
  }
>()('exsomnis/orchestration/model-service/ModelService', {
  make: Effect.gen(function* () {
    const providers = yield* ProviderRegistry;
    const cache = yield* ModelCacheRepository;
    const atoms = yield* AtomRegistry.AtomRegistry;
    const refresh = Effect.fn('ModelService.refresh')(function* (provider: ProviderId) {
      const driver = yield* providers.get(provider);
      const models = yield* driver.listModels;
      const fetchedAt = yield* Clock.currentTimeMillis;
      yield* cache.put(provider, models, fetchedAt);
      yield* Effect.sync(() => atoms.set(modelsAtom(provider), models));
      return models;
    });
    const listModels = Effect.fn('ModelService.listModels')(function* (
      provider: ProviderId,
      options: ListModelsOptions,
    ) {
      const cached = yield* cache.get(provider);
      if (options.force || Option.isNone(cached)) {
        return yield* refresh(provider);
      }
      yield* Effect.sync(() => atoms.set(modelsAtom(provider), cached.value.models));
      const now = yield* Clock.currentTimeMillis;
      if (now - cached.value.fetchedAt < cacheLifetimeMilliseconds) {
        return cached.value.models;
      }
      yield* refresh(provider).pipe(Effect.result, Effect.forkDetach);
      return cached.value.models;
    });
    return { listModels };
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies;
}
