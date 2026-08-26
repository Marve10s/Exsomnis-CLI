export const cellWidth = (value: string): number => Bun.stringWidth(value);

export const fit = (value: string, width: number): string => {
  if (width <= 0) {
    return '';
  }
  if (cellWidth(value) <= width) {
    return value;
  }
  let used = 0;
  let out = '';
  for (const character of value) {
    const next = used + cellWidth(character);
    if (next > width - 1) {
      return `${out}…`;
    }
    used = next;
    out += character;
  }
  return out;
};

export const pad = (value: string, width: number): string => {
  const fitted = fit(value, width);
  return fitted + ' '.repeat(Math.max(0, width - cellWidth(fitted)));
};

const hardWrap = (value: string, width: number): ReadonlyArray<string> => {
  const pieces: Array<string> = [];
  let current = '';
  let used = 0;
  for (const character of value) {
    const size = cellWidth(character);
    if (used + size > width && current.length > 0) {
      pieces.push(current);
      current = '';
      used = 0;
    }
    current += character;
    used += size;
  }
  pieces.push(current);
  return pieces;
};

const wrapParagraph = (paragraph: string, width: number): ReadonlyArray<string> => {
  if (paragraph.length === 0) {
    return [''];
  }
  const lines: Array<string> = [];
  let current = '';
  for (const word of paragraph.split(' ')) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (cellWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
      current = '';
    }
    if (cellWidth(word) <= width) {
      current = word;
      continue;
    }
    const pieces = hardWrap(word, width);
    for (const piece of pieces.slice(0, -1)) {
      lines.push(piece);
    }
    current = pieces[pieces.length - 1] ?? '';
  }
  lines.push(current);
  return lines;
};

export const wrap = (value: string, width: number): ReadonlyArray<string> => {
  if (width <= 0) {
    return [];
  }
  return value.split('\n').flatMap((paragraph) => wrapParagraph(paragraph, width));
};

export const indent = (
  lines: ReadonlyArray<string>,
  prefix: string,
  continuation: string,
): ReadonlyArray<string> =>
  lines.map((line, index) => `${index === 0 ? prefix : continuation}${line}`);

export const collapse = (value: string): string => value.replaceAll(/\s+/gu, ' ').trim();
