# Technical stack

Exsomnis is two languages with one boundary between them. Rust owns the byte-heavy work. TypeScript owns the application. The split exists for speed, and the line is drawn so that the TypeScript side stays readable to a TypeScript developer.

## Rust core

A single Rust crate, built as a native library, owns:

- Compositing. Rust holds the full-screen cell buffer, tracks damaged rows, diffs each frame against the previous one, and writes the smallest ANSI byte sequence that updates the host terminal.
- Diff parsing for the Diff screen, and later syntax highlighting for Files and Diff.
- Terminal emulation, later. Each managed pseudo-terminal will feed a VT parser, a cell grid, an alternate buffer, and scrollback that live in Rust, with PTY reads on Rust threads so a chatty process never blocks the interface.

The first release drives Codex and Claude Code over their protocols, so it has no pseudo-terminal and no VT parser. The core is the compositor only. Terminal emulation is added when the first PTY screen (Shell, Tests, or a CLI without a protocol) needs it, and the `vte` crate is the candidate because it needs two dependencies where `alacritty_terminal` pulls a graph that collides with the one-version-per-crate policy.

The compositor is one `Screen` class: create with a size, resize, set capabilities, `present`, read frame statistics, shut down. `present` takes the whole frame as one batch: an `Int32Array` of fixed eight-word draw operations (`opcode, x, y, a, b, fg, bg, attrs`) and a `Uint8Array` of UTF-8 text the text runs point into, both borrowed for the duration of the call and reused across frames. Rust draws into a back grid, diffs the dirty rows against the front grid, emits cursor moves only when cheaper than spaces, emits SGR only on style change, wraps the frame in synchronized output when the terminal supports it, and writes once. Colours are stored as true colour and downgraded at emit time. Wide graphemes occupy a lead cell and a continuation cell that is never emitted; `unicode-width` and `unicode-segmentation` are the only crates added for this. The core does not know about threads, screens, providers, or Git.

Why the batch exists: an N-API call from Bun into the addon costs about 40 nanoseconds on the development machine, so per-call overhead is not the constraint. One call per frame makes the frame atomic, keeps one owner for the operation list, and is the same shape a future PTY-backed region uses, where a single extra opcode copies a rectangle from a Rust-owned emulator grid without any cell crossing the boundary.

## TypeScript application

Bun runs the TypeScript side. Bun 1.4.0 is installed on the development machine; compiling the executable needs 1.4.0 or newer. TypeScript owns projects, threads, screens, layout, input decoding and routing, the leader key, mouse hit-testing, provider clients, Git commands through the installed binary, SQLite persistence, and the sidebar, navigator, chat, Diff, Files, and Activity widgets. Widgets describe what to draw. Rust draws it.

TypeScript also owns the host terminal: raw mode, the alternate screen, bracketed paste, focus events, mouse reporting (modes 1000, 1002, 1006), the kitty keyboard protocol behind a capability handshake that ends with a primary device attributes query, and the teardown that restores all of it from an Effect scope finalizer and from the signal and uncaught-error paths through one idempotent restore. Host terminal access goes through the `process` globals (`process.stdin.setRawMode`, `process.stdout.columns`, `process.on('SIGWINCH')`), which are Bun's own implementations; nothing under the `node:` prefix is imported, and `Bun.Terminal` is the child side of a pseudo-terminal, not a handle on the host. Effect's `Terminal` service stays off the render path because it wraps readline with a 50 millisecond escape timeout and a 10 millisecond raw-mode lease. The Effect logger writes to stderr so log lines never land inside a frame.

Input decoding is a byte state machine in TypeScript with a carry buffer for sequences split across reads. It produces objects shaped like `KeyboardEvent` (`key`, `code`, four modifier booleans) so the pure matching functions of `@tanstack/hotkeys` (`parseHotkey`, `matchesKeyboardEvent`, `createSequenceMatcher`, `formatForDisplay`) apply unchanged, plus mouse events with zero-based cell coordinates. The platform is passed explicitly and `Mod` never appears in a hotkey, because no terminal reports the Command key. Column widths in layout come from `Bun.stringWidth`; the rendering spike compares it with the Rust crate and the terminal on hard graphemes, and if the two tables disagree Rust exposes its width function and TypeScript uses that.

The TypeScript side is written in Effect 4, pinned to an exact release candidate. Services and layers hold every dependency, `Schema` decodes every boundary, `Stream` carries process output and activity events, and `Atom` from `effect/unstable/reactivity` holds interface state. The command-line entrypoint, Git child processes, SQLite access, and observability all come from the `effect` package and its Bun and SQLite companions. `guidelines/typescript/effect.md` records the packages, versions, and rules.

Codex runs as a `codex app-server` child per open thread, spoken to over JSON-RPC on stdio: one JSON object per line, numeric ids, typed `Deferred` per request with a timeout, server-to-client approval requests answered by the interface, notifications as a `Stream`. Claude Code runs through `@anthropic-ai/claude-agent-sdk` with `pathToClaudeCodeExecutable` pointing at the user's `claude`, one streaming query per thread fed by an Effect queue. Both sit behind the `ProviderDriver` contract in `apps/exsomnis/src/providers/provider.ts`. They are TypeScript because they move tens of small messages per second, and a Rust client would add a second typed boundary in front of widgets that are TypeScript anyway.

`Bun.Terminal` is the first choice for spawning pseudo-terminals when PTY screens arrive because it is already in the runtime. If handing its file descriptor to Rust for reading proves awkward, the Rust core spawns the PTY itself.

## The boundary

TypeScript calls Rust through N-API using napi-rs, which Bun supports and which gives typed bindings. `bun:ffi` is the fallback if N-API call overhead shows up in profiling. Large data never crosses the boundary per frame. Rust owns the cell grids and TypeScript only receives damage notifications and sends layout and input.

On the TypeScript side the native library is one Effect service. Its layer loads the library once and releases it when the application scope closes. Native callbacks feed a `Stream`, so damage notifications and process exits look like every other event in the application.

This split is not decided in a document. The rendering milestone measures it: three synthetic threads streaming a token every 8 milliseconds into a TypeScript-described three-column screen, composited by the Rust `Screen`, presented at the terminal's refresh rate, with the binary produced by `bun build --compile`. The numbers that gate it: frame build, diff, and emit time under 2 milliseconds against a 16.7 millisecond budget, input-to-write latency under 5 milliseconds, and fewer than 20 bytes written per changed cell. Rust keeps a 240-frame ring buffer of those timings behind `takeStats()`; nothing is logged per frame. The measured values are recorded here when the milestone lands.

The scaffold already proves the packaging half. `bun build --compile` embeds the napi-rs `.node` file through the generated loader, and the resulting single binary runs from any directory and calls into Rust. Bun 1.4.0 or newer is required for that step; 1.3.12 writes a code signature macOS rejects.

## Persistence and Git

SQLite through `@effect/sql-sqlite-bun` stores projects, threads, turns, timeline items, pending requests, provider resume references, model cache entries, and settings. Startup reconciliation marks active turns as interrupted and pending requests as stale because live provider sessions do not survive a process exit. Live process handles and terminal buffers stay in memory.

Git operations use the installed Git binary through Effect's child process service. Each thread gets a worktree from the remote default branch, with the current branch as the fallback when the remote has no default branch reference. Thread deletion and forced worktree removal remain separate operations so the interface can show tracked and untracked change counts before removal.

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

Whether the Rust core builds its later VT parser on the `vte` crate or on `alacritty_terminal` is undecided, with `vte` favoured for its dependency footprint. The first PTY screen decides.

Whether `Bun.stringWidth` and `unicode-width` agree on hard graphemes is unmeasured. The rendering milestone's calibration step decides which side owns the width table.

The syntax highlighting engine in the Rust core is undecided. tree-sitter and syntect are the candidates.
