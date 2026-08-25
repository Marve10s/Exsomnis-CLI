import { Context, Effect, Layer, Option } from 'effect';
import type { ApprovalDimension } from '@/domain/provider.ts';
import { ProviderError } from '@/providers/provider.ts';
import type { ProviderDriver } from '@/providers/provider.ts';

const notImplemented = (operation: string) =>
  ProviderError.make({
    provider: 'codex',
    operation,
    message: 'the Codex adapter is not implemented yet',
  });

const codexApprovalDimensions: ReadonlyArray<ApprovalDimension> = [
  {
    id: 'approvalPolicy',
    label: 'Approval policy',
    options: [{ value: 'untrusted' }, { value: 'on-request' }, { value: 'never' }],
    defaultValue: 'on-request',
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    options: [
      { value: 'read-only' },
      { value: 'workspace-write' },
      { value: 'danger-full-access' },
    ],
    defaultValue: 'workspace-write',
  },
];

export class CodexProvider extends Context.Service<CodexProvider, ProviderDriver>()(
  'exsomnis/providers/codex/codex-provider/CodexProvider',
  {
    make: Effect.succeed({
      id: 'codex',
      detect: Effect.succeed(Option.none()),
      listModels: Effect.fail(notImplemented('listModels')),
      approvalDimensions: codexApprovalDimensions,
      openSession: () => Effect.fail(notImplemented('openSession')),
    } satisfies ProviderDriver),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
