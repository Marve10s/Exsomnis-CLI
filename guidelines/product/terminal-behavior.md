# Terminal and provider behavior

These rules protect the wrapped CLIs. Exsomnis hosts them; it does not reinterpret them.

- Send ordinary input to the active child process unchanged. Application shortcuts must stay behind the configured leader key.
- Forward mouse events to a child process that has enabled mouse reporting. Otherwise the wheel scrolls that screen and a click focuses it.
- Treat terminal output as terminal data. Do not infer provider state by parsing generic transcripts.
- Keep provider-specific behavior at provider boundaries. Shared task state belongs to the filesystem, Git, and explicit application metadata.
- Keep diff modes explicit so the user can tell whether they are viewing working changes, branch changes, or a pull request comparison.
- Use the installed Git binary so local configuration, credentials, hooks, and worktrees behave normally.
