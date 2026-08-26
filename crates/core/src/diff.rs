use std::collections::TryReserveError;
use std::fmt;

pub(crate) const MAX_DIFF_BYTES: usize = 67_108_864;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DiffError {
    SizeOutOfRange,
    Allocation,
    Malformed,
}

impl fmt::Display for DiffError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SizeOutOfRange => formatter.write_str("unified diff exceeds the maximum size"),
            Self::Allocation => formatter.write_str("unified diff allocation failed"),
            Self::Malformed => formatter.write_str("unified diff is malformed"),
        }
    }
}

impl From<TryReserveError> for DiffError {
    fn from(_source: TryReserveError) -> Self {
        Self::Allocation
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DiffStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DiffLineKind {
    Context,
    Added,
    Removed,
    NoNewline,
}

#[derive(Debug)]
pub(crate) struct DiffLine {
    pub(crate) kind: DiffLineKind,
    pub(crate) text: String,
    pub(crate) old_line_number: Option<u32>,
    pub(crate) new_line_number: Option<u32>,
}

#[derive(Debug)]
pub(crate) struct DiffHunk {
    pub(crate) header: String,
    pub(crate) old_start: u32,
    pub(crate) old_count: u32,
    pub(crate) new_start: u32,
    pub(crate) new_count: u32,
    pub(crate) lines: Vec<DiffLine>,
}

#[derive(Debug)]
pub(crate) struct DiffFile {
    pub(crate) old_path: String,
    pub(crate) new_path: String,
    pub(crate) status: DiffStatus,
    pub(crate) binary: bool,
    pub(crate) additions: u32,
    pub(crate) deletions: u32,
    pub(crate) hunks: Vec<DiffHunk>,
}

#[derive(Debug)]
pub(crate) struct DiffDocument {
    pub(crate) files: Vec<DiffFile>,
}

struct Parser {
    document: DiffDocument,
    file: Option<DiffFile>,
    hunk: Option<DiffHunk>,
    old_line: u32,
    new_line: u32,
}

impl Parser {
    const fn new() -> Self {
        Self {
            document: DiffDocument { files: Vec::new() },
            file: None,
            hunk: None,
            old_line: 0,
            new_line: 0,
        }
    }

    fn consume(&mut self, line: &str) -> Result<(), DiffError> {
        if let Some(header) = line.strip_prefix("diff --git ") {
            self.start_file(header)?;
            return Ok(());
        }
        if line.starts_with("@@ ") {
            self.start_hunk(line)?;
            return Ok(());
        }
        if self.hunk.is_some() {
            return self.consume_hunk_line(line);
        }
        self.consume_file_header(line)
    }

    fn start_file(&mut self, header: &str) -> Result<(), DiffError> {
        self.finish_file()?;
        let (old_path, new_path) = parse_diff_paths(header)?;
        self.file = Some(DiffFile {
            old_path,
            new_path,
            status: DiffStatus::Modified,
            binary: false,
            additions: 0,
            deletions: 0,
            hunks: Vec::new(),
        });
        Ok(())
    }

    fn start_hunk(&mut self, header: &str) -> Result<(), DiffError> {
        self.finish_hunk()?;
        let (old_start, old_count, new_start, new_count) = parse_hunk_header(header)?;
        self.old_line = old_start;
        self.new_line = new_start;
        self.hunk = Some(DiffHunk {
            header: copy_string(header)?,
            old_start,
            old_count,
            new_start,
            new_count,
            lines: Vec::new(),
        });
        Ok(())
    }

    fn consume_file_header(&mut self, line: &str) -> Result<(), DiffError> {
        let Some(file) = self.file.as_mut() else {
            return Ok(());
        };
        if line.starts_with("new file mode ") {
            file.status = DiffStatus::Added;
        } else if line.starts_with("deleted file mode ") {
            file.status = DiffStatus::Deleted;
        } else if let Some(path) = line.strip_prefix("rename from ") {
            file.status = DiffStatus::Renamed;
            file.old_path = copy_string(path)?;
        } else if let Some(path) = line.strip_prefix("rename to ") {
            file.status = DiffStatus::Renamed;
            file.new_path = copy_string(path)?;
        } else if let Some(path) = line.strip_prefix("--- ") {
            if path == "/dev/null" {
                file.status = DiffStatus::Added;
            } else {
                file.old_path = normalize_patch_path(path, "a/")?;
            }
        } else if let Some(path) = line.strip_prefix("+++ ") {
            if path == "/dev/null" {
                file.status = DiffStatus::Deleted;
            } else {
                file.new_path = normalize_patch_path(path, "b/")?;
            }
        } else if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            file.binary = true;
        }
        Ok(())
    }

    fn consume_hunk_line(&mut self, line: &str) -> Result<(), DiffError> {
        let (kind, text, old_line_number, new_line_number) =
            if let Some(text) = line.strip_prefix(' ') {
                let old = self.old_line;
                let new = self.new_line;
                self.old_line = increment_line(self.old_line)?;
                self.new_line = increment_line(self.new_line)?;
                (DiffLineKind::Context, text, Some(old), Some(new))
            } else if let Some(text) = line.strip_prefix('+') {
                let new = self.new_line;
                self.new_line = increment_line(self.new_line)?;
                self.increment_additions()?;
                (DiffLineKind::Added, text, None, Some(new))
            } else if let Some(text) = line.strip_prefix('-') {
                let old = self.old_line;
                self.old_line = increment_line(self.old_line)?;
                self.increment_deletions()?;
                (DiffLineKind::Removed, text, Some(old), None)
            } else if line.starts_with("\\ No newline at end of file") {
                (DiffLineKind::NoNewline, line, None, None)
            } else {
                return Ok(());
            };
        let diff_line = DiffLine {
            kind,
            text: copy_string(text)?,
            old_line_number,
            new_line_number,
        };
        let hunk = self.hunk.as_mut().ok_or(DiffError::Malformed)?;
        push_reserved(&mut hunk.lines, diff_line)
    }

    fn increment_additions(&mut self) -> Result<(), DiffError> {
        let file = self.file.as_mut().ok_or(DiffError::Malformed)?;
        file.additions = file.additions.checked_add(1).ok_or(DiffError::Malformed)?;
        Ok(())
    }

    fn increment_deletions(&mut self) -> Result<(), DiffError> {
        let file = self.file.as_mut().ok_or(DiffError::Malformed)?;
        file.deletions = file.deletions.checked_add(1).ok_or(DiffError::Malformed)?;
        Ok(())
    }

    fn finish_hunk(&mut self) -> Result<(), DiffError> {
        let Some(hunk) = self.hunk.take() else {
            return Ok(());
        };
        let file = self.file.as_mut().ok_or(DiffError::Malformed)?;
        push_reserved(&mut file.hunks, hunk)
    }

    fn finish_file(&mut self) -> Result<(), DiffError> {
        self.finish_hunk()?;
        if let Some(file) = self.file.take() {
            push_reserved(&mut self.document.files, file)?;
        }
        Ok(())
    }

    fn finish(mut self) -> Result<DiffDocument, DiffError> {
        self.finish_file()?;
        Ok(self.document)
    }
}

pub(crate) fn parse_unified_diff(text: &str) -> Result<DiffDocument, DiffError> {
    if text.len() > MAX_DIFF_BYTES {
        return Err(DiffError::SizeOutOfRange);
    }
    let mut parser = Parser::new();
    for line in text.lines() {
        parser.consume(line)?;
    }
    parser.finish()
}

fn parse_diff_paths(header: &str) -> Result<(String, String), DiffError> {
    if let Some((old_path, new_path)) = header.rsplit_once(" b/") {
        return Ok((
            normalize_patch_path(old_path, "a/")?,
            normalize_patch_path(new_path, "")?,
        ));
    }
    if let Some((old_path, new_path)) = header.rsplit_once("\" \"b/") {
        return Ok((
            normalize_patch_path(old_path, "a/")?,
            normalize_patch_path(new_path, "")?,
        ));
    }
    Err(DiffError::Malformed)
}

fn normalize_patch_path(path: &str, prefix: &str) -> Result<String, DiffError> {
    let unquoted = path.trim_matches('"');
    copy_string(unquoted.strip_prefix(prefix).unwrap_or(unquoted))
}

fn parse_hunk_header(header: &str) -> Result<(u32, u32, u32, u32), DiffError> {
    let body = header
        .strip_prefix("@@ -")
        .and_then(|value| value.split_once(" @@").map(|pair| pair.0))
        .ok_or(DiffError::Malformed)?;
    let (old_range, new_range) = body.split_once(" +").ok_or(DiffError::Malformed)?;
    let (old_start, old_count) = parse_range(old_range)?;
    let (new_start, new_count) = parse_range(new_range)?;
    Ok((old_start, old_count, new_start, new_count))
}

fn parse_range(value: &str) -> Result<(u32, u32), DiffError> {
    let (start_text, count_text) = value.split_once(',').unwrap_or((value, "1"));
    let start = start_text
        .parse::<u32>()
        .map_err(|_error| DiffError::Malformed)?;
    let count = count_text
        .parse::<u32>()
        .map_err(|_error| DiffError::Malformed)?;
    Ok((start, count))
}

fn increment_line(line: u32) -> Result<u32, DiffError> {
    line.checked_add(1).ok_or(DiffError::Malformed)
}

fn copy_string(value: &str) -> Result<String, DiffError> {
    let mut output = String::new();
    output.try_reserve(value.len())?;
    output.push_str(value);
    Ok(output)
}

fn push_reserved<T>(values: &mut Vec<T>, value: T) -> Result<(), DiffError> {
    values.try_reserve(1)?;
    values.push(value);
    Ok(())
}
