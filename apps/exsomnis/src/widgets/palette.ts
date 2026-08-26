import type { ProviderId } from '@/domain/ids.ts';
import type { ApprovalDimension, ModelInfo, NativeCommand } from '@/domain/provider.ts';
import type { ExsomnisCommandId } from '@/commands/registry.ts';
import { EXSOMNIS_SOURCE, exsomnisCommands } from '@/commands/registry.ts';
import type { FrameBuilder } from '@/render/frame.ts';
import type { ItemRange, Region } from '@/render/layout.ts';
import type { PaletteMode } from '@/state/atoms.ts';
import * as theme from '@/widgets/theme.ts';
import { fit, pad } from '@/widgets/text.ts';

export type PaletteAction =
  | { readonly kind: 'exsomnis'; readonly id: ExsomnisCommandId }
  | { readonly kind: 'native'; readonly command: NativeCommand }
  | { readonly kind: 'model'; readonly model: ModelInfo }
  | { readonly kind: 'reasoning'; readonly model: string; readonly effort: string }
  | { readonly kind: 'provider'; readonly provider: ProviderId }
  | { readonly kind: 'approval'; readonly dimension: string; readonly value: string };

export interface PaletteEntry {
  readonly label: string;
  readonly detail: string;
  readonly source: string;
  readonly disabled: boolean;
  readonly action: PaletteAction;
}

export interface PaletteContext {
  readonly query: string;
  readonly provider: ProviderId;
  readonly providerLabel: string;
  readonly nativeCommands: ReadonlyArray<NativeCommand>;
  readonly nativeDisabled: boolean;
  readonly models: ReadonlyArray<ModelInfo>;
  readonly dimensions: ReadonlyArray<ApprovalDimension>;
  readonly currentModel: string;
  readonly currentApproval: Readonly<Record<string, string>>;
}

export const paletteTitle = (mode: PaletteMode, context: PaletteContext): string => {
  switch (mode.kind) {
    case 'commands':
      return 'commands';
    case 'model':
      return 'select a model';
    case 'reasoning':
      return `reasoning effort for ${mode.model}`;
    case 'provider':
      return 'provider for new threads';
    case 'approvals': {
      const dimension = context.dimensions[mode.dimension];
      return dimension === undefined ? 'approvals' : dimension.label.toLowerCase();
    }
  }
};

const commandEntries = (context: PaletteContext): ReadonlyArray<PaletteEntry> => {
  const query = context.query.trim().split(' ')[0]?.toLowerCase() ?? '';
  const own = exsomnisCommands.map((command) => ({
    label: `/${command.name}`,
    detail: command.description,
    source: EXSOMNIS_SOURCE,
    disabled: false,
    action: { kind: 'exsomnis' as const, id: command.id },
  }));
  const native = context.nativeCommands.map((command) => ({
    label: `/${command.name}`,
    detail:
      command.argumentHint === undefined
        ? command.description
        : `${command.description} ${command.argumentHint}`,
    source: context.providerLabel,
    disabled: context.nativeDisabled,
    action: { kind: 'native' as const, command },
  }));
  const all = [...own, ...native];
  return query.length === 0
    ? all
    : all.filter((entry) => entry.label.slice(1).toLowerCase().includes(query));
};

export const paletteEntries = (
  mode: PaletteMode,
  context: PaletteContext,
): ReadonlyArray<PaletteEntry> => {
  switch (mode.kind) {
    case 'commands':
      return commandEntries(context);
    case 'model':
      return context.models.map((model) => ({
        label: model.displayName,
        detail: model.id === context.currentModel ? 'current' : (model.description ?? model.id),
        source: context.providerLabel,
        disabled: false,
        action: { kind: 'model', model },
      }));
    case 'reasoning': {
      const model = context.models.find((entry) => entry.id === mode.model);
      const efforts = model === undefined ? [] : model.reasoningEfforts;
      return efforts.map((effort) => ({
        label: effort,
        detail: effort === model?.defaultReasoningEffort ? 'default' : '',
        source: context.providerLabel,
        disabled: false,
        action: { kind: 'reasoning', model: mode.model, effort },
      }));
    }
    case 'provider':
      return [
        { id: 'codex' as const, label: 'Codex CLI' },
        { id: 'claude' as const, label: 'Claude Code' },
      ].map((entry) => ({
        label: entry.label,
        detail: entry.id === context.provider ? 'current' : '',
        source: EXSOMNIS_SOURCE,
        disabled: false,
        action: { kind: 'provider', provider: entry.id },
      }));
    case 'approvals': {
      const dimension = context.dimensions[mode.dimension];
      if (dimension === undefined) {
        return [];
      }
      return dimension.options.map((option) => ({
        label: option.value,
        detail:
          option.description ??
          (context.currentApproval[dimension.id] === option.value ? 'current' : ''),
        source: EXSOMNIS_SOURCE,
        disabled: false,
        action: { kind: 'approval', dimension: dimension.id, value: option.value },
      }));
    }
  }
};

const paletteWindow = (count: number, cursor: number, height: number): number => {
  if (count <= height) {
    return 0;
  }
  return Math.min(Math.max(0, cursor - height + 1), count - height);
};

export const paletteRegion = (
  anchor: Region,
  entries: ReadonlyArray<PaletteEntry>,
  cursor: number,
): Region => {
  const height = Math.max(1, Math.min(anchor.height, Math.max(1, entries.length)));
  const offset = paletteWindow(entries.length, cursor, height);
  const items: ReadonlyArray<ItemRange> = entries.map((_entry, index) => ({
    startRow: index,
    rowCount: 1,
    itemId: String(index),
  }));
  return {
    id: 'palette',
    x: anchor.x,
    y: anchor.y + anchor.height - height,
    width: anchor.width,
    height,
    scroll: { offset, contentHeight: entries.length },
    items,
  };
};

export const paintPalette = (
  builder: FrameBuilder,
  region: Region,
  entries: ReadonlyArray<PaletteEntry>,
  cursor: number,
) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.overlay);
  builder.clipPush(region.x, region.y, region.width, region.height);
  const offset = region.scroll === null ? 0 : region.scroll.offset;
  if (entries.length === 0) {
    builder.text(region.x + 1, region.y, fit('no matches', region.width - 2), theme.overlayMuted);
    builder.clipPop();
    return;
  }
  for (let row = 0; row < region.height; row += 1) {
    const index = offset + row;
    const entry = entries[index];
    if (entry === undefined) {
      continue;
    }
    const y = region.y + row;
    const active = index === cursor;
    if (active) {
      builder.fillRect(region.x, y, region.width, 1, theme.overlaySelected);
    }
    const sourceText = entry.source;
    const labelWidth = Math.max(0, region.width - sourceText.length - 3);
    const label = entry.disabled ? `${entry.label} (busy)` : entry.label;
    const labelStyle = active
      ? theme.overlaySelected
      : entry.disabled
        ? theme.overlayMuted
        : theme.overlay;
    builder.text(region.x + 1, y, pad(label, Math.min(labelWidth, 28)), labelStyle);
    const detailX = region.x + 1 + Math.min(labelWidth, 28) + 1;
    const detailWidth = Math.max(0, region.x + region.width - sourceText.length - 1 - detailX);
    builder.text(detailX, y, fit(entry.detail, detailWidth), theme.overlayMuted);
    builder.text(
      region.x + region.width - sourceText.length - 1,
      y,
      sourceText,
      theme.overlayMuted,
    );
  }
  builder.clipPop();
};
