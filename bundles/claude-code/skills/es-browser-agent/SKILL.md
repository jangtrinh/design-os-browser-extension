---
name: es-browser-agent
description: "Use when operating a signed-in Chrome or Firefox tab via browser-agent CLI/MCP for LinkedIn zero-drift reads, SQLite cache queries, Copilot drafts, or building new site extension adapters."
metadata:
  author: DESIGN:OS
---

# DESIGN:OS Browser Agent (`es-browser-agent`)

One workflow: Concept -> Build & Operate -> Check -> Hand over -> Adjust.
Use a checkout of `design-os-browser-extension` as `--repo-root`; installed skill copies ship guidance and entrypoints, not the engine (`cli/dist/browser-agent.js`, `extension/dist/{chromium,firefox}`). Node >= 22, TypeScript >= 7.0.2.

## 1. Concept

Read [concepts.md](concepts.md) and pick one mode (`cache-query`, `zero-drift-read`, `copilot-draft`, or `new-domain-adapter`). The generated [contract.md](contract.md) owns CLI flags, MCP tools, RPC actions, and Human Gate states. Read [rules.md](rules.md) (`R1`–`R8`) before running mutations.

| Need | Choose | Reference |
| --- | --- | --- |
| Repeat query over saved entities | `cache-query` (`linkedin cache` / `linkedin_query_cache`) | [linkedin-interaction-workflow.md](references/linkedin-interaction-workflow.md) |
| Live search/profile/post/inbox read | `zero-drift-read` (`ISOLATED` DOM + passive `MAIN` tap) | [linkedin-interaction-workflow.md](references/linkedin-interaction-workflow.md) |
| Draft message/comment/post/note | `copilot-draft` (prefill composer, `sent: false`) | [linkedin-interaction-workflow.md](references/linkedin-interaction-workflow.md) |
| Extend engine to another website | `new-domain-adapter` (`knowledge/agent-browser-extensions/`) | [extension-adapter-workflow.md](references/extension-adapter-workflow.md) |

Reject: headless CDP bots, `chrome.debugger` on LinkedIn, hardcoded `/voyager/api/` `queryId` hash tables, auto-sending spam, or CAPTCHA bypass.

## 2. Build & Operate

Start from [linkedin-profile-and-copilot-draft.json](examples/linkedin-profile-and-copilot-draft.json) or [linkedin-checkpoint-handoff.json](examples/linkedin-checkpoint-handoff.json) using a fresh `--output-dir`. Live browser sessions attach to `127.0.0.1:4347`.

```sh
node skills/es-browser-agent/build.mjs --repo-root . \
  --spec skills/es-browser-agent/examples/linkedin-profile-and-copilot-draft.json \
  --output-dir /absolute/new-run
```

[build.mjs](build.mjs) runs offline deterministic verification by default (pass `--live` to target the open browser on `127.0.0.1:4347`), writes `receipt.json` + `steps-output.json` + `cache-rows.json`, and refuses an existing output directory.

## 3. Check

Run [validate.mjs](validate.mjs), read [look.md](look.md), then run [look.mjs](look.mjs) to render the 4-panel sheet PNG:

```sh
node skills/es-browser-agent/validate.mjs --repo-root . --output-dir /absolute/new-run
node skills/es-browser-agent/look.mjs --repo-root . --output-dir /absolute/new-run \
  --sheet /absolute/new-run/look-sheet.png
```

## 4. Hand over

Report exact verified fields only — never claim `"should work"`:

```text
RUN_DIR: <absolute run directory>
BUILD: <spec path, mode, contract sha256, exit>
VALIDATE: <exit and checks passed or failed lines>
LOOK: <exit, sheet png path, L1-L4 counts, L5-L8 visual notes>
HUMAN_GATE: <CLEAR | BLOCKED_CHALLENGE | BLOCKED_AUTH | BLOCKED_PAYMENT | BLOCKED_POLICY>
COPILOT_QUEUE: <queued count, sent=false invariant verified>
LIMITS: <offline vs live browser, checks skipped, single-session rate caps>
```

Without a browser use verbatim: `LOOK: NOT RUN — browser runtime or local Chromium cache is unavailable.`

## 5. Adjust

| What goes wrong | Do this instead |
| --- | --- |
| `EXTENSION_OFFLINE` | Run `browser-agent daemon start`, paste token from `daemon token --reveal --json` into popup (`R2`, `127.0.0.1:4347`). |
| `BROWSER_PAGE_STALE` / `BROWSER_DISPATCH_UNCERTAIN` | Re-run `browser_observe` for fresh `(pageId, epoch, leaseId)` and read state; never blind-retry (`R4`). |
| `COPILOT_HUMAN_APPROVAL_REQUIRED` | Human must click **Mark Ready (Human)** / **Discard** inside `extension-popup` (`R5`). |
| `BLOCKED_CHALLENGE` / `429` / `451` / `BLOCKED_AUTH` | Stop immediately (`0` retries); hand visible tab to user (`R6`). |
| `SQL_READ_ONLY_VIOLATION` | Rewrite as single `SELECT` / `WITH` statement without semicolons or comments (`R7`). |
| `contract:` drift diagnostic | Regenerate via `node scripts/skill_contract.mjs` (`R1`). |

## Files

[concepts.md](concepts.md) · [rules.md](rules.md) · [look.md](look.md) · [contract.md](contract.md) · [build.mjs](build.mjs) · [validate.mjs](validate.mjs) · [look.mjs](look.mjs) · [ATTRIBUTION.md](ATTRIBUTION.md) · [linkedin-interaction-workflow.md](references/linkedin-interaction-workflow.md) · [extension-adapter-workflow.md](references/extension-adapter-workflow.md)
