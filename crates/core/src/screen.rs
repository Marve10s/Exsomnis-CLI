use std::io::{self, Write as _};
use std::time::Instant;

use unicode_segmentation::UnicodeSegmentation as _;

use crate::color::CAP_SYNCHRONIZED_OUTPUT;
use crate::error::CoreError;
use crate::grid::{Cell, Content, DirtySpan, Grid, Style};
use crate::ops::{
    MAX_CLIP_DEPTH, OP_CLIP_POP, OP_CLIP_PUSH, OP_CURSOR, OP_FILL_RECT, OP_TEXT_RUN, OP_WORDS,
    RawOp, Rect,
};
use crate::stats::{Stats, StatsSnapshot};
use crate::text::{ClusterPool, grapheme_width};
use crate::writer::Writer;

const MERGE_GAP: usize = 4;
const ERASE_THRESHOLD: usize = 8;
const MAX_OPS: usize = 100_000;
const MAX_TEXT_BYTES: usize = 4_000_000;
const BYTES_PER_CELL_BUDGET: usize = 24;

const INVALID_CELL: Cell = Cell {
    content: Content::Cluster(u32::MAX),
    style: Style {
        foreground: u32::MAX,
        background: u32::MAX,
        attributes: u32::MAX,
    },
};

#[derive(Debug, Default)]
pub(crate) struct Compositor {
    front: Grid,
    back: Grid,
    dirty: Vec<DirtySpan>,
    clips: Vec<Rect>,
    pool: ClusterPool,
    capabilities: u32,
    cursor_x: usize,
    cursor_y: usize,
    cursor_visible: bool,
    shown_cursor_x: usize,
    shown_cursor_y: usize,
    shown_cursor_visible: bool,
    frame: Vec<u8>,
    output: Vec<u8>,
    stats: Stats,
    active: bool,
}

fn elapsed_micros(start: Instant) -> u32 {
    u32::try_from(start.elapsed().as_micros()).unwrap_or(u32::MAX)
}

fn write_frame(bytes: &[u8]) -> Result<(), CoreError> {
    let stdout = io::stdout();
    let mut locked = stdout.lock();
    locked.write_all(bytes)?;
    locked.flush()?;
    Ok(())
}

const fn style_of(op: RawOp) -> Style {
    Style {
        foreground: op.foreground.cast_unsigned(),
        background: op.background.cast_unsigned(),
        attributes: op.attributes.cast_unsigned(),
    }
}

fn clamp(rect: Rect) -> Option<(usize, usize, usize, usize)> {
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return None;
    }
    Some((
        usize::try_from(rect.left).ok()?,
        usize::try_from(rect.top).ok()?,
        usize::try_from(rect.right).ok()?,
        usize::try_from(rect.bottom).ok()?,
    ))
}

fn emit_run(
    writer: &mut Writer<'_>,
    back: &Grid,
    pool: &ClusterPool,
    y: usize,
    begin: usize,
    finish: usize,
) {
    let width = back.width();
    let mut from = begin;
    while from > 0 && back.cell(from, y).is_some_and(Cell::is_continuation) {
        from = from.saturating_sub(1);
    }
    let mut to = finish;
    while to < width && back.cell(to, y).is_some_and(Cell::is_continuation) {
        to = to.saturating_add(1);
    }
    writer.move_to(from, y);
    for x in from..to {
        if let Some(cell) = back.cell(x, y) {
            writer.write_cell(*cell, pool);
        }
    }
    writer.advance(to.saturating_sub(from));
}

fn differs(front: &Grid, back: &Grid, x: usize, y: usize) -> bool {
    front.cell(x, y) != back.cell(x, y)
}

fn erasable_tail(back: &Grid, y: usize, floor: usize) -> usize {
    let mut tail = back.width();
    while tail > floor {
        let previous = tail.saturating_sub(1);
        if !back.cell(previous, y).is_some_and(Cell::is_erasable) {
            break;
        }
        tail = previous;
    }
    tail
}

fn emit_row(
    writer: &mut Writer<'_>,
    front: &Grid,
    back: &Grid,
    pool: &ClusterPool,
    y: usize,
    span: DirtySpan,
) -> u32 {
    let width = back.width();
    let start = span.start().min(width);
    let end = span.end().min(width);
    let mut changed = 0_u32;
    for x in start..end {
        if differs(front, back, x, y) {
            changed = changed.saturating_add(1);
        }
    }
    if changed == 0 {
        return 0;
    }
    let tail = erasable_tail(back, y, start);
    let tail_changed = (tail..end).filter(|x| differs(front, back, *x, y)).count();
    let use_erase = tail < width && tail_changed >= ERASE_THRESHOLD;
    let scan_end = if use_erase { end.min(tail) } else { end };

    let mut run_start: Option<usize> = None;
    let mut run_end = start;
    for x in start..scan_end {
        if differs(front, back, x, y) {
            if run_start.is_none() {
                run_start = Some(x);
            }
            run_end = x.saturating_add(1);
        } else if let Some(begin) = run_start
            && x >= run_end.saturating_add(MERGE_GAP)
        {
            emit_run(writer, back, pool, y, begin, run_end);
            run_start = None;
        }
    }
    if let Some(begin) = run_start {
        emit_run(writer, back, pool, y, begin, run_end);
    }
    if use_erase {
        writer.move_to(tail, y);
        writer.erase_to_end();
    }
    changed
}

impl Compositor {
    pub(crate) fn new(width: usize, height: usize) -> Result<Self, CoreError> {
        let mut compositor = Self {
            active: true,
            ..Self::default()
        };
        compositor.resize(width, height)?;
        Ok(compositor)
    }

    pub(crate) fn resize(&mut self, width: usize, height: usize) -> Result<(), CoreError> {
        self.front.resize(width, height)?;
        self.back.resize(width, height)?;
        self.dirty.clear();
        self.dirty.try_reserve(height)?;
        self.dirty.resize(height, DirtySpan::default());
        let budget = width
            .saturating_mul(height)
            .saturating_mul(BYTES_PER_CELL_BUDGET)
            .saturating_add(4096);
        self.output.clear();
        self.output.try_reserve(budget)?;
        self.frame.clear();
        self.frame.try_reserve(budget)?;
        self.invalidate();
        Ok(())
    }

    pub(crate) fn invalidate(&mut self) {
        self.front.clear();
        for y in 0..self.front.height() {
            for x in 0..self.front.width() {
                self.front.put(x, y, INVALID_CELL);
            }
        }
        let width = self.back.width();
        for span in &mut self.dirty {
            span.mark(0, width);
        }
        self.shown_cursor_visible = false;
        self.shown_cursor_x = usize::MAX;
        self.shown_cursor_y = usize::MAX;
    }

    pub(crate) const fn set_capabilities(&mut self, capabilities: u32) {
        self.capabilities = capabilities;
    }

    pub(crate) fn take_stats(&mut self) -> StatsSnapshot {
        self.stats.take()
    }

    pub(crate) fn shutdown(&mut self) {
        self.active = false;
        self.output.clear();
        self.frame.clear();
        self.dirty.clear();
        self.clips.clear();
    }

    pub(crate) const fn is_active(&self) -> bool {
        self.active
    }

    fn clip(&self) -> Rect {
        self.clips
            .last()
            .copied()
            .unwrap_or_else(|| Rect::screen(self.back.width(), self.back.height()))
    }

    fn mark(&mut self, x: usize, y: usize) {
        if let Some(span) = self.dirty.get_mut(y) {
            span.mark(x, x.saturating_add(1));
        }
    }

    fn mark_span(&mut self, y: usize, start: usize, end: usize) {
        if let Some(span) = self.dirty.get_mut(y) {
            span.mark(start, end);
        }
    }

    fn is_continuation(&self, x: usize, y: usize) -> bool {
        self.back.cell(x, y).is_some_and(Cell::is_continuation)
    }

    fn break_wide(&mut self, x: usize, y: usize) {
        let mut lead = x;
        while lead > 0 && self.is_continuation(lead, y) {
            lead = lead.saturating_sub(1);
        }
        let mut cursor = lead;
        loop {
            self.back.put(cursor, y, Cell::default());
            self.mark(cursor, y);
            let next = cursor.saturating_add(1);
            if !self.is_continuation(next, y) {
                break;
            }
            cursor = next;
        }
    }

    fn put_blank(&mut self, x: usize, y: usize, style: Style) {
        self.break_wide(x, y);
        self.back.put(x, y, Cell::blank(style));
        self.mark(x, y);
    }

    fn put_grapheme(&mut self, x: usize, y: usize, content: Content, cells: usize, style: Style) {
        for offset in 0..cells {
            self.break_wide(x.saturating_add(offset), y);
        }
        self.back.put(x, y, Cell { content, style });
        for offset in 1..cells {
            self.back.put(
                x.saturating_add(offset),
                y,
                Cell {
                    content: Content::Continuation,
                    style,
                },
            );
        }
        self.mark_span(y, x, x.saturating_add(cells));
    }

    fn fill_rect(&mut self, op: RawOp) {
        let rect = Rect::from_size(op.x, op.y, op.a, op.b).intersect(self.clip());
        let Some((left, top, right, bottom)) = clamp(rect) else {
            return;
        };
        let style = style_of(op);
        for y in top..bottom {
            self.mark_span(y, left, right);
            for x in left..right {
                self.put_blank(x, y, style);
            }
        }
    }

    fn content_for(&mut self, grapheme: &str) -> Content {
        let mut characters = grapheme.chars();
        let first = characters.next();
        if let (Some(single), None) = (first, characters.next()) {
            if single == ' ' {
                return Content::Blank;
            }
            return Content::Single(single);
        }
        self.pool
            .intern(grapheme)
            .map_or(Content::Blank, Content::Cluster)
    }

    fn text_run(&mut self, op: RawOp, text: &[u8]) -> Result<(), CoreError> {
        let offset = usize::try_from(op.a)?;
        let length = usize::try_from(op.b)?;
        let end = offset.checked_add(length).ok_or(CoreError::MalformedOps)?;
        let bytes = text.get(offset..end).ok_or(CoreError::MalformedOps)?;
        let value = str::from_utf8(bytes)?;
        let clip = self.clip();
        let row = i64::from(op.y);
        if row < clip.top || row >= clip.bottom {
            return Ok(());
        }
        let y = usize::try_from(row)?;
        let style = style_of(op);
        let mut x = i64::from(op.x);
        for grapheme in value.graphemes(true) {
            let cells = grapheme_width(grapheme);
            if cells == 0 {
                continue;
            }
            let advance = i64::try_from(cells)?;
            let next = x.saturating_add(advance);
            if x >= clip.right {
                break;
            }
            if x >= clip.left && next <= clip.right {
                let content = self.content_for(grapheme);
                self.put_grapheme(usize::try_from(x)?, y, content, cells, style);
            }
            x = next;
        }
        Ok(())
    }

    fn set_cursor(&mut self, op: RawOp) {
        let last_x = self.back.width().saturating_sub(1);
        let last_y = self.back.height().saturating_sub(1);
        self.cursor_x = usize::try_from(op.x).unwrap_or(0).min(last_x);
        self.cursor_y = usize::try_from(op.y).unwrap_or(0).min(last_y);
        self.cursor_visible = op.a != 0_i32;
    }

    fn clip_push(&mut self, op: RawOp) -> Result<(), CoreError> {
        if self.clips.len() >= MAX_CLIP_DEPTH {
            return Err(CoreError::ClipOverflow);
        }
        let rect = Rect::from_size(op.x, op.y, op.a, op.b).intersect(self.clip());
        self.clips.push(rect);
        Ok(())
    }

    fn clip_pop(&mut self) {
        if self.clips.len() > 1 {
            self.clips.truncate(self.clips.len().saturating_sub(1));
        }
    }

    fn apply(&mut self, ops: &[i32], text: &[u8]) -> Result<(), CoreError> {
        self.clips.clear();
        self.clips.try_reserve(MAX_CLIP_DEPTH)?;
        self.clips
            .push(Rect::screen(self.back.width(), self.back.height()));
        for words in ops.chunks_exact(OP_WORDS) {
            let op = RawOp::from_words(words).ok_or(CoreError::MalformedOps)?;
            match op.opcode {
                OP_FILL_RECT => self.fill_rect(op),
                OP_TEXT_RUN => self.text_run(op, text)?,
                OP_CURSOR => self.set_cursor(op),
                OP_CLIP_PUSH => self.clip_push(op)?,
                OP_CLIP_POP => self.clip_pop(),
                _ => return Err(CoreError::MalformedOps),
            }
        }
        Ok(())
    }

    fn compose(&mut self) -> u32 {
        let Self {
            front,
            back,
            dirty,
            pool,
            frame,
            output,
            capabilities,
            cursor_x,
            cursor_y,
            cursor_visible,
            shown_cursor_x,
            shown_cursor_y,
            shown_cursor_visible,
            ..
        } = self;
        frame.clear();
        output.clear();
        let cursor_moved = *shown_cursor_x != *cursor_x
            || *shown_cursor_y != *cursor_y
            || *shown_cursor_visible != *cursor_visible;
        let mut changed = 0_u32;
        let mut writer = Writer::new(frame, *capabilities);
        for y in 0..back.height() {
            let Some(span) = dirty.get(y).copied() else {
                continue;
            };
            if span.is_dirty() {
                changed = changed.saturating_add(emit_row(&mut writer, front, back, pool, y, span));
            }
        }
        let painted = writer.len() > 0;
        if !painted && !cursor_moved {
            return 0;
        }
        if *cursor_visible {
            writer.move_to(*cursor_x, *cursor_y);
        }
        let synchronized = *capabilities & CAP_SYNCHRONIZED_OUTPUT != 0;
        if synchronized {
            output.extend_from_slice(b"\x1b[?2026h");
        }
        if *shown_cursor_visible {
            output.extend_from_slice(b"\x1b[?25l");
        }
        output.extend_from_slice(frame);
        if *cursor_visible {
            output.extend_from_slice(b"\x1b[?25h");
        }
        if synchronized {
            output.extend_from_slice(b"\x1b[?2026l");
        }
        *shown_cursor_x = *cursor_x;
        *shown_cursor_y = *cursor_y;
        *shown_cursor_visible = *cursor_visible;
        changed
    }

    fn commit(&mut self) {
        for y in 0..self.back.height() {
            let Some(span) = self.dirty.get(y).copied() else {
                continue;
            };
            if span.is_dirty() {
                self.front.copy_row_from(&self.back, y);
            }
        }
        for span in &mut self.dirty {
            span.reset();
        }
    }

    pub(crate) fn present(
        &mut self,
        ops: &[i32],
        op_count: usize,
        text: &[u8],
        text_len: usize,
    ) -> Result<u32, CoreError> {
        if !self.active {
            return Err(CoreError::ShutDown);
        }
        let words = op_count
            .checked_mul(OP_WORDS)
            .ok_or(CoreError::MalformedOps)?;
        if op_count > MAX_OPS || text_len > MAX_TEXT_BYTES {
            return Err(CoreError::SizeOutOfRange);
        }
        let op_words = ops.get(..words).ok_or(CoreError::MalformedOps)?;
        let text_bytes = text.get(..text_len).ok_or(CoreError::MalformedOps)?;

        let draw_start = Instant::now();
        self.apply(op_words, text_bytes)?;
        let draw = elapsed_micros(draw_start);

        let diff_start = Instant::now();
        let changed = self.compose();
        let diff = elapsed_micros(diff_start);
        let bytes = self.output.len();

        let write_start = Instant::now();
        if bytes > 0 {
            write_frame(&self.output)?;
        }
        let write = elapsed_micros(write_start);

        self.commit();
        let written = u32::try_from(bytes).unwrap_or(u32::MAX);
        self.stats.record(draw, diff, write, written, changed);
        Ok(written)
    }
}
