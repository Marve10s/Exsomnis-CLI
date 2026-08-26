export const OP_FILL_RECT = 0;
export const OP_TEXT_RUN = 1;
export const OP_CURSOR = 2;
export const OP_CLIP_PUSH = 3;
export const OP_CLIP_POP = 4;

export const OP_WORDS = 8;
export const MAX_OPS = 32768;
export const MAX_TEXT_BYTES = 1_048_576;
const INITIAL_OPS = 2048;
const INITIAL_TEXT_BYTES = 32768;

export const ATTR_BOLD = 1;
export const ATTR_DIM = 1 << 1;
export const ATTR_ITALIC = 1 << 2;
export const ATTR_UNDERLINE = 1 << 3;
export const ATTR_STRIKETHROUGH = 1 << 4;
export const ATTR_REVERSE = 1 << 5;
export const ATTR_BLINK = 1 << 6;

export const DEFAULT_COLOR = 0;

export const namedColor = (index: number): number => (index & 15) + 1;
export const indexedColor = (index: number): number => 0x0200_0000 | (index & 255);
export const rgbColor = (red: number, green: number, blue: number): number =>
  0x0100_0000 | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255);

export interface Style {
  readonly foreground: number;
  readonly background: number;
  readonly attributes: number;
}

export const style = (foreground: number, background: number, attributes = 0): Style => ({
  foreground,
  background,
  attributes,
});

export interface FrameBuilder {
  readonly begin: () => void;
  readonly fillRect: (x: number, y: number, width: number, height: number, value: Style) => void;
  readonly text: (x: number, y: number, value: string, appearance: Style) => void;
  readonly cursor: (x: number, y: number, visible: boolean) => void;
  readonly clipPush: (x: number, y: number, width: number, height: number) => void;
  readonly clipPop: () => void;
  readonly ops: () => Int32Array;
  readonly opCount: () => number;
  readonly textBytes: () => Uint8Array;
  readonly textLength: () => number;
}

const encoder = new TextEncoder();

export const makeFrameBuilder = (): FrameBuilder => {
  let ops = new Int32Array(INITIAL_OPS * OP_WORDS);
  let opCount = 0;
  let textBytes = new Uint8Array(INITIAL_TEXT_BYTES);
  let textLength = 0;

  const ensureOps = (): boolean => {
    if ((opCount + 1) * OP_WORDS <= ops.length) {
      return true;
    }
    if (opCount + 1 > MAX_OPS) {
      return false;
    }
    let capacity = Math.max(INITIAL_OPS, ops.length / OP_WORDS);
    while (capacity < opCount + 1) {
      capacity *= 2;
    }
    const grown = new Int32Array(Math.min(MAX_OPS, capacity) * OP_WORDS);
    grown.set(ops.subarray(0, opCount * OP_WORDS));
    ops = grown;
    return true;
  };

  const ensureText = (needed: number): boolean => {
    if (textLength + needed <= textBytes.length) {
      return true;
    }
    if (textLength + needed > MAX_TEXT_BYTES) {
      return false;
    }
    let capacity = Math.max(INITIAL_TEXT_BYTES, textBytes.length);
    while (capacity < textLength + needed) {
      capacity *= 2;
    }
    const grown = new Uint8Array(Math.min(MAX_TEXT_BYTES, capacity));
    grown.set(textBytes.subarray(0, textLength));
    textBytes = grown;
    return true;
  };

  const push = (opcode: number, x: number, y: number, a: number, b: number, appearance: Style) => {
    if (!ensureOps()) {
      return;
    }
    const base = opCount * OP_WORDS;
    ops[base] = opcode;
    ops[base + 1] = x;
    ops[base + 2] = y;
    ops[base + 3] = a;
    ops[base + 4] = b;
    ops[base + 5] = appearance.foreground;
    ops[base + 6] = appearance.background;
    ops[base + 7] = appearance.attributes;
    opCount += 1;
  };

  const empty: Style = { foreground: DEFAULT_COLOR, background: DEFAULT_COLOR, attributes: 0 };

  return {
    begin: () => {
      opCount = 0;
      textLength = 0;
    },
    fillRect: (x, y, width, height, value) => {
      if (width <= 0 || height <= 0) {
        return;
      }
      push(OP_FILL_RECT, x, y, width, height, value);
    },
    text: (x, y, value, appearance) => {
      if (value.length === 0) {
        return;
      }
      if (!ensureText(value.length * 4)) {
        return;
      }
      const written = encoder.encodeInto(value, textBytes.subarray(textLength)).written;
      push(OP_TEXT_RUN, x, y, textLength, written, appearance);
      textLength += written;
    },
    cursor: (x, y, visible) => {
      push(OP_CURSOR, x, y, visible ? 1 : 0, 0, empty);
    },
    clipPush: (x, y, width, height) => {
      push(OP_CLIP_PUSH, x, y, width, height, empty);
    },
    clipPop: () => {
      push(OP_CLIP_POP, 0, 0, 0, 0, empty);
    },
    ops: () => ops,
    opCount: () => opCount,
    textBytes: () => textBytes,
    textLength: () => textLength,
  };
};
