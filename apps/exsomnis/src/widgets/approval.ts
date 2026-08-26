import type { ApprovalDecision, ApprovalRequest } from '@/domain/provider.ts';
import type { FrameBuilder } from '@/render/frame.ts';
import type { ItemRange, Region } from '@/render/layout.ts';
import * as theme from '@/widgets/theme.ts';
import { fit, wrap } from '@/widgets/text.ts';

const DETAIL_LINES = 4;

const decisionKey = (decision: ApprovalDecision): string => {
  switch (decision) {
    case 'accept':
      return 'y';
    case 'acceptForSession':
      return 's';
    case 'decline':
      return 'n';
    case 'cancel':
      return 'esc';
  }
};

const decisionLabel = (decision: ApprovalDecision): string => {
  switch (decision) {
    case 'accept':
      return 'accept';
    case 'acceptForSession':
      return 'accept for session';
    case 'decline':
      return 'decline';
    case 'cancel':
      return 'cancel the turn';
  }
};

export const decisionForKey = (
  request: ApprovalRequest,
  character: string,
): ApprovalDecision | undefined =>
  request.decisions.find((decision) => decisionKey(decision) === character);

interface CardBody {
  readonly header: ReadonlyArray<string>;
  readonly decisions: ReadonlyArray<ApprovalDecision>;
}

const cardBody = (request: ApprovalRequest, width: number): CardBody => {
  const detail = request.detail ?? '';
  const detailLines = detail.length === 0 ? [] : wrap(detail, width - 2).slice(0, DETAIL_LINES);
  return {
    header: [
      `${request.kind} approval: ${request.title}`,
      ...detailLines.map((line) => `  ${line}`),
    ],
    decisions: request.decisions,
  };
};

export const approvalRegion = (
  anchor: Region,
  request: ApprovalRequest,
  cursor: number,
): Region => {
  const body = cardBody(request, Math.max(1, anchor.width - 2));
  const total = body.header.length + body.decisions.length;
  const height = Math.max(1, Math.min(anchor.height, total));
  const offset = Math.max(0, Math.min(total - height, cursor));
  const items: ReadonlyArray<ItemRange> = body.decisions.map((decision, index) => ({
    startRow: body.header.length + index,
    rowCount: 1,
    itemId: decision,
  }));
  return {
    id: 'approval',
    x: anchor.x,
    y: anchor.y + anchor.height - height,
    width: anchor.width,
    height,
    scroll: { offset, contentHeight: total },
    items,
  };
};

export const paintApproval = (
  builder: FrameBuilder,
  region: Region,
  request: ApprovalRequest,
  cursor: number,
) => {
  if (region.width <= 0 || region.height <= 0) {
    return;
  }
  builder.fillRect(region.x, region.y, region.width, region.height, theme.overlay);
  builder.clipPush(region.x, region.y, region.width, region.height);
  const body = cardBody(request, Math.max(1, region.width - 2));
  const offset = region.scroll === null ? 0 : region.scroll.offset;
  for (let row = 0; row < region.height; row += 1) {
    const index = offset + row;
    const y = region.y + row;
    const headerLine = body.header[index];
    if (headerLine !== undefined) {
      builder.text(
        region.x + 1,
        y,
        fit(headerLine, region.width - 2),
        index === 0 ? theme.overlayAccent : theme.overlayMuted,
      );
      continue;
    }
    const decision = body.decisions[index - body.header.length];
    if (decision === undefined) {
      continue;
    }
    const active = index - body.header.length === cursor;
    if (active) {
      builder.fillRect(region.x, y, region.width, 1, theme.overlaySelected);
    }
    builder.text(
      region.x + 1,
      y,
      fit(`[${decisionKey(decision)}] ${decisionLabel(decision)}`, region.width - 2),
      active ? theme.overlaySelected : theme.overlay,
    );
  }
  builder.clipPop();
};
