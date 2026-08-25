import { Context, Effect, Layer, Option } from 'effect';
import type { ApprovalDimension } from '@/domain/provider.ts';
import { ProviderError } from '@/providers/provider.ts';
import type { ProviderDriver } from '@/providers/provider.ts';

const notImplemented = (operation: string) =>
  ProviderError.make({
    provider: 'claude',
    operation,
    message: 'the Claude Code adapter is not implemented yet',
  });

const claudeApprovalDimensions: ReadonlyArray<ApprovalDimension> = [
  {
    id: 'permissionMode',
    label: 'Permission mode',
    options: [
      { value: 'default' },
      { value: 'acceptEdits' },
      { value: 'plan' },
      { value: 'bypassPermissions' },
      { value: 'dontAsk' },
      { value: 'auto' },
    ],
    defaultValue: 'default',
  },
];

export class ClaudeProvider extends Context.Service<ClaudeProvider, ProviderDriver>()(
  'exsomnis/providers/claude/claude-provider/ClaudeProvider',
  {
    make: Effect.succeed({
      id: 'claude',
      detect: Effect.succeed(Option.none()),
      listModels: Effect.fail(notImplemented('listModels')),
      approvalDimensions: claudeApprovalDimensions,
      openSession: () => Effect.fail(notImplemented('openSession')),
    } satisfies ProviderDriver),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
