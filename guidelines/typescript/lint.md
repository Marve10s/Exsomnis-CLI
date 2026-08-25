# Lint and diagnostics

Three layers enforce the TypeScript rules: the Effect diagnostics inside `tsc`, oxlint's built-in rules, and the custom rules in `packages/oxlint-plugins`. All three run in `bun run check` and in CI.

## Effect diagnostics

`@effect/tsgo` runs inside `tsc --noEmit` with all 95 of its diagnostics at `error`, except `missingPipeableSignature` and `missedPipeableOpportunity`, which exist for authors of pipeable Effect libraries and would force overloads onto every exported helper. The important ones for this codebase: `tryCatchInEffectGen`, `asyncFunction`, `newPromise`, `promiseInEffectSuccess`, `runEffectInsideEffect`, `floatingEffect`, `leakingRequirements`, `layerMergeAllWithDependencies`, `strictEffectProvide`, `serviceNotAsClass`, `deterministicKeys` (service keys follow `exsomnis/<file>/<Class>`), `extendsNativeError`, `processEnv`, `nodeBuiltinImport`, `globalConsole`, `strictBooleanExpressions`, `unsafeEffectTypeAssertion`, `preferSchemaOverJson`, `outdatedApi`. An exception is `// @effect-diagnostics <name>:off -- <reason>`; the name carries no `effect/` prefix because the patched `tsc` ignores the prefixed form. `@effect/language-service` (the editor plugin) knows 77 of the 95 names, so the editor may not show every diagnostic the CLI enforces.

## oxlint built-ins

oxlint runs type-aware with `typescript/no-explicit-any`, `no-non-null-assertion`, the `no-unsafe-*` family, `no-floating-promises` (no `void` escape), `no-misused-promises`, `switch-exhaustiveness-check`, `strict-boolean-expressions` at its strictest, `no-shadow`, `consistent-type-imports`, `ban-ts-comment`, `no-restricted-imports` (zod, `node:fs`, `node:path`, `node:child_process`), `promise/avoid-new`, `unicorn/no-process-exit`, `import/no-cycle`, and, in `apps/**`, `consistent-type-assertions` set to `never`.

## Custom rules

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

## Suppressions

- Effect diagnostic: `// @effect-diagnostics <name>:off -- <reason>`, placed above the statement. The name carries no `effect/` prefix; the patched `tsc` ignores the prefixed form. A `-next-line` variant exists but the formatter may move the comment away from the line, so prefer the statement-level form.
- oxlint rule: `// oxlint-disable-next-line <rule> -- <reason>`.
- TypeScript: `// @ts-expect-error -- <reason>` with at least ten characters of reason. `@ts-ignore` and `@ts-nocheck` are banned.
- Every suppression without a reason fails lint, every unused suppression fails lint, and any other comment fails lint.

## Adding a rule

Write the rule in `packages/oxlint-plugins/src/<plugin>.ts` against the `TSESLint.RuleModule` type, resolve imports through `lib/ast.ts`, and register it in `oxlint.config.ts` under `rules` (every file) or the `apps/**` override (application code only). Before adopting it, run oxlint against a temporary fixture file that contains one violation per rule and one clean example, confirm the rule id appears once and the clean file is silent, and delete the fixture. Two runtime facts about oxlint's plugin host: `Program.parent` is `null`, not `undefined`, and relative imports need the `.ts` extension.
