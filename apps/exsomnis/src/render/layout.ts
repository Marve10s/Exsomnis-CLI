export interface ItemRange {
  readonly startRow: number;
  readonly rowCount: number;
  readonly itemId: string;
}

export interface RegionScroll {
  readonly offset: number;
  readonly contentHeight: number;
}

export interface Region {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scroll: RegionScroll | null;
  readonly items: ReadonlyArray<ItemRange>;
}

export const SIDEBAR_WIDTH = 26;
export const NAVIGATOR_WIDTH = 4;
export const HEADER_HEIGHT = 1;
export const COMPOSER_HEIGHT = 3;
export const STATUS_HEIGHT = 1;
export const MIN_CENTER_WIDTH = 20;

export interface ShellInput {
  readonly columns: number;
  readonly rows: number;
  readonly sidebarVisible: boolean;
  readonly sidebarItems: ReadonlyArray<ItemRange>;
  readonly transcriptItems: ReadonlyArray<ItemRange>;
  readonly transcriptOffset: number;
  readonly transcriptContentHeight: number;
  readonly navigatorItems: ReadonlyArray<ItemRange>;
}

export const sidebarWidthFor = (columns: number, visible: boolean): number => {
  if (!visible) {
    return 0;
  }
  const remaining = columns - NAVIGATOR_WIDTH - MIN_CENTER_WIDTH;
  return remaining < SIDEBAR_WIDTH ? Math.max(0, remaining) : SIDEBAR_WIDTH;
};

export const layoutShell = (input: ShellInput): ReadonlyArray<Region> => {
  const columns = Math.max(1, input.columns);
  const rows = Math.max(1, input.rows);
  const sidebar = sidebarWidthFor(columns, input.sidebarVisible);
  const navigator = Math.min(NAVIGATOR_WIDTH, Math.max(0, columns - sidebar));
  const centerX = sidebar;
  const centerWidth = Math.max(0, columns - sidebar - navigator);
  const bodyTop = HEADER_HEIGHT;
  const bodyHeight = Math.max(0, rows - HEADER_HEIGHT - STATUS_HEIGHT);
  const composerHeight = Math.min(COMPOSER_HEIGHT, bodyHeight);
  const transcriptHeight = Math.max(0, bodyHeight - composerHeight);
  const maxOffset = Math.max(0, input.transcriptContentHeight - transcriptHeight);
  const offset = Math.min(Math.max(0, input.transcriptOffset), maxOffset);

  return [
    {
      id: 'header',
      x: 0,
      y: 0,
      width: columns,
      height: HEADER_HEIGHT,
      scroll: null,
      items: [],
    },
    {
      id: 'sidebar',
      x: 0,
      y: bodyTop,
      width: sidebar,
      height: bodyHeight,
      scroll: null,
      items: input.sidebarItems,
    },
    {
      id: 'transcript',
      x: centerX,
      y: bodyTop,
      width: centerWidth,
      height: transcriptHeight,
      scroll: { offset, contentHeight: input.transcriptContentHeight },
      items: input.transcriptItems,
    },
    {
      id: 'composer',
      x: centerX,
      y: bodyTop + transcriptHeight,
      width: centerWidth,
      height: composerHeight,
      scroll: null,
      items: [],
    },
    {
      id: 'navigator',
      x: columns - navigator,
      y: bodyTop,
      width: navigator,
      height: bodyHeight,
      scroll: null,
      items: input.navigatorItems,
    },
    {
      id: 'status',
      x: 0,
      y: rows - STATUS_HEIGHT,
      width: columns,
      height: STATUS_HEIGHT,
      scroll: null,
      items: [],
    },
  ];
};

export const regionAt = (
  regions: ReadonlyArray<Region>,
  x: number,
  y: number,
): Region | undefined => {
  for (const region of regions) {
    if (
      region.width > 0 &&
      region.height > 0 &&
      x >= region.x &&
      x < region.x + region.width &&
      y >= region.y &&
      y < region.y + region.height
    ) {
      return region;
    }
  }
  return undefined;
};

export const contentRowAt = (region: Region, y: number): number =>
  y - region.y + (region.scroll === null ? 0 : region.scroll.offset);

export const itemAtRow = (items: ReadonlyArray<ItemRange>, row: number): ItemRange | undefined => {
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = items[middle];
    if (candidate === undefined) {
      return undefined;
    }
    if (row < candidate.startRow) {
      high = middle - 1;
    } else if (row >= candidate.startRow + candidate.rowCount) {
      low = middle + 1;
    } else {
      return candidate;
    }
  }
  return undefined;
};

export const itemAt = (region: Region, y: number): ItemRange | undefined =>
  itemAtRow(region.items, contentRowAt(region, y));
