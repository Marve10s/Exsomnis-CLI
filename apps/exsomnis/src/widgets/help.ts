import type { FrameBuilder } from '@/render/frame.ts';
import type { Region } from '@/render/layout.ts';
import type { Binding } from '@/terminal/hotkeys.ts';
import * as theme from '@/widgets/theme.ts';
import { fit, pad } from '@/widgets/text.ts';

export const helpRegion = (columns: number, rows: number, count: number): Region => {
  const width = Math.min(columns, 60);
  const height = Math.min(rows, count + 2);
  return {
    id: 'help',
    x: Math.max(0, Math.floor((columns - width) / 2)),
    y: Math.max(0, Math.floor((rows - height) / 2)),
    width,
    height,
    scroll: null,
    items: [],
  };
};

export const paintHelp = (
  builder: FrameBuilder,
  region: Region,
  bindings: ReadonlyArray<Binding>,
) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.overlay);
  builder.clipPush(region.x, region.y, region.width, region.height);
  builder.text(region.x + 1, region.y, fit('key bindings', region.width - 2), theme.overlayAccent);
  bindings.forEach((binding, index) => {
    const y = region.y + 1 + index;
    if (y >= region.y + region.height - 1) {
      return;
    }
    builder.text(region.x + 1, y, pad(binding.display, 12), theme.overlay);
    builder.text(region.x + 14, y, fit(binding.label, region.width - 15), theme.overlayMuted);
  });
  builder.text(
    region.x + 1,
    region.y + region.height - 1,
    fit('esc closes this overlay', region.width - 2),
    theme.overlayMuted,
  );
  builder.clipPop();
};
