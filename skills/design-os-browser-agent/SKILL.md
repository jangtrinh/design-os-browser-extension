---
name: design-os-browser-agent
description: "Operate a real user-signed-in Chromium or Firefox browser tab through `browser-agent` CLI (`--json`) and the 12-tool MCP stdio server (`linkedin_status`, `linkedin_search`, `linkedin_get_profile`, `linkedin_get_post`, `linkedin_get_company`, `linkedin_get_job`, `linkedin_list_inbox`, `linkedin_draft_write`, `linkedin_query_cache`, `browser_observe`, `browser_act`, `browser_capabilities`). Use when reading LinkedIn profiles/posts/companies/jobs/inbox or staging Copilot drafts without bot browsers, chrome.debugger, or hardcoded Voyager queryId hashes."
---

# DESIGN:OS Browser Agent

Bridge AI agents cleanly into the user's own signed-in Chromium or Firefox session over `127.0.0.1:4347` (`browser-agent`), backed by the `UKMC.v2` knowledge pack at `knowledge/agent-browser-extensions/`.

## Quick Startup

1. Build CLI + Chromium & Firefox MV3 extension bundles:
   ```bash
   npm run build
   ```
2. Start the local WebSocket broker and reveal the pairing token:
   ```bash
   node cli/dist/browser-agent.js daemon start
   node cli/dist/browser-agent.js daemon token --json
   ```
3. Load the extension in Chrome/Arc/Brave (`extension/dist/chromium`) or Firefox (`extension/dist/firefox`), open the extension popup, paste the token, and click **Save & Connect**.

## Operating Laws

1. **Check SQLite Cache First:** Query locally persisted LinkedIn records in `<5ms` via `browser-agent linkedin cache --sql "SELECT ..."` or MCP `linkedin_query_cache` (read-only `SELECT` / `WITH` only) before navigating live tabs.
2. **Zero-Drift Hybrid Reads:** Content extraction combines semantic DOM/ARIA (`ISOLATED` world) with a passive `MAIN`-world response observer (`passive-observer.js`, loaded at `document_start`). Never issue synthetic Voyager requests or attach `chrome.debugger`.
3. **Fenced Dispatch:** Always capture `(tabId, pageId, epoch, leaseId)` via `browser_observe` before calling `browser_act`. Timed-out actions return `UNCERTAIN` (`retryable: false`); reconcile with a read instead of blind-retrying.
4. **Copilot Drafts Never Auto-Send:** `linkedin_draft_write` (`linkedin draft --prefill`) populates the visible composer and adds an item (`sent: false`) to the Copilot Approval Queue. Human approval happens exclusively in `extension-popup` (`BLOCKED_POLICY` blocks agent self-approval).
5. **Human Gate Handoff:** Stop immediately with `0` retries on `BLOCKED_CHALLENGE`, `BLOCKED_AUTH`, or `BLOCKED_PAYMENT` so the human resolves the checkpoint or sign-in in the open tab.
