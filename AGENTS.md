# Project instructions

This is the canonical instruction file for coding agents working on Exsomnis CLI. `CLAUDE.md` imports it for Claude Code.

## Project status

The workspace is scaffolded and every check below passes. The application is a hello world: an Effect 4 `Command.run` entrypoint that loads the Rust core through N-API and logs its version. The next step is the rendering spike described in `exsomnis-context.md`.

## Layout

- `apps/exsomnis`: the executable. `src/bin.ts` is the only place that runs an Effect.
- `crates/core`: the Rust core, a napi-rs cdylib. `napi build` writes `index.js`, `index.d.ts`, and the platform `.node` file here; the first two are tracked, the binary is not.
- `packages/config`: the shared `tsconfig.base.json`, including the Effect language-service diagnostics.
- `packages/oxlint-plugins`: the custom lint rules.
- `Cargo.toml` at the root is the Cargo workspace; `package.json` at the root is the Bun workspace with the version catalog.

## Commands

All commands run from the workspace root.

- `bun install` installs dependencies and patches TypeScript 7 with the Effect language service.
- `bun run build:native` builds the Rust core in release mode. Run it before `typecheck` on a fresh clone, since `crates/core/index.d.ts` comes from it.
- `bun run check` runs `fmt:check`, `lint`, and `typecheck`. CI (`.github/workflows/ci.yml`) runs the same plus knip, clippy, cargo-deny, cargo-machete, `bun audit`, a generated-bindings drift check, and a compiled-binary smoke test on macOS 15 arm64.
- `bun run knip` finds unused files and dependencies.
- `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo deny check`, and `cargo machete` cover the Rust side.
- `bun apps/exsomnis/src/bin.ts` runs the app from source.
- `bun run compile` writes a single-file executable to `dist/exsomnis`. It needs Bun 1.4.0 or newer: Bun 1.3.12 emits a broken code signature on macOS arm64 and the kernel kills the binary on launch (oven-sh/bun issues 29120, 29270, 29361).

## Product context

- Read `exsomnis-context.md` before making product, interface, or architecture decisions.
- Read `effect-stack.md` before writing TypeScript. It records the Effect version, the packages in use, and the rules.
- Read `prompt-context.md` if it exists. It is gitignored and holds references to other products and to a private reference codebase. Never copy those names or paths into tracked files.
- Exsomnis wraps the agent CLIs installed on the machine. It never calls model provider APIs or holds API keys.
- Preserve each wrapped tool's native behavior instead of reimplementing or normalizing it.
- Keep the application independent of cmux, tmux, Zellij, and terminal-specific tab systems.
- Every action must be reachable by both mouse and keyboard.
- Performance is a product goal. Measure before and after any change on a hot path.
- Keep work focused on the current request. Do not turn a small change into a broad refactor.
- Preserve unrelated changes already present in the working tree.

## Workflow

- Work in small, reviewable changes.
- Never start a development server or long-running watcher unless the user asks.
- Never use `git stash` without the user's permission.
- Inspect the current code and dependencies before introducing a new abstraction, library, or tool.
- Prefer the simplest solution that satisfies the real user flow.
- Do not build speculative infrastructure. Add a daemon, plugin system, or provider abstraction only when a concrete need justifies it.

## Language boundary

- Rust owns terminal emulation, compositing, frame output, syntax highlighting, and diff parsing.
- TypeScript owns everything else: tasks, screens, layout, input routing, providers, Git, persistence, and widgets.
- Do not move logic across the boundary to fix a performance problem until a profile shows the boundary is the problem.
- Large buffers never cross the boundary per frame. Rust owns cell grids; TypeScript receives damage notifications.

## Effect

- All TypeScript application code is written with Effect 4, pinned to the exact release candidate in `package.json` and forced to one copy through `overrides`. Bumps are deliberate commits.
- Services are class-style `Context.Service` with a namespaced key, a `make` effect, and an explicit static `layer`. No `Effect.Service`, `.Default`, or generated accessors.
- Failures are `Schema.TaggedError` classes with fields a handler can act on. Recover with `catchTag` or `catchTags`. Generic `Effect.catch` only at a terminal boundary. Never `orDie` to hide an error.
- `try` and `catch` never appear in TypeScript. Wrap each throwing or Promise API once with `Effect.try` or `Effect.tryPromise`, routing the caught value through the shared `serializeUnknownError` helper.
- `Schema` declares every domain type, config value, persisted row, process output, and message, and decodes it once at the boundary. The per-frame N-API path is the only exception. No Zod.
- Interface state is `Atom` from `effect/unstable/reactivity` through one application-owned `AtomRegistry`. Nothing mirrors it in plain variables.
- Every meaningful operation is a named `Effect.fn('Service.method')`; I/O edges carry `Effect.withSpan`. Log configuration lives on the runtime layer. `console.*` is a lint error.
- The process runs once, at `bin.ts`, through `BunRuntime.runMain`. No `runSync`, `runPromise`, or `runFork` anywhere else.
- Prefer a module from `effect` or a package listed in `effect-stack.md` over a hand-written replacement. Before adding another Effect community package, confirm it peers on Effect 4 and record it in `effect-stack.md`.
- Before using an `effect/unstable/*` module, read its current source in `node_modules`. Effect 3 documentation does not apply.
- All 95 `@effect/tsgo` diagnostics are `error` except `missingPipeableSignature` and `missedPipeableOpportunity`, which target Effect library authors. An exception needs an inline `// @effect-diagnostics <rule>:off -- <reason>`.
- When `effect-stack.md` and the `effect-ts-practices` skill are silent, follow the reference codebase named in `prompt-context.md`, if that file exists.

## TypeScript and Bun

- Use strict TypeScript.
- Never use `any`, including casts, generic defaults, or temporary escape hatches. Keep untrusted values as `unknown` until they are narrowed.
- Prefer inferred types. Do not add annotations the compiler can infer.
- Use clear names, focused modules, explicit control flow, and useful types.
- Do not write comments in code. Express intent through names, types, structure, and durable documentation outside the code.
- Bun is the runtime, package manager, and script runner. Use `bun install`, `bun run`, `bunx`, and Bun APIs unless the project explicitly requires another tool.
- Lint with type-aware oxlint. The custom rules in `packages/oxlint-plugins` enforce the Effect rules mechanically; `effect-stack.md` lists them. Format with oxfmt. Keep `@effect/language-service` enabled in `tsconfig.json` and `@effect/tsgo` installed through `prepare`.
- Suppress an Effect diagnostic with `// @effect-diagnostics <name>:off -- <reason>` (no `effect/` prefix; the patched `tsc` ignores the prefixed form). Suppress an oxlint rule with `// oxlint-disable-next-line <rule> -- <reason>`. Both directives fail lint without a reason, and any other comment fails lint.

## Rust

- Lint levels live in the root `Cargo.toml` under `[workspace.lints]`; the crate inherits them. Process-safety lints are `deny` (no `unwrap`, `expect`, `panic`, `todo`, indexing, `as` casts, unchecked arithmetic, wildcard matches, shadowing, ignored results), the `all`, `pedantic`, `nursery`, and `cargo` clippy groups are `warn`, and CI runs clippy with `-D warnings`, so every warning fails.
- `unsafe_code` is denied crate-wide. Only `crates/core/src/napi_boundary.rs` allows it, with a reason, because napi-derive emits unsafe trampolines. The boundary module decodes N-API values, enforces size limits, converts numbers with `TryFrom`, calls safe domain code, and maps typed failures to `napi::Result`. Nothing else lives there.
- Every exported function carries `#[napi(catch_unwind)]` and returns `napi::Result` for expected failures. Profiles keep `panic = "unwind"` so a panic becomes a JavaScript error instead of killing Bun.
- `clippy.toml` bans assertion macros and infallible capacity APIs (`with_capacity`, `reserve`); use `try_reserve` after validating a bound. Every `#[allow]` needs a `reason`.
- `deny.toml` (cargo-deny) is the dependency policy: allowed licenses, one version per crate (the `syn` exception is listed), crates.io only. `cargo machete` catches unused dependencies.
- Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo deny check`, and `cargo machete` before declaring a change complete.
- Do not write comments in code, same rule as TypeScript. Documentation lints are off for that reason.

## Terminal and provider behavior

- Send ordinary input to the active child process unchanged. Application shortcuts must stay behind the configured leader key.
- Forward mouse events to a child process that has enabled mouse reporting. Otherwise the wheel scrolls that screen and a click focuses it.
- Treat terminal output as terminal data. Do not infer provider state by parsing generic transcripts.
- Keep provider-specific behavior at provider boundaries. Shared task state belongs to the filesystem, Git, and explicit application metadata.
- Keep diff modes explicit so the user can tell whether they are viewing working changes, branch changes, or a pull request comparison.
- Use the installed Git binary so local configuration, credentials, hooks, and worktrees behave normally.

## Testing and verification

- Do not add regression tests or automated test suites.
- Test changes manually through the real CLI and the complete user flow affected by the change.
- Exercise actual terminal behavior through a real pseudo-terminal. Verify input, output, screen switching, resizing, mouse input, process exit, and attention states when they are relevant.
- Use the real provider CLI when provider behavior is part of the change. If credentials or the local environment prevent this, state the exact limitation.
- Lint, typecheck, and build checks may detect collateral problems, but they do not replace manual CLI verification.
- Before declaring a change complete, state which user flows were exercised and what happened.

## Documentation

- Keep `exsomnis-context.md` focused on the product idea, interface, stack, and boundaries.
- Keep `effect-stack.md` as the record of Effect packages, versions, and rules.
- Record lasting decisions in documentation instead of code comments.
- Verify commands, paths, API names, and dependency behavior against the current project before documenting them.
