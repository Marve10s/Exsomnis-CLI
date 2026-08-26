import { PUNCTUATION_CODE_MAP } from '@tanstack/hotkeys';

export interface KeyEvent {
  readonly type: 'key';
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

export type MouseKind =
  | 'press'
  | 'release'
  | 'move'
  | 'drag'
  | 'click'
  | 'doubleClick'
  | 'wheelUp'
  | 'wheelDown'
  | 'wheelLeft'
  | 'wheelRight';

export interface MouseEvent {
  readonly type: 'mouse';
  readonly kind: MouseKind;
  readonly button: number;
  readonly x: number;
  readonly y: number;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export interface PasteEvent {
  readonly type: 'paste';
  readonly text: string;
}

export interface FocusEvent {
  readonly type: 'focus';
  readonly focused: boolean;
}

export interface KittyFlagsEvent {
  readonly type: 'kittyFlags';
  readonly flags: number;
}

export interface ModeReportEvent {
  readonly type: 'modeReport';
  readonly mode: number;
  readonly value: number;
}

export interface DeviceAttributesEvent {
  readonly type: 'deviceAttributes';
  readonly parameters: ReadonlyArray<number>;
}

export interface TextAreaSizeEvent {
  readonly type: 'textAreaSize';
  readonly rows: number;
  readonly columns: number;
}

export interface CursorPositionEvent {
  readonly type: 'cursorPosition';
  readonly row: number;
  readonly column: number;
}

export type TerminalInput =
  | KeyEvent
  | MouseEvent
  | PasteEvent
  | FocusEvent
  | KittyFlagsEvent
  | ModeReportEvent
  | DeviceAttributesEvent
  | TextAreaSizeEvent
  | CursorPositionEvent;

export interface InputDecoder {
  readonly decode: (chunk: Uint8Array) => ReadonlyArray<TerminalInput>;
  readonly flush: () => ReadonlyArray<TerminalInput>;
  readonly expectCursorPosition: () => void;
}

const ESC = 0x1b;
const PASTE_END = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e];
const DOUBLE_CLICK_MILLIS = 400;

const CODE_FOR_PUNCTUATION: ReadonlyMap<string, string> = new Map(
  Object.entries(PUNCTUATION_CODE_MAP).map(([code, character]) => [character, code]),
);

const NAMED_BY_TILDE: ReadonlyMap<number, string> = new Map([
  [1, 'Home'],
  [2, 'Insert'],
  [3, 'Delete'],
  [4, 'End'],
  [5, 'PageUp'],
  [6, 'PageDown'],
  [7, 'Home'],
  [8, 'End'],
  [11, 'F1'],
  [12, 'F2'],
  [13, 'F3'],
  [14, 'F4'],
  [15, 'F5'],
  [17, 'F6'],
  [18, 'F7'],
  [19, 'F8'],
  [20, 'F9'],
  [21, 'F10'],
  [23, 'F11'],
  [24, 'F12'],
]);

const NAMED_BY_FINAL: ReadonlyMap<number, string> = new Map([
  [0x41, 'ArrowUp'],
  [0x42, 'ArrowDown'],
  [0x43, 'ArrowRight'],
  [0x44, 'ArrowLeft'],
  [0x45, 'Clear'],
  [0x46, 'End'],
  [0x48, 'Home'],
  [0x50, 'F1'],
  [0x51, 'F2'],
  [0x52, 'F3'],
  [0x53, 'F4'],
]);

const NAMED_BY_KITTY: ReadonlyMap<number, string> = new Map([
  [9, 'Tab'],
  [13, 'Enter'],
  [27, 'Escape'],
  [127, 'Backspace'],
  [57358, 'CapsLock'],
  [57359, 'ScrollLock'],
  [57360, 'NumLock'],
  [57361, 'PrintScreen'],
  [57362, 'Pause'],
  [57363, 'ContextMenu'],
  [57414, 'Enter'],
]);

export interface Modifiers {
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

const NO_MODIFIERS: Modifiers = {
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
};

const modifiersFrom = (encoded: number): Modifiers => {
  const bits = encoded > 0 ? encoded - 1 : 0;
  return {
    shiftKey: (bits & 1) !== 0,
    altKey: (bits & 2) !== 0,
    ctrlKey: (bits & 4) !== 0,
    metaKey: (bits & 8) !== 0,
  };
};

const key = (name: string, code: string, modifiers: Modifiers): KeyEvent => ({
  type: 'key',
  key: name,
  code,
  ...modifiers,
});

export const codeForCharacter = (character: string): string => {
  const point = character.codePointAt(0);
  if (point === undefined) {
    return '';
  }
  if (point >= 0x61 && point <= 0x7a) {
    return `Key${String.fromCharCode(point - 32)}`;
  }
  if (point >= 0x41 && point <= 0x5a) {
    return `Key${String.fromCharCode(point)}`;
  }
  if (point >= 0x30 && point <= 0x39) {
    return `Digit${character}`;
  }
  if (character === ' ') {
    return 'Space';
  }
  if (character === "'") {
    return 'Quote';
  }
  return CODE_FOR_PUNCTUATION.get(character) ?? '';
};

const namedCode = (name: string): string => (name === 'Space' ? 'Space' : name);

const controlKey = (byte: number): KeyEvent => {
  if (byte === 0x09) {
    return key('Tab', 'Tab', NO_MODIFIERS);
  }
  if (byte === 0x0d || byte === 0x0a) {
    return key('Enter', 'Enter', NO_MODIFIERS);
  }
  if (byte === 0x08 || byte === 0x7f) {
    return key('Backspace', 'Backspace', NO_MODIFIERS);
  }
  if (byte === ESC) {
    return key('Escape', 'Escape', NO_MODIFIERS);
  }
  if (byte === 0x00) {
    return key(' ', 'Space', { ...NO_MODIFIERS, ctrlKey: true });
  }
  if (byte >= 0x01 && byte <= 0x1a) {
    const letter = String.fromCharCode(byte + 0x60);
    return key(letter, codeForCharacter(letter), { ...NO_MODIFIERS, ctrlKey: true });
  }
  const punctuation = String.fromCharCode(byte + 0x40);
  return key(punctuation, codeForCharacter(punctuation), { ...NO_MODIFIERS, ctrlKey: true });
};

const utf8Length = (lead: number): number => {
  if (lead < 0x80) {
    return 1;
  }
  if (lead >= 0xc2 && lead <= 0xdf) {
    return 2;
  }
  if (lead >= 0xe0 && lead <= 0xef) {
    return 3;
  }
  if (lead >= 0xf0 && lead <= 0xf4) {
    return 4;
  }
  return 1;
};

const decoder = new TextDecoder('utf-8');

const printableKey = (character: string): KeyEvent => {
  const upper = character.length === 1 && character >= 'A' && character <= 'Z';
  return key(character, codeForCharacter(character), {
    ...NO_MODIFIERS,
    shiftKey: upper,
  });
};

const withModifiers = (event: KeyEvent, modifiers: Modifiers): KeyEvent => ({
  ...event,
  ctrlKey: event.ctrlKey || modifiers.ctrlKey,
  altKey: event.altKey || modifiers.altKey,
  shiftKey: event.shiftKey || modifiers.shiftKey,
  metaKey: event.metaKey || modifiers.metaKey,
});

interface Parameter {
  readonly values: ReadonlyArray<number>;
}

const parseParameters = (text: string): ReadonlyArray<Parameter> => {
  if (text.length === 0) {
    return [];
  }
  return text.split(';').map((part) => ({
    values: part.split(':').map((value) => (value.length === 0 ? 0 : Number.parseInt(value, 10))),
  }));
};

const parameterAt = (
  parameters: ReadonlyArray<Parameter>,
  index: number,
  slot: number,
  fallback: number,
): number => {
  const value = parameters[index]?.values[slot];
  return value === undefined || Number.isNaN(value) ? fallback : value;
};

const matchesAt = (bytes: Uint8Array, index: number, pattern: ReadonlyArray<number>): boolean =>
  pattern.every((expected, offset) => bytes[index + offset] === expected);

const findSequence = (bytes: Uint8Array, from: number, pattern: ReadonlyArray<number>): number => {
  for (let index = from; index + pattern.length <= bytes.length; index += 1) {
    if (matchesAt(bytes, index, pattern)) {
      return index;
    }
  }
  return -1;
};

interface ClickState {
  x: number;
  y: number;
  at: number;
  count: number;
}

export const makeInputDecoder = (now: () => number = Date.now): InputDecoder => {
  let carry = new Uint8Array(0);
  let pasting = false;
  let paste: Array<number> = [];
  let pressedAt: { x: number; y: number } | undefined = undefined;
  const lastClick: ClickState = { x: -1, y: -1, at: -1, count: 0 };
  let cursorPositionExpected = false;

  const pushMouse = (
    events: Array<TerminalInput>,
    encoded: number,
    x: number,
    y: number,
    released: boolean,
  ) => {
    const modifiers = {
      shiftKey: (encoded & 4) !== 0,
      altKey: (encoded & 8) !== 0,
      ctrlKey: (encoded & 16) !== 0,
    };
    const button = encoded & 3;
    if ((encoded & 64) !== 0) {
      const wheel = ['wheelUp', 'wheelDown', 'wheelLeft', 'wheelRight'] as const;
      const kind = wheel[button] ?? 'wheelUp';
      events.push({ type: 'mouse', kind, button, x, y, ...modifiers });
      return;
    }
    if ((encoded & 32) !== 0) {
      const kind = button === 3 ? 'move' : 'drag';
      events.push({ type: 'mouse', kind, button, x, y, ...modifiers });
      return;
    }
    if (released) {
      events.push({ type: 'mouse', kind: 'release', button, x, y, ...modifiers });
      if (pressedAt !== undefined && pressedAt.x === x && pressedAt.y === y) {
        const at = now();
        const repeated =
          lastClick.x === x && lastClick.y === y && at - lastClick.at <= DOUBLE_CLICK_MILLIS;
        lastClick.count = repeated ? lastClick.count + 1 : 1;
        lastClick.x = x;
        lastClick.y = y;
        lastClick.at = at;
        const kind = lastClick.count >= 2 ? 'doubleClick' : 'click';
        events.push({ type: 'mouse', kind, button, x, y, ...modifiers });
      }
      pressedAt = undefined;
      return;
    }
    pressedAt = { x, y };
    events.push({ type: 'mouse', kind: 'press', button, x, y, ...modifiers });
  };

  const pushKitty = (
    events: Array<TerminalInput>,
    parameters: ReadonlyArray<Parameter>,
    terminator: number,
  ) => {
    const eventType = parameterAt(parameters, 1, 1, 1);
    if (eventType === 3) {
      return;
    }
    const modifiers = modifiersFrom(parameterAt(parameters, 1, 0, 1));
    const point = parameterAt(parameters, 0, 0, 0);
    if (terminator === 0x7e) {
      const name = NAMED_BY_TILDE.get(point);
      if (name !== undefined) {
        events.push(key(name, namedCode(name), modifiers));
      }
      return;
    }
    const named = NAMED_BY_KITTY.get(point);
    if (named !== undefined) {
      events.push(key(named, namedCode(named), modifiers));
      return;
    }
    if (point === 32) {
      events.push(key(' ', 'Space', modifiers));
      return;
    }
    const shifted = parameterAt(parameters, 0, 1, 0);
    const base = parameterAt(parameters, 0, 2, 0);
    const character = String.fromCodePoint(shifted > 0 ? shifted : point);
    const code = codeForCharacter(String.fromCodePoint(base > 0 ? base : point));
    events.push(key(character, code, modifiers));
  };

  const parseCsi = (bytes: Uint8Array, start: number, events: Array<TerminalInput>): number => {
    let index = start + 2;
    const parameterStart = index;
    while (index < bytes.length) {
      const byte = bytes[index];
      if (byte === undefined || byte < 0x30 || byte > 0x3f) {
        break;
      }
      index += 1;
    }
    const intermediateStart = index;
    while (index < bytes.length) {
      const byte = bytes[index];
      if (byte === undefined || byte < 0x20 || byte > 0x2f) {
        break;
      }
      index += 1;
    }
    const final = bytes[index];
    if (final === undefined) {
      return 0;
    }
    const consumed = index + 1 - start;
    if (final < 0x40 || final > 0x7e) {
      return consumed;
    }
    const raw = String.fromCharCode(...bytes.subarray(parameterStart, intermediateStart));
    const intermediates = String.fromCharCode(...bytes.subarray(intermediateStart, index));
    const leading = raw[0];
    const prefix = leading !== undefined && leading >= '<' && leading <= '?' ? leading : '';
    const parameters = parseParameters(prefix === '' ? raw : raw.slice(1));

    if (prefix === '<' && (final === 0x4d || final === 0x6d)) {
      pushMouse(
        events,
        parameterAt(parameters, 0, 0, 0),
        Math.max(0, parameterAt(parameters, 1, 0, 1) - 1),
        Math.max(0, parameterAt(parameters, 2, 0, 1) - 1),
        final === 0x6d,
      );
      return consumed;
    }
    if (final === 0x75 && prefix === '?') {
      events.push({ type: 'kittyFlags', flags: parameterAt(parameters, 0, 0, 0) });
      return consumed;
    }
    if (final === 0x63 && prefix === '?') {
      events.push({
        type: 'deviceAttributes',
        parameters: parameters.map((entry) => entry.values[0] ?? 0),
      });
      return consumed;
    }
    if (final === 0x79 && prefix === '?' && intermediates === '$') {
      events.push({
        type: 'modeReport',
        mode: parameterAt(parameters, 0, 0, 0),
        value: parameterAt(parameters, 1, 0, 0),
      });
      return consumed;
    }
    if (final === 0x75) {
      pushKitty(events, parameters, final);
      return consumed;
    }
    if (final === 0x7e) {
      const code = parameterAt(parameters, 0, 0, 0);
      if (code === 200) {
        pasting = true;
        paste = [];
        return consumed;
      }
      if (code === 201) {
        return consumed;
      }
      pushKitty(events, parameters, final);
      return consumed;
    }
    if (final === 0x74 && parameterAt(parameters, 0, 0, 0) === 8) {
      events.push({
        type: 'textAreaSize',
        rows: parameterAt(parameters, 1, 0, 0),
        columns: parameterAt(parameters, 2, 0, 0),
      });
      return consumed;
    }
    if (final === 0x49 || final === 0x4f) {
      events.push({ type: 'focus', focused: final === 0x49 });
      return consumed;
    }
    if (final === 0x52 && cursorPositionExpected) {
      cursorPositionExpected = false;
      events.push({
        type: 'cursorPosition',
        row: parameterAt(parameters, 0, 0, 1),
        column: parameterAt(parameters, 1, 0, 1),
      });
      return consumed;
    }
    const name = NAMED_BY_FINAL.get(final);
    if (name !== undefined) {
      events.push(key(name, namedCode(name), modifiersFrom(parameterAt(parameters, 1, 0, 1))));
    }
    return consumed;
  };

  const parseSs3 = (bytes: Uint8Array, start: number, events: Array<TerminalInput>): number => {
    const final = bytes[start + 2];
    if (final === undefined) {
      return 0;
    }
    const name = NAMED_BY_FINAL.get(final);
    if (name !== undefined) {
      events.push(key(name, namedCode(name), NO_MODIFIERS));
    }
    return 3;
  };

  const parseSingle = (bytes: Uint8Array, start: number): { event: KeyEvent; size: number } => {
    const lead = bytes[start] ?? 0;
    if (lead < 0x20 || lead === 0x7f) {
      return { event: controlKey(lead), size: 1 };
    }
    const size = utf8Length(lead);
    const slice = bytes.subarray(start, start + size);
    const character = decoder.decode(slice);
    return { event: printableKey(character), size };
  };

  const step = (bytes: Uint8Array, start: number, events: Array<TerminalInput>): number => {
    const first = bytes[start];
    if (first === undefined) {
      return 0;
    }
    if (first === ESC) {
      const second = bytes[start + 1];
      if (second === undefined) {
        return 0;
      }
      if (second === 0x5b) {
        return parseCsi(bytes, start, events);
      }
      if (second === 0x4f) {
        return parseSs3(bytes, start, events);
      }
      if (second === ESC) {
        events.push(key('Escape', 'Escape', NO_MODIFIERS));
        return 1;
      }
      const lead = bytes[start + 1] ?? 0;
      const size = utf8Length(lead);
      if (start + 1 + size > bytes.length) {
        return 0;
      }
      const inner = parseSingle(bytes, start + 1);
      events.push(withModifiers(inner.event, { ...NO_MODIFIERS, altKey: true }));
      return 1 + inner.size;
    }
    if (first >= 0x80) {
      const size = utf8Length(first);
      if (start + size > bytes.length) {
        return 0;
      }
      const inner = parseSingle(bytes, start);
      events.push(inner.event);
      return inner.size;
    }
    const inner = parseSingle(bytes, start);
    events.push(inner.event);
    return inner.size;
  };

  const consumePaste = (bytes: Uint8Array, start: number, events: Array<TerminalInput>): number => {
    const found = findSequence(bytes, start, PASTE_END);
    if (found === -1) {
      const keep = Math.max(start, bytes.length - PASTE_END.length + 1);
      for (let index = start; index < keep; index += 1) {
        paste.push(bytes[index] ?? 0);
      }
      return keep - start;
    }
    for (let index = start; index < found; index += 1) {
      paste.push(bytes[index] ?? 0);
    }
    pasting = false;
    events.push({ type: 'paste', text: decoder.decode(Uint8Array.from(paste)) });
    paste = [];
    return found + PASTE_END.length - start;
  };

  const drain = (bytes: Uint8Array, events: Array<TerminalInput>): number => {
    let index = 0;
    while (index < bytes.length) {
      const consumed = pasting ? consumePaste(bytes, index, events) : step(bytes, index, events);
      if (consumed <= 0) {
        break;
      }
      index += consumed;
    }
    return index;
  };

  return {
    decode: (chunk) => {
      const events: Array<TerminalInput> = [];
      if (carry.length === 1 && carry[0] === ESC && chunk.length > 0) {
        events.push(key('Escape', 'Escape', NO_MODIFIERS));
        carry = new Uint8Array(0);
      }
      const bytes = carry.length === 0 ? chunk : Uint8Array.from([...carry, ...chunk]);
      const consumed = drain(bytes, events);
      carry = bytes.slice(consumed);
      return events;
    },
    flush: () => {
      if (carry.length === 0) {
        return [];
      }
      const events: Array<TerminalInput> = [];
      if (carry.length === 1 && carry[0] === ESC) {
        events.push(key('Escape', 'Escape', NO_MODIFIERS));
        carry = new Uint8Array(0);
      }
      return events;
    },
    expectCursorPosition: () => {
      cursorPositionExpected = true;
    },
  };
};
