import { Option } from 'effect';
import { Atom } from 'effect/unstable/reactivity';
import type { ProviderId, ThreadId } from '@/domain/ids.ts';
import type { ModelInfo, TokenUsage } from '@/domain/provider.ts';
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
  Atom.make<ReadonlyArray<TimelineItem>>([]),
);
export const turnsAtom = Atom.family((_threadId: ThreadId) => Atom.make<ReadonlyArray<Turn>>([]));
export const pendingRequestAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<Option.Option<PendingRequest>>(Option.none()),
);
export const attentionAtom = Atom.family((_threadId: ThreadId) => Atom.make<Attention>('none'));
export const modelsAtom = Atom.family((_provider: ProviderId) =>
  Atom.make<ReadonlyArray<ModelInfo>>([]),
);
export const tokenUsageAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make<Option.Option<TokenUsage>>(Option.none()),
);
export const workingTreeVersionAtom = Atom.family((_threadId: ThreadId) =>
  Atom.make(0).pipe(Atom.keepAlive),
);
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
