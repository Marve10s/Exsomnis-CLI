import { Context, Effect, Layer } from 'effect';
import type { ProviderId } from '@/domain/ids.ts';
import { ClaudeProvider } from '@/providers/claude/claude-provider.ts';
import { CodexProvider } from '@/providers/codex/codex-provider.ts';
import { ProviderUnavailableError } from '@/providers/provider.ts';
import type { ProviderDriver } from '@/providers/provider.ts';

const registryOf = (drivers: ReadonlyArray<ProviderDriver>) => {
  const byId = new Map(drivers.map((driver) => [driver.id, driver] as const));
  return {
    drivers,
    get: (id: ProviderId) => {
      const driver = byId.get(id);
      return driver === undefined
        ? Effect.fail(
            ProviderUnavailableError.make({ provider: id, reason: 'no driver registered' }),
          )
        : Effect.succeed(driver);
    },
  };
};

export class ProviderRegistry extends Context.Service<
  ProviderRegistry,
  {
    readonly drivers: ReadonlyArray<ProviderDriver>;
    readonly get: (id: ProviderId) => Effect.Effect<ProviderDriver, ProviderUnavailableError>;
  }
>()('exsomnis/providers/registry/ProviderRegistry', {
  make: Effect.gen(function* () {
    const codex = yield* CodexProvider;
    const claude = yield* ClaudeProvider;
    return registryOf([codex, claude]);
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies.pipe(
    Layer.provide(Layer.mergeAll(CodexProvider.layer, ClaudeProvider.layer)),
  );
}
