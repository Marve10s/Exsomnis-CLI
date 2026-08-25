#![allow(
    unsafe_code,
    reason = "napi-derive emits unsafe Node-API callback trampolines"
)]

use napi_derive::napi;

#[must_use]
#[napi(catch_unwind)]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
