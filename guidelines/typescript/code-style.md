# TypeScript code style

- Use strict TypeScript.
- Never use `any`, including casts, generic defaults, or temporary escape hatches. Keep untrusted values as `unknown` until they are narrowed.
- Prefer inferred types. Do not add annotations the compiler can infer.
- Use clear names, focused modules, explicit control flow, and useful types.
- Do not write comments in code. Express intent through names, types, structure, and durable documentation outside the code.
- Bun is the runtime, package manager, and script runner. Use `bun install`, `bun run`, `bunx`, and Bun APIs unless the project explicitly requires another tool.
- Lint with type-aware oxlint and format with oxfmt; `guidelines/typescript/lint.md` lists every rule and the suppression syntax. Keep `@effect/language-service` enabled in `tsconfig.json` and `@effect/tsgo` installed through `prepare`.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on: an absent optional field and a present `undefined` are different things, and every indexed read may be `undefined`.
- Relative imports carry the `.ts` extension. Node's ESM loader, which oxlint uses to load the lint plugins, requires it, and `allowImportingTsExtensions` is on.
