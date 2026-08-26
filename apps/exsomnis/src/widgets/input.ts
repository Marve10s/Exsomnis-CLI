import { Effect, Option } from 'effect';
import type { ThreadId } from '@/domain/ids.ts';
import type { ActiveView } from '@/domain/thread.ts';
import type { InterfaceActions } from '@/commands/actions.ts';
import { itemAt, regionAt } from '@/render/layout.ts';
import type { Region } from '@/render/layout.ts';
import {
  activeViewAtom,
  approvalCursorAtom,
  diffFileScrollAtom,
  diffFocusedPaneAtom,
  diffHunkScrollAtom,
  diffSelectionAtom,
  composerFor,
  defaultProviderAtom,
  emptyComposer,
  focusAtom,
  helpVisibleAtom,
  leaderPendingAtom,
  paletteAtom,
  regionsAtom,
  selectedThreadIdAtom,
  sidebarCursorAtom,
  sidebarVisibleAtom,
  statusMessageAtom,
  transcriptFollowAtom,
  transcriptOffsetAtom,
} from '@/state/atoms.ts';
import type { ComposerState, PaletteMode } from '@/state/atoms.ts';
import type { KeyEvent, MouseEvent, TerminalInput } from '@/terminal/input-decoder.ts';
import { decisionForKey } from '@/widgets/approval.ts';
import type { DiffInputResult } from '@/widgets/diff.ts';
import { handleDiffInput } from '@/widgets/diff.ts';
import { LEADER_ACTIONS, withPhysicalKey } from '@/widgets/bindings.ts';
import { deleteBackward, deleteForward, insertText, moveBy } from '@/widgets/composer.ts';
import type { PaletteAction, PaletteEntry } from '@/widgets/palette.ts';
import { threadRowIndexes } from '@/widgets/sidebar.ts';
import type { ShellDeps, ShellState } from '@/widgets/shell.ts';
import { currentPaletteEntries, diffViewState, readShellState } from '@/widgets/shell.ts';

const SCROLL_STEP = 3;

export interface InputDeps extends ShellDeps {
  readonly actions: InterfaceActions;
  readonly quit: Effect.Effect<void>;
}

interface DiffRoute {
  readonly threadId: ThreadId;
  readonly result: DiffInputResult;
}

const isPrintable = (event: KeyEvent): boolean =>
  !event.ctrlKey &&
  !event.altKey &&
  !event.metaKey &&
  Array.from(event.key).length === 1 &&
  event.key >= ' ';

const regionById = (regions: ReadonlyArray<Region>, id: string): Region | undefined =>
  regions.find((region) => region.id === id);

export const makeRouter = (deps: InputDeps) => {
  const registry = deps.registry;
  const actions = deps.actions;

  const state = (): ShellState => readShellState(deps, registry.get(selectedThreadIdAtom));

  const setStatus = (message: string) =>
    Effect.sync(() => registry.set(statusMessageAtom, Option.some(message)));

  const closePalette = () => {
    registry.set(paletteAtom, Option.none());
  };

  const openPalette = (mode: PaletteMode) => {
    registry.set(paletteAtom, Option.some({ mode, cursor: 0 }));
  };

  const clearComposer = (threadId: ThreadId | undefined) => {
    registry.set(composerFor(threadId), emptyComposer);
  };

  const scrollTranscript = (delta: number) =>
    Effect.sync(() => {
      const current = state();
      if (current.thread === undefined) {
        return;
      }
      const transcript = regionById(registry.get(regionsAtom), 'transcript');
      if (transcript === undefined || transcript.scroll === null) {
        return;
      }
      const maximum = Math.max(0, transcript.scroll.contentHeight - transcript.height);
      const next = Math.min(Math.max(0, transcript.scroll.offset + delta), maximum);
      registry.set(transcriptFollowAtom(current.thread.id), next >= maximum);
      registry.set(transcriptOffsetAtom(current.thread.id), next);
    });

  const jumpTranscript = (toEnd: boolean) =>
    Effect.sync(() => {
      const current = state();
      if (current.thread === undefined) {
        return;
      }
      registry.set(transcriptFollowAtom(current.thread.id), toEnd);
      registry.set(transcriptOffsetAtom(current.thread.id), 0);
    });

  const moveThread = (delta: number) =>
    Effect.suspend(() => {
      const current = state();
      const indexes = threadRowIndexes(current.rows);
      if (indexes.length === 0) {
        return Effect.void;
      }
      const selected = registry.get(selectedThreadIdAtom);
      const position = Option.isNone(selected)
        ? -1
        : indexes.findIndex((row) => current.rows[row]?.threadId === selected.value);
      const next = Math.min(
        Math.max(0, (position === -1 ? 0 : position) + delta),
        indexes.length - 1,
      );
      const row = indexes[next];
      const threadId = row === undefined ? undefined : current.rows[row]?.threadId;
      if (row === undefined || threadId === undefined) {
        return Effect.void;
      }
      registry.set(sidebarCursorAtom, row);
      return actions.selectThread(threadId);
    });

  const setView = (view: ActiveView) =>
    Effect.sync(() => {
      registry.set(activeViewAtom, view);
      registry.set(helpVisibleAtom, false);
    });

  const applyLeaderAction = (action: string) => {
    switch (action) {
      case 'quit':
        return deps.quit;
      case 'sidebar.toggle':
        return Effect.sync(() =>
          registry.set(sidebarVisibleAtom, !registry.get(sidebarVisibleAtom)),
        );
      case 'thread.next':
        return moveThread(1);
      case 'thread.previous':
        return moveThread(-1);
      case 'thread.new':
        return actions.createThread;
      case 'view.chat':
        return setView('chat');
      case 'view.diff':
        return setView('diff');
      case 'help':
        return Effect.sync(() => {
          closePalette();
          registry.set(helpVisibleAtom, !registry.get(helpVisibleAtom));
        });
      default:
        return Effect.void;
    }
  };

  const pageSize = (): number => {
    const transcript = regionById(registry.get(regionsAtom), 'transcript');
    return transcript === undefined ? SCROLL_STEP : Math.max(1, transcript.height - 1);
  };

  const applyScrollAction = (action: string) => {
    switch (action) {
      case 'transcript.pageUp':
        return scrollTranscript(-pageSize());
      case 'transcript.pageDown':
        return scrollTranscript(pageSize());
      case 'transcript.top':
        return jumpTranscript(false);
      case 'transcript.bottom':
        return jumpTranscript(true);
      default:
        return Effect.void;
    }
  };

  const routeToDiff = (current: ShellState, event: TerminalInput): DiffRoute | undefined => {
    const thread = current.thread;
    if (thread === undefined || registry.get(activeViewAtom) !== 'diff') {
      return undefined;
    }
    const region = regionById(registry.get(regionsAtom), 'transcript');
    if (region === undefined) {
      return undefined;
    }
    return {
      threadId: thread.id,
      result: handleDiffInput(event, diffViewState(registry, thread.id, region)),
    };
  };

  const applyDiffRoute = (route: DiffRoute): Effect.Effect<void> =>
    Effect.suspend(() => {
      registry.set(diffSelectionAtom(route.threadId), route.result.state.selectedFile);
      registry.set(diffFileScrollAtom(route.threadId), route.result.state.fileScroll);
      registry.set(diffHunkScrollAtom(route.threadId), route.result.state.hunkScroll);
      registry.set(diffFocusedPaneAtom(route.threadId), route.result.state.focusedPane);
      return route.result.refreshRequested ? actions.refreshDiff(route.threadId) : Effect.void;
    });

  const activatePalette = (entry: PaletteEntry): Effect.Effect<void> => {
    if (entry.disabled) {
      return setStatus('that command is unavailable while a turn is running');
    }
    return applyPaletteAction(entry.action);
  };

  const applyPaletteAction = (action: PaletteAction): Effect.Effect<void> => {
    const current = state();
    const thread = current.thread;
    switch (action.kind) {
      case 'exsomnis': {
        switch (action.id) {
          case 'model': {
            const provider = thread?.provider ?? registry.get(defaultProviderAtom);
            return Effect.sync(() => {
              clearComposer(thread?.id);
              openPalette({ kind: 'model' });
            }).pipe(Effect.andThen(actions.loadModels(provider)));
          }
          case 'provider':
            return Effect.sync(() => {
              clearComposer(thread?.id);
              openPalette({ kind: 'provider' });
            });
          case 'approvals':
            return Effect.sync(() => {
              clearComposer(thread?.id);
              openPalette({ kind: 'approvals', dimension: 0, chosen: {} });
            });
          case 'help':
            return Effect.sync(() => {
              clearComposer(thread?.id);
              closePalette();
              registry.set(helpVisibleAtom, true);
            });
        }
      }
      case 'native': {
        if (thread === undefined) {
          return Effect.void;
        }
        const text = registry.get(composerFor(thread.id)).text;
        const rest = text.startsWith('/') ? text.slice(1) : text;
        const args = rest.slice(action.command.name.length).trim();
        return Effect.sync(closePalette).pipe(
          Effect.andThen(actions.runNative(action.command, args)),
        );
      }
      case 'model': {
        if (action.model.reasoningEfforts.length > 0) {
          return Effect.sync(() => openPalette({ kind: 'reasoning', model: action.model.id }));
        }
        return Effect.sync(closePalette).pipe(
          Effect.andThen(actions.applyModel({ model: action.model.id })),
        );
      }
      case 'reasoning':
        return Effect.sync(closePalette).pipe(
          Effect.andThen(
            actions.applyModel({ model: action.model, reasoningEffort: action.effort }),
          ),
        );
      case 'provider':
        return Effect.sync(() => {
          registry.set(defaultProviderAtom, action.provider);
          closePalette();
        });
      case 'approval': {
        const palette = registry.get(paletteAtom);
        if (Option.isNone(palette) || palette.value.mode.kind !== 'approvals') {
          return Effect.void;
        }
        const mode = palette.value.mode;
        const chosen = { ...mode.chosen, [action.dimension]: action.value };
        const dimensions = deps.approvalDimensions(
          thread?.provider ?? registry.get(defaultProviderAtom),
        );
        if (mode.dimension + 1 < dimensions.length) {
          return Effect.sync(() =>
            openPalette({ kind: 'approvals', dimension: mode.dimension + 1, chosen }),
          );
        }
        return Effect.sync(closePalette).pipe(
          Effect.andThen(actions.applyApproval({ ...thread?.approval, ...chosen })),
        );
      }
    }
    return Effect.void;
  };

  const movePalette = (delta: number, entries: ReadonlyArray<PaletteEntry>) =>
    Effect.sync(() => {
      const palette = registry.get(paletteAtom);
      if (Option.isNone(palette) || entries.length === 0) {
        return;
      }
      const next = Math.min(Math.max(0, palette.value.cursor + delta), entries.length - 1);
      registry.set(paletteAtom, Option.some({ mode: palette.value.mode, cursor: next }));
    });

  const editComposer = (
    threadId: ThreadId | undefined,
    edit: (previous: ComposerState) => ComposerState,
  ) =>
    Effect.sync(() => {
      registry.set(composerFor(threadId), edit(registry.get(composerFor(threadId))));
    });

  const handleComposerKey = (current: ShellState, event: KeyEvent): Effect.Effect<void> => {
    const threadId = current.thread?.id;
    if (event.key === 'Enter') {
      if (event.altKey || event.shiftKey) {
        return editComposer(threadId, (previous) => insertText(previous, '\n'));
      }
      return actions.sendComposer;
    }
    if (event.key === 'Escape') {
      return current.running ? actions.interrupt : Effect.void;
    }
    if (event.key === 'Backspace') {
      return editComposer(threadId, deleteBackward);
    }
    if (event.key === 'Delete') {
      return editComposer(threadId, deleteForward);
    }
    if (event.key === 'ArrowLeft') {
      return editComposer(threadId, (previous) => moveBy(previous, -1));
    }
    if (event.key === 'ArrowRight') {
      return editComposer(threadId, (previous) => moveBy(previous, 1));
    }
    if (event.key === 'ArrowUp') {
      return scrollTranscript(-1);
    }
    if (event.key === 'ArrowDown') {
      return scrollTranscript(1);
    }
    if (!isPrintable(event)) {
      return Effect.void;
    }
    const composer = registry.get(composerFor(threadId));
    if (event.key === '/' && composer.text.length === 0) {
      return Effect.sync(() => {
        registry.set(composerFor(threadId), insertText(composer, '/'));
        openPalette({ kind: 'commands' });
      }).pipe(Effect.andThen(actions.loadCommands));
    }
    return editComposer(threadId, (previous) => insertText(previous, event.key));
  };

  const handlePaletteKey = (current: ShellState, event: KeyEvent): Effect.Effect<void> => {
    const entries = currentPaletteEntries(deps, current);
    const palette = registry.get(paletteAtom);
    if (Option.isNone(palette)) {
      return Effect.void;
    }
    if (event.key === 'Escape') {
      return Effect.sync(() => {
        closePalette();
        if (registry.get(composerFor(current.thread?.id)).text.startsWith('/')) {
          clearComposer(current.thread?.id);
        }
      });
    }
    if (event.key === 'ArrowUp') {
      return movePalette(-1, entries);
    }
    if (event.key === 'ArrowDown') {
      return movePalette(1, entries);
    }
    if (event.key === 'Enter') {
      const entry = entries[palette.value.cursor];
      return entry === undefined ? Effect.sync(closePalette) : activatePalette(entry);
    }
    if (palette.value.mode.kind !== 'commands') {
      return Effect.void;
    }
    const threadId = current.thread?.id;
    const edited =
      event.key === 'Backspace'
        ? deleteBackward(registry.get(composerFor(threadId)))
        : isPrintable(event)
          ? insertText(registry.get(composerFor(threadId)), event.key)
          : undefined;
    if (edited === undefined) {
      return Effect.void;
    }
    return Effect.sync(() => {
      registry.set(composerFor(threadId), edited);
      registry.set(paletteAtom, Option.some({ mode: palette.value.mode, cursor: 0 }));
      if (!edited.text.startsWith('/')) {
        closePalette();
      }
    });
  };

  const answer = (decision: Parameters<InterfaceActions['respond']>[0]) =>
    Effect.sync(() => registry.set(approvalCursorAtom, 0)).pipe(
      Effect.andThen(actions.respond(decision)),
    );

  const handleApprovalKey = (current: ShellState, event: KeyEvent): Effect.Effect<void> => {
    if (Option.isNone(current.request)) {
      return Effect.void;
    }
    const request = current.request.value.request;
    if (event.key === 'Escape') {
      return request.decisions.includes('cancel') ? actions.respond('cancel') : Effect.void;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      return Effect.sync(() => {
        const next = Math.min(
          Math.max(0, registry.get(approvalCursorAtom) + (event.key === 'ArrowUp' ? -1 : 1)),
          request.decisions.length - 1,
        );
        registry.set(approvalCursorAtom, next);
      });
    }
    if (event.key === 'Enter') {
      const decision = request.decisions[registry.get(approvalCursorAtom)];
      return decision === undefined ? Effect.void : answer(decision);
    }
    const decision = decisionForKey(request, event.key.toLowerCase());
    return decision === undefined ? Effect.void : answer(decision);
  };

  const handleSidebarKey = (current: ShellState, event: KeyEvent): Effect.Effect<void> => {
    if (event.key === 'ArrowUp') {
      return moveThread(-1);
    }
    if (event.key === 'ArrowDown') {
      return moveThread(1);
    }
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'Tab') {
      return Effect.sync(() => registry.set(focusAtom, 'chat'));
    }
    return handleComposerKey(current, event);
  };

  const handleKey = (event: KeyEvent): Effect.Effect<void> => {
    const leaderWasPending = registry.get(leaderPendingAtom);
    const action = deps.hotkeys.resolve(withPhysicalKey(event));
    registry.set(leaderPendingAtom, deps.hotkeys.leaderPending());
    const current = state();
    if (action !== undefined) {
      if (LEADER_ACTIONS.has(action)) {
        return applyLeaderAction(action);
      }
      if (current.focus === 'diff') {
        const route = routeToDiff(current, event);
        return route !== undefined && route.result.handled ? applyDiffRoute(route) : Effect.void;
      }
      return current.focus === 'chat' || current.focus === 'sidebar'
        ? applyScrollAction(action)
        : Effect.void;
    }
    if (leaderWasPending) {
      return Effect.void;
    }
    switch (current.focus) {
      case 'help':
        return event.key === 'Escape' || event.key === 'q'
          ? Effect.sync(() => registry.set(helpVisibleAtom, false))
          : Effect.void;
      case 'approval':
        return handleApprovalKey(current, event);
      case 'palette':
        return handlePaletteKey(current, event);
      case 'sidebar':
        return handleSidebarKey(current, event);
      case 'diff': {
        const route = routeToDiff(current, event);
        return route !== undefined && route.result.handled
          ? applyDiffRoute(route)
          : handleComposerKey(current, event);
      }
      case 'chat':
        return handleComposerKey(current, event);
    }
  };

  const handleMouse = (event: MouseEvent): Effect.Effect<void> => {
    const regions = registry.get(regionsAtom);
    const region = regionAt(regions, event.x, event.y);
    if (region === undefined) {
      return Effect.void;
    }
    const current = state();
    const diffRoute = routeToDiff(current, event);
    if (diffRoute !== undefined && diffRoute.result.handled) {
      return applyDiffRoute(diffRoute);
    }
    if (event.kind === 'wheelUp' || event.kind === 'wheelDown') {
      const delta = event.kind === 'wheelUp' ? -SCROLL_STEP : SCROLL_STEP;
      if (region.id === 'palette') {
        return movePalette(event.kind === 'wheelUp' ? -1 : 1, currentPaletteEntries(deps, current));
      }
      return region.id === 'transcript' ? scrollTranscript(delta) : Effect.void;
    }
    if (event.kind !== 'click' && event.kind !== 'doubleClick') {
      return Effect.void;
    }
    if (region.id === 'running') {
      return actions.interrupt;
    }
    const item = itemAt(region, event.y);
    switch (region.id) {
      case 'sidebar': {
        if (item === undefined) {
          return Effect.void;
        }
        const row = current.rows.findIndex((entry) => entry.threadId === item.itemId);
        const threadId = current.rows[row]?.threadId;
        if (row === -1 || threadId === undefined) {
          return Effect.void;
        }
        registry.set(sidebarCursorAtom, row);
        registry.set(focusAtom, 'chat');
        return actions.selectThread(threadId);
      }
      case 'navigator':
        return item === undefined ? Effect.void : setView(item.itemId === 'diff' ? 'diff' : 'chat');
      case 'palette': {
        if (item === undefined) {
          return Effect.void;
        }
        const index = Number.parseInt(item.itemId, 10);
        const entries = currentPaletteEntries(deps, current);
        const entry = entries[index];
        if (entry === undefined) {
          return Effect.void;
        }
        return Effect.sync(() => {
          const palette = registry.get(paletteAtom);
          if (Option.isSome(palette)) {
            registry.set(paletteAtom, Option.some({ mode: palette.value.mode, cursor: index }));
          }
        }).pipe(Effect.andThen(activatePalette(entry)));
      }
      case 'approval': {
        if (item === undefined || Option.isNone(current.request)) {
          return Effect.void;
        }
        const decision = current.request.value.request.decisions.find(
          (value) => value === item.itemId,
        );
        return decision === undefined ? Effect.void : answer(decision);
      }
      case 'transcript':
      case 'composer':
        return Effect.sync(() => registry.set(focusAtom, 'chat'));
      default:
        return Effect.void;
    }
  };

  const handlePaste = (text: string): Effect.Effect<void> => {
    const current = state();
    if (current.thread === undefined) {
      return Effect.void;
    }
    return editComposer(current.thread.id, (previous) => insertText(previous, text));
  };

  return (event: TerminalInput): Effect.Effect<void> => {
    switch (event.type) {
      case 'key':
        return handleKey(event);
      case 'mouse':
        return handleMouse(event);
      case 'paste':
        return handlePaste(event.text);
      case 'focus':
      case 'kittyFlags':
      case 'modeReport':
      case 'deviceAttributes':
      case 'textAreaSize':
      case 'cursorPosition':
        return Effect.void;
    }
  };
};
