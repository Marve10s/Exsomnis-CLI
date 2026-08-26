import { createSequenceMatcher, formatForDisplay, matchesKeyboardEvent } from '@tanstack/hotkeys';
import type { Hotkey } from '@tanstack/hotkeys';
import type { KeyEvent } from '@/terminal/input-decoder.ts';

export type HotkeyPlatform = 'mac' | 'windows' | 'linux';

export const LEADER: Hotkey = 'Control+G';
export const LEADER_TIMEOUT_MILLIS = 1000;

export interface BindingSpec {
  readonly id: string;
  readonly sequence: ReadonlyArray<Hotkey>;
  readonly label: string;
}

export interface Binding {
  readonly id: string;
  readonly display: string;
  readonly label: string;
}

export interface HotkeyRegistry {
  readonly bindings: ReadonlyArray<Binding>;
  readonly resolve: (event: KeyEvent) => string | undefined;
  readonly leaderPending: () => boolean;
  readonly reset: () => void;
}

interface Entry {
  readonly spec: BindingSpec;
  readonly matcher: { match: (event: KeyEvent) => boolean; reset: () => void } | undefined;
}

export const displayFor = (sequence: ReadonlyArray<Hotkey>, platform: HotkeyPlatform): string =>
  sequence.map((element) => formatForDisplay(element, { platform, useSymbols: true })).join(' ');

export const makeHotkeyRegistry = (
  specs: ReadonlyArray<BindingSpec>,
  platform: HotkeyPlatform,
): HotkeyRegistry => {
  const entries: ReadonlyArray<Entry> = specs.map((spec) => ({
    spec,
    matcher:
      spec.sequence.length > 1
        ? createSequenceMatcher([...spec.sequence], {
            timeout: LEADER_TIMEOUT_MILLIS,
            platform,
          })
        : undefined,
  }));

  const leaderMatcher = createSequenceMatcher([LEADER, LEADER], {
    timeout: LEADER_TIMEOUT_MILLIS,
    platform,
  });

  let pending = false;

  const resetAll = () => {
    pending = false;
    leaderMatcher.reset();
    for (const entry of entries) {
      entry.matcher?.reset();
    }
  };

  return {
    bindings: specs.map((spec) => ({
      id: spec.id,
      display: displayFor(spec.sequence, platform),
      label: spec.label,
    })),
    resolve: (event) => {
      for (const entry of entries) {
        if (entry.matcher === undefined) {
          const single = entry.spec.sequence[0];
          if (single !== undefined && matchesKeyboardEvent(event, single, platform)) {
            resetAll();
            return entry.spec.id;
          }
        } else if (entry.matcher.match(event)) {
          resetAll();
          return entry.spec.id;
        }
      }
      pending = matchesKeyboardEvent(event, LEADER, platform);
      return undefined;
    },
    leaderPending: () => pending,
    reset: resetAll,
  };
};
