import type { FrameBuilder } from '@/render/frame.ts';
import type { Region } from '@/render/layout.ts';
import * as theme from '@/widgets/theme.ts';
import { fit } from '@/widgets/text.ts';

const DIFF_PLACEHOLDER = 'diff view not available yet';

export const diffPlaceholder = (builder: FrameBuilder, region: Region) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.body);
  builder.text(
    region.x + 1,
    region.y + Math.floor(region.height / 2),
    fit(DIFF_PLACEHOLDER, region.width - 2),
    theme.bodyMuted,
  );
};
