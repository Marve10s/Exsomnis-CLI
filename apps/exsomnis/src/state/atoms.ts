import { Option } from 'effect';
import { Atom } from 'effect/unstable/reactivity';
import type { ProviderId, ThreadId } from '@/domain/ids.ts';
import type { ApprovalSettings, ModelInfo, NativeCommand, TokenUsage } from '@/domain/provider.ts';
import type { DiffDocument } from '@/core-native.ts';
import type { Region } from '@/render/layout.ts';
import type { TerminalSize } from '@/terminal/host-terminal.ts';
import type {
  ActiveView,
  Attention,
  FocusRegion,
  PendingRequest,
  Project,
  Thread,
  TimelineItem,
  Turn,
} from '@/domain/thread.ts';

export const projectsAtom = Atom.make<ReadonlyArray<Project>>([]);
export const threadsAtom = Atom.make<ReadonlyArray<Thread>>([]);
export const selectedThreadIdAtom = Atom.make<Option.Option<ThreadId>>(Option.none());
export const activeViewAtom = Atom.make<ActiveView>('chat');
export const focusAtom = Atom.make<FocusRegion>('chat');
export const sidebarVisibleAtom = Atom.make(true);
export const defaultProviderAtom = Atom.make<ProviderId>('codex');
export const terminalSizeAtom = Atom.make<TerminalSize>({ columns: 80, rows: 24 });
export const regionsAtom = Atom.make<ReadonlyArray<Region>>([]);

export const timelineAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<ReadonlyArray<TimelineItem>>([]).pipe(Atom.keepAlive),
);
export const turnsAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<ReadonlyArray<Turn>>([]).pipe(Atom.keepAlive),
);
export const pendingRequestAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<Option.Option<PendingRequest>>(Option.none()).pipe(Atom.keepAlive),
);
export const attentionAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<Attention>('none').pipe(Atom.keepAlive),
);
export const modelsAtom = Atom.family((_provider: ProviderId) =>
  Atom.make<ReadonlyArray<ModelInfo>>([]).pipe(Atom.keepAlive),
);
export const tokenUsageAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<Option.Option<TokenUsage>>(Option.none()).pipe(Atom.keepAlive),
);
export const workingTreeVersionAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make(0).pipe(Atom.keepAlive),
);

export interface ComposerState {
  readonly text: string;
  readonly cursor: number;
}

export const emptyComposer: ComposerState = { text: '', cursor: 0 };

export const composerAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<ComposerState>(emptyComposer).pipe(Atom.keepAlive),
);
export const draftComposerAtom = Atom.make<ComposerState>(emptyComposer);

export const composerFor = (threadId: ThreadId | undefined) =>
  threadId === undefined ? draftComposerAtom : composerAtom(threadId);

export const transcriptOffsetAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make(0).pipe(Atom.keepAlive),
);
export const transcriptFollowAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make(true).pipe(Atom.keepAlive),
);
export const nativeCommandsAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<ReadonlyArray<NativeCommand>>([]).pipe(Atom.keepAlive),
);
export const nativeCommandsLoadedAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make(false).pipe(Atom.keepAlive),
);

export type PaletteMode =
  | { readonly kind: 'commands' }
  | { readonly kind: 'model' }
  | { readonly kind: 'reasoning'; readonly model: string }
  | { readonly kind: 'provider' }
  | { readonly kind: 'approvals'; readonly dimension: number; readonly chosen: ApprovalSettings };

export interface PaletteState {
  readonly mode: PaletteMode;
  readonly cursor: number;
}

export const paletteAtom = Atom.make<Option.Option<PaletteState>>(Option.none());
export const helpVisibleAtom = Atom.make(false);
export const approvalCursorAtom = Atom.make(0);
export const sidebarCursorAtom = Atom.make(0);
export const leaderPendingAtom = Atom.make(false);
export const statusMessageAtom = Atom.make<Option.Option<string>>(Option.none());
export const uiRevisionAtom = Atom.make(0);
export const diffDocumentAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<DiffDocument>({ files: [] }).pipe(Atom.keepAlive),
);
export const diffSelectionAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make(0).pipe(Atom.keepAlive),
);
export const diffFileScrollAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make(0).pipe(Atom.keepAlive),
);
export const diffHunkScrollAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make(0).pipe(Atom.keepAlive),
);
export type DiffPane = 'files' | 'hunks';
export const diffFocusedPaneAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<DiffPane>('files').pipe(Atom.keepAlive),
);

export interface DiffRefreshTrigger {
  readonly enabled: boolean;
  readonly workingTreeVersion: number;
  readonly finalizedTurnId: string;
}

export const diffRefreshTriggerAtom = Atom.family((threadId: ThreadId) =>
  Atom.make((get): DiffRefreshTrigger => {
    const selected = get(selectedThreadIdAtom);
    const enabled =
      get(activeViewAtom) === 'diff' && Option.isSome(selected) && selected.value === threadId;
    const finalized = get(turnsAtom(threadId)).findLast((turn) => Option.isSome(turn.finishedAt));
    return {
      enabled,
      workingTreeVersion: get(workingTreeVersionAtom(threadId)),
      finalizedTurnId: finalized?.id ?? '',
    };
  }).pipe(
    Atom.withEquality<DiffRefreshTrigger>(
      (left, right) =>
        left.enabled === right.enabled &&
        left.workingTreeVersion === right.workingTreeVersion &&
        left.finalizedTurnId === right.finalizedTurnId,
    ),
    Atom.keepAlive,
  ),
);
