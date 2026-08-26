import type { ActiveView } from '@/domain/thread.ts';
import type { FrameBuilder } from '@/render/frame.ts';
import type { ItemRange, Region } from '@/render/layout.ts';
import * as theme from '@/widgets/theme.ts';
import { fit } from '@/widgets/text.ts';

export interface NavigatorEntry {
  readonly view: ActiveView;
  readonly icon: string;
  readonly key: string;
}

const ROWS_PER_ENTRY = 3;

export const navigatorEntries = (
  chatKey: string,
  diffKey: string,
): ReadonlyArray<NavigatorEntry> => [
  { view: 'chat', icon: '▤', key: chatKey },
  { view: 'diff', icon: '≡', key: diffKey },
];

export const navigatorItems = (entries: ReadonlyArray<NavigatorEntry>): ReadonlyArray<ItemRange> =>
  entries.map((entry, index) => ({
    startRow: index * ROWS_PER_ENTRY,
    rowCount: ROWS_PER_ENTRY,
    itemId: entry.view,
  }));

export const paintNavigator = (
  builder: FrameBuilder,
  region: Region,
  entries: ReadonlyArray<NavigatorEntry>,
  active: ActiveView,
) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.panel);
  builder.clipPush(region.x, region.y, region.width, region.height);
  entries.forEach((entry, index) => {
    const top = region.y + index * ROWS_PER_ENTRY;
    const selected = entry.view === active;
    if (selected) {
      builder.fillRect(region.x, top, region.width, 2, theme.panelSelected);
    }
    builder.text(region.x + 1, top, entry.icon, selected ? theme.panelSelected : theme.panelMuted);
    builder.text(
      region.x,
      top + 1,
      fit(entry.key, region.width),
      selected ? theme.panelSelected : theme.panelMuted,
    );
  });
  builder.clipPop();
};
