# Effect

Exsomnis's TypeScript side is written in Effect end to end. This document records the Effect version, the packages in use, the conventions carried over from the reference codebase, and the rules that follow. Enforcement lives in `guidelines/typescript/lint.md`. Versions were checked against the npm registry on 2026-08-25.

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
| `@effect/sql-sqlite-bun` | 4.0.0-rc.112 | SQLite driver over `bun:sqlite`. Added with the persistence layer |
| `@anthropic-ai/claude-agent-sdk` | 0.3.245 | Claude Code adapter. Pinned to the installed Claude Code minor version and pointed at the user's `claude` binary; its peers (zod, the Anthropic and MCP SDKs) are never imported by Exsomnis code. Added with the adapter |
| `@tanstack/hotkeys` | 0.8.0 | Hotkey parsing, matching, leader sequences, and display labels. Only its pure functions are used; `HotkeyManager` needs a DOM. Added with the input layer |
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

Exsomnis uses the core module without a binding. One application-owned registry is provided through `AtomRegistry.layer` in `bin.ts`. State is declared at module scope in `apps/exsomnis/src/state/atoms.ts` with `Atom.make`, per-thread and per-provider state with `Atom.family`, actions with `Atom.fn`, and atoms derived from services with `Atom.runtime`. The orchestrator writes atoms; widgets and the input router only read them. Widgets subscribe through the registry, and `Atom.toStream` feeds the render loop. Two footguns. `registry.set(atom, fn)` stores the function as the value instead of applying it. `registry.subscribe` on a computed atom does not evaluate it, so its dependency edges are never recorded and writes to its sources never notify the subscriber; read the atom once with `registry.get` after subscribing. The registry also drops the value of an atom nobody subscribes to, so per-thread and per-provider families are declared with `Atom.keepAlive` and the interface mounts every atom it reads for the life of the application scope.

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

## Conventions

These are the conventions the reference codebase applies, adopted as written.

### Services and layers

Every service is a class-style `Context.Service`, with a namespaced key and a `make` effect, and an explicit static `layer`. No `Effect.Service`, no `.Default`, no generated accessors.

```ts
export class GitService extends Context.Service<GitService>()('exsomnis/git/GitService', {
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

## How Effect meets the Rust core

The Rust core is a native library loaded through N-API. On the TypeScript side it is one `Context.Service`, `CoreNative`, whose layer loads the library once and releases it on scope close. Synchronous native calls are wrapped in `Effect.sync` or `Effect.try` with a tagged error. Later, damage notifications and PTY exits arrive through `Stream.callback` or a `Queue` fed by the native callback.

The host terminal is read and configured through the `process` globals, never through Effect's `Terminal` service, whose readline-based input path does not understand mouse or kitty sequences. The logger layer routes to stderr because Rust writes frames to stdout.

Codex runs through `ChildProcess` from `effect/unstable/process` with stdio pipes; Claude Code runs through the Agent SDK's `query`, wrapped in exactly one `Effect.tryPromise` adapter per SDK call. Effect's `ChildProcess` module has no pseudo-terminal option, so the later Shell and Tests screens spawn through `Bun.Terminal`, wrapped as a scoped Effect resource so the process is killed when the screen's scope closes. Git and other non-interactive commands use `ChildProcess`.

## Rules

- Application code is Effect. Workflows are Effect values, dependencies are `Context.Service` classes provided by explicit layers, failures are `Schema.TaggedError` classes, and event streams are `Stream`.
- `async`, `await`, and raw Promises appear only inside `Effect.tryPromise` adapters, one per third-party API.
- No `try` or `catch` anywhere in TypeScript.
- No `console.*`. Use `Effect.log*` with annotations and spans.
- No Zod or other validation library. `Schema` declares every type and decodes every boundary except the per-frame N-API path.
- Interface state lives in `Atom`. Nothing mirrors it in plain variables.
- Before adding an Effect community package, confirm it peers on Effect 4 and was published in the last six months. Record it in this file.
- Service keys follow the `deterministicKeys` diagnostic: `exsomnis/<path under src without .ts>/<ClassName>`, for example `exsomnis/core-native/CoreNative` and `exsomnis/providers/registry/ProviderRegistry`.
- Tagged errors are constructed with `.make(...)`, and finite numbers are declared with `Schema.Finite`; the `newSchemaClass` and `schemaNumber` diagnostics enforce both. Unions of structs that carry a `_tag` use `Schema.TaggedStruct`.
- All TypeScript application code is written with Effect 4, pinned to the exact release candidate in `package.json` and forced to one copy through `overrides`. Bumps are deliberate commits.
- Every meaningful operation is a named `Effect.fn('Service.method')`; I/O edges carry `Effect.withSpan`. Log configuration lives on the runtime layer.
- The process runs once, at `bin.ts`, through `BunRuntime.runMain`. No `runSync`, `runPromise`, or `runFork` anywhere else.
- Prefer a module from `effect` or a package listed above over a hand-written replacement.
- Before using an `unstable/*` module, read its current source in `node_modules`. Docs and examples for Effect 3 do not apply.
- Follow the `effect-ts-practices` skill where this file is silent, and the reference codebase where the skill is silent.
