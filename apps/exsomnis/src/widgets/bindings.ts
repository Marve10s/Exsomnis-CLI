import type { BindingSpec } from '@/terminal/hotkeys.ts';
import { LEADER } from '@/terminal/hotkeys.ts';
import type { KeyEvent } from '@/terminal/input-decoder.ts';
import { codeForCharacter } from '@/terminal/input-decoder.ts';

export const bindingSpecs: ReadonlyArray<BindingSpec> = [
  { id: 'thread.previous', sequence: [LEADER, 'K'], label: 'select the previous thread' },
  { id: 'thread.next', sequence: [LEADER, 'J'], label: 'select the next thread' },
  { id: 'thread.new', sequence: [LEADER, 'N'], label: 'create a thread' },
  { id: 'sidebar.toggle', sequence: [LEADER, 'B'], label: 'collapse or show the sidebar' },
  { id: 'view.chat', sequence: [LEADER, 'C'], label: 'show the chat view' },
  { id: 'view.diff', sequence: [LEADER, 'D'], label: 'show the diff view' },
  { id: 'help', sequence: [LEADER, '/'], label: 'show this list' },
  { id: 'quit', sequence: [LEADER, 'Q'], label: 'quit exsomnis' },
  { id: 'transcript.pageUp', sequence: ['PageUp'], label: 'scroll the transcript up' },
  { id: 'transcript.pageDown', sequence: ['PageDown'], label: 'scroll the transcript down' },
  { id: 'transcript.top', sequence: ['Home'], label: 'jump to the start of the transcript' },
  { id: 'transcript.bottom', sequence: ['End'], label: 'follow the end of the transcript' },
];

export const LEADER_ACTIONS: ReadonlySet<string> = new Set([
  'thread.previous',
  'thread.next',
  'thread.new',
  'sidebar.toggle',
  'view.chat',
  'view.diff',
  'help',
  'quit',
]);

export const shortKey = (display: string): string => display.split(' ').at(-1) ?? display;

export const displayOf = (
  bindings: ReadonlyArray<{ readonly id: string; readonly display: string }>,
  id: string,
): string => bindings.find((binding) => binding.id === id)?.display ?? '';

const UNSHIFTED: ReadonlyMap<string, string> = new Map([
  ['?', '/'],
  ['~', '`'],
  ['{', '['],
  ['}', ']'],
  ['|', '\\'],
  ['+', '='],
  ['_', '-'],
  ['<', ','],
  ['>', '.'],
  [':', ';'],
  ['!', '1'],
  ['@', '2'],
  ['#', '3'],
  ['$', '4'],
  ['%', '5'],
  ['^', '6'],
  ['&', '7'],
  ['*', '8'],
  ['(', '9'],
  [')', '0'],
]);

export const withPhysicalKey = (event: KeyEvent): KeyEvent => {
  if (event.code.length > 0) {
    return event;
  }
  const base = UNSHIFTED.get(event.key);
  return base === undefined ? event : { ...event, code: codeForCharacter(base) };
};
