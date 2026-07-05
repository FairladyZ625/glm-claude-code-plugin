---
description: Check whether the GLM Claude companion can find claude and GLM environment variables.
argument-hint: ""
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup
```

Return the setup report directly. Do not print secret values.
