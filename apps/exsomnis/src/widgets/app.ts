import { Deferred, Effect, Option, Queue } from 'effect';
import type { Atom } from 'effect/unstable/reactivity';
import { AtomRegistry } from 'effect/unstable/reactivity';
import { CoreNative } from '@/core-native.ts';
import type { ProviderId, ThreadId } from '@/domain/ids.ts';
import { GitService } from '@/git/git.ts';
import { makeActions } from '@/commands/actions.ts';
import { ThreadService } from '@/orchestration/thread-service.ts';
import { ProviderRegistry } from '@/providers/registry.ts';
import { runRenderLoop } from '@/render/render-loop.ts';
import { makeStatsCollector } from '@/render/stats.ts';
import {
  activeViewAtom,
  approvalCursorAtom,
  attentionAtom,
  composerAtom,
  defaultProviderAtom,
  draftComposerAtom,
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
  terminalSizeAtom,
  threadsAtom,
  timelineAtom,
  tokenUsageAtom,
  transcriptFollowAtom,
  transcriptOffsetAtom,
  turnsAtom,
  uiRevisionAtom,
} from '@/state/atoms.ts';
import { makeHotkeyRegistry } from '@/terminal/hotkeys.ts';
import { HostTerminal, capabilityFlags } from '@/terminal/host-terminal.ts';
import { bindingSpecs } from '@/widgets/bindings.ts';
import { makeRouter } from '@/widgets/input.ts';
import { makePaint } from '@/widgets/shell.ts';
import type { ShellDeps } from '@/widgets/shell.ts';

const PROVIDERS: ReadonlyArray<ProviderId> = ['codex', 'claude'];

const STATIC_ATOMS: ReadonlyArray<Atom.Atom<unknown>> = [
  projectsAtom,
  threadsAtom,
  selectedThreadIdAtom,
  activeViewAtom,
  focusAtom,
  sidebarVisibleAtom,
  defaultProviderAtom,
  terminalSizeAtom,
  paletteAtom,
  helpVisibleAtom,
  approvalCursorAtom,
  sidebarCursorAtom,
  leaderPendingAtom,
  statusMessageAtom,
  draftComposerAtom,
  uiRevisionAtom,
];

const perThreadAtoms = (threadId: ThreadId): ReadonlyArray<Atom.Atom<unknown>> => [
  timelineAtom(threadId),
  turnsAtom(threadId),
  pendingRequestAtom(threadId),
  attentionAtom(threadId),
  tokenUsageAtom(threadId),
  composerAtom(threadId),
  transcriptOffsetAtom(threadId),
  transcriptFollowAtom(threadId),
  nativeCommandsAtom(threadId),
];

const watchThreads = Effect.fn('App.watchThreads')(function* () {
  const registry = yield* AtomRegistry.AtomRegistry;
  const cancels = new Map<ThreadId, ReadonlyArray<() => void>>();
  const bump = () => {
    registry.set(uiRevisionAtom, registry.get(uiRevisionAtom) + 1);
  };
  const sync = () => {
    const present = new Set(registry.get(threadsAtom).map((thread) => thread.id));
    for (const [threadId, list] of cancels) {
      if (!present.has(threadId)) {
        for (const cancel of list) {
          cancel();
        }
        cancels.delete(threadId);
      }
    }
    for (const threadId of present) {
      if (!cancels.has(threadId)) {
        cancels.set(
          threadId,
          perThreadAtoms(threadId).map((atom) => registry.subscribe(atom, bump)),
        );
      }
    }
    bump();
  };
  const threadsCancel = registry.subscribe(threadsAtom, sync);
  const providerCancels = PROVIDERS.map((provider) =>
    registry.subscribe(modelsAtom(provider), bump),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      threadsCancel();
      for (const cancel of providerCancels) {
        cancel();
      }
      for (const list of cancels.values()) {
        for (const cancel of list) {
          cancel();
        }
      }
    }),
  );
  sync();
});

export const runApp = Effect.fn('App.run')(function* () {
  const terminal = yield* HostTerminal;
  const core = yield* CoreNative;
  const registry = yield* AtomRegistry.AtomRegistry;
  const git = yield* GitService;
  const threads = yield* ThreadService;
  const providers = yield* ProviderRegistry;
  const actions = yield* makeActions();
  const stats = makeStatsCollector();
  const hotkeys = makeHotkeyRegistry(bindingSpecs, 'mac');
  const done = yield* Deferred.make<void>();

  for (const atom of [...STATIC_ATOMS, regionsAtom]) {
    const unmount = registry.mount(atom);
    yield* Effect.addFinalizer(() => Effect.sync(unmount));
  }

  const dimensions = new Map(
    providers.drivers.map((driver) => [driver.id, driver.approvalDimensions] as const),
  );
  const deps: ShellDeps = {
    registry,
    hotkeys,
    approvalDimensions: (provider) => dimensions.get(provider) ?? [],
  };

  const size = yield* terminal.size;
  registry.set(terminalSizeAtom, size);

  yield* watchThreads();

  const root = yield* git.topLevel(process.cwd());
  const project = yield* threads.ensureProject(root);
  yield* threads.reconcileStartup;
  const all = yield* threads.refreshThreads;
  const owned = all
    .filter((thread) => thread.projectId === project.id)
    .toSorted((left, right) => right.lastViewedAt - left.lastViewedAt);
  const first = owned[0];
  if (first !== undefined) {
    yield* actions.selectThread(first.id);
  } else {
    registry.set(selectedThreadIdAtom, Option.none());
  }

  const screen = yield* core.openScreen(size.columns, size.rows);
  yield* screen.setCapabilities(capabilityFlags(terminal.capabilities));

  const route = makeRouter({
    ...deps,
    actions,
    quit: Deferred.succeed(done, undefined).pipe(Effect.asVoid),
  });

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        const event = yield* Queue.take(terminal.events);
        yield* route(event);
      }),
    ),
  );

  yield* Effect.forkScoped(
    runRenderLoop({
      screen,
      paint: makePaint(deps),
      sources: STATIC_ATOMS,
      stats,
      onResize: (next) => {
        registry.set(terminalSizeAtom, next);
      },
    }),
  );

  yield* Deferred.await(done);
});
