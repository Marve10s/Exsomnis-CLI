import { Option } from 'effect';
import type { ProviderId, ThreadId } from '@/domain/ids.ts';
import type { Attention, Project, Thread } from '@/domain/thread.ts';
import type { FrameBuilder, Style } from '@/render/frame.ts';
import type { ItemRange, Region } from '@/render/layout.ts';
import * as theme from '@/widgets/theme.ts';
import { fit, pad } from '@/widgets/text.ts';

export type ThreadBadge = 'running' | 'approval' | 'completed' | 'failed' | 'idle';

export interface SidebarRow {
  readonly kind: 'project' | 'thread';
  readonly label: string;
  readonly provider: ProviderId | undefined;
  readonly badge: ThreadBadge;
  readonly threadId: ThreadId | undefined;
}

export interface SidebarInput {
  readonly projects: ReadonlyArray<Project>;
  readonly threads: ReadonlyArray<Thread>;
  readonly attention: (threadId: ThreadId) => Attention;
  readonly running: (threadId: ThreadId) => boolean;
}

const badgeFor = (attention: Attention, running: boolean): ThreadBadge => {
  if (running) {
    return 'running';
  }
  switch (attention) {
    case 'approval':
      return 'approval';
    case 'failed':
      return 'failed';
    case 'completed':
      return 'completed';
    case 'input':
    case 'none':
      return 'idle';
  }
};

const badgeGlyph = (badge: ThreadBadge): string => {
  switch (badge) {
    case 'running':
      return '◐';
    case 'approval':
      return '?';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'idle':
      return '·';
  }
};

const badgeStyle = (badge: ThreadBadge, selected: boolean): Style => {
  if (selected) {
    return theme.panelSelected;
  }
  switch (badge) {
    case 'running':
      return theme.panelAccent;
    case 'approval':
      return theme.panelWarning;
    case 'completed':
      return theme.panelSuccess;
    case 'failed':
      return theme.panelDanger;
    case 'idle':
      return theme.panelMuted;
  }
};

const providerLabel = (provider: ProviderId): string => (provider === 'codex' ? 'cdx' : 'cld');

export const sidebarRows = (input: SidebarInput): ReadonlyArray<SidebarRow> => {
  const rows: Array<SidebarRow> = [];
  for (const project of input.projects) {
    const owned = input.threads.filter((thread) => thread.projectId === project.id);
    rows.push({
      kind: 'project',
      label: project.name,
      provider: undefined,
      badge: 'idle',
      threadId: undefined,
    });
    for (const thread of owned) {
      rows.push({
        kind: 'thread',
        label: thread.title,
        provider: thread.provider,
        badge: badgeFor(input.attention(thread.id), input.running(thread.id)),
        threadId: thread.id,
      });
    }
  }
  return rows;
};

export const sidebarItems = (rows: ReadonlyArray<SidebarRow>): ReadonlyArray<ItemRange> =>
  rows.map((row, index) => ({
    startRow: index,
    rowCount: 1,
    itemId: row.threadId ?? `project:${index}`,
  }));

export const threadRowIndexes = (rows: ReadonlyArray<SidebarRow>): ReadonlyArray<number> =>
  rows.flatMap((row, index) => (row.kind === 'thread' ? [index] : []));

export interface SidebarPaint {
  readonly rows: ReadonlyArray<SidebarRow>;
  readonly selected: Option.Option<ThreadId>;
  readonly cursor: number;
  readonly focused: boolean;
  readonly hints: ReadonlyArray<string>;
}

export const paintSidebar = (builder: FrameBuilder, region: Region, input: SidebarPaint) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.panel);
  builder.clipPush(region.x, region.y, region.width, region.height);
  const footerRows = Math.min(input.hints.length, Math.max(0, region.height - 1));
  const listHeight = Math.max(0, region.height - footerRows);
  for (let row = 0; row < listHeight; row += 1) {
    const entry = input.rows[row];
    if (entry === undefined) {
      continue;
    }
    const y = region.y + row;
    if (entry.kind === 'project') {
      builder.text(region.x, y, fit(entry.label, region.width), theme.panelAccent);
      continue;
    }
    const selected =
      entry.threadId !== undefined &&
      Option.isSome(input.selected) &&
      input.selected.value === entry.threadId;
    const cursored = input.focused && row === input.cursor;
    const rowStyle = selected ? theme.panelSelected : theme.panel;
    if (selected || cursored) {
      builder.fillRect(region.x, y, region.width, 1, rowStyle);
    }
    builder.text(region.x, y, badgeGlyph(entry.badge), badgeStyle(entry.badge, selected));
    const providerText = entry.provider === undefined ? '' : providerLabel(entry.provider);
    const titleWidth = Math.max(0, region.width - 2 - providerText.length - 1);
    builder.text(
      region.x + 2,
      y,
      pad(cursored ? `▸${entry.label}` : entry.label, titleWidth),
      selected ? rowStyle : theme.panel,
    );
    builder.text(
      region.x + region.width - providerText.length,
      y,
      providerText,
      selected ? rowStyle : theme.panelMuted,
    );
  }
  for (let index = 0; index < footerRows; index += 1) {
    const hint = input.hints[index];
    if (hint === undefined) {
      continue;
    }
    builder.text(
      region.x,
      region.y + listHeight + index,
      fit(hint, region.width),
      theme.panelMuted,
    );
  }
  builder.clipPop();
};
