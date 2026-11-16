---
description: Operate the user's open LinkedIn session safely (SQLite cache -> Zero-Drift hybrid reads -> Fenced Copilot drafts -> Human Gate halt)
allowed-tools: Bash, Read
---

# `/linkedin` — LinkedIn Zero-Drift Agent Workflow

Follow [`workflows/linkedin-agent-workflow.md`](../workflows/linkedin-agent-workflow.md) and [`skills/es-browser-agent/SKILL.md`](../skills/es-browser-agent/SKILL.md).

## Mandatory Sequence

1. Check live tab gate & session status:
   ```bash
   node cli/dist/browser-agent.js linkedin status --json
   ```
   Stop immediately (`0` retries) if `humanGate` is `BLOCKED_CHALLENGE`, `BLOCKED_AUTH`, or `BLOCKED_PAYMENT`.
2. Query local SQLite cache first (`SELECT` / `WITH` only):
   ```bash
   node cli/dist/browser-agent.js linkedin cache --sql "SELECT public_identifier, full_name, headline, source FROM profiles ORDER BY captured_at DESC LIMIT 20" --json
   ```
3. Perform targeted Zero-Drift search or entity extraction (`linkedin search`, `linkedin profile`, `linkedin post`, `linkedin company`, `linkedin job`, `linkedin inbox`).
4. For outbound writes, stage a prefilled Copilot draft (`linkedin draft --prefill --json`) and instruct the user to review or click Send manually in the browser.
