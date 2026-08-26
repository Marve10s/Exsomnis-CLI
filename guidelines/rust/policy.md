# Rust policy

The Rust core is a napi-rs cdylib loaded into the Bun process. A panic, an abort, or undefined behavior there kills Exsomnis, every PTY, and every agent session with it. The policy below exists so that the compiler and the tools catch what a reviewer would, because the maintainer is not a Rust developer.

## Lint tiers

Lint levels live in the root `Cargo.toml` under `[workspace.lints]`; `crates/core/Cargo.toml` inherits them with `[lints] workspace = true`. There are two tiers.

Process-safety lints are `deny`, so an ordinary local build rejects them: `unsafe_code`, `unsafe_op_in_unsafe_fn`, `unused_results`, `let_underscore_drop`, `ffi_unwind_calls`, `unused_crate_dependencies`, and on the clippy side `unwrap_used`, `expect_used`, `panic`, `panic_in_result_fn`, `todo`, `unimplemented`, `unreachable`, `exit`, `indexing_slicing`, `string_slice`, `arithmetic_side_effects`, `integer_division`, `modulo_arithmetic`, `as_conversions`, every `cast_*` lint, `default_numeric_fallback`, `wildcard_enum_match_arm`, `match_wild_err_arm`, `match_wildcard_for_single_variants`, `shadow_reuse`, `shadow_same`, `shadow_unrelated`, `mem_forget`, `multiple_unsafe_ops_per_block`, `iter_over_hash_type`, `print_stdout`, `print_stderr`, `dbg_macro`, `allow_attributes_without_reason`, `map_err_ignore`, `unused_result_ok`, `let_underscore_must_use`, `fallible_impl_from`.

Quality groups are `warn`: rustc's `future_incompatible` and `rust_2024_compatibility`, and clippy's `all`, `pedantic`, `nursery`, and `cargo`. CI runs clippy with `-D warnings`, so every warning fails there while local exploratory builds stay usable.

Allowed back, with reasons in `Cargo.toml`: `cargo_common_metadata` (private crate), `manual_assert` (assertions are banned, so clippy must not suggest one), `missing_errors_doc`, `missing_panics_doc`, `missing_safety_doc` (the project forbids comments; error behavior belongs in types), and `multiple_crate_versions` (cargo-deny owns the dependency graph, with the `syn` exception recorded there). `undocumented_unsafe_blocks` is not enabled because it requires comments; one unsafe module, one operation per block, and `unsafe_op_in_unsafe_fn` compensate.

Three more allows carry reasons in the source. `clippy::redundant_pub_crate` is allowed at the crate root because it contradicts rustc's `unreachable_pub`: every item shared between the private modules must be `pub(crate)` to satisfy one lint and plain `pub` to satisfy the other, and `pub(crate)` is the safer half of the pair. `clippy::unnecessary_wraps` is allowed on `Screen::shutdown` because the policy below requires every export to return `napi::Result` even when it cannot fail. `clippy::needless_pass_by_value` is allowed on `cell_width` because napi-derive rejects `&str`: a JavaScript string is a primitive and must arrive owned.

Four rustc lints the research recommended are nightly-only and are not set: `unqualified_local_imports`, `must_not_suspend`, `lossy_provenance_casts`, `fuzzy_provenance_casts`.

## clippy.toml

- Assertion macros, including the `debug_assert` family, are disallowed because they panic inside the host.
- `with_capacity`, `reserve`, and `reserve_exact` on `Vec`, `String`, `VecDeque`, `BinaryHeap`, `HashMap`, and `HashSet` are disallowed. Every size that comes from N-API gets a named maximum, a `TryFrom` conversion, checked arithmetic, `try_reserve`, and a typed `napi::Error` when the bound or the reservation fails. The lint cannot track a tainted size through `collect` or repeated pushes, so that design rule stands on its own.
- Every `#[allow]` carries a `reason`.
- Thresholds: cognitive complexity 20, 6 arguments, 80 lines per function, type complexity 200. `msrv = "1.93"`.

## Unsafe policy

`unsafe_code` is denied crate-wide. `crates/core/src/napi_boundary.rs` is the only module that allows it, with the reason that napi-derive emits unsafe Node-API callback trampolines. The boundary module does only these jobs: decode and validate N-API values, enforce size limits, convert numbers through `TryFrom`, call safe domain functions, map typed failures to `napi::Result`, and convert output to N-API values. Terminal emulation, parsing, compositing, and state live in sibling modules that inherit the deny.

napi-derive's expansion includes `#[allow(clippy::all)]` and `#[allow(non_snake_case)]` without reasons and an unsafe block per export. Clippy suppresses findings inside external macro expansions, so the crate compiles clean under the policy above; if a future napi-derive release changes that, scope the exception to the individual `#[napi]` item, never to the crate.

## The compositor

`crates/core/src/napi_boundary.rs` exports one class. `new Screen(cols, rows)` allocates the front and back grids, `resize` reallocates them and forces a full repaint, `setCapabilities` takes a bitmask for true colour, indexed colour, and synchronized output, `present` takes the whole frame and returns the bytes written, `takeStats` drains the 240-frame ring, `invalidate` forces the next frame to repaint everything, and `shutdown` makes every later call fail. Two free functions sit beside it: `coreVersion` and `cellWidth`, the second so TypeScript can compare its width table against the crate's.

`present(ops, opCount, text, textLen)` borrows an `Int32ArraySlice` and a `Uint8ArraySlice` for the duration of the call. Operations are fixed eight-word records, so the writer never branches on record size: `[opcode, x, y, a, b, foreground, background, attributes]`. The opcodes are fill rect, text run, cursor, clip push, and clip pop; a text run puts a byte offset and length into `a` and `b`. Colours pack a tag in the high byte, `0x01RRGGBB` for true colour, `0x020000NN` for a 256 index, and `0x0000000N` for default and the sixteen named colours. Both lengths arrive as separate arguments and are validated against a named maximum and against the slice length before anything is read.

The domain modules beside the boundary are `grid` (cells, styles, dirty spans), `text` (grapheme segmentation and the cluster interner), `color` (decoding and downgrading), `ops` (record decoding and clip rectangles), `writer` (cursor moves, SGR, cell bytes), `screen` (the compositor), `stats` (the ring buffers), and `error`. Every one of them is a private module whose shared items are `pub(crate)`.

## Panics

Every profile keeps `panic = "unwind"`. `panic = "abort"` would turn any missed panic into immediate termination of Bun and make `catch_unwind` useless.

Every exported function carries `#[napi(catch_unwind)]` and returns `napi::Result` for expected failures. An unwinding panic that reaches the generated wrapper becomes a JavaScript error instead of crossing the C ABI. This does not cover out-of-memory, undefined behavior, signals, foreign exceptions, or explicit aborts, so the lints above exist to keep panics from happening in the first place. Destructors stay infallible, because a second panic during unwinding aborts. Thread joins and ThreadsafeFunction return statuses are checked, never ignored.

## napi-rs

- Features are explicit: `napi` with `napi4` and `dyn-symbols`, `napi-derive` with `type-def` and `strict`. `napi4` is the lowest level that provides ThreadsafeFunction and cross-thread reference cleanup. `full`, `experimental`, `serde-json`, `tokio_rt`, `async`, `web_stream`, and higher `napiN` levels stay off until a measured need appears; Rust worker threads and ThreadsafeFunction callbacks do not need Tokio, and adding it would duplicate the async ownership Bun and Effect already have.
- Bun implements most of Node-API and napi-rs classifies Bun support as best effort. The scaffold proves the hello-world load and the compiled-executable path only. ThreadsafeFunction, buffer ownership, cleanup, and shutdown need real Bun tests before the product relies on them.
- ThreadsafeFunction: never touch `napi_env`, `napi_value`, or `napi_ref` from a Rust worker thread. Give every ThreadsafeFunction a finite queue size and use `NonBlocking` for damage notifications. Handle `QueueFull` by coalescing damage or marking a full redraw, and handle `Closing` during shutdown. Never call `Blocking` from Bun's JavaScript thread; it can deadlock. Decide explicitly whether the function is weak, since weak mode neither keeps the event loop alive nor guarantees delivery. Keep `CalleeHandled` at its default and use `call_async_catch` or `call_with_return_value` when Rust must observe a JavaScript failure. Damage notifications carry small owned facts such as a terminal id and a damage generation; the cell grids stay in Rust.
- Buffers: borrow `&[u8]` or `BufferSlice` only during a synchronous call. Copy JavaScript-owned bytes before handing work to a Rust thread; `Buffer: Send + Sync` does not synchronize concurrent JavaScript mutation. Return `Buffer` from an owned `Vec<u8>` when ownership can transfer. Do not use `from_external`; it needs `mem::forget`, which is banned. Validate every length before copying or reserving.
- Errors: expected failures are `napi::Result` values. A synchronous `Err` becomes a thrown JavaScript `Error`, an asynchronous one a rejected Promise; `reason` becomes `error.message` and the status string `error.code`. The generated TypeScript declarations do not encode thrown exceptions, so the `CoreNative` service wraps every native call and maps the JavaScript error into a `Schema.TaggedError`.

## Dependencies and tools

- `deny.toml` is the dependency policy: allowed licenses (Apache-2.0, MIT, ISC, Unicode-3.0), one version per crate with the `syn` 2 and 3 duplication recorded as an explicit skip, crates.io as the only source, yanked and unmaintained crates denied. Run `cargo deny check`.
- The compositor added `unicode-segmentation` 1.13.3 and `unicode-width` 0.2.2. Both are `MIT OR Apache-2.0`, both have no runtime dependencies, and `unicode-width` declares `#![forbid(unsafe_code)]`. They are the whole crate budget for grapheme segmentation and column width; `crossterm` and `termwiz` were rejected for their dependency graphs and because they want to own terminal setup, which TypeScript owns here.
- `cargo machete` catches unused dependencies. `napi` is listed under `[package.metadata.cargo-machete] ignored` because the source only names `napi_derive` and every `napi::` path is inside the macro expansion.
- Not used, and why: `cargo-udeps` needs nightly; `cargo-semver-checks` targets published Rust APIs and this crate's consumer is generated TypeScript; `cargo-nextest` has nothing to run because the project keeps no automated test suite; `cargo-audit` duplicates cargo-deny's advisory check and is not in CI.
- `rust-toolchain.toml` pins 1.93.1 with clippy and rustfmt for rustup users and for `dtolnay/rust-toolchain` in CI. The local toolchain comes from Homebrew, which does not read that file, so the pin is a CI guarantee and a local convention. `rust-version = "1.93"` in the crate is the build floor, not a downstream support promise.
- `rustfmt.toml` sets edition 2024 style, 100 columns, 4 spaces, reordered imports and modules, merged derives, and the `?` and field-init shorthands.

## Before declaring a change complete

Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo deny check`, and `cargo machete`, and check each one's exit code rather than its last line of output. Do not write comments in code; the same rule as TypeScript applies.
