# Project instructions

This is the canonical instruction file for coding agents working on Exsomnis CLI. `CLAUDE.md` imports it for Claude Code. It holds the rules that apply to every task; everything else lives under `guidelines/`, and the table below says which file to read for which work. Read only the files that match the task.

## Project status

The workspace is scaffolded, the strict lint and CI policy is in place, and every check passes. The application is a hello world: an Effect 4 `Command.run` entrypoint that loads the Rust core through N-API and logs its version. The next step is the rendering spike described in `guidelines/architecture/stack.md`.

## Guidelines

| Work | Read |
|---|---|
| Product, interface, or screen decisions | `guidelines/product/context.md` |
| Anything touching the wrapped CLIs, PTYs, input, or Git | `guidelines/product/terminal-behavior.md` |
| Architecture, the Rust and TypeScript split, release shape, open technical questions | `guidelines/architecture/stack.md` |
| Finding where something lives, generated versus authored files | `guidelines/architecture/layout.md` |
| Any TypeScript | `guidelines/typescript/code-style.md` and `guidelines/typescript/effect.md` |
| Lint findings, suppressions, adding a lint rule | `guidelines/typescript/lint.md` |
| Any Rust | `guidelines/rust/policy.md` |
| Running, building, or checking the project | `guidelines/workflow/commands.md` |
| Declaring a change done | `guidelines/workflow/verification.md` |
| CI, branch protection, git hygiene | `guidelines/workflow/ci.md` |

`prompt-context.md` at the root, if it exists, is gitignored and holds references to other products and to a private reference codebase. Read it for context. Never copy those names or paths into tracked files.

## Always-on rules

- Exsomnis wraps the agent CLIs installed on the machine. It never calls model provider APIs or holds API keys.
- Preserve each wrapped tool's native behavior instead of reimplementing or normalizing it.
- Keep the application independent of cmux, tmux, Zellij, and terminal-specific tab systems.
- Every action must be reachable by both mouse and keyboard.
- Performance is a product goal. Measure before and after any change on a hot path.
- Keep work focused on the current request. Do not turn a small change into a broad refactor.
- Preserve unrelated changes already present in the working tree.
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

## Git

- Commit messages and pull request bodies carry no tool attribution, session links, or trailers.
- Scan staged content for the private names from `prompt-context.md` before every commit.
- Commit and push only when asked.

## Documentation

- `guidelines/` is the record of lasting decisions. Update the matching file in the same change that alters the behavior it describes.
- Record lasting decisions in documentation instead of code comments.
- Verify commands, paths, API names, and dependency behavior against the current project before documenting them.
- Prose follows the same voice as the existing files: sentence-case headings, plain words, one idea per sentence, no em dashes.
