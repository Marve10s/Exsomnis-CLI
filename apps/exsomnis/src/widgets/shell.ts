import { Option } from 'effect';
import type { AtomRegistry } from 'effect/unstable/reactivity';
import type { ProviderId, ThreadId } from '@/domain/ids.ts';
import type { ApprovalDimension, ModelInfo, NativeCommand } from '@/domain/provider.ts';
import type { PendingRequest, Thread, TimelineItem, Turn } from '@/domain/thread.ts';
import type { FrameBuilder } from '@/render/frame.ts';
import type { Region } from '@/render/layout.ts';
import { layoutShell } from '@/render/layout.ts';
import {
  activeViewAtom,
  approvalCursorAtom,
  attentionAtom,
  diffDocumentAtom,
  diffFileScrollAtom,
  diffFocusedPaneAtom,
  diffHunkScrollAtom,
  diffSelectionAtom,
  composerFor,
  defaultProviderAtom,
  focusAtom,
  helpVisibleAtom,
  leaderPendingAtom,
  modelsAtom,
  nativeCommandsAtom,
  paletteAtom,
  pendingRequestAtom,
  projectsAtom,
  regionsAtom,
  selectedThreadIdAtom,
  sidebarCursorAtom,
  sidebarVisibleAtom,
  statusMessageAtom,
  threadsAtom,
  timelineAtom,
  tokenUsageAtom,
  transcriptFollowAtom,
  transcriptOffsetAtom,
  turnsAtom,
} from '@/state/atoms.ts';
import type { PaletteState } from '@/state/atoms.ts';
import type { Binding, HotkeyRegistry } from '@/terminal/hotkeys.ts';
import type { TerminalSize } from '@/terminal/host-terminal.ts';
import { approvalRegion, paintApproval } from '@/widgets/approval.ts';
import { displayOf, shortKey } from '@/widgets/bindings.ts';
import { paintComposer } from '@/widgets/composer.ts';
import type { DiffViewState } from '@/widgets/diff.ts';
import { paintDiffView } from '@/widgets/diff.ts';
import type { ComposerCursor } from '@/widgets/composer.ts';
import { paintHeader, runningLabel, headerRunningRegion } from '@/widgets/header.ts';
import { helpRegion, paintHelp } from '@/widgets/help.ts';
import { navigatorEntries, navigatorItems, paintNavigator } from '@/widgets/navigator.ts';
import type { PaletteContext, PaletteEntry } from '@/widgets/palette.ts';
import { paintPalette, paletteEntries, paletteRegion, paletteTitle } from '@/widgets/palette.ts';
import { paintSidebar, sidebarItems, sidebarRows } from '@/widgets/sidebar.ts';
import type { SidebarRow } from '@/widgets/sidebar.ts';
import { paintStatus } from '@/widgets/status.ts';
import { paintTranscript, transcriptContent } from '@/widgets/transcript.ts';
import * as theme from '@/widgets/theme.ts';

type ShellFocus = 'sidebar' | 'chat' | 'diff' | 'palette' | 'approval' | 'help';

const ACTIVE_TURN_STATES: ReadonlySet<string> = new Set([
  'queued',
  'starting',
  'running',
  'finalizing',
]);

const RUNNING_TURN_STATES: ReadonlySet<string> = new Set(['starting', 'running', 'finalizing']);

export interface ShellDeps {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly hotkeys: HotkeyRegistry;
  readonly approvalDimensions: (provider: ProviderId) => ReadonlyArray<ApprovalDimension>;
}

export interface ShellState {
  readonly thread: Thread | undefined;
  readonly threads: ReadonlyArray<Thread>;
  readonly rows: ReadonlyArray<SidebarRow>;
  readonly timeline: ReadonlyArray<TimelineItem>;
  readonly turns: ReadonlyArray<Turn>;
  readonly request: Option.Option<PendingRequest>;
  readonly palette: Option.Option<PaletteState>;
  readonly helpVisible: boolean;
  readonly focus: ShellFocus;
  readonly running: boolean;
  readonly queued: number;
  readonly nativeCommands: ReadonlyArray<NativeCommand>;
  readonly models: ReadonlyArray<ModelInfo>;
}

const hasPendingRequest = (request: Option.Option<PendingRequest>): boolean =>
  Option.isSome(request) && request.value.status === 'pending';

const selectedThread = (
  registry: AtomRegistry.AtomRegistry,
  threadId: Option.Option<ThreadId>,
): Thread | undefined => {
  if (Option.isNone(threadId)) {
    return undefined;
  }
  return registry.get(threadsAtom).find((thread) => thread.id === threadId.value);
};

const runningState = (turns: ReadonlyArray<Turn>) => ({
  running: turns.some((turn) => RUNNING_TURN_STATES.has(turn.state)),
  queued: turns.filter((turn) => turn.state === 'queued').length,
  active: turns.some((turn) => ACTIVE_TURN_STATES.has(turn.state)),
});

export const readShellState = (deps: ShellDeps, threadId: Option.Option<ThreadId>): ShellState => {
  const registry = deps.registry;
  const thread = selectedThread(registry, threadId);
  const threads = registry.get(threadsAtom);
  const timeline = thread === undefined ? [] : registry.get(timelineAtom(thread.id));
  const turns = thread === undefined ? [] : registry.get(turnsAtom(thread.id));
  const request =
    thread === undefined
      ? Option.none<PendingRequest>()
      : registry.get(pendingRequestAtom(thread.id));
  const palette = registry.get(paletteAtom);
  const helpVisible = registry.get(helpVisibleAtom);
  const counts = runningState(turns);
  const focus: ShellFocus = helpVisible
    ? 'help'
    : hasPendingRequest(request)
      ? 'approval'
      : Option.isSome(palette)
        ? 'palette'
        : registry.get(focusAtom) === 'sidebar'
          ? 'sidebar'
          : registry.get(activeViewAtom) === 'diff'
            ? 'diff'
            : 'chat';
  return {
    thread,
    threads,
    rows: sidebarRows({
      projects: registry.get(projectsAtom),
      threads,
      attention: (id) =>
        id === thread?.id && !hasPendingRequest(request) ? 'none' : registry.get(attentionAtom(id)),
      running: (id) => runningState(registry.get(turnsAtom(id))).running,
    }),
    timeline,
    turns,
    request,
    palette,
    helpVisible,
    focus,
    running: counts.running,
    queued: counts.queued,
    nativeCommands: thread === undefined ? [] : registry.get(nativeCommandsAtom(thread.id)),
    models: thread === undefined ? [] : registry.get(modelsAtom(thread.provider)),
  };
};

const paletteContext = (deps: ShellDeps, state: ShellState): PaletteContext => {
  const provider = state.thread?.provider ?? deps.registry.get(defaultProviderAtom);
  const composer = deps.registry.get(composerFor(state.thread?.id));
  const counts = runningState(state.turns);
  return {
    query: composer.text.startsWith('/') ? composer.text.slice(1) : '',
    provider: deps.registry.get(defaultProviderAtom),
    providerLabel: provider,
    nativeCommands: state.nativeCommands,
    nativeDisabled: counts.active,
    models: state.models,
    dimensions: deps.approvalDimensions(provider),
    currentModel: state.thread?.model.model ?? '',
    currentApproval: state.thread?.approval ?? {},
  };
};

export const currentPaletteEntries = (
  deps: ShellDeps,
  state: ShellState,
): ReadonlyArray<PaletteEntry> =>
  Option.isNone(state.palette)
    ? []
    : paletteEntries(state.palette.value.mode, paletteContext(deps, state));

const statusHints = (bindings: ReadonlyArray<Binding>): string =>
  [
    `${displayOf(bindings, 'thread.next')}/${shortKey(displayOf(bindings, 'thread.previous'))} threads`,
    `${displayOf(bindings, 'thread.new')} new`,
    `${displayOf(bindings, 'sidebar.toggle')} sidebar`,
    `${displayOf(bindings, 'view.chat')}/${shortKey(displayOf(bindings, 'view.diff'))} view`,
    `${displayOf(bindings, 'help')} help`,
    `${displayOf(bindings, 'quit')} quit`,
  ].join('  ');

export const diffViewState = (
  registry: AtomRegistry.AtomRegistry,
  threadId: ThreadId,
  region: Region,
): DiffViewState => ({
  document: registry.get(diffDocumentAtom(threadId)),
  selectedFile: registry.get(diffSelectionAtom(threadId)),
  fileScroll: registry.get(diffFileScrollAtom(threadId)),
  hunkScroll: registry.get(diffHunkScrollAtom(threadId)),
  focusedPane: registry.get(diffFocusedPaneAtom(threadId)),
  region,
});

const projectNameFor = (deps: ShellDeps, thread: Thread): string =>
  deps.registry.get(projectsAtom).find((project) => project.id === thread.projectId)?.name ?? '';

const composerHint = (state: ShellState): string => {
  if (Option.isSome(state.palette)) {
    return '↑↓ move  enter run  esc close';
  }
  if (state.running) {
    return 'enter queues  esc interrupts';
  }
  return 'enter sends  alt+enter newline  / commands';
};

const baseLayout = (size: TerminalSize, sidebarVisible: boolean) =>
  layoutShell({
    columns: size.columns,
    rows: size.rows,
    sidebarVisible,
    sidebarItems: [],
    transcriptItems: [],
    transcriptOffset: 0,
    transcriptContentHeight: 0,
    navigatorItems: [],
  });

export const makePaint = (deps: ShellDeps) => (builder: FrameBuilder, size: TerminalSize) => {
  const registry = deps.registry;
  const sidebarVisible = registry.get(sidebarVisibleAtom);
  const threadId = registry.get(selectedThreadIdAtom);
  const state = readShellState(deps, threadId);
  const activeView = registry.get(activeViewAtom);
  const probe = baseLayout(size, sidebarVisible);
  const centerWidth = probe.find((region) => region.id === 'transcript')?.width ?? 0;
  const content =
    activeView === 'diff'
      ? { lines: [], items: [] }
      : transcriptContent({ items: state.timeline, turns: state.turns, width: centerWidth });
  const follow = state.thread === undefined || registry.get(transcriptFollowAtom(state.thread.id));
  const offset =
    state.thread === undefined
      ? 0
      : follow
        ? Number.MAX_SAFE_INTEGER
        : registry.get(transcriptOffsetAtom(state.thread.id));
  const bindings = deps.hotkeys.bindings;
  const entries = navigatorEntries(
    shortKey(displayOf(bindings, 'view.chat')),
    shortKey(displayOf(bindings, 'view.diff')),
  );
  const rows = state.rows;
  const layout = layoutShell({
    columns: size.columns,
    rows: size.rows,
    sidebarVisible,
    sidebarItems: sidebarItems(rows),
    transcriptItems: content.items,
    transcriptOffset: offset,
    transcriptContentHeight: content.lines.length,
    navigatorItems: navigatorItems(entries),
  });
  const header = layout.find((region) => region.id === 'header');
  const transcript = layout.find((region) => region.id === 'transcript');
  const composerRegion = layout.find((region) => region.id === 'composer');
  const usage =
    state.thread === undefined
      ? undefined
      : Option.getOrUndefined(registry.get(tokenUsageAtom(state.thread.id)));
  const headerInput = {
    project: state.thread === undefined ? 'exsomnis' : projectNameFor(deps, state.thread),
    branch: state.thread?.branch ?? '',
    provider: state.thread?.provider ?? registry.get(defaultProviderAtom),
    model: state.thread?.model.model ?? '',
    running: state.running,
    queued: state.queued,
    usage,
  };
  const overlays: Array<Region> = [];
  const paletteList = currentPaletteEntries(deps, state);
  if (transcript !== undefined && Option.isSome(state.palette)) {
    overlays.push(paletteRegion(transcript, paletteList, state.palette.value.cursor));
  }
  if (
    transcript !== undefined &&
    hasPendingRequest(state.request) &&
    Option.isSome(state.request)
  ) {
    overlays.push(
      approvalRegion(transcript, state.request.value.request, registry.get(approvalCursorAtom)),
    );
  }
  if (state.helpVisible) {
    overlays.push(helpRegion(size.columns, size.rows, bindings.length));
  }
  const runningText = runningLabel(headerInput);
  if (header !== undefined && runningText.length > 0) {
    overlays.push(headerRunningRegion(header, runningText));
  }
  registry.set(regionsAtom, [...overlays, ...layout]);

  builder.fillRect(0, 0, size.columns, size.rows, theme.body);
  let cursor: ComposerCursor | undefined = undefined;
  for (const region of layout) {
    if (region.id === 'header') {
      paintHeader(builder, region, headerInput);
    } else if (region.id === 'sidebar') {
      paintSidebar(builder, region, {
        rows,
        selected: threadId,
        cursor: registry.get(sidebarCursorAtom),
        focused: state.focus === 'sidebar',
        hints: [
          `${displayOf(bindings, 'thread.new')} new thread`,
          `${displayOf(bindings, 'sidebar.toggle')} hide`,
        ],
      });
    } else if (region.id === 'transcript') {
      if (activeView === 'diff' && state.thread !== undefined) {
        paintDiffView(builder, region, diffViewState(registry, state.thread.id, region));
      } else {
        paintTranscript(
          builder,
          region,
          content,
          state.thread === undefined
            ? `no thread yet · ${displayOf(bindings, 'thread.new')} creates one`
            : 'send a message to start this thread',
        );
      }
    } else if (region.id === 'composer') {
      cursor = paintComposer(builder, region, {
        state: registry.get(composerFor(state.thread?.id)),
        placeholder: Option.isSome(state.palette)
          ? paletteTitle(state.palette.value.mode, paletteContext(deps, state))
          : state.thread === undefined
            ? 'type / for commands'
            : 'message the agent',
        hint: composerHint(state),
        focused: state.focus === 'chat' || state.focus === 'palette',
      });
    } else if (region.id === 'navigator') {
      paintNavigator(builder, region, entries, activeView);
    } else if (region.id === 'status') {
      paintStatus(builder, region, {
        leaderPending: registry.get(leaderPendingAtom),
        message: Option.getOrElse(registry.get(statusMessageAtom), () => ''),
        hints: statusHints(bindings),
      });
    }
  }
  for (const region of overlays) {
    if (region.id === 'palette' && Option.isSome(state.palette)) {
      paintPalette(builder, region, paletteList, state.palette.value.cursor);
    } else if (region.id === 'approval' && Option.isSome(state.request)) {
      paintApproval(builder, region, state.request.value.request, registry.get(approvalCursorAtom));
    } else if (region.id === 'help') {
      paintHelp(builder, region, bindings);
    }
  }
  if (
    cursor !== undefined &&
    composerRegion !== undefined &&
    (state.focus === 'chat' || state.focus === 'palette')
  ) {
    builder.cursor(cursor.x, cursor.y, true);
  } else {
    builder.cursor(0, 0, false);
  }
};
