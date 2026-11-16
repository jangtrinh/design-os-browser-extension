# Concepts & Concept Selection (`es-browser-agent`)

Map every user request to exactly one governed execution mode before issuing CLI/MCP calls.

## Execution Mode Table

| Mode | When to choose | Primary Surface | Max Budget / Guard |
| --- | --- | --- | --- |
| `cache-query` | Data may already exist from earlier sessions (filter people, posts, jobs, companies, threads) | `browser-agent linkedin cache --sql` / `linkedin_query_cache` | Read-only single `SELECT` / `WITH` (`< 5 ms`, zero network traffic) |
| `zero-drift-read` | Need live search results, profile, post engagement, analytics, comments, job details, company bio, or inbox messages | `linkedin status` -> `linkedin search/profile/post/analytics/comments/company/job/inbox` | `ISOLATED` accessibility-tree (role + name) readers; max `120` reads/hour |
| `shared-reader` | Read across 10 site adapters or run 4 checks under shared pacing and cache | `reader list`, `read`, `check`, `cache`, `guard`, `pacing`, `audit` (`reader_*` MCP tools) | `dos.reader.v1` envelope; SQLite cache-first; human-only Account Guard resume in popup |
| `copilot-draft` | User asks to draft a reply, comment, post, or connection note | `linkedin draft --prefill` (`linkedin_draft_write`) | Fenced prefill + queue park (`sent: false`); max `30` prefills/hour; popup-only human approval |
| `new-domain-adapter` | User asks to support another web app beyond LinkedIn | `knowledge_builder.cli query` -> `extension/src/adapters/<domain>/` -> `tests/` | Query `knowledge/agent-browser-extensions/` (`UKMC.v2`) first; no `chrome.debugger` unless explicit & safe |

## Shared Reader Layer (`dos.reader.v1`)

The Shared Browser Layer exposes 8 `reader_*` MCP tools and CLI commands for automated bot routines:
- `reader_list` (`reader list`): Discover supported adapters (`linkedin`, `x`, `youtube-studio`, `producthunt`, `reddit`, `threads`, `facebook`, `unikorn`, `jobs`, `generic`), views, and required fields.
- `reader_read` (`reader read --site <site> --view <view>`): Cache-first structured reader returning `dos.reader.v1` envelope with freshness rules, shared pacing, and redaction.
- `reader_check` (`reader check --check <kind>`): Read-only page verification (`duplicate_text`, `profile_links`, `link_status`, `subreddit_rules`).
- `reader_query_cache` (`reader cache --sql "..."`): Fast SELECT-only query over `reader_results`, `reader_latest`, and `reader_series`.
- `pacing_status` / `guard_status`: Inspect shared load budgets and site guard pauses (`PAUSED_BY_GUARD`). Site guards can only be cleared by a human in the popup (`#guard-panel`).

## Weak Concepts (Reject Immediately)

1. **Headless Puppeteer/Playwright Scraping on LinkedIn:** Fresh automation fingerprints and synthetic timing trigger checkpoint lockouts on real user accounts.
2. **Hardcoded `/voyager/api/graphql?queryId=...` Tables:** LinkedIn build hashes rotate frequently, causing silent `400/410` breakage. Read the accessibility tree (role + accessible name) in the `ISOLATED` world instead; LinkedIn's SDUI pages no longer expose Voyager JSON at all (pilot 2026-11-16).
3. **Unattended Outbound Auto-Send / Mass Invite Blast:** Never automate final Send clicks or bypass `CopilotQueueManager`'s `extension-popup` human gate.
4. **CAPTCHA / Auth / Paywall Evasion:** Never attach stealth patchers or auto-solvers; emit `BLOCKED_CHALLENGE`, `BLOCKED_AUTH`, or `BLOCKED_PAYMENT` immediately.
