# Repository layout

- `apps/exsomnis`: the executable. `src/bin.ts` is the only place that runs an Effect.
- `crates/core`: the Rust core, a napi-rs cdylib. `napi build` writes `index.js`, `index.d.ts`, and the platform `.node` file here; the first two are tracked, the binary is not.
- `packages/config`: the shared `tsconfig.base.json`, including the Effect language-service diagnostics.
- `packages/oxlint-plugins`: the custom lint rules.
- `Cargo.toml` at the root is the Cargo workspace; `package.json` at the root is the Bun workspace with the version catalog.

## Generated versus authored

- `crates/core/index.js` and `crates/core/index.d.ts` are written by `napi build`. They are committed so the TypeScript side typechecks without a Rust toolchain, and CI fails when they drift from a fresh build. Never edit them; oxlint and oxfmt ignore them.
- `crates/core/*.node` is the compiled addon for one platform. It is ignored by git and rebuilt by `bun run build:native`.
- `bun.lock` and `Cargo.lock` are committed. CI installs with `--frozen-lockfile` and `--locked`.
- `dist/` holds the compiled executable and is ignored.

## Where things live

- `apps/exsomnis/src/bin.ts` is the single runtime boundary: the only `BunRuntime.runMain` and the only `Effect.provide` of the full layer.
- `apps/exsomnis/src/core-native.ts` is the only file that imports `@exsomnis/core`. Everything else depends on the `CoreNative` service.
- `crates/core/src/napi_boundary.rs` is the only Rust module that allows `unsafe`, because napi-derive emits unsafe trampolines there. Domain code lives in sibling modules that inherit `unsafe_code = "deny"`.
- `packages/oxlint-plugins/src/lib/` holds the helpers shared by the custom lint rules; each other file in `src/` is one plugin exporting one or more rules.
- `prompt-context.md` at the root is gitignored and holds private references. It must never be copied into a tracked file.
