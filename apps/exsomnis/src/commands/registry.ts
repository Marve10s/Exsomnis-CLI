export type ExsomnisCommandId = 'model' | 'provider' | 'approvals' | 'help';

export interface ExsomnisCommand {
  readonly id: ExsomnisCommandId;
  readonly name: string;
  readonly description: string;
}

export const EXSOMNIS_SOURCE = 'exsomnis';

export const exsomnisCommands: ReadonlyArray<ExsomnisCommand> = [
  { id: 'model', name: 'model', description: 'Choose the model for this thread' },
  { id: 'provider', name: 'provider', description: 'Choose the provider for new threads' },
  { id: 'approvals', name: 'approvals', description: 'Choose the approval mode for this thread' },
  { id: 'help', name: 'help', description: 'Show every key binding' },
];
