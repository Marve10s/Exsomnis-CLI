#![deny(clippy::all)]

use napi_derive::napi;

#[napi]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
