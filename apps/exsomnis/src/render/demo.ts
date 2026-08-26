import { Deferred, Effect, Option, Queue } from 'effect';
import { Atom, AtomRegistry } from 'effect/unstable/reactivity';
import { CoreNative } from '@/core-native.ts';
import type { FrameBuilder, Style } from '@/render/frame.ts';
import { ATTR_BOLD, ATTR_DIM, rgbColor, style } from '@/render/frame.ts';
import type { ItemRange, Region } from '@/render/layout.ts';
import { itemAt, layoutShell, regionAt } from '@/render/layout.ts';
import { runRenderLoop } from '@/render/render-loop.ts';
import type { StatsSummary } from '@/render/stats.ts';
import { formatStatsSummary, makeStatsCollector } from '@/render/stats.ts';
import type { BindingSpec, HotkeyRegistry } from '@/terminal/hotkeys.ts';
import { LEADER, makeHotkeyRegistry } from '@/terminal/hotkeys.ts';
import type { HostTerminalShape, TerminalSize } from '@/terminal/host-terminal.ts';
import { HostTerminal, capabilityFlags } from '@/terminal/host-terminal.ts';
import type { KeyEvent, MouseEvent, TerminalInput } from '@/terminal/input-decoder.ts';
import { regionsAtom, sidebarVisibleAtom, terminalSizeAtom } from '@/state/atoms.ts';

const CSI = '\u001b[';
const MAX_LINES = 500;
const SCROLL_STEP = 3;
const CALIBRATION_TIMEOUT = '250 millis';

const TOKENS = [
  'reading',
  'crates/core/src/screen.rs',
  'to',
  'find',
  'the',
  'diff',
  'loop,',
  'then',
  'checking',
  'whether',
  'the',
  'dirty',
  'span',
  'covers',
  'the',
  'wide',
  'grapheme',
  'continuation',
  'cell.',
];

export const HARD_GRAPHEMES = [
  '世',
  '界',
  'あ',
  '가',
  '漢',
  '字',
  'ก',
  'א',
  'ا',
  'ত',
  '\u{1f600}',
  '\u{1f469}‍\u{1f4bb}',
  '\u{1f469}‍\u{1f467}‍\u{1f466}',
  '\u{1f3f4}‍☠️',
  '\u{1f1ef}\u{1f1f5}',
  '\u{1f1fa}\u{1f1f8}',
  '\u{1f1ea}\u{1f1fa}',
  '\u{1f44d}\u{1f3fd}',
  '\u{1f9d1}‍\u{1f680}',
  '❤️',
  '☠️',
  '⚠️',
  '✔️',
  '✖️',
  'é',
  'ä',
  'ñ',
  'ō̧',
  'ඕා',
  '각',
  'नि',
  'กำ',
  '█',
  '─',
  '│',
  '▶',
  '✓',
  '·',
  '…',
  '←',
];

const BACKGROUND = rgbColor(16, 18, 24);
const PANEL = rgbColor(24, 27, 36);
const TEXT = rgbColor(208, 214, 226);
const MUTED = rgbColor(118, 126, 144);
const ACCENT = rgbColor(122, 162, 247);
const SELECTED = rgbColor(38, 46, 66);
const HIGHLIGHT = rgbColor(58, 70, 96);

const BODY: Style = style(TEXT, BACKGROUND);
const PANEL_TEXT: Style = style(TEXT, PANEL);
const PANEL_MUTED: Style = style(MUTED, PANEL, ATTR_DIM);
const HEADER: Style = style(ACCENT, PANEL, ATTR_BOLD);
const SELECTED_ROW: Style = style(TEXT, SELECTED, ATTR_BOLD);
const HIGHLIGHT_ROW: Style = style(TEXT, HIGHLIGHT);

export interface DemoThread {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly lines: ReadonlyArray<string>;
  readonly width: number;
  readonly tokens: number;
}

const initialThreads: ReadonlyArray<DemoThread> = [
  {
    id: 'render-core',
    title: 'Rust compositor',
    provider: 'codex',
    lines: [''],
    width: 0,
    tokens: 0,
  },
  {
    id: 'input-layer',
    title: 'Input decoding',
    provider: 'claude',
    lines: [''],
    width: 0,
    tokens: 0,
  },
  {
    id: 'layout-pass',
    title: 'Layout and hit test',
    provider: 'codex',
    lines: [''],
    width: 0,
    tokens: 0,
  },
];

export const demoThreadsAtom = Atom.make<ReadonlyArray<DemoThread>>(initialThreads);
export const demoSelectedAtom = Atom.make(0);
export const demoScrollAtom = Atom.make(0);
export const demoHighlightAtom = Atom.make(-1);
export const demoLeaderAtom = Atom.make(false);

const DEMO_ATOMS: ReadonlyArray<Atom.Atom<unknown>> = [
  demoThreadsAtom,
  demoSelectedAtom,
  demoScrollAtom,
  demoHighlightAtom,
  demoLeaderAtom,
  sidebarVisibleAtom,
  terminalSizeAtom,
];

const RENDER_SOURCES = DEMO_ATOMS;

const BINDINGS: ReadonlyArray<BindingSpec> = [
  { id: 'quit', sequence: [LEADER, 'Q'], label: 'quit' },
  { id: 'sidebar', sequence: [LEADER, 'B'], label: 'collapse sidebar' },
  { id: 'next', sequence: [LEADER, 'N'], label: 'next thread' },
  { id: 'scrollUp', sequence: ['ArrowUp'], label: 'scroll up' },
  { id: 'scrollDown', sequence: ['ArrowDown'], label: 'scroll down' },
  { id: 'bottom', sequence: ['End'], label: 'jump to end' },
];

const fit = (value: string, width: number): string => {
  if (width <= 0) {
    return '';
  }
  if (Bun.stringWidth(value) <= width) {
    return value;
  }
  const characters = Array.from(value);
  let used = 0;
  let out = '';
  for (const character of characters) {
    const next = used + Bun.stringWidth(character);
    if (next > width - 1) {
      return `${out}…`;
    }
    used = next;
    out += character;
  }
  return out;
};

const rewrap = (lines: ReadonlyArray<string>, width: number): ReadonlyArray<string> => {
  if (width <= 0) {
    return lines;
  }
  const wrapped: Array<string> = [];
  let current = '';
  for (const word of lines.join(' ').split(' ')) {
    if (word.length === 0) {
      continue;
    }
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (Bun.stringWidth(candidate) <= width) {
      current = candidate;
    } else {
      wrapped.push(current);
      current = word;
    }
  }
  wrapped.push(current);
  return wrapped.slice(-MAX_LINES);
};

const appendToken = (thread: DemoThread, token: string, width: number): DemoThread => {
  if (width <= 0) {
    return thread;
  }
  const lines = thread.width === width ? thread.lines : rewrap(thread.lines, width);
  const last = lines[lines.length - 1] ?? '';
  const candidate = last.length === 0 ? token : `${last} ${token}`;
  const next =
    Bun.stringWidth(candidate) <= width ? [...lines.slice(0, -1), candidate] : [...lines, token];
  return {
    ...thread,
    lines: next.length > MAX_LINES ? next.slice(-MAX_LINES) : next,
    width,
    tokens: thread.tokens + 1,
  };
};

const centerWidthFor = (size: TerminalSize, sidebarVisible: boolean): number => {
  const layout = layoutShell({
    columns: size.columns,
    rows: size.rows,
    sidebarVisible,
    sidebarItems: [],
    transcriptItems: [],
    transcriptOffset: 0,
    transcriptContentHeight: 0,
    navigatorItems: [],
  });
  return layout.find((region) => region.id === 'transcript')?.width ?? 0;
};

const SIDEBAR_HEADER_ROWS = 2;

const rangesFor = (count: number, firstRow = 0): ReadonlyArray<ItemRange> =>
  Array.from({ length: count }, (_unused, index) => ({
    startRow: firstRow + index,
    rowCount: 1,
    itemId: String(index),
  }));

const paintHeader = (builder: FrameBuilder, region: Region, label: string) => {
  builder.fillRect(region.x, region.y, region.width, region.height, PANEL_TEXT);
  builder.text(region.x + 1, region.y, fit(label, region.width - 2), HEADER);
};

const paintSidebar = (
  builder: FrameBuilder,
  region: Region,
  threads: ReadonlyArray<DemoThread>,
  selected: number,
) => {
  if (region.width === 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, PANEL_TEXT);
  builder.clipPush(region.x, region.y, region.width, region.height);
  builder.text(region.x + 1, region.y, fit('threads', region.width - 2), PANEL_MUTED);
  threads.forEach((thread, index) => {
    const row = region.y + SIDEBAR_HEADER_ROWS + index;
    const rowStyle = index === selected ? SELECTED_ROW : PANEL_TEXT;
    builder.fillRect(region.x, row, region.width, 1, rowStyle);
    builder.text(region.x + 1, row, fit(thread.title, region.width - 8), rowStyle);
    builder.text(
      region.x + region.width - 7,
      row,
      fit(thread.provider, 6),
      index === selected ? rowStyle : PANEL_MUTED,
    );
  });
  builder.clipPop();
};

const paintTranscript = (
  builder: FrameBuilder,
  region: Region,
  lines: ReadonlyArray<string>,
  highlight: number,
) => {
  builder.fillRect(region.x, region.y, region.width, region.height, BODY);
  builder.clipPush(region.x, region.y, region.width, region.height);
  const offset = region.scroll === null ? 0 : region.scroll.offset;
  for (let row = 0; row < region.height; row += 1) {
    const index = offset + row;
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const rowStyle = index === highlight ? HIGHLIGHT_ROW : BODY;
    if (index === highlight) {
      builder.fillRect(region.x, region.y + row, region.width, 1, rowStyle);
    }
    builder.text(region.x + 1, region.y + row, line, rowStyle);
  }
  builder.clipPop();
};

const paintComposer = (builder: FrameBuilder, region: Region, prompt: string) => {
  if (region.height === 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, PANEL_TEXT);
  builder.text(region.x, region.y, '─'.repeat(Math.max(0, region.width)), PANEL_MUTED);
  if (region.height > 1) {
    builder.text(region.x + 1, region.y + 1, fit(`› ${prompt}`, region.width - 2), PANEL_TEXT);
  }
};

const paintNavigator = (
  builder: FrameBuilder,
  region: Region,
  threads: ReadonlyArray<DemoThread>,
  selected: number,
) => {
  if (region.width === 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, PANEL_TEXT);
  threads.forEach((_thread, index) => {
    const row = region.y + index;
    const marker = index === selected ? '▶' : '·';
    builder.text(region.x + 1, row, marker, index === selected ? HEADER : PANEL_MUTED);
  });
};

const paintStatus = (builder: FrameBuilder, region: Region, label: string) => {
  builder.fillRect(region.x, region.y, region.width, region.height, PANEL_MUTED);
  builder.text(region.x + 1, region.y, fit(label, region.width - 2), PANEL_MUTED);
};

const makePaint =
  (registry: AtomRegistry.AtomRegistry, hotkeys: HotkeyRegistry) =>
  (builder: FrameBuilder, size: TerminalSize) => {
    const threads = registry.get(demoThreadsAtom);
    const selected = registry.get(demoSelectedAtom);
    const sidebarVisible = registry.get(sidebarVisibleAtom);
    const highlight = registry.get(demoHighlightAtom);
    const leaderPending = registry.get(demoLeaderAtom);
    const thread = threads[selected] ?? threads[0];
    const lines = thread === undefined ? [] : thread.lines;

    const centerWidth = centerWidthFor(size, sidebarVisible);
    const regions = layoutShell({
      columns: size.columns,
      rows: size.rows,
      sidebarVisible,
      sidebarItems: rangesFor(threads.length, SIDEBAR_HEADER_ROWS),
      transcriptItems: rangesFor(lines.length),
      transcriptOffset: registry.get(demoScrollAtom),
      transcriptContentHeight: lines.length,
      navigatorItems: rangesFor(threads.length),
    });
    registry.set(regionsAtom, regions);

    builder.fillRect(0, 0, size.columns, size.rows, BODY);
    for (const region of regions) {
      if (region.id === 'header') {
        paintHeader(
          builder,
          region,
          `exsomnis render-demo  ${size.columns}x${size.rows}  center ${centerWidth}`,
        );
      } else if (region.id === 'sidebar') {
        paintSidebar(builder, region, threads, selected);
      } else if (region.id === 'transcript') {
        paintTranscript(builder, region, lines, highlight);
      } else if (region.id === 'composer') {
        paintComposer(
          builder,
          region,
          thread === undefined ? '' : `${thread.title} · ${thread.tokens} tokens`,
        );
      } else if (region.id === 'navigator') {
        paintNavigator(builder, region, threads, selected);
      } else if (region.id === 'status') {
        const labels = hotkeys.bindings
          .map((binding) => `${binding.display} ${binding.label}`)
          .join('  ');
        paintStatus(builder, region, leaderPending ? `leader …  ${labels}` : labels);
      }
    }

    const composer = regions.find((region) => region.id === 'composer');
    if (composer !== undefined && composer.height > 1) {
      builder.cursor(composer.x + 3, composer.y + 1, true);
    } else {
      builder.cursor(0, 0, false);
    }
  };

const takeCursorPosition = (terminal: HostTerminalShape) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const next = yield* Queue.take(terminal.events).pipe(
        Effect.timeoutOption(CALIBRATION_TIMEOUT),
      );
      if (Option.isNone(next)) {
        return undefined;
      }
      if (next.value.type === 'cursorPosition') {
        return next.value.column;
      }
    }
    return undefined;
  });

export const calibrateWidths = Effect.fn('RenderDemo.calibrate')(function* () {
  const terminal = yield* HostTerminal;
  const core = yield* CoreNative;
  const rows: Array<string> = [];
  for (const grapheme of HARD_GRAPHEMES) {
    yield* terminal.write(`${CSI}H${CSI}2K${grapheme}`);
    yield* terminal.requestCursorPosition;
    const column = yield* takeCursorPosition(terminal);
    const measured = column === undefined ? -1 : column - 1;
    const bun = Bun.stringWidth(grapheme);
    const rust = core.cellWidth(grapheme);
    if (measured !== bun || measured !== rust) {
      const points = Array.from(grapheme)
        .map((character) => (character.codePointAt(0) ?? 0).toString(16))
        .join('+');
      rows.push(`U+${points} terminal ${measured} bun ${bun} rust ${rust}`);
    }
  }
  yield* terminal.write(`${CSI}H${CSI}2J`);
  return rows;
});

const applyKey = (
  registry: AtomRegistry.AtomRegistry,
  hotkeys: HotkeyRegistry,
  event: KeyEvent,
): string | undefined => {
  const action = hotkeys.resolve(event);
  registry.set(demoLeaderAtom, hotkeys.leaderPending());
  if (action === undefined) {
    return undefined;
  }
  if (action === 'sidebar') {
    registry.set(sidebarVisibleAtom, !registry.get(sidebarVisibleAtom));
  } else if (action === 'next') {
    const threads = registry.get(demoThreadsAtom);
    registry.set(demoSelectedAtom, (registry.get(demoSelectedAtom) + 1) % threads.length);
    registry.set(demoScrollAtom, 0);
  } else if (action === 'scrollUp') {
    registry.set(demoScrollAtom, Math.max(0, registry.get(demoScrollAtom) - SCROLL_STEP));
  } else if (action === 'scrollDown') {
    registry.set(demoScrollAtom, registry.get(demoScrollAtom) + SCROLL_STEP);
  } else if (action === 'bottom') {
    registry.set(demoScrollAtom, Number.MAX_SAFE_INTEGER);
  }
  return action;
};

const clampScroll = (region: Region, offset: number): number => {
  const content = region.scroll === null ? 0 : region.scroll.contentHeight;
  return Math.min(Math.max(0, offset), Math.max(0, content - region.height));
};

const applyMouse = (registry: AtomRegistry.AtomRegistry, event: MouseEvent) => {
  const regions = registry.get(regionsAtom);
  const region = regionAt(regions, event.x, event.y);
  if (region === undefined) {
    return;
  }
  if (event.kind === 'wheelUp' || event.kind === 'wheelDown') {
    if (region.id !== 'transcript') {
      return;
    }
    const delta = event.kind === 'wheelUp' ? -SCROLL_STEP : SCROLL_STEP;
    registry.set(demoScrollAtom, clampScroll(region, registry.get(demoScrollAtom) + delta));
    return;
  }
  if (event.kind !== 'click' && event.kind !== 'doubleClick') {
    return;
  }
  const item = itemAt(region, event.y);
  if (item === undefined) {
    return;
  }
  if (region.id === 'transcript') {
    registry.set(demoHighlightAtom, Number.parseInt(item.itemId, 10));
  } else if (region.id === 'sidebar' || region.id === 'navigator') {
    registry.set(demoSelectedAtom, Number.parseInt(item.itemId, 10));
    registry.set(demoScrollAtom, 0);
  }
};

const routeInput = (
  registry: AtomRegistry.AtomRegistry,
  hotkeys: HotkeyRegistry,
  done: Deferred.Deferred<void>,
  event: TerminalInput,
) =>
  Effect.gen(function* () {
    if (event.type === 'key') {
      if (applyKey(registry, hotkeys, event) === 'quit') {
        yield* Deferred.succeed(done, undefined);
      }
      return;
    }
    if (event.type === 'mouse') {
      applyMouse(registry, event);
    }
  });

const streamTokens = (registry: AtomRegistry.AtomRegistry, index: number) =>
  Effect.forever(
    Effect.gen(function* () {
      yield* Effect.sleep('8 millis');
      const size = registry.get(terminalSizeAtom);
      const width = Math.max(0, centerWidthFor(size, registry.get(sidebarVisibleAtom)) - 2);
      const threads = registry.get(demoThreadsAtom);
      const thread = threads[index];
      if (thread === undefined || width === 0) {
        return;
      }
      const token = TOKENS[(thread.tokens + index) % TOKENS.length] ?? 'token';
      registry.set(
        demoThreadsAtom,
        threads.map((entry, position) =>
          position === index ? appendToken(entry, token, width) : entry,
        ),
      );
    }),
  );

export interface RenderDemoOptions {
  readonly calibrate: boolean;
  readonly durationSeconds: number;
}

export const runRenderDemo = Effect.fn('RenderDemo.run')(function* (options: RenderDemoOptions) {
  const terminal = yield* HostTerminal;
  const core = yield* CoreNative;
  const registry = yield* AtomRegistry.AtomRegistry;
  const stats = makeStatsCollector();
  const hotkeys = makeHotkeyRegistry(BINDINGS, 'mac');
  const done = yield* Deferred.make<void>();

  for (const atom of [...DEMO_ATOMS, regionsAtom]) {
    const unmount = registry.mount(atom);
    yield* Effect.addFinalizer(() => Effect.sync(unmount));
  }

  const size = yield* terminal.size;
  registry.set(terminalSizeAtom, size);

  const disagreements = options.calibrate ? yield* calibrateWidths() : [];

  const screen = yield* core.openScreen(size.columns, size.rows);
  yield* screen.setCapabilities(capabilityFlags(terminal.capabilities));

  for (let index = 0; index < 3; index += 1) {
    yield* Effect.forkScoped(streamTokens(registry, index));
  }

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        const event = yield* Queue.take(terminal.events);
        yield* routeInput(registry, hotkeys, done, event);
      }),
    ),
  );

  yield* Effect.forkScoped(
    runRenderLoop({
      screen,
      paint: makePaint(registry, hotkeys),
      sources: RENDER_SOURCES,
      stats,
      onResize: (next) => {
        registry.set(terminalSizeAtom, next);
      },
    }),
  );

  if (options.durationSeconds > 0) {
    yield* Effect.forkScoped(
      Effect.sleep(`${options.durationSeconds} seconds`).pipe(
        Effect.andThen(Deferred.succeed(done, undefined)),
      ),
    );
  }

  yield* Deferred.await(done);

  const native = yield* screen.takeStats;
  return {
    summary: stats.summarize(native),
    disagreements,
    capabilities: terminal.capabilities,
  };
});

export const formatDemoReport = (result: {
  readonly summary: StatsSummary;
  readonly disagreements: ReadonlyArray<string>;
  readonly capabilities: {
    readonly trueColor: boolean;
    readonly indexedColor: boolean;
    readonly synchronizedOutput: boolean;
    readonly kittyKeyboard: boolean;
  };
}): string =>
  [
    formatStatsSummary(result.summary),
    `capabilities trueColor ${result.capabilities.trueColor} indexed ${result.capabilities.indexedColor} synchronized ${result.capabilities.synchronizedOutput} kitty ${result.capabilities.kittyKeyboard}`,
    `width disagreements ${result.disagreements.length}`,
    ...result.disagreements,
  ].join('\n');
