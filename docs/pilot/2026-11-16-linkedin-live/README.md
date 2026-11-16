# Live LinkedIn read-only pilot, 2026-11-16

A pilot of `design-os-browser-extension` v0.2.0 (commit `b3ce888`) on Jang Trinh's real, signed-in LinkedIn session, covering the daily tasks our Growth and Community agents do. Everything was read-only. No clicks, drafts, prefills, queue decisions, likes, comments, connects or messages.

## Verdict

**The engine works. The LinkedIn adapter mostly does not work on today's LinkedIn.**

- Pairing, the loopback broker, the CLI, the human gate, pacing counters and the SQLite cache all behaved correctly against live LinkedIn. There was no checkpoint, CAPTCHA or `BLOCKED_*` in 30 calls.
- The LinkedIn-specific readers (`profile`, `post`, `feed`, `search`) returned empty or wrong fields on every real page.
  - The passive Voyager tap captured **0 entities** on all pages. LinkedIn now serves these pages through server-driven UI (`isSdui=true` appears in the links), not the `/voyager/api/` JSON the tap listens for.
  - The DOM selectors are written against the repo's own fixture pages (`[data-test=…]`) and old LinkedIn class names.
- The generic `observe` snapshot (accessible name and role of interactive nodes) *did* surface most of the numbers we need, as link text: followers, connections, profile views, impressions and per-post engagement. A real adapter can be built on that layer.
- Comments: **not captured** by any reader. The post page shows no comment nodes until the comment section is expanded, and the extension has no comment reader.

## Summary table

| # | Daily task | Command(s) | Result | Key data captured |
|---|---|---|---|---|
| 1 | Status + Jang's profile | `linkedin status`, `linkedin profile --url …/in/jangtrinh/`, `observe` | **PARTIAL** | Status OK, gate `CLEAR`. The adapter got the headline only; `fullName` fell back to the slug `jangtrinh`, and followers/connections were missing. `observe` showed **8,741 followers, 500+ connections, 638 profile views, 3,776 post impressions (7 d), 59 search appearances**. |
| 2a | Creator content analytics | `observe --url …/analytics/creator/content/` | **PARTIAL** | There is no analytics reader. `observe` got per-post numbers (759 impr / 20 eng, 550 / 3, 299 / 4) but not the page's headline totals or chart (non-interactive text is not snapshotted). Passive tap: 0. |
| 2b | Profile viewers | `observe --url …/analytics/profile-views/` | **PARTIAL** | No reader. `observe` listed the recent viewer cards (names, titles, "Viewed 1d ago") and "4 recruiters viewed your profile". The 638 total only shows on the profile page. Viewer identities are redacted here. |
| 3 | Comments on latest post | `linkedin feed --url …/recent-activity/all/`, `linkedin post --url …/feed/update/urn:li:share:7525934959287635969/`, `observe` (max 400 nodes) | **FAIL** | `feed` returned `posts: []`. `post` returned garbage (`postUrn: "unknown"`, `authorName: "0 notifications"`, `text: "Premium"`) and persisted it to the cache. `observe` showed 7 reactions and 760 impressions but **no comment nodes**. No Voyager entities. |
| 4 | People search "design system" + profile lookup | `linkedin search --category people --query 'design system' --url …`, `linkedin profile --url <result>` | **FAIL** (adapter) / **PARTIAL** (observe) | `search` returned `items: []`. `observe` saw about 14 result profiles (28 profile links, 2 per card) with names and headlines. `profile` on the first result returned `fullName` = slug and `headline: "· 1st"`. |
| 5 | Query the cache | `linkedin cache --sql …` | **PASS** (mechanics) | The SELECT-only cache works and is fast (~0.1 s): 2 profiles, 1 post, 2 search runs, 0 companies/jobs/threads, 0 copilot items. The persisted content is the same wrong or empty data as above. The 8 `events` rows come from the earlier logged-out smoke test, not this pilot. |

Note on task 3: the post opened was the top-impression post from the 7-day analytics list (759 impressions, 20 engagements), not the newest item on recent activity (`urn:li:activity:7527725342086721537`). The comment finding is the same either way: no reader exists and none of the snapshots showed comment nodes.

## Environment

- Box Linux, Node v24.22.1, TypeScript 7.0.2, built with `npm run build`.
- Broker `browser-agent daemon start` on `127.0.0.1:4347` (fixtures off). The pairing token lived in a temp file outside the repo and is not committed.
- The extension `extension/dist/chromium` was loaded unpacked (ID `cilhmiggidchhdnndeiphjhbkeafdfme`) into the box's signed-in Chrome by a separate browser agent. It was paired from the popup.
- Capabilities reported: `tier1-chromium`, `debuggerAttached: false`, `passiveMainObserver: true`.

## Method

- The CLI read commands only: `linkedin status|profile|post|feed|search|cache` and `observe`. `--url` makes the extension navigate the tab with `tabs.update`. Each navigation was followed about 5 s later by a re-read of the settled page.
- 8 page loads in about 3.5 minutes (17:47 to 17:51 ICT). Jang asked to drop the planned 20-60 s waits, so reads ran a few seconds apart.
- The broker's own pacing counter ended at 19/120 reads per hour and 0/30 prefills.
- Each call's exact command, start time (ICT), exit code and duration are in [`commands.tsv`](commands.tsv). The raw JSON for every call is in [`raw/`](raw/).
- Before and during the run, a logged-out headless check with a throwaway profile got a Cloudflare challenge and an authwall. The gate classified them correctly as `BLOCKED_CHALLENGE` and `BLOCKED_AUTH` ([`screenshots/`](screenshots/)). No screenshots were taken of the signed-in session; the JSON is the evidence.

## Privacy and redaction

- Jang's own public profile data and aggregate numbers are kept.
- Third-party data is removed by [`redact.py`](redact.py). This covers viewer cards, search results, the looked-up member's profile and any `/in/<slug>`, `vanityName`, messaging `recipient`/`profileUrn`, emails and phone numbers. Names and headlines become `[redacted:<sha256[:8]>]`, slugs become `[member:<sha256[:8]>]`, and query strings on third-party pages are dropped. On those pages `compactText` is regenerated from the redacted nodes.
- Not committed: the pairing token, `daemon.log` and `cache.sqlite`.

## Safety notes

- Only read actions ran. `browser_act`, `draft`, `--prefill` and `queue decide` were never called.
- No `BLOCKED_*`, checkpoint or 429/451 response occurred while signed in.
- The adapter does not use `chrome.debugger`, and it sends no synthetic background fetches.

## Gaps found

1. **The passive tap captures nothing on current LinkedIn.** The SDUI responses are not `/voyager/api/` JSON with `included[]` (`extension/src/adapters/linkedin/passive-observer.ts`).
2. **The DOM extractors are fixture-shaped** (`extension/src/adapters/linkedin/dom-extractors.ts`). They miss the name, followers, search results and feed posts, and they misread the post page. The wrong values then get cached.
3. **There is no comment reader and no analytics reader** (creator content, post summary, profile views). These are the two things Community and Growth need every day.
4. **`observe` drops non-interactive text**, so analytics totals and charts can't be read. Comments are not rendered until expanded, and expanding them needs a click, which a read-only agent shouldn't do.
5. **Security: `POST /rpc` and `/cache/query` have no authentication** (`cli/src/daemon/ws-broker.ts`). The pairing token only protects the extension's WebSocket. Any local process, and possibly any web page (`text/plain` simple POST, no Origin or Host check), can drive the paired browser.
6. **Safety: `browser_act` is unrestricted.** `click_ref` and `fill_ref` can click any element, including Send, Like or Connect. They are not counted by the pacing limits. `--url` can navigate to any http URL.
7. **CLI quirks:** `doctor` is not a CLI command (it returns `UNKNOWN_COMMAND` with exit 0). `daemon start` prints the pairing token to stdout.

## Next steps

1. Rebuild the readers on the accessibility tree (role and name) instead of class names. Parse numbers like "8,741 followers" and "759 impressions • 20 engagements", and add `linkedin analytics content|profile-views|post-summary` commands.
2. Add `linkedin comments --url <post>` that reads only comments already rendered, or comments from the post-summary analytics page, without clicking.
3. Investigate the SDUI / RSC response stream as a passive source to replace `/voyager/api/`.
4. Require the pairing token, as a header, on `/rpc` and `/cache/query`. Check Origin and Host.
5. Gate `browser_act` behind an allowlist or a human confirmation, count it in pacing, and refuse Send/Post/Connect targets.
6. Don't cache a read whose required fields are missing (for example `postUrn: "unknown"`). Add regression fixtures captured from these real pages (redacted).
