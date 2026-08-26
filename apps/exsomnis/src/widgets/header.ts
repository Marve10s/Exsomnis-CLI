import type { TokenUsage } from '@/domain/provider.ts';
import type { FrameBuilder } from '@/render/frame.ts';
import type { Region } from '@/render/layout.ts';
import * as theme from '@/widgets/theme.ts';
import { cellWidth, fit } from '@/widgets/text.ts';

export interface HeaderInput {
  readonly project: string;
  readonly branch: string;
  readonly provider: string;
  readonly model: string;
  readonly running: boolean;
  readonly queued: number;
  readonly usage: TokenUsage | undefined;
}

const SPINNER = '◐';

export const runningLabel = (input: HeaderInput): string => {
  if (!input.running) {
    return '';
  }
  return input.queued > 0
    ? `${SPINNER} running (+${input.queued} queued) · esc to interrupt`
    : `${SPINNER} running · esc to interrupt`;
};

const usageLabel = (usage: TokenUsage | undefined): string => {
  if (usage === undefined) {
    return '';
  }
  const used = Math.round(usage.used);
  return usage.contextWindow === undefined
    ? `${used} tokens`
    : `${used}/${Math.round(usage.contextWindow)} tokens`;
};

export const headerRunningRegion = (region: Region, label: string): Region => {
  const width = Math.min(cellWidth(label), region.width);
  return {
    id: 'running',
    x: region.x + Math.max(0, region.width - width - 1),
    y: region.y,
    width,
    height: 1,
    scroll: null,
    items: [{ startRow: 0, rowCount: 1, itemId: 'running' }],
  };
};

export const paintHeader = (builder: FrameBuilder, region: Region, input: HeaderInput) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.panel);
  const left = [input.project, input.branch, input.provider, input.model]
    .filter((part) => part.length > 0)
    .join(' · ');
  const running = runningLabel(input);
  const usage = usageLabel(input.usage);
  const right = running.length > 0 ? running : usage;
  const rightWidth = Math.min(cellWidth(right), Math.max(0, region.width - 2));
  builder.text(
    region.x + 1,
    region.y,
    fit(left, Math.max(0, region.width - rightWidth - 3)),
    theme.panelAccent,
  );
  if (rightWidth > 0) {
    builder.text(
      region.x + Math.max(0, region.width - rightWidth - 1),
      region.y,
      fit(right, rightWidth),
      running.length > 0 ? theme.panelWarning : theme.panelMuted,
    );
  }
};
