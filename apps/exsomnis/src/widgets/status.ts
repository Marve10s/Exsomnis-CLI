import type { FrameBuilder } from '@/render/frame.ts';
import type { Region } from '@/render/layout.ts';
import * as theme from '@/widgets/theme.ts';
import { fit } from '@/widgets/text.ts';

export interface StatusInput {
  readonly leaderPending: boolean;
  readonly message: string;
  readonly hints: string;
}

export const paintStatus = (builder: FrameBuilder, region: Region, input: StatusInput) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.panel);
  const text = input.leaderPending
    ? `leader … ${input.hints}`
    : input.message.length > 0
      ? input.message
      : input.hints;
  builder.text(
    region.x + 1,
    region.y,
    fit(text, region.width - 2),
    input.message.length > 0 && !input.leaderPending ? theme.panelWarning : theme.panelMuted,
  );
};
