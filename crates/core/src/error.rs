use std::collections::TryReserveError;
use std::fmt;
use std::io;
use std::num::TryFromIntError;
use std::str::Utf8Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CoreError {
    SizeOutOfRange,
    Allocation,
    MalformedOps,
    InvalidText,
    ClipOverflow,
    Output(io::ErrorKind),
    ShutDown,
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            Self::SizeOutOfRange => formatter.write_str("screen size out of range"),
            Self::Allocation => formatter.write_str("screen allocation failed"),
            Self::MalformedOps => formatter.write_str("draw operation buffer is malformed"),
            Self::InvalidText => formatter.write_str("text buffer is not valid utf-8"),
            Self::ClipOverflow => formatter.write_str("clip stack is too deep"),
            Self::Output(kind) => write!(formatter, "writing the frame failed: {kind}"),
            Self::ShutDown => formatter.write_str("screen is shut down"),
        }
    }
}

impl From<TryReserveError> for CoreError {
    fn from(_source: TryReserveError) -> Self {
        Self::Allocation
    }
}

impl From<TryFromIntError> for CoreError {
    fn from(_source: TryFromIntError) -> Self {
        Self::MalformedOps
    }
}

impl From<Utf8Error> for CoreError {
    fn from(_source: Utf8Error) -> Self {
        Self::InvalidText
    }
}

impl From<io::Error> for CoreError {
    fn from(source: io::Error) -> Self {
        Self::Output(source.kind())
    }
}
