# Exsomnis CLI context

## The idea

The name is the Latin adjective exsomnis, "sleepless, wakeful, watchful", the word Virgil uses for a sentinel. Exsomnis keeps watch over the agents. The name was chosen on 2026-08-25 after checking that no GitHub repository, npm package, crate, PyPI project, or Homebrew formula used it.

Exsomnis is a terminal workspace for people who run several coding agents and command-line tools during the day. It is one full-screen terminal program that runs inside whatever terminal the user already has open, and it hosts the agent CLIs installed on the machine.

The problem is keeping the work together. Moving among agent apps, terminal windows, and GitHub breaks focus. The local diff is often missing at the moment it is needed, so review moves to GitHub while the work is still local.

Exsomnis wraps the agent CLIs already installed on the machine. It does not call model provider APIs, hold API keys, or run an agent loop of its own. Each CLI keeps its own login, permission prompts, configuration, and update cycle. Exsomnis adds the workspace around them: tasks, screens, diff and file review, and a view of what needs attention.

Performance is a product goal, not a nice-to-have. The interface must stay responsive while several agents stream output at once, and a diff over a large repository must open without a visible pause.

## Interface shape

The interface has three regions.

The optional sidebar on the left changes tasks. A task is a piece of work and its repository or worktree. The sidebar shows each task's active provider, branch, unread activity, and whether a process needs attention.

The center holds the current work. It does not split between several tools. The selected screen gets all the available space.

The navigator on the right changes screens within the current task. The screen types are Agent, Diff, Files, Shell, Tests, and Activity.

Exsomnis draws these regions and screens itself. It does not depend on native terminal tabs or an external multiplexer such as cmux, tmux, or Zellij.

## Tasks and screens

A task owns the context its screens share: the repository, worktree, base branch, linked pull request, provider sessions, and local review state.

Agent screens run an installed agent CLI in a managed pseudo-terminal. The first providers are Codex CLI and Claude Code. Gemini CLI, OpenCode, and any other CLI the user configures come after. More than one provider can work in the same task. Changing providers does not move conversation history between them. The shared context is the filesystem, Git state, task metadata, and an optional handoff summary.

Diff is a first-class screen. It shows working changes, branch changes since the merge-base, or the comparison for a linked pull request. The screen labels which comparison is selected so the user always knows what is under review.

Files browses the task's worktree. It has a tree and a viewer with syntax highlighting. Clicking a file in Diff opens it in the same viewer at the same line. Files is read-only in the first version. Editing stays in the user's editor.

Shell and Tests screens are ordinary terminal sessions. They keep running when another screen is selected.

Activity collects facts from child process exits, test results, provider hooks, and terminal notifications. It shows which tasks finished or need attention. Exsomnis never decides that an agent is waiting for input by parsing its transcript.

## Interaction model

Every action has two paths, mouse and keyboard, and both are always available.

Mouse covers clicking tasks in the sidebar, screens in the navigator, files and hunks in Diff and Files, and the wheel in every scrollable region. Clickable elements show their hotkey next to them so mouse users learn the keyboard path.

Keyboard commands sit behind one configurable leader key. A key sequence after the leader changes tasks, screens, or application state. Any input that is not an application command goes to the active child process unchanged.

Inside an Agent, Shell, or Tests screen the child process owns the mouse when it has asked for mouse reporting. Exsomnis forwards mouse events to it. When the child has not asked, the wheel scrolls that screen's scrollback and a click gives the screen focus.

This boundary matters because coding agents, shells, editors, and test runners have their own shortcuts. The design minimizes interference with them.

The left sidebar can collapse when the current task needs more room. The right navigator stays visible because screen switching is part of the main workflow.

## Technical stack

Exsomnis is two languages with one boundary between them. Rust owns the byte-heavy work. TypeScript owns the application. The split exists for speed, and the line is drawn so that the TypeScript side stays readable to a TypeScript developer.

### Rust core

A single Rust crate, built as a native library, owns:

- Terminal emulation. Each managed pseudo-terminal feeds a VT parser, a cell grid, an alternate buffer, and scrollback that live in Rust. PTY reads run on Rust threads, so a chatty agent never blocks the interface.
- Compositing. Rust holds the full-screen cell buffer, tracks damaged regions, diffs each frame against the previous one, and writes the smallest ANSI byte sequence that updates the host terminal.
- Syntax highlighting for Files and Diff, and diff parsing for large changes.

The core exposes a small API: create a terminal, write input, resize, read damage, place a region on screen, present a frame. It does not know about tasks, screens, providers, or Git.

### TypeScript application

Bun runs the TypeScript side. Bun 1.4.0 is installed on the development machine; compiling the executable needs 1.4.0 or newer. TypeScript owns tasks, screens, layout, input routing, the leader key, mouse hit-testing, provider adapters, Git commands through the installed binary, SQLite persistence, and the sidebar, navigator, Diff, Files, and Activity widgets. Widgets describe what to draw. Rust draws it.

The TypeScript side is written in Effect 4, pinned to an exact release candidate. Services and layers hold every dependency, `Schema` decodes every boundary, `Stream` carries process output and activity events, and `Atom` from `effect/unstable/reactivity` holds interface state. The command-line entrypoint, Git child processes, SQLite access, and observability all come from the `effect` package and its Bun and SQLite companions. `effect-stack.md` records the packages, versions, and rules.

`Bun.Terminal` is the first choice for spawning pseudo-terminals because it is already in the runtime. If handing its file descriptor to Rust for reading proves awkward, the Rust core spawns the PTY itself.

### The boundary

TypeScript calls Rust through N-API using napi-rs, which Bun supports and which gives typed bindings. `bun:ffi` is the fallback if N-API call overhead shows up in profiling. Large data never crosses the boundary per frame. Rust owns the cell grids and TypeScript only receives damage notifications and sends layout and input.

On the TypeScript side the native library is one Effect service. Its layer loads the library once and releases it when the application scope closes. Native callbacks feed a `Stream`, so damage notifications and process exits look like every other event in the application.

This split is not decided in a document. The first engineering step is a spike that measures it: one Rust terminal receiving a flood of output, composited into a frame with a TypeScript-described sidebar, presented at the terminal's refresh rate, with the binary produced by `bun build --compile`.

The scaffold already proves the packaging half. `bun build --compile` embeds the napi-rs `.node` file through the generated loader, and the resulting single binary runs from any directory and calls into Rust. Bun 1.4.0 or newer is required for that step; 1.3.12 writes a code signature macOS rejects.

### Persistence and Git

SQLite through `bun:sqlite` stores facts that survive a restart: tasks, screen definitions, provider resume references, selected screens, activity history, and settings. Live process handles and terminal buffers stay in memory on the Rust side.

Git operations use the installed Git binary. This keeps repository behavior consistent with the user's credentials, configuration, hooks, and worktrees.

### Alternatives considered

Effect 3 with `@effect-atom/atom` and `@effect-tui/core` was considered. Both peer on Effect 3, and Effect 4 moves reactivity into the core package while Rust replaces the TypeScript renderer. Starting a new project on the version that is months from long-term support beats migrating later.

Pure TypeScript with OpenTUI and `@xterm/headless` was the earlier plan. OpenTUI has a Zig native core, mouse events, and scroll containers, and it would ship faster. It was set aside because a custom Rust core gives control over the two hot paths, VT parsing and frame output, and because the layout here is rigid enough that a general layout engine is not needed. OpenTUI stays the fallback if the Rust core spike fails.

Ink was rejected because it has no mouse support and repaints through a React reconciler that flickers on large diffs and long transcripts.

A full Rust application with ratatui was rejected because the maintainer works in TypeScript and the application logic is where most of the change happens. Rust is confined to the parts where the language choice changes the numbers.

## Process and release shape

The first version runs as one process. It owns the interface, database connection, terminal sessions, and child processes. Closing Exsomnis closes the live sessions.

A background daemon may come later if keeping sessions alive after the interface exits becomes important. The daemon is not part of the first version.

The first release targets macOS because that is the current daily environment. The runtime and terminal boundaries leave room for Linux and Windows later.

Distribution uses compiled Bun executables with the Rust library built per platform. The goal is one installation command and no runtime that users manage separately.

CI runs on every pull request and push to `main`: formatting, type-aware lint, typecheck with every Effect diagnostic, knip, clippy with warnings denied, cargo-deny, cargo-machete, `bun audit`, a check that the committed napi bindings match a fresh build, and a compile-and-run smoke test on a macOS 15 arm64 runner. Every action is pinned to a commit SHA and the workflow token is read-only.

## Product boundaries

Exsomnis is not a coding agent. It does not replace provider CLIs, call model APIs, or normalize conversations across providers.

Exsomnis is not a general terminal emulator. It implements the terminal behavior needed to host its managed screens. It does not compete with Ghostty, iTerm2, Terminal, Kitty, or WezTerm.

Exsomnis is not a replacement for GitHub. It makes local review available during development and keeps the comparison precise. Pull request publishing, collaboration, and remote review stay in existing tools.

## Open questions

The default leader key needs to work across common terminals without colliding with agent and editor shortcuts.

Whether the Rust core builds its VT parser on the `vte` crate or on `alacritty_terminal` is undecided. The spike decides.

The syntax highlighting engine in the Rust core is undecided. tree-sitter and syntect are the candidates.

Whether Vite+ (`vp check`, `vp run`) fronts the oxlint, oxfmt, and typecheck commands or Bun scripts call them directly is undecided. Vite+ is a 0.3 beta that forwards package commands to Bun but does not manage Bun as a runtime.

Local review notes may stay private, feed a provider handoff, or become a GitHub-ready review summary.

Session survival across application exits may eventually justify a background daemon. The daily workflow will show whether that complexity is worth it.
