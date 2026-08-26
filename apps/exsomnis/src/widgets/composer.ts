import type { ComposerState } from '@/state/atoms.ts';
import type { FrameBuilder } from '@/render/frame.ts';
import type { Region } from '@/render/layout.ts';
import * as theme from '@/widgets/theme.ts';
import { cellWidth, fit } from '@/widgets/text.ts';

const points = (value: string): ReadonlyArray<string> => Array.from(value);

const rebuild = (characters: ReadonlyArray<string>, cursor: number): ComposerState => ({
  text: characters.join(''),
  cursor: Math.min(Math.max(0, cursor), characters.length),
});

export const insertText = (state: ComposerState, value: string): ComposerState => {
  const characters = points(state.text);
  const inserted = points(value);
  return rebuild(
    [...characters.slice(0, state.cursor), ...inserted, ...characters.slice(state.cursor)],
    state.cursor + inserted.length,
  );
};

export const deleteBackward = (state: ComposerState): ComposerState => {
  if (state.cursor === 0) {
    return state;
  }
  const characters = points(state.text);
  return rebuild(
    [...characters.slice(0, state.cursor - 1), ...characters.slice(state.cursor)],
    state.cursor - 1,
  );
};

export const deleteForward = (state: ComposerState): ComposerState => {
  const characters = points(state.text);
  if (state.cursor >= characters.length) {
    return state;
  }
  return rebuild(
    [...characters.slice(0, state.cursor), ...characters.slice(state.cursor + 1)],
    state.cursor,
  );
};

export const moveBy = (state: ComposerState, delta: number): ComposerState => ({
  text: state.text,
  cursor: Math.min(Math.max(0, state.cursor + delta), points(state.text).length),
});

interface ComposerLayout {
  readonly lines: ReadonlyArray<string>;
  readonly cursorRow: number;
  readonly cursorColumn: number;
}

const layoutComposer = (state: ComposerState, width: number): ComposerLayout => {
  const usable = Math.max(1, width);
  const lines: Array<string> = [];
  let current = '';
  let used = 0;
  let cursorRow = 0;
  let cursorColumn = 0;
  let index = 0;
  const mark = () => {
    if (index === state.cursor) {
      cursorRow = lines.length;
      cursorColumn = used;
    }
  };
  for (const character of points(state.text)) {
    mark();
    if (character === '\n') {
      lines.push(current);
      current = '';
      used = 0;
      index += 1;
      continue;
    }
    const size = cellWidth(character);
    if (used + size > usable) {
      lines.push(current);
      current = '';
      used = 0;
      if (index === state.cursor) {
        cursorRow = lines.length;
        cursorColumn = 0;
      }
    }
    current += character;
    used += size;
    index += 1;
  }
  mark();
  lines.push(current);
  return { lines, cursorRow, cursorColumn };
};

export interface ComposerPaint {
  readonly state: ComposerState;
  readonly placeholder: string;
  readonly hint: string;
  readonly focused: boolean;
}

export interface ComposerCursor {
  readonly x: number;
  readonly y: number;
}

export const paintComposer = (
  builder: FrameBuilder,
  region: Region,
  input: ComposerPaint,
): ComposerCursor | undefined => {
  if (region.width <= 0 || region.height <= 0) {
    return undefined;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.panel);
  builder.text(region.x, region.y, '─'.repeat(Math.max(0, region.width)), theme.panelMuted);
  const hint = fit(input.hint, Math.max(0, region.width - 2));
  builder.text(
    region.x + Math.max(0, region.width - cellWidth(hint) - 1),
    region.y,
    hint,
    theme.panelMuted,
  );
  const textRows = region.height - 1;
  if (textRows <= 0) {
    return undefined;
  }
  const textX = region.x + 2;
  const textWidth = Math.max(1, region.width - 3);
  builder.text(region.x, region.y + 1, '›', input.focused ? theme.panelAccent : theme.panelMuted);
  if (input.state.text.length === 0) {
    builder.text(textX, region.y + 1, fit(input.placeholder, textWidth), theme.panelMuted);
    return { x: textX, y: region.y + 1 };
  }
  const layout = layoutComposer(input.state, textWidth);
  const maxFirst = Math.max(0, layout.lines.length - textRows);
  const firstRow = Math.min(maxFirst, Math.max(0, layout.cursorRow - textRows + 1));
  for (let row = 0; row < textRows; row += 1) {
    const line = layout.lines[firstRow + row];
    if (line === undefined || line.length === 0) {
      continue;
    }
    builder.text(textX, region.y + 1 + row, line, theme.panel);
  }
  const cursorRow = layout.cursorRow - firstRow;
  if (cursorRow < 0 || cursorRow >= textRows) {
    return undefined;
  }
  return { x: textX + layout.cursorColumn, y: region.y + 1 + cursorRow };
};
