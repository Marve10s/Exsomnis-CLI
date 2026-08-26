import type { DiffDocument, DiffFile, DiffLine } from '@/core-native.ts';
import type { FrameBuilder, Style } from '@/render/frame.ts';
import { ATTR_BOLD, ATTR_DIM, rgbColor, style } from '@/render/frame.ts';
import type { Region } from '@/render/layout.ts';
import type { DiffPane } from '@/state/atoms.ts';
import type { TerminalInput } from '@/terminal/input-decoder.ts';

const SCROLL_STEP = 3;
const LINE_NUMBER_WIDTH = 6;
const HEADER_HEIGHT = 1;
const REFRESH_LABEL = 'r refresh';

const BACKGROUND = rgbColor(16, 18, 24);
const PANEL = rgbColor(24, 27, 36);
const TEXT = rgbColor(208, 214, 226);
const MUTED = rgbColor(118, 126, 144);
const ACCENT = rgbColor(122, 162, 247);
const ERROR = rgbColor(247, 118, 142);
const SELECTED = rgbColor(38, 46, 66);

const BODY: Style = style(TEXT, BACKGROUND);
const PANEL_TEXT: Style = style(TEXT, PANEL);
const PANEL_MUTED: Style = style(MUTED, PANEL, ATTR_DIM);
const HEADER: Style = style(ACCENT, PANEL, ATTR_BOLD);
const SELECTED_ROW: Style = style(TEXT, SELECTED, ATTR_BOLD);
const ADDED_LINE: Style = style(ACCENT, BACKGROUND);
const REMOVED_LINE: Style = style(ERROR, BACKGROUND);
const MUTED_LINE: Style = style(MUTED, BACKGROUND, ATTR_DIM);

export interface DiffViewState {
  readonly document: DiffDocument;
  readonly selectedFile: number;
  readonly fileScroll: number;
  readonly hunkScroll: number;
  readonly focusedPane: DiffPane;
  readonly region: Region;
}

export interface DiffInputResult {
  readonly state: DiffViewState;
  readonly handled: boolean;
  readonly refreshRequested: boolean;
}

interface DiffLayout {
  readonly files: Region;
  readonly hunks: Region;
}

const fit = (value: string, width: number): string => {
  if (width <= 0) {
    return '';
  }
  if (Bun.stringWidth(value) <= width) {
    return value;
  }
  let output = '';
  let used = 0;
  for (const character of value) {
    const next = used + Bun.stringWidth(character);
    if (next > width - 1) {
      return `${output}…`;
    }
    output += character;
    used = next;
  }
  return output;
};

const layoutDiff = (region: Region): DiffLayout => {
  const bodyY = region.y + Math.min(HEADER_HEIGHT, region.height);
  const bodyHeight = Math.max(0, region.height - HEADER_HEIGHT);
  const preferredFilesWidth = Math.min(36, Math.max(18, Math.floor(region.width * 0.32)));
  const filesWidth = Math.min(Math.max(0, region.width - 1), preferredFilesWidth);
  const dividerWidth = region.width > filesWidth ? 1 : 0;
  return {
    files: {
      id: 'diff-files',
      x: region.x,
      y: bodyY,
      width: filesWidth,
      height: bodyHeight,
      scroll: null,
      items: [],
    },
    hunks: {
      id: 'diff-hunks',
      x: region.x + filesWidth + dividerWidth,
      y: bodyY,
      width: Math.max(0, region.width - filesWidth - dividerWidth),
      height: bodyHeight,
      scroll: null,
      items: [],
    },
  };
};

const statusLetter = (status: string): string => {
  if (status === 'added') {
    return 'A';
  }
  if (status === 'deleted') {
    return 'D';
  }
  if (status === 'renamed') {
    return 'R';
  }
  return 'M';
};

const displayPath = (file: DiffFile): string => {
  const status: string = file.status;
  return status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : file.newPath;
};

const clamp = (value: number, maximum: number): number =>
  Math.min(Math.max(0, value), Math.max(0, maximum));

const selectedFile = (state: DiffViewState): DiffFile | undefined =>
  state.document.files[clamp(state.selectedFile, state.document.files.length - 1)];

const hunkContentHeight = (file: DiffFile | undefined): number => {
  if (file === undefined || file.binary || file.hunks.length === 0) {
    return 1;
  }
  return file.hunks.reduce((height, hunk) => height + hunk.lines.length + 1, 0);
};

const lineStyle = (line: DiffLine): Style => {
  const kind: string = line.kind;
  if (kind === 'added') {
    return ADDED_LINE;
  }
  if (kind === 'removed') {
    return REMOVED_LINE;
  }
  if (kind === 'noNewline') {
    return MUTED_LINE;
  }
  return BODY;
};

const formatLineNumber = (number: number | undefined): string =>
  number === undefined ? ' '.repeat(LINE_NUMBER_WIDTH) : String(number).padStart(LINE_NUMBER_WIDTH);

const paintFiles = (builder: FrameBuilder, region: Region, state: DiffViewState) => {
  builder.fillRect(region.x, region.y, region.width, region.height, PANEL_TEXT);
  builder.clipPush(region.x, region.y, region.width, region.height);
  const selection = clamp(state.selectedFile, state.document.files.length - 1);
  const scroll = clamp(state.fileScroll, state.document.files.length - region.height);
  for (let row = 0; row < region.height; row += 1) {
    const index = scroll + row;
    const file = state.document.files[index];
    if (file === undefined) {
      continue;
    }
    const rowStyle = index === selection ? SELECTED_ROW : PANEL_TEXT;
    const counts = `+${file.additions} −${file.deletions}`;
    const pathWidth = Math.max(0, region.width - Bun.stringWidth(counts) - 5);
    builder.fillRect(region.x, region.y + row, region.width, 1, rowStyle);
    builder.text(
      region.x + 1,
      region.y + row,
      `${statusLetter(file.status)} ${fit(displayPath(file), pathWidth)}`,
      rowStyle,
    );
    builder.text(
      region.x + Math.max(0, region.width - Bun.stringWidth(counts) - 1),
      region.y + row,
      counts,
      index === selection ? rowStyle : PANEL_MUTED,
    );
  }
  builder.clipPop();
};

const paintDiffLine = (builder: FrameBuilder, region: Region, row: number, line: DiffLine) => {
  const oldNumber = formatLineNumber(line.oldLineNumber);
  const newNumber = formatLineNumber(line.newLineNumber);
  const kind: string = line.kind;
  const marker = kind === 'added' ? '+' : kind === 'removed' ? '−' : ' ';
  const prefix = `${oldNumber} ${newNumber} │${marker}`;
  const textWidth = Math.max(0, region.width - Bun.stringWidth(prefix) - 1);
  const appearance = lineStyle(line);
  builder.text(region.x + 1, region.y + row, prefix, MUTED_LINE);
  builder.text(
    region.x + 1 + Bun.stringWidth(prefix),
    region.y + row,
    fit(line.text, textWidth),
    appearance,
  );
};

const paintHunks = (builder: FrameBuilder, region: Region, state: DiffViewState) => {
  builder.fillRect(region.x, region.y, region.width, region.height, BODY);
  builder.clipPush(region.x, region.y, region.width, region.height);
  const file = selectedFile(state);
  if (file === undefined) {
    builder.text(region.x + 1, region.y, fit('No working changes', region.width - 2), MUTED_LINE);
  } else if (file.binary) {
    builder.text(region.x + 1, region.y, fit('Binary file', region.width - 2), MUTED_LINE);
  } else if (file.hunks.length === 0) {
    builder.text(region.x + 1, region.y, fit('No textual hunks', region.width - 2), MUTED_LINE);
  } else {
    let contentRow = 0;
    for (const hunk of file.hunks) {
      const headerRow = contentRow - state.hunkScroll;
      if (headerRow >= 0 && headerRow < region.height) {
        builder.text(
          region.x + 1,
          region.y + headerRow,
          fit(hunk.header, region.width - 2),
          HEADER,
        );
      }
      contentRow += 1;
      for (const line of hunk.lines) {
        const visibleRow = contentRow - state.hunkScroll;
        if (visibleRow >= 0 && visibleRow < region.height) {
          paintDiffLine(builder, region, visibleRow, line);
        }
        contentRow += 1;
      }
    }
  }
  builder.clipPop();
};

export const paintDiffView = (builder: FrameBuilder, region: Region, state: DiffViewState) => {
  const layout = layoutDiff(region);
  builder.fillRect(region.x, region.y, region.width, region.height, BODY);
  if (region.height > 0) {
    builder.fillRect(region.x, region.y, region.width, 1, PANEL_TEXT);
    const refreshWidth = Bun.stringWidth(REFRESH_LABEL);
    builder.text(
      region.x + 1,
      region.y,
      fit(
        `working tree vs HEAD  ${state.document.files.length} files`,
        region.width - refreshWidth - 3,
      ),
      HEADER,
    );
    builder.text(
      region.x + Math.max(1, region.width - refreshWidth - 1),
      region.y,
      REFRESH_LABEL,
      PANEL_MUTED,
    );
  }
  paintFiles(builder, layout.files, state);
  if (layout.hunks.x > region.x) {
    const divider = state.focusedPane === 'hunks' ? HEADER : PANEL_MUTED;
    for (let row = 0; row < layout.hunks.height; row += 1) {
      builder.text(layout.hunks.x - 1, layout.hunks.y + row, '│', divider);
    }
  }
  paintHunks(builder, layout.hunks, state);
};

const withSelection = (state: DiffViewState, selected: number): DiffViewState => {
  const layout = layoutDiff(state.region);
  const nextSelection = clamp(selected, state.document.files.length - 1);
  const fileScroll =
    nextSelection < state.fileScroll
      ? nextSelection
      : Math.max(state.fileScroll, nextSelection - Math.max(0, layout.files.height - 1));
  return { ...state, selectedFile: nextSelection, fileScroll, hunkScroll: 0 };
};

const unhandled = (state: DiffViewState): DiffInputResult => ({
  state,
  handled: false,
  refreshRequested: false,
});

const handled = (state: DiffViewState, refreshRequested = false): DiffInputResult => ({
  state,
  handled: true,
  refreshRequested,
});

export const handleDiffInput = (event: TerminalInput, state: DiffViewState): DiffInputResult => {
  const layout = layoutDiff(state.region);
  const file = selectedFile(state);
  if (event.type === 'key') {
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    if (plain && event.key.toLowerCase() === 'r') {
      return handled(state, true);
    }
    if (plain && state.focusedPane === 'files' && event.key.toLowerCase() === 'j') {
      return handled(withSelection(state, state.selectedFile + 1));
    }
    if (plain && state.focusedPane === 'files' && event.key.toLowerCase() === 'k') {
      return handled(withSelection(state, state.selectedFile - 1));
    }
    if (event.key === 'Enter' && state.focusedPane === 'files') {
      return handled({ ...state, focusedPane: 'hunks' });
    }
    if (event.key === 'Escape' && state.focusedPane === 'hunks') {
      return handled({ ...state, focusedPane: 'files' });
    }
    if (state.focusedPane === 'hunks' && event.key === 'PageUp') {
      const step = Math.max(1, layout.hunks.height - 1);
      return handled({
        ...state,
        hunkScroll: clamp(state.hunkScroll - step, Number.MAX_SAFE_INTEGER),
      });
    }
    if (state.focusedPane === 'hunks' && event.key === 'PageDown') {
      const step = Math.max(1, layout.hunks.height - 1);
      const maximum = hunkContentHeight(file) - layout.hunks.height;
      return handled({ ...state, hunkScroll: clamp(state.hunkScroll + step, maximum) });
    }
    return unhandled(state);
  }
  if (event.type !== 'mouse') {
    return unhandled(state);
  }
  const refreshStart = state.region.x + state.region.width - Bun.stringWidth(REFRESH_LABEL) - 1;
  if (
    (event.kind === 'click' || event.kind === 'doubleClick') &&
    event.y === state.region.y &&
    event.x >= refreshStart &&
    event.x < state.region.x + state.region.width
  ) {
    return handled(state, true);
  }
  const inFiles =
    event.x >= layout.files.x &&
    event.x < layout.files.x + layout.files.width &&
    event.y >= layout.files.y &&
    event.y < layout.files.y + layout.files.height;
  const inHunks =
    event.x >= layout.hunks.x &&
    event.x < layout.hunks.x + layout.hunks.width &&
    event.y >= layout.hunks.y &&
    event.y < layout.hunks.y + layout.hunks.height;
  if (event.kind === 'wheelUp' || event.kind === 'wheelDown') {
    const delta = event.kind === 'wheelUp' ? -SCROLL_STEP : SCROLL_STEP;
    if (inFiles) {
      const maximum = state.document.files.length - layout.files.height;
      return handled({ ...state, fileScroll: clamp(state.fileScroll + delta, maximum) });
    }
    if (inHunks) {
      const maximum = hunkContentHeight(file) - layout.hunks.height;
      return handled({ ...state, hunkScroll: clamp(state.hunkScroll + delta, maximum) });
    }
  }
  if (event.kind === 'click' || event.kind === 'doubleClick') {
    if (inFiles) {
      const index = state.fileScroll + event.y - layout.files.y;
      if (state.document.files[index] !== undefined) {
        const next = withSelection(state, index);
        return handled({
          ...next,
          focusedPane: event.kind === 'doubleClick' ? 'hunks' : 'files',
        });
      }
    }
    if (inHunks) {
      return handled({ ...state, focusedPane: 'hunks' });
    }
  }
  return unhandled(state);
};
