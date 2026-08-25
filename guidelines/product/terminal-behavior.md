# Terminal and provider behavior

These rules protect the wrapped CLIs. Exsomnis hosts them; it does not reinterpret them.

- Send ordinary input to the active child process unchanged. Application shortcuts must stay behind the configured leader key.
- Forward mouse events to a child process that has enabled mouse reporting. Otherwise the wheel scrolls that screen and a click focuses it.
- Treat terminal output as terminal data. Do not infer provider state by parsing generic transcripts.
- Keep provider-specific behavior at provider boundaries. Shared task state belongs to the filesystem, Git, and explicit application metadata.
- Keep diff modes explicit so the user can tell whether they are viewing working changes, branch changes, or a pull request comparison.
- Use the installed Git binary so local configuration, credentials, hooks, and worktrees behave normally.

## Structured providers

Codex CLI and Claude Code are driven over their protocols, not a pseudo-terminal. These rules keep that boundary honest.

- Decode every message from a provider with `Schema` at the adapter. A message that fails to decode is logged as a diagnostic with the raw method name; it is never dropped silently and never crashes the session.
- Send every configuration field on both start and resume: working directory, model, reasoning effort, approval settings, and for Codex the reviewer and sandbox. Omitted fields keep their previous value on the provider side, which is how a resumed thread ends up with settings the user did not choose.
- Store the provider's own conversation identifier on the thread as the resume reference. Exsomnis never uses it as a primary key. When a resume fails because the provider no longer has the conversation, tell the user and offer a fresh thread; never replace the reference silently.
- The native command list comes from the protocol. Claude Code: `supportedCommands()` minus the names in the init message's `terminal_slash_commands`, executed by sending the command text as a user message. Codex: only the TUI commands with an RPC equivalent, executed through that RPC. The Codex table is `/compact` (`thread/compact/start`), `/review` (`review/start`), `/skills` (`skills/list`, then `$name` in the composer), `/status` (`thread/read` plus the last token usage), `/usage` (`account/usage/read`, `account/rateLimits/read`), `/rename` (`thread/name/set`). `/model`, `/permissions`, `/new`, and `/clear` have Exsomnis equivalents. TUI-only commands such as `/diff` and `/theme` are not shown.
- `/approvals` exposes each provider's own values, verbatim. Codex: approval policy `untrusted`, `on-request`, `never` and sandbox `read-only`, `workspace-write`, `danger-full-access`. Claude Code: `default`, `acceptEdits`, `plan`, `bypassPermissions`, `dontAsk`, `auto`. Exsomnis has no permission model of its own.
- Approval prompts are answered with the four decisions both providers share: accept, accept for session, decline, cancel. Cancel also interrupts the turn. An "accept for session" answer to Claude Code returns only session-scoped permission suggestions.
- A pending approval can only be answered by the session that raised it. After a restart it is shown as stale, and the user is offered interrupt or restart.
- The `result` message ends a Claude Code turn, and `turn/completed` ends a Codex turn. Process or query exit is a failure path, not the normal end of a turn.
- The Claude Agent SDK bundles a protocol matched to its own Claude Code version. Exsomnis pins the SDK to the installed CLI's minor version, passes `pathToClaudeCodeExecutable` so the user's own binary runs, and warns at startup when the two drift.
