# Effect stack

Exsomnis's TypeScript side is written in Effect end to end. This document records the Effect version, the packages in use, the conventions carried over from the reference codebase, and the rules that follow. Versions were checked against the npm registry on 2026-08-25.

## Reference codebase

A private production codebase, named with its local path in the gitignored `prompt-context.md`, is the reference for how Effect 4 code looks in practice. It runs `effect@4.0.0-rc.110` across a Bun workspace with 97 `Context.Service` classes, 129 `Schema.TaggedError` classes, 130 named `Effect.fn` operations, and 153 spans. When this document is silent, do what that codebase does.

Two places where its docs drifted from its code: the docs say `Schema.TaggedErrorClass` and the code uses `Schema.TaggedError` (129 to 0); the docs mention a vendored vitest package that was deleted. Follow the code.

## Version decision

Exsomnis starts on Effect 4, pinned to an exact release candidate (`4.0.0-rc.112` at the time of writing) and bumped deliberately. A single `overrides` entry (`"effect": "$effect"`) forces one copy, as the reference codebase does.

Effect 4 rewrote the fiber runtime for lower memory use and faster execution, and a minimal program shrank from about 70 kB to about 20 kB. The release candidate is declared free of further broad breaking changes, stable is targeted for Q3 or Q4 2026, and the stable release is planned as long-term support. Exsomnis has no code yet, so it pays no migration cost.

Modules under `effect/unstable/*` may break in minor releases, which is another reason to pin exactly. Exsomnis uses them where they are the only option and accepts the churn.

## Packages in use

| Package | Version | Role in Exsomnis |
|---|---|---|
| `effect` | 4.0.0-rc.112 | Runtime, `Context.Service`, `Layer`, `Schema`, `Stream`, `Config`, `Terminal`, `Stdio`, `FileSystem`, `Path`, `ErrorReporter`, `Logger`, `Metric`, `Tracer` |
| `effect/unstable/process` | same | `ChildProcess` and `ChildProcessSpawner` for Git and other non-PTY commands |
| `effect/unstable/cli` | same | The `exsomnis` entrypoint: `Command`, `Flag`, `Argument`, help, completions |
| `effect/unstable/sql` | same | `SqlClient`, `SqlSchema`, `Migrator` for the task database |
| `effect/unstable/reactivity` | same | `Atom`, `AtomRef`, `AtomRegistry`, `AsyncResult` for interface state. No framework binding |
| `effect/unstable/devtools` | same | `DevTools.layer()` behind a config flag during development |
| `effect/unstable/observability` | same | OTLP export of traces and metrics during performance work |
| `@effect/platform-bun` | 4.0.0-rc.112 | `BunServices` layer: file system, path, stdio, terminal, child process spawner. `BunRuntime.runMain` |
| `@effect/sql-sqlite-bun` | 4.0.0-rc.112 | SQLite driver over `bun:sqlite` |
| `@effect/language-service` | 0.87.2 | TypeScript plugin with Effect diagnostics. Every diagnostic set to `error` |
| `@effect/tsgo` | 0.37.0 | Same diagnostics under TypeScript 7. Installed through `"prepare": "effect-tsgo patch"` |
| `oxlint`, `oxfmt`, `oxlint-tsgolint` | 1.80.0, 0.65.0, 7.0.2001 | Lint and formatting, configured as in the reference codebase. TypeScript is 7.0.2 |
| `effect-analyzer` | 2.2.0 | Static analysis of Effect code. Development tool |
| `effect-solutions` | 0.5.3 | Reference docs and helper CLI for Effect patterns. Development tool |

Reserved for the daemon, if it ever exists: `effect/unstable/socket` and `effect/unstable/rpc` over a Unix socket.

Candidates to evaluate when a need appears, all on Effect 4:

| Package | Version | Possible role |
|---|---|---|
| `effect-boxes` | 0.17.0 | Text box layout in Effect. Worth reading for the Files and Diff widgets even though Rust does the final compositing |
| `@parischap/pretty-print` | 1.1.0 | Configurable value printing for debug output and the Activity screen |
| `effect-oxlint` | 0.3.3 | Writing project-specific lint rules in Effect |
| `@mpsuesser/oxlint-plugin-effect` | 0.4.3 | Third-party Effect lint rules, if the language-service diagnostics leave gaps |
| `@effect/opentelemetry` | 4.0.0-rc.112 | Only if the built-in OTLP exporter in `unstable/observability` is not enough |

## The Effect Atom family

Atom lives in the core package in Effect 4. `effect/unstable/reactivity` holds `Atom`, `AtomRef`, `AtomRegistry`, `AsyncResult`, `Reactivity`, and `Hydration`. The framework bindings are separate packages: `@effect/atom-react`, `@effect/atom-vue`, `@effect/atom-solid`, all at `4.0.0-rc.112`. The removed `@effect-atom/atom` and `@effect-atom/atom-react` paths are Effect 3 only.

The core module has no React or DOM dependency. Its only browser references are inside `windowFocusSignal`, `refreshOnWindowFocus`, and `searchParam`, which Exsomnis never calls.

Exsomnis uses the core module without a binding. One application-owned registry is created with `AtomRegistry.make` and provided through `AtomRegistry.layer`. State is declared at module scope with `Atom.make`, per-task and per-screen state with `Atom.family`, actions with `Atom.fn`, and atoms derived from services with `Atom.runtime`. Widgets subscribe through the registry, and `Atom.toStream` feeds the render loop. A footgun carried over from the reference codebase: `registry.set(atom, fn)` stores the function as the value instead of applying it.

## Other Effect sub-packages

On the Effect 4 line at `rc.112`: `@effect/platform-node`, `@effect/sql-pg`, `@effect/sql-pglite`, `@effect/sql-d1`, `@effect/sql-libsql`, `@effect/ai-openai`, `@effect/ai-anthropic`, `@effect/ai-openrouter`, `@effect/openapi-generator`, `@effect/opentelemetry`, `@effect/vitest`. None of these fit a single-process terminal app that calls no model APIs.

Not on Effect 4: `@effect/sql-drizzle`, `@effect/sql-kysely`, `@effect/printer`, `@effect/printer-ansi`, `@effect/typeclass`, `@effect/experimental`, and `@effect/schema` (dead; Schema is in core).

The reference codebase also uses `effect-query`, `effect-tanstack-start`, `effect-playwright`, `@distilled.cloud/aws`, and `drizzle-orm/effect-postgres`. All are web, Postgres, or AWS specific. What transfers from that codebase is the conventions and the lint rules, not the package list.

## Packages considered and left out

| Package | Version | Why not |
|---|---|---|
| `@effect-atom/atom` | 0.7.0 | Peers on Effect 3. Its successor is `effect/unstable/reactivity` in core |
| `@effect-tui/core` | 2.0.1 | Peers on Effect 3, and it renders in TypeScript. Its `CellBuffer` and `Palette` design is a useful reference for the N-API contract |
| `effect-errors` | 1.10.24 | Peers on Effect 3. Core `ErrorReporter` covers error formatting in v4 |
| `effect-log` | 0.36.0 | Peers on Effect 3 and last published in 2024. Core `Logger` is enough |
| `@codeforbreakfast/eslint-effect` | 0.8.5 | ESLint, last published 2025-12. The language-service diagnostics and oxlint cover it |
| `@effect/vitest` | 4.0.0-rc.112 | The project has no automated test suite |
| `vite-plus` | 0.3.0 beta | Its `vp check` would wrap the same oxlint and oxfmt. Undecided; see open questions in `exsomnis-context.md` |

## Conventions

These are the conventions the reference codebase applies, adopted as written.

### Services and layers

Every service is a class-style `Context.Service`, with a namespaced key and a `make` effect, and an explicit static `layer`. No `Effect.Service`, no `.Default`, no generated accessors.

```ts
export class GitService extends Context.Service<GitService>()('@exsomnis/git/GitService', {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return { status, diff, mergeBase }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

When callers must substitute a dependency, also export `layerWithoutDependencies`. Read config inside `make`, never at module top level. Unwrap `Redacted` values only at the point of use.

Compose with `Layer.provideMerge` when one sibling depends on another sibling's output. Reserve `Layer.mergeAll` for independent layers. Use `Layer.unwrap(Effect.gen(...))` when config decides which layer to build. The `layerMergeAllWithDependencies` diagnostic enforces this.

The process starts once, at `bin.ts`, with `BunRuntime.runMain` running a `Command.run` program. `ConfigProvider` is provided as a layer inside one merged `Effect.provide`. Nothing else calls `runSync`, `runPromise`, or `runFork`.

### Errors

Expected failures are `Schema.TaggedError` classes with specific names and fields a handler can act on, such as `{ path, reason }` or `{ command, exitCode }`. Recovery uses `catchTag` and `catchTags`. Generic `Effect.catch` is allowed only at a terminal boundary that handles everything, and `catchCause` only at infrastructure boundaries. `orDie` is never used to remove an inconvenient error from a signature.

Every throwing or Promise API is wrapped exactly once with `Effect.try` or `Effect.tryPromise`, and the caught `unknown` goes through one shared `serializeUnknownError` helper into the error's `message`.

`try` and `catch` do not appear anywhere in the TypeScript code. The reference codebase allows them at React and browser edges; Exsomnis has no such edges.

### Schema

Every domain type, configuration value, persisted row, child process output, and IPC message is declared as a `Schema` and its TypeScript type is derived from it. Decoding runs once at each boundary with `Schema.decodeUnknownEffect`. `Schema.Struct` is the default shape, `Schema.Literals([...])` for enumerations, `Schema.Class` for entities with methods. Configuration uses `Config.schema`. Forward-compatible fields use `Schema.withDecodingDefaultType`. No Zod.

Values crossing the N-API boundary are typed by the generated bindings. Damage notifications arrive many times per frame, so they are not decoded through `Schema` per call. This is the one exception to Schema at every boundary, and it is deliberate.

### Logging and tracing

Log level, format, and global annotations live on the runtime layer: `Logger.layer`, `References.MinimumLogLevel`, `References.CurrentLogAnnotations`. Every meaningful operation is a named `Effect.fn('Service.method')`. I/O edges carry `Effect.withSpan('subsystem.operation', { attributes })` with OpenTelemetry attribute names. Errors are logged with `Effect.annotateLogs` and structured fields. `console.*` is a lint error.

One `TracerLive(serviceName)` layer owns OTLP export and returns `Layer.empty` when no endpoint is configured.

### Enforcement

`@effect/tsgo` runs inside `tsc --noEmit` with all 95 of its diagnostics at `error`, except `missingPipeableSignature` and `missedPipeableOpportunity`, which exist for authors of pipeable Effect libraries and would force overloads onto every exported helper. The important ones for this codebase: `tryCatchInEffectGen`, `asyncFunction`, `newPromise`, `promiseInEffectSuccess`, `runEffectInsideEffect`, `floatingEffect`, `leakingRequirements`, `layerMergeAllWithDependencies`, `strictEffectProvide`, `serviceNotAsClass`, `deterministicKeys` (service keys follow `exsomnis/<file>/<Class>`), `extendsNativeError`, `processEnv`, `nodeBuiltinImport`, `globalConsole`, `strictBooleanExpressions`, `unsafeEffectTypeAssertion`, `preferSchemaOverJson`, `outdatedApi`. An exception is `// @effect-diagnostics <name>:off -- <reason>`; the name carries no `effect/` prefix because the patched `tsc` ignores the prefixed form. `@effect/language-service` (the editor plugin) knows 77 of the 95 names, so the editor may not show every diagnostic the CLI enforces.

oxlint runs type-aware with `typescript/no-explicit-any`, `no-non-null-assertion`, the `no-unsafe-*` family, `no-floating-promises` (no `void` escape), `no-misused-promises`, `switch-exhaustiveness-check`, `strict-boolean-expressions` at its strictest, `no-shadow`, `consistent-type-imports`, `ban-ts-comment`, `no-restricted-imports` (zod, `node:fs`, `node:path`, `node:child_process`), `promise/avoid-new`, `unicorn/no-process-exit`, `import/no-cycle`, and, in `apps/**`, `consistent-type-assertions` set to `never`.

The custom rules in `packages/oxlint-plugins` cover what neither tool sees:

| Rule | What it rejects |
|---|---|
| `effect-syntax/no-try-statement` | Any `try`, `catch`, or `finally`, in every file |
| `effect-syntax/try-promise-only` | `async`, `await`, `new Promise`, `Promise.*`, and `Promise` types outside the function passed directly to `Effect.tryPromise` |
| `effect-style/context-service-contract` | Function-style `Context.Service`, `Effect.Service`, `Effect.Tag`, `Context.Tag`, `accessors`, a service without `make` or a static `layer`, a key that does not end with the class name |
| `effect-style/schema-tagged-errors` | Classes extending `Error` or `Data.TaggedError`, `*Error` classes not extending `Schema.TaggedError`, `throw`, `new Error` |
| `effect-style/no-error-erasure` | `Effect.orDie`, `Effect.orDieWith`, `Effect.catchCause`, and generic `Effect.catch` outside `bin.ts` |
| `effect-style/runtime-boundary` | Every `Effect.run*`; `BunRuntime.runMain` outside `bin.ts` or more than once |
| `effect-style/named-effect-fn` | `Effect.fn` without a `Service.method` string literal; `Effect.fnUntraced` |
| `effect-style/no-module-mutable-state` | Module-level `let` and `var` |
| `effect-boundaries/adapter-error` | `Effect.try` or `Effect.tryPromise` without the object form, or a `catch` that does not call `serializeUnknownError` |
| `architecture/native-core-import` | Importing `@exsomnis/core` anywhere except `apps/exsomnis/src/core-native.ts` |
| `disable-comments/require-description` | Any oxlint, eslint, TypeScript, or Effect suppression without ` -- <reason>` |
| `code-style/no-comments` | Any comment that is not a suppression directive |

The rules resolve imports by name (`import { Effect } from 'effect'`, `import * as Effect from 'effect/Effect'`, `import { fn } from 'effect/Effect'`), so aliasing through a local variable defeats them; `typescript/no-shadow` keeps the name-based resolution honest. JS-plugin rules have no type information, so anything that needs types stays with the tsgo diagnostics. The rules were exercised against fixture files containing one violation per rule before being adopted; the fixtures are not committed because the project keeps no test suite.

## How Effect meets the Rust core

The Rust core is a native library loaded through N-API. On the TypeScript side it is one `Context.Service`, `TerminalHost`, whose layer loads the library once and releases it on scope close. Synchronous native calls are wrapped in `Effect.sync` or `Effect.try` with a tagged error. Damage notifications and PTY exits arrive through `Stream.callback` or a `Queue` fed by the native callback.

Effect's `ChildProcess` module has no pseudo-terminal option. Agent, Shell, and Tests screens spawn through `Bun.Terminal`, wrapped as a scoped Effect resource so the process is killed when the screen's scope closes. Git and other non-interactive commands use `ChildProcess` from `effect/unstable/process`.

## Rules

- Application code is Effect. Workflows are Effect values, dependencies are `Context.Service` classes provided by explicit layers, failures are `Schema.TaggedError` classes, and event streams are `Stream`.
- `async`, `await`, and raw Promises appear only inside `Effect.tryPromise` adapters, one per third-party API.
- No `try` or `catch` anywhere in TypeScript.
- No `console.*`. Use `Effect.log*` with annotations and spans.
- No Zod or other validation library. `Schema` declares every type and decodes every boundary except the per-frame N-API path.
- Interface state lives in `Atom`. Nothing mirrors it in plain variables.
- Before adding an Effect community package, confirm it peers on Effect 4 and was published in the last six months. Record it in this file.
- Before using an `unstable/*` module, read its current source in `node_modules`. Docs and examples for Effect 3 do not apply.
- Follow the `effect-ts-practices` skill where this file is silent, and the reference codebase where the skill is silent.
