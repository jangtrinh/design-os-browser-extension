# LinkedIn Interaction Reference Workflow (`es-browser-agent`)

## Step-by-Step Operational Loop

1. **Preflight & Gate Check:** Verify the broker (`127.0.0.1:4347`) and open tab status first.
   ```bash
   node cli/dist/browser-agent.js daemon status --json
   node cli/dist/browser-agent.js linkedin status --json
   ```
   If `humanGate` is anything other than `CLEAR`, stop immediately (`R6`).
2. **Cache-First SQLite Lookup (`R3`, `R7`):** Query saved profiles, companies, jobs, posts, or threads before driving the browser tab.
   ```bash
   node cli/dist/browser-agent.js linkedin cache \
     --sql "SELECT public_identifier, full_name, headline, source FROM profiles ORDER BY captured_at DESC LIMIT 20" \
     --json
   ```
3. **Zero-Drift Live Read:** Extract people, posts, jobs, companies, search results, or inbox threads cleanly from the open tab.
   ```bash
   node cli/dist/browser-agent.js linkedin search --category people --query "AI" --json
   node cli/dist/browser-agent.js linkedin profile --json
   ```
4. **Fenced UI Interaction (`R4`):** Always observe right before mutating to bind `(tabId, pageId, epoch, leaseId)`.
   ```bash
   node cli/dist/browser-agent.js observe --json
   node cli/dist/browser-agent.js act --op click_ref --ref 4 --tab 1 --page-id pg_abc --epoch 3 --lease-id ls_xyz --json
   ```
5. **Human-Gated Copilot Draft (`R5`):** Pre-fill the visible composer without clicking Send (`sent: false`).
   ```bash
   node cli/dist/browser-agent.js linkedin draft --kind message --target linh-nguyen --body "Hi Linh..." --prefill --json
   ```

## Right vs Wrong Usage

| Right (`es-browser-agent`) | Wrong (Blocked / Fragile) |
| --- | --- |
| Query `linkedin_query_cache` first with single `SELECT` (`<5ms`) | Re-open 50 already-visited profile tabs in one loop |
| Read `pageId`, `epoch`, `leaseId` from `browser_observe` before `browser_act` | Cache DOM refs across navigations or blind-retry `UNCERTAIN` |
| Read passive `included[]` JSON via `passive-observer.js` (`0` hashes) | Hardcode `/voyager/api/graphql?queryId=<hash>` inside agent scripts |
| Stage draft with `--prefill` (`sent: false`), hand off Send to human | Auto-click Send or invoke `linkedin.queue.decide` from `agent-rpc` |
| Halt with `0` retries when `BLOCKED_CHALLENGE` triggers | Reload `/checkpoint/` repeatedly or attempt automated CAPTCHA solving |

## Common Errors & Recovery

| Code | Meaning | Exact Recovery |
| --- | --- | --- |
| `EXTENSION_OFFLINE` | Extension WebSocket not attached to `127.0.0.1:4347` | Open popup, paste token from `daemon token --reveal --json`, click Save & Connect. |
| `BROWSER_PAGE_STALE` | Tab navigated (`epoch` bumped) after `observe` | Call `browser_observe` again to obtain current fence. |
| `BROWSER_DISPATCH_UNCERTAIN` | Mutation timed out; outcome unknown | Read current DOM/cache state first; never auto-retry blindly. |
| `COPILOT_HUMAN_APPROVAL_REQUIRED` | Non-popup caller tried approving queue item | Only the human clicks **Mark Ready (Human)** inside `extension-popup`. |
| `BLOCKED_CHALLENGE` | Security check, `429`, `451`, or CAPTCHA iframe detected | Stop agent loop immediately and let user solve it in the browser tab. |
