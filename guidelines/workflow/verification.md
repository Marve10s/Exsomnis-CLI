# Verification

- Do not add regression tests or automated test suites.
- Test changes manually through the real CLI and the complete user flow affected by the change.
- Exercise actual terminal behavior through a real pseudo-terminal. Verify input, output, screen switching, resizing, mouse input, process exit, and attention states when they are relevant.
- Use the real provider CLI when provider behavior is part of the change. If credentials or the local environment prevent this, state the exact limitation.
- Lint, typecheck, and build checks may detect collateral problems, but they do not replace manual CLI verification.
- Before declaring a change complete, state which user flows were exercised and what happened.
- Lint rules are verified the same way: a temporary fixture with one violation per rule, run through the real `oxlint.config.ts`, then deleted. See `guidelines/typescript/lint.md`.
- When a tool prints a summary and an exit code, trust the exit code. `cargo machete` prints `Done!` after listing failures.
