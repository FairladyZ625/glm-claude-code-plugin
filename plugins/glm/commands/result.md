---
description: Show the stored final output for a completed GLM Claude job.
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" result $ARGUMENTS
```

Return the full output directly. Do not summarize the GLM result unless the user separately asks for a summary.
