#![allow(
    unsafe_code,
    reason = "napi-derive emits unsafe Node-API callback trampolines"
)]

use napi::bindgen_prelude::{Int32ArraySlice, Uint8ArraySlice};
use napi::{Error, Result, Status};
use napi_derive::napi;

use crate::diff::{
    self, DiffDocument as ParsedDiffDocument, DiffError, DiffFile as ParsedDiffFile,
    DiffHunk as ParsedDiffHunk, DiffLine as ParsedDiffLine, DiffLineKind as ParsedDiffLineKind,
    DiffStatus as ParsedDiffStatus,
};
use crate::error::CoreError;
use crate::screen::Compositor;
use crate::stats::StatsSnapshot;
use crate::text::cell_width as measure_cell_width;

fn to_napi(error: CoreError) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

fn to_napi_diff(error: DiffError) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

fn to_size(value: u32) -> Result<usize> {
    usize::try_from(value).map_err(|error| Error::new(Status::InvalidArg, error.to_string()))
}

#[derive(Debug)]
#[napi(object)]
pub struct FrameStats {
    pub frames: f64,
    pub draw_micros_mean: f64,
    pub draw_micros_p95: f64,
    pub diff_micros_mean: f64,
    pub diff_micros_p95: f64,
    pub write_micros_mean: f64,
    pub write_micros_p95: f64,
    pub bytes_mean: f64,
    pub bytes_max: f64,
    pub bytes_total: f64,
    pub cells_total: f64,
}

impl From<StatsSnapshot> for FrameStats {
    fn from(snapshot: StatsSnapshot) -> Self {
        Self {
            frames: snapshot.frames,
            draw_micros_mean: snapshot.draw_micros_mean,
            draw_micros_p95: snapshot.draw_micros_p95,
            diff_micros_mean: snapshot.diff_micros_mean,
            diff_micros_p95: snapshot.diff_micros_p95,
            write_micros_mean: snapshot.write_micros_mean,
            write_micros_p95: snapshot.write_micros_p95,
            bytes_mean: snapshot.bytes_mean,
            bytes_max: snapshot.bytes_max,
            bytes_total: snapshot.bytes_total,
            cells_total: snapshot.cells_total,
        }
    }
}

#[derive(Debug)]
#[napi(string_enum = "camelCase")]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
    NoNewline,
}

impl From<ParsedDiffLineKind> for DiffLineKind {
    fn from(kind: ParsedDiffLineKind) -> Self {
        match kind {
            ParsedDiffLineKind::Context => Self::Context,
            ParsedDiffLineKind::Added => Self::Added,
            ParsedDiffLineKind::Removed => Self::Removed,
            ParsedDiffLineKind::NoNewline => Self::NoNewline,
        }
    }
}

#[derive(Debug)]
#[napi(object)]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub text: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
}

impl TryFrom<ParsedDiffLine> for DiffLine {
    type Error = DiffError;

    fn try_from(line: ParsedDiffLine) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            kind: line.kind.into(),
            text: line.text,
            old_line_number: line.old_line_number,
            new_line_number: line.new_line_number,
        })
    }
}

#[derive(Debug)]
#[napi(string_enum = "camelCase")]
pub enum DiffStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

impl From<ParsedDiffStatus> for DiffStatus {
    fn from(status: ParsedDiffStatus) -> Self {
        match status {
            ParsedDiffStatus::Added => Self::Added,
            ParsedDiffStatus::Modified => Self::Modified,
            ParsedDiffStatus::Deleted => Self::Deleted,
            ParsedDiffStatus::Renamed => Self::Renamed,
        }
    }
}

#[derive(Debug)]
#[napi(object)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<DiffLine>,
}

impl TryFrom<ParsedDiffHunk> for DiffHunk {
    type Error = DiffError;

    fn try_from(hunk: ParsedDiffHunk) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            header: hunk.header,
            old_start: hunk.old_start,
            old_count: hunk.old_count,
            new_start: hunk.new_start,
            new_count: hunk.new_count,
            lines: try_convert(hunk.lines)?,
        })
    }
}

#[derive(Debug)]
#[napi(object)]
pub struct DiffFile {
    pub old_path: String,
    pub new_path: String,
    pub status: DiffStatus,
    pub binary: bool,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
}

impl TryFrom<ParsedDiffFile> for DiffFile {
    type Error = DiffError;

    fn try_from(file: ParsedDiffFile) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            old_path: file.old_path,
            new_path: file.new_path,
            status: file.status.into(),
            binary: file.binary,
            additions: file.additions,
            deletions: file.deletions,
            hunks: try_convert(file.hunks)?,
        })
    }
}

#[derive(Debug)]
#[napi(object)]
pub struct DiffDocument {
    pub files: Vec<DiffFile>,
}

impl TryFrom<ParsedDiffDocument> for DiffDocument {
    type Error = DiffError;

    fn try_from(document: ParsedDiffDocument) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            files: try_convert(document.files)?,
        })
    }
}

fn try_convert<T, U>(values: Vec<T>) -> std::result::Result<Vec<U>, DiffError>
where
    U: TryFrom<T, Error = DiffError>,
{
    let mut output = Vec::new();
    output.try_reserve(values.len())?;
    for value in values {
        output.push(U::try_from(value)?);
    }
    Ok(output)
}

#[derive(Debug)]
#[napi]
pub struct Screen {
    compositor: Compositor,
}

#[napi]
impl Screen {
    #[napi(constructor, catch_unwind)]
    pub fn new(cols: u32, rows: u32) -> Result<Self> {
        let compositor = Compositor::new(to_size(cols)?, to_size(rows)?).map_err(to_napi)?;
        Ok(Self { compositor })
    }

    #[napi(catch_unwind)]
    pub fn resize(&mut self, cols: u32, rows: u32) -> Result<()> {
        self.compositor
            .resize(to_size(cols)?, to_size(rows)?)
            .map_err(to_napi)
    }

    #[napi(catch_unwind)]
    pub fn set_capabilities(&mut self, flags: u32) -> Result<()> {
        if !self.compositor.is_active() {
            return Err(to_napi(CoreError::ShutDown));
        }
        self.compositor.set_capabilities(flags);
        Ok(())
    }

    #[napi(catch_unwind)]
    pub fn invalidate(&mut self) -> Result<()> {
        if !self.compositor.is_active() {
            return Err(to_napi(CoreError::ShutDown));
        }
        self.compositor.invalidate();
        Ok(())
    }

    #[napi(catch_unwind)]
    pub fn present(
        &mut self,
        ops: Int32ArraySlice<'_>,
        op_count: u32,
        text: Uint8ArraySlice<'_>,
        text_len: u32,
    ) -> Result<u32> {
        self.compositor
            .present(&ops, to_size(op_count)?, &text, to_size(text_len)?)
            .map_err(to_napi)
    }

    #[napi(catch_unwind)]
    pub fn take_stats(&mut self) -> Result<FrameStats> {
        if !self.compositor.is_active() {
            return Err(to_napi(CoreError::ShutDown));
        }
        Ok(self.compositor.take_stats().into())
    }

    #[allow(
        clippy::unnecessary_wraps,
        reason = "the Rust policy requires every N-API export to return Result"
    )]
    #[napi(catch_unwind)]
    pub fn shutdown(&mut self) -> Result<()> {
        self.compositor.shutdown();
        Ok(())
    }
}

#[must_use]
#[napi(catch_unwind)]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-derive rejects &str because a JavaScript string is a primitive"
)]
#[must_use]
#[napi(catch_unwind)]
pub fn cell_width(text: String) -> u32 {
    u32::try_from(measure_cell_width(&text)).unwrap_or(u32::MAX)
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-derive rejects &str because a JavaScript string is a primitive"
)]
#[napi(catch_unwind)]
pub fn parse_unified_diff(text: String) -> Result<DiffDocument> {
    let document = diff::parse_unified_diff(&text).map_err(to_napi_diff)?;
    DiffDocument::try_from(document).map_err(to_napi_diff)
}
