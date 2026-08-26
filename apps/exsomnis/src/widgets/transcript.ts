import type { ApprovalDecision, TimelineItemPayload } from '@/domain/provider.ts';
import type { TimelineItem, Turn, TurnState } from '@/domain/thread.ts';
import type { FrameBuilder, Style } from '@/render/frame.ts';
import type { ItemRange, Region } from '@/render/layout.ts';
import * as theme from '@/widgets/theme.ts';
import { collapse, fit, indent, wrap } from '@/widgets/text.ts';

interface TranscriptLine {
  readonly text: string;
  readonly appearance: Style;
}

export interface TranscriptContent {
  readonly lines: ReadonlyArray<TranscriptLine>;
  readonly items: ReadonlyArray<ItemRange>;
}

export interface TranscriptInput {
  readonly items: ReadonlyArray<TimelineItem>;
  readonly turns: ReadonlyArray<Turn>;
  readonly width: number;
}

const COMMAND_OUTPUT_LINES = 6;

const decisionLabel = (decision: ApprovalDecision): string => {
  switch (decision) {
    case 'accept':
      return 'accepted';
    case 'acceptForSession':
      return 'accepted for session';
    case 'decline':
      return 'declined';
    case 'cancel':
      return 'cancelled';
  }
};

const styled = (lines: ReadonlyArray<string>, appearance: Style): ReadonlyArray<TranscriptLine> =>
  lines.map((text) => ({ text, appearance }));

const collapsedOutput = (output: string, width: number): ReadonlyArray<string> => {
  const trimmed = output.replace(/\n+$/u, '');
  if (trimmed.length === 0) {
    return [];
  }
  const rows = trimmed.split('\n');
  const shown = rows.slice(0, COMMAND_OUTPUT_LINES).map((row) => `  ${fit(row, width - 2)}`);
  return rows.length > COMMAND_OUTPUT_LINES
    ? [...shown, `  … ${rows.length - COMMAND_OUTPUT_LINES} more lines`]
    : shown;
};

const renderPayload = (
  payload: TimelineItemPayload,
  width: number,
  queued: boolean,
): ReadonlyArray<TranscriptLine> => {
  switch (payload.kind) {
    case 'userMessage': {
      const lines = indent(wrap(payload.text, width - 2), '› ', '  ');
      const marker = queued ? [{ text: '  queued', appearance: theme.bodyMuted }] : [];
      return [...styled(lines, theme.bodyAccent), ...marker];
    }
    case 'assistantMessage':
      return payload.text.length === 0 ? [] : styled(wrap(payload.text, width), theme.body);
    case 'reasoning': {
      const summary = collapse(payload.text);
      return summary.length === 0
        ? []
        : [{ text: fit(`· ${summary}`, width), appearance: theme.bodyMuted }];
    }
    case 'command': {
      const exit = payload.exitCode === undefined ? '' : ` (exit ${payload.exitCode.toFixed(0)})`;
      const head = fit(`$ ${collapse(payload.command)}${exit}`, width);
      const headStyle =
        payload.exitCode === undefined || payload.exitCode === 0
          ? theme.bodySuccess
          : theme.bodyDanger;
      return [
        { text: head, appearance: headStyle },
        ...styled(collapsedOutput(payload.output, width), theme.bodyMuted),
      ];
    }
    case 'fileChange':
      return [
        {
          text: fit(`± ${payload.change} ${payload.path}`, width),
          appearance: theme.bodyWarning,
        },
      ];
    case 'toolCall': {
      const head = fit(`⚙ ${payload.name} ${collapse(payload.input)}`, width);
      const output = payload.output ?? '';
      return [
        { text: head, appearance: theme.bodyStrong },
        ...styled(collapsedOutput(output, width), theme.bodyMuted),
      ];
    }
    case 'webSearch':
      return [{ text: fit(`search ${payload.query}`, width), appearance: theme.bodyStrong }];
    case 'approval': {
      const detail = payload.request.detail ?? '';
      const decision = payload.decision === undefined ? 'waiting' : decisionLabel(payload.decision);
      return [
        { text: fit(`? ${payload.request.title}`, width), appearance: theme.bodyWarning },
        ...(detail.length === 0
          ? []
          : styled(indent(wrap(detail, width - 2), '  ', '  '), theme.bodyMuted)),
        { text: fit(`  ${decision}`, width), appearance: theme.bodyMuted },
      ];
    }
    case 'error':
      return styled(indent(wrap(payload.message, width - 2), '! ', '  '), theme.bodyDanger);
    case 'notice':
      return styled(indent(wrap(payload.text, width - 2), '· ', '  '), theme.bodyMuted);
  }
};

const isQueued = (state: TurnState | undefined): boolean => state === 'queued';

export const transcriptContent = (input: TranscriptInput): TranscriptContent => {
  const width = Math.max(1, input.width - 2);
  const states = new Map(input.turns.map((turn) => [turn.id, turn.state] as const));
  const lines: Array<TranscriptLine> = [];
  const ranges: Array<ItemRange> = [];
  for (const item of input.items) {
    const rendered = renderPayload(item.payload, width, isQueued(states.get(item.turnId)));
    if (rendered.length === 0) {
      continue;
    }
    ranges.push({ startRow: lines.length, rowCount: rendered.length + 1, itemId: item.id });
    for (const line of rendered) {
      lines.push(line);
    }
    lines.push({ text: '', appearance: theme.body });
  }
  return { lines, items: ranges };
};

export const paintTranscript = (
  builder: FrameBuilder,
  region: Region,
  content: TranscriptContent,
  emptyHint: string,
) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.body);
  builder.clipPush(region.x, region.y, region.width, region.height);
  if (content.lines.length === 0) {
    builder.text(region.x + 1, region.y, fit(emptyHint, region.width - 2), theme.bodyMuted);
    builder.clipPop();
    return;
  }
  const offset = region.scroll === null ? 0 : region.scroll.offset;
  for (let row = 0; row < region.height; row += 1) {
    const line = content.lines[offset + row];
    if (line === undefined || line.text.length === 0) {
      continue;
    }
    builder.text(region.x + 1, region.y + row, line.text, line.appearance);
  }
  builder.clipPop();
};
