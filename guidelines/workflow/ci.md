# CI and branch protection

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. The workflow token is read-only (`permissions: contents: read`), concurrent runs on the same ref cancel each other, every job has a timeout, and every action is pinned to a full commit SHA with the version in a comment. Renovate (`renovate.json`) keeps the pins current and groups the Effect 4 release candidates so `effect` and `@effect/platform-bun` move together.

## Jobs

- Quality (`ubuntu-24.04`): `bun install --frozen-lockfile`, `bun run check` (oxfmt, type-aware oxlint, `tsc --noEmit` with every Effect diagnostic), `bun run knip`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`.
- Supply chain (`ubuntu-24.04`): `bun audit --audit-level=high`, `cargo deny check` through `EmbarkStudios/cargo-deny-action`, `cargo machete` installed through `taiki-e/install-action`.
- Compile smoke (`macos-15`, arm64): `bun run build:native`, then `git diff --exit-code` on `Cargo.lock`, `crates/core/index.js`, and `crates/core/index.d.ts` so committed bindings cannot drift, then `bun run compile` and a run of `dist/exsomnis --version` and `dist/exsomnis` from `$RUNNER_TEMP`. The runner label is `macos-15` on purpose; `macos-latest` now means macOS 26 and moves over time.

Bun 1.4.0 and Rust 1.93.1 are set once in the workflow `env` block. Bun's global package cache and Cargo's registry and target directories are cached; `node_modules` is not, so `prepare` patches TypeScript on every run.

## Branch protection

Ruleset `main` (GitHub ruleset id 21418153) requires the three job names above as status checks with the strict up-to-date policy, blocks force pushes and branch deletion, and lets repository admins bypass so direct pushes from the maintainer still work. Job names are part of the contract: renaming a job in the workflow requires updating the ruleset.

## What the pre-commit hook covers

`lefthook.yml` runs oxlint with fixes, oxfmt, and `cargo fmt` on staged files. The oxlint job is limited to `*.{ts,js,jsonc}` because oxlint exits 1 when given nothing it can lint. CI repeats all of it: hooks can be skipped, staged-file checks do not cover the whole tree, and the hook never runs typecheck, knip, clippy, the audits, the drift check, or the compiled binary.

## Git history and privacy

Commit messages and pull request bodies carry no tool attribution, session links, or trailers. Tracked files never name the products or the private codebase listed in the gitignored `prompt-context.md`. Before every commit, scan the staged content for those names.
