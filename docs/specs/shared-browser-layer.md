# Shared browser layer: read-only readers for our daily routines

| Field | Value |
|---|---|
| Status | DRAFT, not approved. No routine switches to the extension until Jang approves that routine's switch. |
| Owner | PM (writes), Jang (approves), Dev (builds), QA (accepts) |
| Date | 2026-11-16 (ICT) |
| Repo | jangtrinh/design-os-browser-extension |
| Tracking issue | #8 |
| Builds on | Pilot [docs/pilot/2026-11-16-linkedin-live/README.md](../pilot/2026-11-16-linkedin-live/README.md) (#3, `ac7a03f`); Dev PRs #4 (ARIA readers + analytics/comments), #5 (`/rpc` auth + Host/Origin), #6 (`browser_act` allowlist), #7 (`doctor`) |

## 0. Decisions this spec records

1. **The extension is the shared browser layer that bots call over MCP** for routines that touch a website through a browser. Source: Jang, 2026-11-16 18:10 ICT: "Giao PM viết spec và mở issue cho các ý tưởng trong repo extension", and 18:11 ICT: "Tất cả routine tương tác với web đều đưa thành extension hết".
2. **Its primary purpose is read-only collection of information.** Source: Jang, 2026-11-16 18:14 ICT: "Mục tiêu các extentions nên dùng để cào thông tin". Readers come first. Write and post actions are in [Later](#11-later-out-of-scope-for-now) and keep their current routes.
3. **No routine switches over until Jang approves that routine's switch.** This spec and its issues authorize no code. Code starts only when Jang requests it.

## 1. Problem

Our bots (J, Growth, Community, Unikorn, Career and others) read websites every day: metrics, comments, mentions, follower lists, profiles, listings. Today each bot does this its own way:

- A computerUse subagent drives the signed-in box Chrome by hand (screenshots, scrolling, reading text). It is slow and costly, and each bot re-implements the same page reading.
- Some numbers are missing entirely. X Articles impressions are not in `growth/x-queue/posted.md`, so every nightly X report undercounts (on 2026-11-16 the two Articles drew 1,810 views against 1,985 for every logged post combined).
- Results are free text in chat, not data. Nothing is cached, so the next bot opens the same page again.
- There is no shared pacing. Two bots can read LinkedIn at once, which `linkedin-account-safety` forbids.
- Checkpoints and warnings are handled per bot. One bot can hit a LinkedIn checkpoint while another keeps going.
- Evidence (screenshot + JSON) is ad hoc. PR #3 showed a good pattern (`raw/*.json` + `redact.py` + screenshots), but it was made by hand.

The engine already works live: pairing, the loopback broker, the human gate, pacing counters and the SQLite cache all behaved correctly in the 2026-11-16 pilot. What is missing is a set of reliable readers, a shared data contract and cross-cutting safety.

## 2. Goals and non-goals

### Goals

- G1. One reader per site view, called over MCP, returning **structured JSON** in one envelope (section 5).
- G2. Every reader result goes into **one shared cache** that any bot can query before opening a page (section 6).
- G3. **Per-site pacing budget** shared by all bots, so the total load on a site stays human-paced (section 7).
- G4. **Account guard**: a checkpoint, CAPTCHA, restriction or warning on any site pauses every reader for that site and alerts (section 8.1).
- G5. **Evidence recorder**: each reader run can leave a screenshot + redacted JSON, like PR #3 (section 8.2).
- G6. **Redaction of third-party data** before anything is cached, logged or committed (section 8.3).
- G7. A **routine inventory and migration map**, so every browser-touching routine has a target reader or a stated reason to stay where it is (section 10).

### Non-goals (now)

- Posting, commenting, replying, liking, upvoting, following, unfollowing, form submission, profile edits, metadata edits or image uploads. See [Later](#11-later-out-of-scope-for-now).
- Replacing connectors that already work (X reads, Unikorn MCP, GitHub, Gmail, Notion, Drive). See section 10.4.
- CAPTCHA solving, anti-bot evasion, auth bypass, internal API calls (Voyager or similar), replaying captured requests, or reading session tokens. These stay forbidden (AGENTS.md rule 3, `linkedin-account-safety`).
- Logged-out QA smoke tests. Those stay on `jev-qa`.

## 3. Who uses it

| Who | What they do with it |
|---|---|
| Bots (J, Growth, Community, Unikorn, Career, Media) | Query the cache first, or call a reader over MCP. Get JSON plus an `evidence_id`. |
| Jang | Reads reports built from the JSON. Resolves account guard pauses in the visible browser. Approves each routine's switch. |
| Dev | Builds one adapter per site under `extension/src/adapters/<site>/`. |
| QA | Accepts each reader against its acceptance criteria, using the evidence recorder output. |

## 4. Architecture

```
bot --MCP--> browser-agent MCP server --/rpc (token, #5)--> broker 127.0.0.1:4347 --WS--> MV3 extension
                    |                                          |                            |
                    |                                   pacing budget (7)            site adapter (one per site)
                    |                                   account guard (8.1)          human-gate detector
                    v                                   audit log (7.3)              ax-collector (#4)
             reader cache (6) <-------- redaction (8.3) <------- evidence recorder (8.2)
```

Components:

1. **Site adapters**, one per site: `linkedin` (exists, rebuilt on ARIA in #4), `x`, `youtube-studio`, `producthunt`, `reddit`, `threads`, `facebook` (read views only), `unikorn`, `jobs` (job boards), and `generic` (any public page: listings, competitor pages, link checks). Each adapter declares its views, its required fields, its allowed hosts and its gate markers.
2. **Reader runtime** in the extension. It navigates the tab with `tabs.update` (as today), waits for the page to settle, collects role/name/text nodes (the `ax-collector` from #4), and runs the adapter's pure parse functions. Readers never click, type or expand anything. If data needs a click to render (for example collapsed LinkedIn comments), the reader returns what is rendered and flags the gap.
3. **Pacing budget** in the broker, shared by all callers (section 7).
4. **Account guard** in the broker, fed by the human-gate detector (section 8.1).
5. **Evidence recorder** (section 8.2) and **redaction** (section 8.3).
6. **Reader cache** in the CLI's SQLite store (section 6).
7. **Audit log** of every reader call (section 7.3).

`browser_act` stays restricted by #6 and no reader uses it.

## 5. MCP tools (shapes)

All tools return the envelope below. JSON field names use `snake_case`. Times are ISO 8601 with an offset.

```jsonc
// Envelope for every reader result
{
  "schema": "dos.reader.v1",
  "site": "linkedin",                 // adapter id
  "view": "analytics.content",        // adapter view id
  "target": "https://www.linkedin.com/analytics/creator/content/",
  "target_key": "linkedin:analytics.content:self",   // cache key, stable per target
  "captured_at": "2026-11-16T17:48:12+07:00",
  "source": "live",                   // live | cache
  "freshness": { "max_age_s": 21600, "age_s": 0, "stale": false },
  "complete": true,                   // false when required fields are missing
  "missing_required": [],             // field names; a result with any entry never becomes latest
  "gate": "CLEAR",                    // CLEAR | BLOCKED_CHALLENGE | BLOCKED_AUTH | BLOCKED_PAYMENT | BLOCKED_POLICY | PAUSED_BY_GUARD
  "pacing": { "site": "linkedin", "loads_left_hour": 23, "loads_left_day": 131 },
  "redaction": { "policy": "third-party-v1", "fields_redacted": 14 },
  "evidence_id": "ev_2026-11-16_174812_linkedin_ab12cd34",  // null when evidence is off
  "audit_id": "au_01J...",
  "caller": { "bot": "J", "routine": "X nightly metrics" },
  "data": { /* view-specific, section 5.2 */ },
  "notes": []                         // caveats, e.g. "comments not rendered; no click made"
}
```

The last line of every CLI call stays the E1 verdict: `AGENT_OK {json}` or `AGENT_FAIL {json}`.

### 5.1 Tools

| Tool | Input | Output | Notes |
|---|---|---|---|
| `reader_list` | `{ site? }` | adapters, views, required fields, default `max_age_s` | Discovery. No page load. |
| `reader_read` | `{ site, view, target?, params?, max_age_s?, evidence?: "off" \| "json" \| "json+screenshot", caller: {bot, routine} }` | envelope | Checks the cache first (rule R3). Loads the page only when the cached entry is missing or stale. Refused with `PAUSED_BY_GUARD` or `PACING_EXHAUSTED`. |
| `reader_query_cache` | `{ sql }` or `{ site, view, target_key?, since? }` | rows | SELECT-only, same validator as `linkedin_query_cache` (rule R7). |
| `reader_check` | `{ check: "duplicate_text" \| "profile_links" \| "link_status" \| "subreddit_rules", params }` | envelope with `data.verdict` | Checks are readers that compare page data with an input. They never act. |
| `pacing_status` | `{ site? }` | per-site budget and use | |
| `guard_status` | `{ site? }` | per-site guard state, reason, `since`, `evidence_id` | Clearing a guard is human-only (popup), never an MCP call. |
| `evidence_get` | `{ evidence_id }` | file paths + manifest | |
| `audit_query` | `{ since?, site?, caller? }` | audit rows | SELECT-only. |

The existing `linkedin_*` read tools stay, and become thin aliases of `reader_read` with `site: "linkedin"` once the shared cache lands.

### 5.2 View data conventions

- Counts are integers. Keep the page's display text next to the parsed number: `{ "followers": 8741, "followers_text": "8,741 followers" }`. Floors such as "500+" become `"connections": 500, "connections_text": "500+", "connections_floor": true`.
- Periods are explicit, for example `"period": "past_7_days"`, never implied.
- Every list item has a stable `id` from the site (URN, post id, video id, slug). When the site gives none, use `sha256(site|view|canonical_url|position)[:16]` and set `"id_synthetic": true`.
- Third-party people are redacted before storage (section 8.3). Jang's own accounts and aggregate numbers are kept.
- Unknown is `null`, never `0` and never a guess.

## 6. Reader cache

### 6.1 Location

- Database: the CLI's existing SQLite store, default `~/.design-os-browser-extension/cache.sqlite` (mode 0600). Override with `BROWSER_AGENT_CACHE_PATH`.
- Evidence files: `~/.design-os-browser-extension/evidence/<YYYY-MM-DD>/<evidence_id>/` (`manifest.json`, `result.redacted.json`, optional `screenshot.png`).
- Audit JSONL mirror: `~/.design-os-browser-extension/audit/<YYYY-MM-DD>.jsonl`.
- Bots read the cache through `reader_query_cache` or the CLI, never by opening the file.
- Nothing in these folders is committed. Pilot-style evidence enters the repo only through a docs PR, after redaction, as in #3.

### 6.2 Tables

```sql
reader_results(
  result_id TEXT PRIMARY KEY,      -- ulid
  site TEXT, view TEXT, target_key TEXT, target TEXT,
  captured_at TEXT, schema TEXT,
  complete INTEGER, missing_required_json TEXT,
  data_json TEXT,                  -- already redacted
  evidence_id TEXT, audit_id TEXT, caller_bot TEXT, caller_routine TEXT
)
reader_latest(site, view, target_key, result_id, captured_at)     -- one row per target, complete results only
reader_series(site, view, target_key, metric, captured_at, value) -- numeric time series for metrics views
```

- `reader_results` is append-only. A new read never overwrites an old one.
- `reader_latest` points at the newest **complete** result. An incomplete result (any `missing_required`) is stored for diagnosis but never becomes latest. This generalizes #4's rule that reads reporting `missingRequired` are not persisted.
- `reader_series` holds one row per numeric metric per capture, so nightly reports can compute deltas without re-reading the page.

### 6.3 Freshness rules

| View class | Default `max_age_s` | Why |
|---|---|---|
| Metrics (analytics, impressions, views, karma, votes) | 21,600 (6 h) | Reports run nightly or daily; one live read per report is enough. |
| Comment and mention feeds | 3,600 (1 h) | Triage runs a few times a day. |
| Following / follower lists | 604,800 (7 d) | Lists change slowly and are expensive to page through. |
| Profiles and profile links | 86,400 (24 h) | |
| Duplicate-text lookup | 900 (15 min) | Must be fresh right before a human posts. |
| Listings and competitor pages | 86,400 (24 h) | |
| Link status checks | 3,600 (1 h) | |

- A caller may ask for a shorter `max_age_s`. The pacing budget still applies.
- A caller may pass `max_age_s: -1` to accept any cached result without a live read.
- A stale result is returned only when the caller allowed it, with `"stale": true`.
- When the account guard has paused a site, readers return the latest cached result with `"gate": "PAUSED_BY_GUARD"` and an honest `stale` flag. They never load the page.

## 7. Pacing budget and back-off

### 7.1 Budget

The broker keeps one budget per site, shared by every caller and every routine. Defaults (Dev may tighten them; loosening needs Jang):

| Site | Page loads / hour | Page loads / day | Min gap between loads | Parallel tabs |
|---|---|---|---|---|
| linkedin | 30 | 150 | 20 s ± 30% jitter | 1 |
| facebook | 30 | 200 | 20 s | 1 |
| x | 40 | 300 | 10 s | 1 |
| threads | 40 | 300 | 10 s | 1 |
| reddit | 40 | 300 | 10 s | 1 |
| youtube-studio | 20 | 100 | 10 s | 1 |
| producthunt | 20 | 100 | 10 s | 1 |
| unikorn | 20 | 100 | 10 s | 1 |
| jobs (per host) | 20 | 100 | 15 s | 1 |
| generic (per host) | 30 | 300 | 5 s | 2 |

- LinkedIn's existing counter allows 120 reads per hour. That counts RPC reads, not page loads, and the pilot ran 8 loads in 3.5 minutes at Jang's request. This spec sets a lower shared default for unattended routines (open question Q1).
- Scrolling to load more items on the same page counts as one load per 3 scroll steps.
- A list reader that would exceed the budget stops there. It returns what it has with `"complete": false` and `"notes": ["budget reached at item N"]`, and saves a resume cursor.

### 7.2 Back-off

- A page that has not settled after 15 s (for example the "Đang tải..." spinner on Facebook's Following list) is a **stall**. The reader waits twice the min gap and tries the read once more. After 3 stalls in a row on one site, that site's readers pause for 30 minutes and the audit log records `STALLED`. After 3 stall pauses in one day, the account guard treats it as a trigger.
- HTTP 429 or 451, a checkpoint, a CAPTCHA, a restriction notice or "unusual activity" text goes straight to the account guard, with no retry.
- Nothing retries a read after a guard trigger (rule R6, `postBlockRetries === 0`).

### 7.3 Audit log

Every reader call appends one row:

```jsonc
{
  "audit_id": "au_01J...", "attempt_id": "at_01J...", "started_at": "...", "ended_at": "...",
  "caller_bot": "Community", "caller_routine": "Daily social engagement batch",
  "site": "threads", "view": "post.replies", "target": "https://www.threads.com/...",
  "kind": "read",                       // read | check  (write kinds are reserved for Later)
  "cache": "miss",                      // hit | miss | stale-allowed
  "page_loads": 1, "pacing_after": { "loads_hour": 7, "loads_day": 31 },
  "gate_before": "CLEAR", "gate_after": "CLEAR",
  "result": "AGENT_OK",                 // AGENT_OK | AGENT_FAIL
  "error_code": null,                   // PACING_EXHAUSTED | PAUSED_BY_GUARD | STALLED | INCOMPLETE | ...
  "evidence_id": "ev_...", "result_id": "...",
  "prev_hash": "sha256 of the previous row"  // hash chain, append-only
}
```

It is stored in the SQLite table `audit_log` and mirrored as JSONL (6.1). Rows are never edited or deleted.

## 8. Cross-cutting safety

### 8.1 Account guard

- Inputs: the human-gate detector (`extension/src/core/human-gate-detector.ts`, generalized per site), HTTP 429/451 from the passive sentinel (#4), warning markers each adapter declares (for example Facebook's "temporarily blocked", LinkedIn restriction notices, Reddit's "you are doing that too much"), and repeated stalls (7.2).
- Effect: that site's guard becomes `PAUSED`, with a reason, a time and an evidence capture. Every reader for that site, from every bot, is refused until Jang clears it in the popup. Other sites keep running.
- Alert: one line per trigger, which the calling bot puts in its normal report to Jang: site, reason, time (ICT) and `evidence_id`. The guard never alerts twice for the same pause.
- Clearing is human-only. The popup shows the pause and a "Resolved, resume" control. No MCP or CLI call clears a guard.
- The guard never tries to solve or dismiss a challenge.

### 8.2 Evidence recorder

- Modes: `off`, `json` (default) and `json+screenshot`.
- Output: `manifest.json` (the envelope minus `data`, plus a hash of each file), `result.redacted.json`, and optionally `screenshot.png` of the visible tab. Screenshots of third-party content are taken only when the caller asks for them, and are never committed.
- The pattern is PR #3's: raw JSON per call, a redaction step, screenshots only of non-personal pages, and a run log (here, the audit log).
- Guard triggers always capture `json+screenshot`.

### 8.3 Redaction

- Policy `third-party-v1`, ported from `docs/pilot/2026-11-16-linkedin-live/redact.py` into the shared runtime so it runs before anything is cached:
  - Kept: Jang's own accounts (an allowlist of his handles and profile URLs per site) and aggregate numbers.
  - Redacted: third-party names and headlines become `[redacted:<sha256[:8]>]`, profile slugs and handles become `[member:<sha256[:8]>]`, emails and phone numbers are removed, and query strings on third-party pages are dropped.
- Exception needed by feeds and triage: the **public text** of a comment or mention on Jang's own post, and the commenter's public handle, are kept so a bot can draft a reply. They are stored with `"third_party": true` and excluded from any committed evidence (open question Q3).
- Following/follower lists keep the handle and public display name only, because the list is the data. They are never committed and never leave the box.

## 9. Readers (scope now)

Priority rule: foundations every reader needs are P1. Readers that feed a daily routine are P2. Readers for occasional or new work are P3.

| # | Reader / foundation | Site(s) | Feeds routine | Priority | Issue |
|---|---|---|---|---|---|
| F1 | Shared reader cache, JSON envelope and freshness rules | all | all | P1 | #9 |
| F2 | Per-site pacing budget, back-off and audit log | all | all | P1 | #10 |
| F3 | Account guard | all | all | P1 | #11 |
| F4 | Evidence recorder + shared redaction | all | all | P1 | #12 |
| R1 | LinkedIn nightly analytics snapshot | linkedin | none yet (read by hand today) | P2 | #13 |
| R2 | X metrics incl. X Articles impressions | x | J "X nightly metrics" | P2 | #14 |
| R3 | YouTube Studio + Product Hunt metrics | youtube-studio, producthunt | J "YouTube growth daily", Unikorn PH checks | P2 | #15 |
| R4 | Reddit metrics (karma, post and comment scores) | reddit | Growth and Community Reddit work | P2 | #16 |
| R5 | Unified comment and mention feed, pre-sorted into 3 tiers | linkedin, threads, x (via connector) | Community engagement, J "X reply monitor" | P2 | #17 |
| R6 | Engagement scout (reply-worthy posts on Threads/LinkedIn) | threads, linkedin | Community "Daily social engagement batch" | P2 | #18 |
| R7 | Following / follower list reader | facebook, x, linkedin, threads | J "FB personal unfollow batches" (read step) | P2 | #19 |
| R8 | Duplicate-text lookup | linkedin, threads, reddit, x | Community paced post batches (pre-post check) | P2 | #20 |
| R9 | Profile link checker | profile pages on all sites | Growth profile-links work | P3 | #21 |
| R10 | Subreddit rules and flair reader | reddit | Community and Growth Reddit drafts | P3 | #22 |
| R11 | Listings and competitor pages reader | generic | Growth "Daily growth auto-research & submit" (live checks), competitor research | P3 | #23 |
| R12 | Unikorn product page + comments snapshot | unikorn | Unikorn "Unikorn + PH daily care" | P3 | #24 |
| R13 | Job board reader | jobs | Career "Morning job digest" | P3 | #25 |
| R14 | Link and proof checks that need the signed-in session | generic | `jev-read` callers | P3 | #26 |

Why this order:

- F1–F4 come first because every reader depends on them. Without the cache nothing is shared; without pacing, two bots overload one site; without the guard, a checkpoint on one bot does not stop the others; without redaction, third-party data lands in the cache.
- R1–R8 replace reading a bot does by hand every day, or fill a number missing today (X Articles).
- R9–R14 are occasional, or already have a working route (`jev-read` for public pages).
- R1 and the LinkedIn part of R5 depend on Dev's #4. Every reader depends on #5 (no unauthenticated `/rpc`). #6 keeps `browser_act` out of reader paths.

### 9.1 Acceptance criteria per component (summary; full criteria are in each issue)

- **F1** Given a complete read, when it is stored, then `reader_latest` points at it and `reader_series` has one row per metric. Given a read with `missing_required`, then it is in `reader_results` only and `reader_latest` is unchanged. Given a cached entry younger than `max_age_s`, then `reader_read` returns `source: "cache"` with zero page loads.
- **F2** Given a site at its hourly budget, then `reader_read` returns `PACING_EXHAUSTED` with no page load, for every caller. Given 3 stalls in a row, then the site pauses for 30 minutes and the audit log shows `STALLED`. Every call has one audit row with a valid `prev_hash`.
- **F3** Given a checkpoint page on site S, then within the same call S is `PAUSED`, an evidence capture exists, and the next reader call on S from any bot is refused with `PAUSED_BY_GUARD`, while other sites still read. No MCP or CLI call can clear it.
- **F4** Given `evidence: "json+screenshot"`, then the evidence folder has a manifest whose file hashes match. Given a page with third-party names, then no stored JSON contains them in clear (checked with a fixture of known names).
- **R1–R14** Given the redacted fixture for the view, then the parsed JSON matches the expected JSON field by field. Given a live read with Jang present, then the numbers match the page as shown in the evidence screenshot. No reader dispatches a click, type or key event (checked in the audit log and by a test that fails on any `Input.*` or `click_ref`).

## 10. Routine inventory and migration

### 10.1 How this inventory was built

From what is on the box, without messaging bots: the Grok Bot usage report for routines over the last 30 days (2026-10-17 to 2026-11-16), bot transcripts (J, Growth, Community, Unikorn, Career, dr eggbot), skills under `/home/box/agent-data/workflows/` (`x-monitor`, `linkedin-account-safety`, `media-scout`, `jev-browser-read`, `jev-browser-qa`) and files in `/workspace/growth`, `/workspace/community` and `/workspace/unikorn`. Routine saved prompts are not stored on disk, so mechanisms come from transcripts. Cells marked "confirm" need the owning bot to confirm before the switch.

### 10.2 Inventory

Cadence comes from the usage report or the routine's own description. R = read, W = write. Read steps map to readers now. Write steps stay on their current route.

| Bot | Routine | Site(s) | R/W | Current mechanism | Cadence | Read step maps to | Write step |
|---|---|---|---|---|---|---|---|
| J | FB personal unfollow batches | facebook.com (personal Following list) | R + W | Box browser, computerUse, signed-in Chrome | Every 5 min, 10–20 per wave (Jang 16/11), ~2,016 runs/week | R7 (list who is followed, detect the stall) | Unfollow stays on its current route (Later) |
| J | X nightly metrics | x.com | R | X connector reads; X Articles impressions missing (confirm) | Daily ~23:00 | R2 (Articles impressions only; post metrics stay on the connector) | none |
| J | X reply monitor | x.com | R (drafts only) | X connector free reads (`x-monitor` SPEC: never the browser) | 10:00, 15:00, 21:00 daily | Stays on the connector; R5 uses it as the X source | none |
| J → Growth | YouTube growth daily | studio.youtube.com, youtube.com | R + W | Brief to Growth; box browser for Studio (confirm) | Daily 10:00 | R3 (views, CTR, watch time, subscribers) | Metadata edits stay (Later) |
| J | Studio micro-features daily posts | Threads, LinkedIn, Unikorn, Product Hunt, Reddit (not X) | W | Box browser; Unikorn MCP for Unikorn | Daily 20:00 | R8 (duplicate check before posting) | Posting stays (Later) |
| J | X English posts (paused) | x.com | W | Box browser signed in as @Jangtrinhvn | Hourly 08:45–22:45 when on | R8 | Stays (Later) |
| J | Reddit replies / Reddit Studio posts (one-off) | reddit.com | W | Box browser | One-off | R8, R10 | Stays (Later) |
| J | CursorUp newsletter unsubscribe | confirm | W | confirm | <1/week | none | Stays |
| Growth | Daily growth auto-research & submit | GitHub (awesome lists), directory sites, PH, Reddit | R + W | `gh` for GitHub; box browser for directory forms | Weekdays (dr eggbot, 16/11) | R11 (listing live checks, competitor pages) | Form submits stay (Later); GitHub stays on the connector |
| Growth | awesome-ai-design daily collect | GitHub | R | GitHub API | Daily | Stays on the connector | none |
| Growth | X deep-tech cadence Tue/Thu/Sat 16:00 | x.com | W | Box browser / X connector (the connector needs an approval card a routine can't show) | 3/week | R8 | Stays (Later) |
| Growth | UX Hacker Page ADA series 11:30, 13–18/11 | facebook.com/uxdesignvn | W | Box browser | Daily until 18/11 | R8 | Stays (Later) |
| Growth | One-off comment queues (Batch3, RPH-01, LI-1, LI-2, Rolling queue) | Reddit, LinkedIn, Threads, PH | W | Box browser | One-off (most paused or done) | R8, R10 | Stays (Later) |
| Growth | Profile-links batch, P-LI retry (paused) | LinkedIn, Threads, GitHub, Unikorn, Reddit profiles | R + W | Box browser | One-off | R9 (every profile links GitHub, LinkedIn and the main channels) | Profile edits stay (Later) |
| Growth | Directory form retries (HyzenPro, Stackviv; paused) | directory sites | W | Box browser | One-off | R11 (is the listing live) | Stays (Later) |
| Community | Daily social engagement batch (20 drafts) | Threads, LinkedIn | R | Box browser; the scheduled run hands scouting to the Community chat because a routine run can't use the browser | Daily ~19:00 | R6 (scout), R5 (comments on our posts) | none (drafts only) |
| Community | Post <date> batch (paced) | LinkedIn, Threads | R + W | Box browser; duplicate check by reading the thread | Every 1–2 h while a batch is open (~112 runs/week) | R8 (duplicate and "existing Jang reply" check) | Posting stays (Later) |
| Community | Daily design-os-studio community check (paused) | confirm | R | confirm | Paused | confirm | confirm |
| Unikorn | Unikorn + PH daily care | unikorn.vn, producthunt.com | R | Unikorn MCP + box browser screenshots (rank, points, views, comments) | Daily | R12 (Unikorn pages), R3 (PH) | Replies stay on MCP or Later |
| Unikorn | Unikorn + PH weekly report & plan | unikorn.vn, producthunt.com | R | Same | Weekly | R12, R3 (from the cache) | none |
| Unikorn | PH launch-day checks and re-checks (Figma Plugin, VieNeu-TTS, AI Review) | producthunt.com, unikorn.vn | R | Box browser | One-off | R3, R12 | none |
| Unikorn | Changelog posts, Talk posts, roadmap sync (paused) | unikorn.vn | W | Unikorn MCP (`post_changelog`, `update_my_product`) | Per release / paused | Stays on the connector | Image attach and changelog edit are browser-only and stay (Later) |
| Career | Morning job digest | Job boards (LinkedIn Jobs, Wellfound, Dribbble, others; confirm) | R | Web search + browser (confirm) | Daily 08:00 | R13 | Applying stays manual, with Jang |
| PM | Release train watch, board hygiene | GitHub | R | `gh` | Daily | Stays on the connector | none |
| QA | Ship-day smoke, weekly security & MCP audit | public / staging pages | R | `jev-qa` (empty profile, CDP 9240) | Weekly / one-off | Stays on `jev-qa` (logged-out by design) | none |
| All bots | Link and proof checks | public pages | R | `jev-read` (empty profile) | Ad hoc | R14 only when a signed-in view is needed; logged-out checks stay on `jev-read` | none |
| Maintainer | System One checks, weekly ops due check | box only | none | local scripts | Daily / weekly | No web step | none |
| dr eggbot | routine-healthcheck, transcript-healthcheck | Grok Bot only | none | built-in tools | Weekly / paused | No web step | none |
| Dev | v071 chain watch (paused) | GitHub | R | `gh` | Paused | Stays on the connector | none |

### 10.3 Needs confirmation

Routines for these bots were not visible from the box (no routine in the 30-day usage report, or the mechanism is unclear). Each needs its owner to confirm before it is mapped:

- **Media**: `media-scout` (weekly Threads research with `jev-browser research` on the Mac through mac-exec). No Media routine appears in the usage report.
- **Design, Revenue, 3D Blender, design:os, Jang.work**: no routines in the usage report.
- **Community** "Daily design-os-studio community check" (paused): sites unknown.
- **J** "CursorUp newsletter unsubscribe": site and mechanism unknown.
- **Career** "Morning job digest": which boards are read in the browser and which through web search.
- **J** "X nightly metrics": where Article numbers come from today (read by hand, or not at all).
- **J → Growth** "YouTube growth daily": which bot actually opens YouTube Studio.
- The usage report groups some routines as "Deleted routines" or "Other routines". Those are not listed.

### 10.4 Stays on connector

A routine stays on its connector wherever that connector already works. Only browser-only steps move to the extension.

| Connector | Stays for | Browser-only step that moves (as a reader) |
|---|---|---|
| X (`x` namespace) | Post metrics, mentions, replies, quotes (`x-monitor`) | X Articles impressions (R2) |
| Unikorn MCP | Changelog posts, product updates, roadmap | Product page rank, points, views and comments snapshot (R12). Image attach is a write: Later |
| GitHub (`gh`, GitHub MCP) | Releases, issues, PRs, awesome-list PRs and checks | none |
| Gmail, Google Calendar, Drive, Notion | Mail, calendar, files, Notion pages | none |
| YouTube (TubeAlfred), TikTok for Business, Typeform connectors | Whatever they already return | YouTube Studio numbers the connector lacks (R3); confirm field by field |
| `jev-read` / `jev-qa` | Logged-out reads and QA smoke tests | Only reads that need the signed-in session (R14) |

### 10.5 Migration order

1. **Phase 0, prerequisites (Dev, in flight):** #4 ARIA readers, #5 `/rpc` auth, #6 `browser_act` allowlist, #7 `doctor`. Merges need Jang's approval.
2. **Phase 1, foundations:** F1 cache, F2 pacing + audit log, F3 account guard, F4 evidence + redaction. QA accepts each on fixtures and on one live read with Jang present.
3. **Phase 2, daily readers:** R1, R2, R5, R6, R8, then R3, R4, R7. Each runs in **shadow mode** first: the routine keeps its current route and also calls the reader, and the bot compares the two for 3 runs. The routine switches only after Jang approves that switch.
4. **Phase 3, occasional readers:** R9–R14, with the same shadow-then-approve rule.
5. **Later:** write and post actions (section 11), only if Jang asks.

**No routine switches over until Jang approves that routine's switch.** Approval is per routine, in Jang's own words, recorded in the routine's issue.

## 11. Later (out of scope for now)

These keep their current routes (box browser computerUse, connectors). Per decision 0.2, no issues are opened for them now. If Jang asks for one, it gets its own spec section and issue.

| Item | Current route | Why later |
|---|---|---|
| Post queue that posts only with an approval token bound to the exact approved text (token = SHA-256 of the exact text + destination + action, single use; any character change blocks) | Box browser posting with `pre-publish` hash checks and `post-log` | Write action. Jang re-centred the extension on reading (18:14 ICT). The model is recorded here so it isn't lost. |
| Paced Facebook Following cleanup (unfollow) with "Đang tải..." stall handling | J routine, box browser | Write action. The read half (who is followed, stall detection) is R7. |
| YouTube metadata apply from an approval pack | Growth, box browser | Write action. |
| Unikorn changelog image attach (and changelog edit) | Unikorn, browser (the MCP has no image field) | Write action. |
| Posting, commenting, upvoting, following and hunting routines (Reddit, PH, LinkedIn, Threads, X, Facebook) | Box browser / X connector | Write actions. |
| Directory form submission | Growth, box browser | Write action. The live check is R11. |
| Shared approval gate and an in-browser approval panel listing items waiting for Jang | Chat approvals (Jang's own words, via J or the owning bot) | Only write actions need them. No reader needs an approval. |

## 12. Security

- Builds on #5: every `/rpc` and cache call needs the pairing token, Host and Origin are checked, and the token is never printed.
- Builds on #6: readers never use `browser_act`. A reader path that dispatches any input event fails its tests.
- Readers navigate only to hosts their adapter declares. The `generic` adapter refuses loopback and private addresses, `file:` and `chrome:` URLs.
- Page text is untrusted data. Hidden instructions found on pages (seen on Threads on 12/11) are recorded in `notes` as `PAGE_INSTRUCTION_IGNORED` and never acted on.
- The cache, evidence and audit folders are mode 0700/0600 and never committed.
- No internal or private APIs, no replayed requests, and no cookies or tokens read by code (`linkedin-account-safety`).

## 13. Open questions

| ID | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | LinkedIn unattended budget: keep the existing 120 RPC reads/hour, or 30 page loads/hour as in 7.1? | (a) 120/h (b) 30/h | (b) for routines; pilots with Jang present may go higher. |
| Q2 | Where do routine bots run readers: the signed-in box Chrome only, or Jang's Mac Chrome too? | (a) box only (b) both | (a) until Phase 2 is accepted. |
| Q3 | Third-party comment text on Jang's posts: keep it in clear in the cache (needed to draft replies) or hash it? | (a) keep, never commit (b) hash | (a). |
| Q4 | How long to keep following/follower lists? | (a) 30 days (b) until replaced | (a). |
| Q5 | The 3-tier pre-sort: System One or LLM? | (a) a System One set like `x_triage` (b) LLM | (a), with the LLM below 0.7 (COORDINATION rule 18). |
| Q6 | Should logged-out link/proof checks move at all, or stay on `jev-read`? | (a) stay (b) move | (a). The signed-in profile adds account risk and gains nothing on public pages. |

## 14. Issue map

| Idea / routine | Issue |
|---|---|
| Umbrella tracking | #8 |
| F1 Shared reader cache, schema, freshness | #9 |
| F2 Pacing budget, back-off, audit log | #10 |
| F3 Account guard | #11 |
| F4 Evidence recorder + redaction | #12 |
| R1 LinkedIn nightly analytics snapshot | #13 |
| R2 X metrics incl. Articles impressions (J "X nightly metrics") | #14 |
| R3 YouTube Studio + Product Hunt metrics (J "YouTube growth daily", Unikorn PH checks) | #15 |
| R4 Reddit metrics | #16 |
| R5 Unified comment and mention feed, 3 tiers (J "X reply monitor" via connector) | #17 |
| R6 Engagement scout (Community "Daily social engagement batch") | #18 |
| R7 Following / follower lists (J "FB personal unfollow batches", read step) | #19 |
| R8 Duplicate-text lookup (Community paced batches; pre-check for every posting routine) | #20 |
| R9 Profile link checker (Growth profile-links) | #21 |
| R10 Subreddit rules and flair reader | #22 |
| R11 Listings and competitor pages (Growth daily auto-research) | #23 |
| R12 Unikorn page + comments snapshot (Unikorn daily care) | #24 |
| R13 Job board reader (Career morning digest) | #25 |
| R14 Link and proof checks that need the signed-in session | #26 |
| Post queue + approval token, FB unfollow cleanup, YouTube metadata apply, Unikorn image attach, approval gate, approval panel, posting/upvoting routines | Later, no issue (section 11) |
| Dev prerequisites | #4, #5, #6, #7 |
