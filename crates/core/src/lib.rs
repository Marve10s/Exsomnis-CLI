#![allow(
    clippy::redundant_pub_crate,
    reason = "pub(crate) inside private modules is what unreachable_pub requires; the two lints disagree"
)]

mod color;
mod diff;
mod error;
mod grid;
mod ops;
mod screen;
mod stats;
mod text;
mod writer;

pub mod napi_boundary;
