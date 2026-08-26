use crate::error::CoreError;

pub(crate) const MAX_WIDTH: usize = 1024;
pub(crate) const MAX_HEIGHT: usize = 512;
pub(crate) const MAX_CELLS: usize = 200_000;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(crate) struct Style {
    pub(crate) foreground: u32,
    pub(crate) background: u32,
    pub(crate) attributes: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(crate) enum Content {
    #[default]
    Blank,
    Single(char),
    Cluster(u32),
    Continuation,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(crate) struct Cell {
    pub(crate) content: Content,
    pub(crate) style: Style,
}

impl Cell {
    pub(crate) const fn blank(style: Style) -> Self {
        Self {
            content: Content::Blank,
            style,
        }
    }

    pub(crate) const fn is_erasable(&self) -> bool {
        matches!(self.content, Content::Blank)
            && self.style.background == 0
            && self.style.attributes == 0
    }

    pub(crate) const fn is_continuation(&self) -> bool {
        matches!(self.content, Content::Continuation)
    }
}

#[derive(Debug, Default)]
pub(crate) struct Grid {
    width: usize,
    height: usize,
    cells: Vec<Cell>,
}

impl Grid {
    pub(crate) const fn width(&self) -> usize {
        self.width
    }

    pub(crate) const fn height(&self) -> usize {
        self.height
    }

    pub(crate) fn resize(&mut self, width: usize, height: usize) -> Result<(), CoreError> {
        let count = width.checked_mul(height).ok_or(CoreError::SizeOutOfRange)?;
        if width > MAX_WIDTH || height > MAX_HEIGHT || count > MAX_CELLS {
            return Err(CoreError::SizeOutOfRange);
        }
        self.cells.clear();
        self.cells.try_reserve(count)?;
        self.cells.resize(count, Cell::default());
        self.width = width;
        self.height = height;
        Ok(())
    }

    fn index(&self, x: usize, y: usize) -> Option<usize> {
        if x >= self.width || y >= self.height {
            return None;
        }
        y.checked_mul(self.width)?.checked_add(x)
    }

    pub(crate) fn cell(&self, x: usize, y: usize) -> Option<&Cell> {
        self.cells.get(self.index(x, y)?)
    }

    pub(crate) fn put(&mut self, x: usize, y: usize, cell: Cell) {
        let Some(index) = self.index(x, y) else {
            return;
        };
        if let Some(slot) = self.cells.get_mut(index) {
            *slot = cell;
        }
    }

    pub(crate) fn row(&self, y: usize) -> Option<&[Cell]> {
        let start = self.index(0, y)?;
        let end = start.checked_add(self.width)?;
        self.cells.get(start..end)
    }

    pub(crate) fn copy_row_from(&mut self, source: &Self, y: usize) {
        let Some(row) = source.row(y) else {
            return;
        };
        let Some(start) = self.index(0, y) else {
            return;
        };
        let Some(end) = start.checked_add(self.width) else {
            return;
        };
        if let Some(target) = self.cells.get_mut(start..end)
            && target.len() == row.len()
        {
            target.copy_from_slice(row);
        }
    }

    pub(crate) fn clear(&mut self) {
        self.cells.fill(Cell::default());
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct DirtySpan {
    start: usize,
    end: usize,
}

impl Default for DirtySpan {
    fn default() -> Self {
        Self {
            start: usize::MAX,
            end: 0,
        }
    }
}

impl DirtySpan {
    pub(crate) const fn start(self) -> usize {
        self.start
    }

    pub(crate) const fn end(self) -> usize {
        self.end
    }

    pub(crate) const fn is_dirty(self) -> bool {
        self.start < self.end
    }

    pub(crate) const fn mark(&mut self, start: usize, end: usize) {
        if start < self.start {
            self.start = start;
        }
        if end > self.end {
            self.end = end;
        }
    }

    pub(crate) fn reset(&mut self) {
        *self = Self::default();
    }
}
