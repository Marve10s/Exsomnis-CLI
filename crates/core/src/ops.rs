pub(crate) const OP_WORDS: usize = 8;

pub(crate) const OP_FILL_RECT: i32 = 0;
pub(crate) const OP_TEXT_RUN: i32 = 1;
pub(crate) const OP_CURSOR: i32 = 2;
pub(crate) const OP_CLIP_PUSH: i32 = 3;
pub(crate) const OP_CLIP_POP: i32 = 4;

pub(crate) const MAX_CLIP_DEPTH: usize = 16;

#[derive(Clone, Copy, Debug)]
pub(crate) struct RawOp {
    pub(crate) opcode: i32,
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) a: i32,
    pub(crate) b: i32,
    pub(crate) foreground: i32,
    pub(crate) background: i32,
    pub(crate) attributes: i32,
}

impl RawOp {
    pub(crate) fn from_words(words: &[i32]) -> Option<Self> {
        Some(Self {
            opcode: *words.first()?,
            x: *words.get(1)?,
            y: *words.get(2)?,
            a: *words.get(3)?,
            b: *words.get(4)?,
            foreground: *words.get(5)?,
            background: *words.get(6)?,
            attributes: *words.get(7)?,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Rect {
    pub(crate) left: i64,
    pub(crate) top: i64,
    pub(crate) right: i64,
    pub(crate) bottom: i64,
}

impl Rect {
    pub(crate) fn from_size(x: i32, y: i32, width: i32, height: i32) -> Self {
        let left = i64::from(x);
        let top = i64::from(y);
        Self {
            left,
            top,
            right: left.saturating_add(i64::from(width)),
            bottom: top.saturating_add(i64::from(height)),
        }
    }

    pub(crate) fn screen(width: usize, height: usize) -> Self {
        Self {
            left: 0,
            top: 0,
            right: i64::try_from(width).unwrap_or(0),
            bottom: i64::try_from(height).unwrap_or(0),
        }
    }

    pub(crate) fn intersect(self, other: Self) -> Self {
        Self {
            left: self.left.max(other.left),
            top: self.top.max(other.top),
            right: self.right.min(other.right),
            bottom: self.bottom.min(other.bottom),
        }
    }
}
