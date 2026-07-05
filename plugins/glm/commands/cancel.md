---
description: Cancel a running GLM Claude job.
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" cancel $ARGUMENTS
```

Return the command output directly.
