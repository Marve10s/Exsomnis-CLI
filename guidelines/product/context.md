# Product context

## The idea

The name is the Latin adjective exsomnis, "sleepless, wakeful, watchful", the word Virgil uses for a sentinel. Exsomnis keeps watch over the agents. The name was chosen on 2026-08-25 after checking that no GitHub repository, npm package, crate, PyPI project, or Homebrew formula used it.

Exsomnis is a terminal workspace for people who run several coding agents and command-line tools during the day. It is one full-screen terminal program that runs inside whatever terminal the user already has open, and it hosts the agent CLIs installed on the machine.

The problem is keeping the work together. Moving among agent apps, terminal windows, and GitHub breaks focus. The local diff is often missing at the moment it is needed, so review moves to GitHub while the work is still local.

Exsomnis wraps the agent CLIs already installed on the machine. It does not call model provider APIs, hold API keys, or run an agent loop of its own. Each CLI keeps its own login, permission prompts, configuration, and update cycle. Exsomnis adds the workspace around them: tasks, screens, diff and file review, and a view of what needs attention.

Performance is a product goal, not a nice-to-have. The interface must stay responsive while several agents stream output at once, and a diff over a large repository must open without a visible pause.

## Interface shape

The interface has three regions.

The optional sidebar on the left lists projects and their threads. A project is a repository the user has opened Exsomnis in. A thread is one conversation with one provider, in its own Git worktree of that repository. The sidebar shows each thread's provider, branch, and whether it needs attention.

The center holds the current work. It does not split between several tools. The selected screen gets all the available space.

The navigator on the right changes screens within the current thread. The first release has two screens, Agent (labelled "chat" on screen) and Diff. Files, Shell, Tests, and Activity come after it.

Exsomnis draws these regions and screens itself. It does not depend on native terminal tabs or an external multiplexer such as cmux, tmux, or Zellij.

## Projects, threads, and screens

A thread owns the context its screens share: the worktree, its branch and base commit, the provider session and its resume reference, the transcript, and local review state. Creating a thread creates the worktree on a temporary branch named `exsomnis/<short id>`; the thread starts before any nicer name exists. Deleting a thread and removing its worktree are separate actions, and removal states whether tracked or untracked changes would be lost before it asks.

Agent screens for the first providers, Codex CLI and Claude Code, talk to the installed CLI over its structured protocol: `codex app-server` over JSON-RPC on stdio, and the Claude Agent SDK pointed at the `claude` binary on the user's PATH. Exsomnis renders the transcript and the composer itself. Typing `/` shows four Exsomnis commands (`/model`, `/provider`, `/approvals`, `/help`) followed by the provider's own commands as the protocol reports them, and only the ones the protocol can run. A provider command is greyed out while the thread has a turn in flight, because the wrapped CLI would take it as plain text instead of running it. Approval prompts render inline and are answered with the provider's own decision values. The CLI keeps its login, settings, hooks, MCP servers, and permission rules. Gemini CLI, OpenCode, and CLIs without a protocol run in a managed pseudo-terminal, which comes after the first release.

A thread has one provider in the first release. Changing the provider for new threads does not move conversation history. The shared context between threads is the filesystem, Git state, and project metadata.

Diff is a first-class screen. The first release shows "working tree vs HEAD" in a two-pane view. The left pane lists tracked and untracked files with their status and added and removed line counts. The right pane shows the selected file's unified diff with old and new line numbers. The file list and hunk view scroll independently. Long lines end with a truncation marker instead of scrolling horizontally.

Opening Diff refreshes it once. Provider file changes and turn finalization refresh the selected thread while Diff is open, and `r` refreshes on demand. The screen does not poll Git, and changes in an unselected thread do not run a refresh. A repository without a commit shows its staged and untracked files instead of failing on the missing `HEAD`.

Branch changes since the merge-base and the comparison for a linked pull request come after the working-tree view. Each mode will keep an explicit comparison label so the user always knows what is under review.

Files browses the task's worktree. It has a tree and a viewer with syntax highlighting. Clicking a file in Diff opens it in the same viewer at the same line. Files is read-only in the first version. Editing stays in the user's editor.

Shell and Tests screens are ordinary terminal sessions. They keep running when another screen is selected.

Activity collects facts from child process exits, test results, provider hooks, and terminal notifications. It shows which tasks finished or need attention. Exsomnis never decides that an agent is waiting for input by parsing its transcript.

## Interaction model

Every action has two paths, mouse and keyboard, and both are always available.

Mouse covers clicking tasks in the sidebar, screens in the navigator, files and hunks in Diff and Files, and the wheel in every scrollable region. Clickable elements show their hotkey next to them so mouse users learn the keyboard path.

Keyboard commands sit behind one configurable leader key, `Ctrl+G` by default. A key sequence after the leader changes threads, screens, or application state. Any input that is not an application command goes to the composer or the active child process unchanged.

The first release binds `Ctrl+G` with `j` and `k` to move between threads, `n` to create one, `b` to collapse the sidebar, `c` and `d` to switch between the chat and diff screens, `?` to list every binding, and `q` to quit. `PageUp`, `PageDown`, `Home`, and `End` scroll the transcript, which follows the tail until the reader scrolls away from it. In the composer, `Enter` sends, `Alt+Enter` inserts a newline, `Shift+Enter` does the same where the terminal reports it, and `Esc` interrupts the running turn.

The provider chosen with `/provider` applies to threads created in the same session. It is not written to the database yet, so a relaunch starts from Codex again.

Inside an Agent, Shell, or Tests screen the child process owns the mouse when it has asked for mouse reporting. Exsomnis forwards mouse events to it. When the child has not asked, the wheel scrolls that screen's scrollback and a click gives the screen focus.

This boundary matters because coding agents, shells, editors, and test runners have their own shortcuts. The design minimizes interference with them.

The left sidebar can collapse when the current thread needs more room. The right navigator stays visible because screen switching is part of the main workflow.

## Product boundaries

Exsomnis is not a coding agent. It does not replace provider CLIs, call model APIs, or normalize conversations across providers.

Exsomnis is not a general terminal emulator. It implements the terminal behavior needed to host its managed screens. It does not compete with Ghostty, iTerm2, Terminal, Kitty, or WezTerm.

Exsomnis is not a replacement for GitHub. It makes local review available during development and keeps the comparison precise. Pull request publishing, collaboration, and remote review stay in existing tools.

## Open questions

The default leader key, `Ctrl+G`, must be confirmed in Terminal.app, Ghostty, and iTerm2 before the first release; the fallback is another control key that no wrapped CLI binds.

Local review notes may stay private, feed a provider handoff, or become a GitHub-ready review summary.

Session survival across application exits may eventually justify a background daemon. The daily workflow will show whether that complexity is worth it.
