use crate::color::{self, CAP_INDEXED_COLOR, CAP_TRUE_COLOR, Color};
use crate::grid::{Cell, Content, Style};
use crate::text::ClusterPool;

pub(crate) const ATTR_BOLD: u32 = 1;
pub(crate) const ATTR_DIM: u32 = 1 << 1;
pub(crate) const ATTR_ITALIC: u32 = 1 << 2;
pub(crate) const ATTR_UNDERLINE: u32 = 1 << 3;
pub(crate) const ATTR_STRIKETHROUGH: u32 = 1 << 4;
pub(crate) const ATTR_REVERSE: u32 = 1 << 5;
pub(crate) const ATTR_BLINK: u32 = 1 << 6;

const UNDERLINE_STYLE_SHIFT: u32 = 7;
const UNDERLINE_STYLE_MASK: u32 = 0b0000_0011_1000_0000;
const UNDERLINE_MASK: u32 = ATTR_UNDERLINE | UNDERLINE_STYLE_MASK;

#[derive(Debug)]
pub(crate) struct Writer<'buffer> {
    out: &'buffer mut Vec<u8>,
    capabilities: u32,
    style: Style,
    style_known: bool,
    x: usize,
    y: usize,
    positioned: bool,
}

impl<'buffer> Writer<'buffer> {
    pub(crate) fn new(out: &'buffer mut Vec<u8>, capabilities: u32) -> Self {
        Self {
            out,
            capabilities,
            style: Style::default(),
            style_known: false,
            x: 0,
            y: 0,
            positioned: false,
        }
    }

    pub(crate) const fn len(&self) -> usize {
        self.out.len()
    }

    fn push_number(&mut self, value: u32) {
        let mut digits = [0_u8; 10];
        let mut count = 0_usize;
        let mut rest = value;
        loop {
            let digit = rest.checked_rem(10).unwrap_or(0);
            if let Some(slot) = digits.get_mut(count) {
                *slot = b'0'.saturating_add(u8::try_from(digit).unwrap_or(0));
            }
            count = count.saturating_add(1);
            rest = rest.checked_div(10).unwrap_or(0);
            if rest == 0 || count >= digits.len() {
                break;
            }
        }
        for index in (0..count).rev() {
            if let Some(byte) = digits.get(index) {
                self.out.push(*byte);
            }
        }
    }

    fn push_param(&mut self, first: &mut bool, value: u32) {
        if *first {
            *first = false;
        } else {
            self.out.push(b';');
        }
        self.push_number(value);
    }

    pub(crate) fn move_to(&mut self, x: usize, y: usize) {
        if self.positioned && self.y == y {
            if self.x == x {
                return;
            }
            if x > self.x {
                let delta = x.saturating_sub(self.x);
                self.out.extend_from_slice(b"\x1b[");
                if delta > 1 {
                    self.push_number(u32::try_from(delta).unwrap_or(1));
                }
                self.out.push(b'C');
            } else if x == 0 {
                self.out.push(b'\r');
            } else {
                let delta = self.x.saturating_sub(x);
                self.out.extend_from_slice(b"\x1b[");
                if delta > 1 {
                    self.push_number(u32::try_from(delta).unwrap_or(1));
                }
                self.out.push(b'D');
            }
        } else {
            self.out.extend_from_slice(b"\x1b[");
            self.push_number(u32::try_from(y.saturating_add(1)).unwrap_or(1));
            self.out.push(b';');
            self.push_number(u32::try_from(x.saturating_add(1)).unwrap_or(1));
            self.out.push(b'H');
        }
        self.x = x;
        self.y = y;
        self.positioned = true;
    }

    pub(crate) const fn advance(&mut self, cells: usize) {
        self.x = self.x.saturating_add(cells);
    }

    fn resolve(&self, value: u32) -> Color {
        match color::decode(value) {
            Color::Default => Color::Default,
            Color::Named(index) => Color::Named(index),
            Color::Indexed(index) => {
                if self.capabilities & CAP_INDEXED_COLOR == 0 {
                    let (red, green, blue) = color::indexed_to_rgb(index);
                    Color::Named(color::to_named(red, green, blue))
                } else {
                    Color::Indexed(index)
                }
            }
            Color::Rgb(red, green, blue) => {
                if self.capabilities & CAP_TRUE_COLOR != 0 {
                    Color::Rgb(red, green, blue)
                } else if self.capabilities & CAP_INDEXED_COLOR != 0 {
                    Color::Indexed(color::to_indexed(red, green, blue))
                } else {
                    Color::Named(color::to_named(red, green, blue))
                }
            }
        }
    }

    fn push_color(&mut self, first: &mut bool, value: u32, foreground: bool) {
        let base = if foreground { 30_u32 } else { 40_u32 };
        let bright = if foreground { 90_u32 } else { 100_u32 };
        let extended = if foreground { 38_u32 } else { 48_u32 };
        match self.resolve(value) {
            Color::Default => self.push_param(first, base.saturating_add(9)),
            Color::Named(index) => {
                if index < 8 {
                    self.push_param(first, base.saturating_add(index));
                } else {
                    self.push_param(first, bright.saturating_add(index.saturating_sub(8)));
                }
            }
            Color::Indexed(index) => {
                self.push_param(first, extended);
                self.push_param(first, 5);
                self.push_param(first, index);
            }
            Color::Rgb(red, green, blue) => {
                self.push_param(first, extended);
                self.push_param(first, 2);
                self.push_param(first, red);
                self.push_param(first, green);
                self.push_param(first, blue);
            }
        }
    }

    fn push_attributes(&mut self, first: &mut bool, base: Style, target: Style) {
        let added = target.attributes & !base.attributes;
        for (mask, param) in [
            (ATTR_BOLD, 1_u32),
            (ATTR_DIM, 2),
            (ATTR_ITALIC, 3),
            (ATTR_BLINK, 5),
            (ATTR_REVERSE, 7),
            (ATTR_STRIKETHROUGH, 9),
        ] {
            if added & mask != 0 {
                self.push_param(first, param);
            }
        }
        let underline_changed =
            base.attributes & UNDERLINE_MASK != target.attributes & UNDERLINE_MASK;
        if underline_changed && target.attributes & ATTR_UNDERLINE != 0 {
            let variant = target
                .attributes
                .checked_shr(UNDERLINE_STYLE_SHIFT)
                .unwrap_or(0)
                & 0b111;
            self.push_param(first, 4);
            if variant != 0 {
                self.out.push(b':');
                self.push_number(variant);
            }
        }
    }

    pub(crate) fn write_style(&mut self, target: Style) {
        if self.style_known && self.style == target {
            return;
        }
        let reset = !self.style_known || self.style.attributes & !target.attributes != 0;
        let base = if reset { Style::default() } else { self.style };
        self.out.extend_from_slice(b"\x1b[");
        let mut first = true;
        if reset {
            self.push_param(&mut first, 0);
        }
        self.push_attributes(&mut first, base, target);
        if base.foreground != target.foreground {
            self.push_color(&mut first, target.foreground, true);
        }
        if base.background != target.background {
            self.push_color(&mut first, target.background, false);
        }
        self.out.push(b'm');
        self.style = target;
        self.style_known = true;
    }

    pub(crate) fn write_cell(&mut self, cell: Cell, pool: &ClusterPool) {
        self.write_style(cell.style);
        match cell.content {
            Content::Blank => self.out.push(b' '),
            Content::Single(value) => {
                let mut buffer = [0_u8; 4];
                let encoded = value.encode_utf8(&mut buffer);
                self.out.extend_from_slice(encoded.as_bytes());
            }
            Content::Cluster(id) => match pool.get(id) {
                Some(value) => self.out.extend_from_slice(value.as_bytes()),
                None => self.out.push(b' '),
            },
            Content::Continuation => {}
        }
    }

    pub(crate) fn erase_to_end(&mut self) {
        self.write_style(Style::default());
        self.out.extend_from_slice(b"\x1b[K");
    }
}
