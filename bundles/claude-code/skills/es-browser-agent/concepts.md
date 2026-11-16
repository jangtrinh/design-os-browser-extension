# Concepts & Concept Selection (`es-browser-agent`)

Map every user request to exactly one governed execution mode before issuing CLI/MCP calls.

## Execution Mode Table

| Mode | When to choose | Primary Surface | Max Budget / Guard |
| --- | --- | --- | --- |
| `cache-query` | Data may already exist from earlier sessions (filter people, posts, jobs, companies, threads) | `browser-agent linkedin cache --sql` / `linkedin_query_cache` | Read-only single `SELECT` / `WITH` (`< 5 ms`, zero network traffic) |
| `zero-drift-read` | Need live search results, profile, post engagement, analytics, comments, job details, company bio, or inbox messages | `linkedin status` -> `linkedin search/profile/post/analytics/comments/company/job/inbox` | `ISOLATED` accessibility-tree (role + name) readers; max `120` reads/hour |
| `copilot-draft` | User asks to draft a reply, comment, post, or connection note | `linkedin draft --prefill` (`linkedin_draft_write`) | Fenced prefill + queue park (`sent: false`); max `30` prefills/hour; popup-only human approval |
| `new-domain-adapter` | User asks to support another web app beyond LinkedIn | `knowledge_builder.cli query` -> `extension/src/adapters/<domain>/` -> `tests/` | Query `knowledge/agent-browser-extensions/` (`UKMC.v2`) first; no `chrome.debugger` unless explicit & safe |

## Weak Concepts (Reject Immediately)

1. **Headless Puppeteer/Playwright Scraping on LinkedIn:** Fresh automation fingerprints and synthetic timing trigger checkpoint lockouts on real user accounts.
2. **Hardcoded `/voyager/api/graphql?queryId=...` Tables:** LinkedIn build hashes rotate frequently, causing silent `400/410` breakage. Read the accessibility tree (role + accessible name) in the `ISOLATED` world instead; LinkedIn's SDUI pages no longer expose Voyager JSON at all (pilot 2026-11-16).
3. **Unattended Outbound Auto-Send / Mass Invite Blast:** Never automate final Send clicks or bypass `CopilotQueueManager`'s `extension-popup` human gate.
4. **CAPTCHA / Auth / Paywall Evasion:** Never attach stealth patchers or auto-solvers; emit `BLOCKED_CHALLENGE`, `BLOCKED_AUTH`, or `BLOCKED_PAYMENT` immediately.
