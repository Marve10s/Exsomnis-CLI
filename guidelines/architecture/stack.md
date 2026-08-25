# Technical stack

Exsomnis is two languages with one boundary between them. Rust owns the byte-heavy work. TypeScript owns the application. The split exists for speed, and the line is drawn so that the TypeScript side stays readable to a TypeScript developer.

## Rust core

A single Rust crate, built as a native library, owns:

- Terminal emulation. Each managed pseudo-terminal feeds a VT parser, a cell grid, an alternate buffer, and scrollback that live in Rust. PTY reads run on Rust threads, so a chatty agent never blocks the interface.
- Compositing. Rust holds the full-screen cell buffer, tracks damaged regions, diffs each frame against the previous one, and writes the smallest ANSI byte sequence that updates the host terminal.
- Syntax highlighting for Files and Diff, and diff parsing for large changes.

The core exposes a small API: create a terminal, write input, resize, read damage, place a region on screen, present a frame. It does not know about tasks, screens, providers, or Git.

## TypeScript application

Bun runs the TypeScript side. Bun 1.4.0 is installed on the development machine; compiling the executable needs 1.4.0 or newer. TypeScript owns tasks, screens, layout, input routing, the leader key, mouse hit-testing, provider adapters, Git commands through the installed binary, SQLite persistence, and the sidebar, navigator, Diff, Files, and Activity widgets. Widgets describe what to draw. Rust draws it.

The TypeScript side is written in Effect 4, pinned to an exact release candidate. Services and layers hold every dependency, `Schema` decodes every boundary, `Stream` carries process output and activity events, and `Atom` from `effect/unstable/reactivity` holds interface state. The command-line entrypoint, Git child processes, SQLite access, and observability all come from the `effect` package and its Bun and SQLite companions. `guidelines/typescript/effect.md` records the packages, versions, and rules.

`Bun.Terminal` is the first choice for spawning pseudo-terminals because it is already in the runtime. If handing its file descriptor to Rust for reading proves awkward, the Rust core spawns the PTY itself.

## The boundary

TypeScript calls Rust through N-API using napi-rs, which Bun supports and which gives typed bindings. `bun:ffi` is the fallback if N-API call overhead shows up in profiling. Large data never crosses the boundary per frame. Rust owns the cell grids and TypeScript only receives damage notifications and sends layout and input.

On the TypeScript side the native library is one Effect service. Its layer loads the library once and releases it when the application scope closes. Native callbacks feed a `Stream`, so damage notifications and process exits look like every other event in the application.

This split is not decided in a document. The first engineering step is a spike that measures it: one Rust terminal receiving a flood of output, composited into a frame with a TypeScript-described sidebar, presented at the terminal's refresh rate, with the binary produced by `bun build --compile`.

The scaffold already proves the packaging half. `bun build --compile` embeds the napi-rs `.node` file through the generated loader, and the resulting single binary runs from any directory and calls into Rust. Bun 1.4.0 or newer is required for that step; 1.3.12 writes a code signature macOS rejects.

## Persistence and Git

SQLite through `bun:sqlite` stores facts that survive a restart: tasks, screen definitions, provider resume references, selected screens, activity history, and settings. Live process handles and terminal buffers stay in memory on the Rust side.

Git operations use the installed Git binary. This keeps repository behavior consistent with the user's credentials, configuration, hooks, and worktrees.

## Alternatives considered

Effect 3 with `@effect-atom/atom` and `@effect-tui/core` was considered. Both peer on Effect 3, and Effect 4 moves reactivity into the core package while Rust replaces the TypeScript renderer. Starting a new project on the version that is months from long-term support beats migrating later.

Pure TypeScript with OpenTUI and `@xterm/headless` was the earlier plan. OpenTUI has a Zig native core, mouse events, and scroll containers, and it would ship faster. It was set aside because a custom Rust core gives control over the two hot paths, VT parsing and frame output, and because the layout here is rigid enough that a general layout engine is not needed. OpenTUI stays the fallback if the Rust core spike fails.

Ink was rejected because it has no mouse support and repaints through a React reconciler that flickers on large diffs and long transcripts.

A full Rust application with ratatui was rejected because the maintainer works in TypeScript and the application logic is where most of the change happens. Rust is confined to the parts where the language choice changes the numbers.

## Process and release shape

The first version runs as one process. It owns the interface, database connection, terminal sessions, and child processes. Closing Exsomnis closes the live sessions.

A background daemon may come later if keeping sessions alive after the interface exits becomes important. The daemon is not part of the first version.

The first release targets macOS because that is the current daily environment. The runtime and terminal boundaries leave room for Linux and Windows later.

Distribution uses compiled Bun executables with the Rust library built per platform. The goal is one installation command and no runtime that users manage separately.

## Open questions

Whether the Rust core builds its VT parser on the `vte` crate or on `alacritty_terminal` is undecided. The spike decides.

The syntax highlighting engine in the Rust core is undecided. tree-sitter and syntect are the candidates.

