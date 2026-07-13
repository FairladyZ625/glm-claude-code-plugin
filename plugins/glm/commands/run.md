---
description: Delegate a task to a GLM-5.2[1m] Claude subprocess. Defaults to full write access with auto permission mode and Claude Code Bash background mode so completion notifies this conversation.
argument-hint: "[--background|--wait|--detached] [--read-only] <task>"
allowed-tools: Bash(node:*)
---

Delegate this request to GLM Claude.

Raw arguments:

```
$ARGUMENTS
```

Execution modes:

- Default and `--background`: run the companion with `run --wait` using Bash `run_in_background: true`. This keeps the Bash task alive until GLM finishes; when Claude Code sends the task completion notification, read the background output and return GLM's final result.
- `--wait`: run foreground with a long timeout and return stdout.
- `--detached`: run `run --background` foreground. This returns a job id immediately; user can later call `/glm:status` and `/glm:result`.
- Default permissions: full write access with `--permission-mode auto`, `Read`, `Grep`, `Glob`, `Edit`, `Write`, and `Bash`.
- `--read-only`: forward only when the user explicitly wants a constrained read-only pass. It restricts GLM to `Read`, `Grep`, `Glob`, and `Bash(git:*)`.

Do not read files for GLM first. Pass paths and instructions. Preserve the task text, minus execution flags.

Use this command shape, with a single-quoted heredoc so the task remains one argv argument:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" run <mode flags> <optional --read-only> "$(cat <<'__GLM_TASK_EOF__'
<task text>
__GLM_TASK_EOF__
)"
```

For default/background mode, use:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" run --wait <optional --read-only> "$(cat <<'__GLM_TASK_EOF__'
<task text>
__GLM_TASK_EOF__
)"
```

and run that Bash call in background. When notified that the Bash task finished, return the output verbatim enough to include the job id, status, session id, and final GLM result.

If GLM fails, return the companion error text and suggest `/glm:status <job-id>` when a job id exists.
