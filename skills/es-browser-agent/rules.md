# Mechanical & Safety Rules (`es-browser-agent`)

Every rule maps one runtime invariant to its CLI/MCP usage ("Keep it") and deterministic validation failure prefix ("Rejected when").

## R1 — Source-Bound Contract Freshness (`contract`)
- **Statement:** `skills/es-browser-agent/contract.md` must exactly match `shared/`, `cli/src/commands/dispatch.ts`, and `cli/src/mcp/stdio-server.ts` via SHA-256 header.
- **Keep it:** Regenerate with `node scripts/skill_contract.mjs` whenever a CLI flag, RPC action, or MCP tool changes.
- **Rejected when:** `contract: contract.md missing or stale against source`.

## R2 — Zero Debugger Permission & Attachment (`debugger-absent`)
- **Statement:** LinkedIn and general user-session manifests never request `"debugger"`, and runtime capability reports always declare `debuggerAttached: false`.
- **Keep it:** Use `passive-observer.js` (`MAIN` world `document_start`) + semantic `ISOLATED` DOM/ARIA reading on `127.0.0.1:4347`.
- **Rejected when:** `debugger-absent: manifest or receipt reports debugger permission/attachment`.

## R3 — SQLite Cache Check Before Live Reads (`cache-check`)
- **Statement:** Every non-trivial read or workflow run checks `linkedin_query_cache` / `linkedin cache --sql` first (or records an explicit SQLite check in its run receipt) before hitting the live browser tab.
- **Keep it:** Run `node cli/dist/browser-agent.js linkedin cache --sql "SELECT ..."` before `linkedin profile` / `search`.
- **Rejected when:** `cache-check: run skipped SQLite pre-lookup`.

## R4 — Fenced Dispatch & No Blind Retries (`fenced-dispatch`)
- **Statement:** Mutating browser actions (`browser_act`, `linkedin.composer.prefill`) require matching `(tabId, pageId, epoch, leaseId)`. On `UNCERTAIN` timeout, reconcile read-only instead of blind-retrying (`timeoutRetryCount === 0`).
- **Keep it:** Capture a fresh fence with `browser_observe` after every navigation before calling `browser_act`.
- **Rejected when:** `fenced-dispatch: missing fence or attempted blind retry on UNCERTAIN`.

## R5 — Copilot Drafts Never Auto-Send (`copilot-safety`)
- **Statement:** Agent write intents park in the Copilot Approval Queue or pre-fill the composer with `sent: false` and `createdBy: "agent-rpc"`. Calling `linkedin.queue.decide` from `agent-rpc` is refused with `BLOCKED_POLICY`.
- **Keep it:** Call `linkedin_draft_write` with `--prefill` and let the human click **Mark Ready (Human)** in the extension popup or click **Send** directly in LinkedIn.
- **Rejected when:** `copilot-safety: draft marked sent=true or approved outside extension-popup`.

## R6 — Instant Human Gate Handoff (`human-gate`)
- **Statement:** Detecting `/checkpoint/`, `/authwall`, `/premium/`, CAPTCHA iframes, or HTTP `429`/`451` sets `humanGate` to `BLOCKED_*` and halts with `postBlockRetries === 0`.
- **Keep it:** Inspect `linkedin status --json` first; when blocked, instruct the human to resolve the visible tab directly.
- **Rejected when:** `human-gate: action continued or retried after BLOCKED_* gate`.

## R7 — Read-Only SQLite Queries (`sql-read-only`)
- **Statement:** All cache queries must pass `validateReadOnlySelectSql` (single `SELECT` / `WITH` statement, no semicolons, no SQL comments, no DDL/DML keywords outside string literals).
- **Keep it:** Pass clean read-only SQL to `linkedin cache --sql "..."` or `linkedin_query_cache`.
- **Rejected when:** `sql-read-only: write, admin, comment, or chained statement detected`.

## R8 — Visual Inspection Clarity (`visual-clarity`)
- **Statement:** Extension popup UI and `look.mjs` inspection sheets pass `ui gate`, `slop-detect`, machine probes `L1`–`L4`, and eye checks `L5`–`L8` in `look.md`.
- **Keep it:** Run `node skills/es-browser-agent/look.mjs --repo-root . --output-dir <run> --sheet <png>` and inspect the PNG.
- **Rejected when:** `look.mjs` exits `1` or an eye check (`L5`–`L8`) fails visual inspection.
