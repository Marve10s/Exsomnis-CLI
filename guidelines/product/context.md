# Product context

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

## Product boundaries

Exsomnis is not a coding agent. It does not replace provider CLIs, call model APIs, or normalize conversations across providers.

Exsomnis is not a general terminal emulator. It implements the terminal behavior needed to host its managed screens. It does not compete with Ghostty, iTerm2, Terminal, Kitty, or WezTerm.

Exsomnis is not a replacement for GitHub. It makes local review available during development and keeps the comparison precise. Pull request publishing, collaboration, and remote review stay in existing tools.

## Open questions

The default leader key needs to work across common terminals without colliding with agent and editor shortcuts.

Local review notes may stay private, feed a provider handoff, or become a GitHub-ready review summary.

Session survival across application exits may eventually justify a background daemon. The daily workflow will show whether that complexity is worth it.
