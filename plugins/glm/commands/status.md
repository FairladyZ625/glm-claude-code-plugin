---
description: Show active and recent GLM Claude jobs for the current machine.
argument-hint: "[job-id] [--all] [--json]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" status $ARGUMENTS
```

Present the command output directly. Keep job ids, status, progress path, result path, session id, and errors intact.
