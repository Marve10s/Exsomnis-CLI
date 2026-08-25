# Commands

All commands run from the workspace root.

- `bun install` installs dependencies and patches TypeScript 7 with the Effect language service.
- `bun run build:native` builds the Rust core in release mode. Run it before `typecheck` on a fresh clone, since `crates/core/index.d.ts` comes from it.
- `bun run check` runs `fmt:check`, `lint`, and `typecheck`. CI (`.github/workflows/ci.yml`) runs the same plus knip, clippy, cargo-deny, cargo-machete, `bun audit`, a generated-bindings drift check, and a compiled-binary smoke test on macOS 15 arm64.
- `bun run knip` finds unused files and dependencies.
- `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo deny check`, and `cargo machete` cover the Rust side.
- `bun apps/exsomnis/src/bin.ts` runs the app from source.
- `bun run compile` writes a single-file executable to `dist/exsomnis`. It needs Bun 1.4.0 or newer: Bun 1.3.12 emits a broken code signature on macOS arm64 and the kernel kills the binary on launch (oven-sh/bun issues 29120, 29270, 29361).
- `bun run fmt` formats; `bun run lint:fix` applies oxlint fixes.
- `cargo fmt --all` formats Rust.
- `bun audit --audit-level=high` audits the Bun dependency tree; CI runs it on every push.
- `bun run build:native:debug` builds the Rust core without optimizations for faster iteration.

Every command above was run on the development machine before it was written down. If a command changes, change this file in the same commit.
