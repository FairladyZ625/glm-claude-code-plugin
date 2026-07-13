# GLM Claude Code Plugin

Claude Code plugin for delegating work to a separate Claude subprocess backed by `GLM-5.2[1m]`.

It follows the same basic shape as delegation plugins such as OpenAI Codex for Claude Code:

- `/glm:run` starts a GLM-backed Claude subprocess.
- `/glm:status` shows running and recent jobs.
- `/glm:result` prints stored final output.
- `/glm:cancel` cancels a running job.
- `/glm:setup` checks local runtime and GLM environment.

## Requirements

- Claude Code CLI available as `claude`
- Node.js
- GLM Anthropic-compatible environment in `~/.zshenv` or the current shell. `~/.zshenv` is recommended because non-interactive zsh reads it automatically:

```sh
export ANTHROPIC_GLM_BASE_URL="https://open.bigmodel.cn/api/anthropic"
export ANTHROPIC_GLM_AUTH_TOKEN="..."
# or token fallback:
export GLM_API_KEY="..."
```

The plugin maps those variables to `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` only for the child Claude process.

If your normal shell also has `ANTHROPIC_API_KEY`, the plugin replaces it for the child process with the GLM token. The child `claude` is launched with `--bare` so it does not read Claude.ai OAuth/keychain credentials.

## Install Locally

From Claude Code:

```text
/plugin marketplace add /Users/lizeyu/Projects/glm-claude-code-plugin
/plugin install glm@glm-claude
/reload-plugins
```

For development without installing:

```sh
claude --plugin-dir /Users/lizeyu/Projects/glm-claude-code-plugin/plugins/glm
```

## Usage

```text
/glm:setup
/glm:run inspect src/foo.ts and explain the bug
/glm:run fix src/foo.ts and run the relevant test
/glm:run --read-only inspect src/foo.ts without modifying files
/glm:status
/glm:result <job-id>
/glm:cancel <job-id>
```

`/glm:run` defaults to Claude Code Bash background mode. The Bash task stays alive until GLM finishes, so Claude Code can notify the conversation when the delegated work completes.

`/glm:run` also defaults to full write access: the child Claude process runs with `--permission-mode auto` and the `Read`, `Grep`, `Glob`, `Edit`, `Write`, and `Bash` tools. Use `--read-only` when you want to restrict a task to `Read`, `Grep`, `Glob`, and `Bash(git:*)`.

`/glm:setup` prints the resolved token source plus a redacted tail and short sha256 fingerprint. Use it to diagnose 401s without exposing secrets:

```text
resolved token source: zshrc:ANTHROPIC_GLM_AUTH_TOKEN (set tail=xxxxxx sha256=...)
```

## OAuth Safety

The plugin does not log out Claude.ai, delete keychain items, or modify global auth state. GLM auth is injected only into the child `claude` process created for a `/glm:run` job.

If official Claude Code looks logged out after using provider-specific API keys, check whether your shell has global Anthropic env vars set:

```sh
env | grep '^ANTHROPIC_'
```

`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_BASE_URL` can mask Claude.ai OAuth because the CLI gives env auth precedence. To verify your OAuth session is still present:

```sh
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL claude auth status
```

For day-to-day official Claude Code usage, keep plain `claude` free of global `ANTHROPIC_*` provider variables and use provider wrapper functions or this plugin for GLM.

For detached jobs that return a job id immediately:

```text
/glm:run --detached inspect the repo and report risks
```

## Job Files

Jobs are stored under:

```text
~/.claude/glm-scale/jobs/<job-id>/
```

Each job includes:

- `job.json`: metadata
- `task.txt`: delegated prompt
- `progress.log`: readable timeline
- `events.jsonl`: raw Claude `stream-json` events
- `result.md`: final GLM result

## License

MIT
