# Changelog

## 0.3.0 — 2026-11-16

### Added
- Implemented Shared Browser Layer (`dos.reader.v1`, Issues #8–#26) for unattended multi-bot daily routines:
  - **Wave 1 Foundations (#9–#12):** Shared reader cache (`reader_results`, `reader_latest`, `reader_series` in SQLite), shared per-site pacing budgets and back-off, human-gated Account Guard (`PAUSED_BY_GUARD`), and evidence recorder with `third-party-v1` redaction policy.
  - **Wave 2 Daily Readers (#13–#20):** 8 high-frequency readers across LinkedIn analytics, X metrics & Articles impressions, YouTube Studio + Product Hunt metrics, Reddit metrics, unified 3-tier comment/mention feeds, engagement scout, following/follower lists, and duplicate-text lookup.
  - **Wave 3 Occasional Readers & Checks (#21–#26):** Profile link checker, subreddit rules/flair reader, directory listings/competitor pages reader, Unikorn product snapshot, job boards reader, and signed-in link/proof checks.
  - **Account Guard Popup UI:** `#guard-panel` in extension popup displaying paused site guards with human-only `"Resolved, resume"` button and audit logging.
  - **22-Tool MCP Stdio Server:** Expanded stdio MCP server from 14 to 22 tools with `reader_list`, `reader_read`, `reader_check`, `reader_query_cache`, `pacing_status`, `guard_status`, `evidence_get`, and `audit_query`.

## 0.2.0 — 2026-11-16

### Added
- Implemented TypeScript `7.0.2+` shared contracts (`shared/`), cross-browser MV3 engine (`extension/dist/{chromium,firefox}`), loopback WebSocket broker (`127.0.0.1:4347`), `node:sqlite` cache, `browser-agent` CLI (`--json`), and 12-tool MCP stdio server.
- Built LinkedIn Zero-Drift Hybrid Adapter (`passive-observer.ts` at `document_start`, structural Voyager `included[]` normalizer, semantic DOM/ARIA extractors, and human-gated Copilot Approval Queue + safe prefill).
- Added Operate-mode extension popup UI verified cleanly by `ui gate` and `slop-detect`.
- Built `skills/es-browser-agent/` following the `es:skill-forge v2` tool-product profile (`SKILL.md`, `concepts.md`, `rules.md`, `look.md`, source-bound `contract.md`, `build.mjs`, `validate.mjs`, `look.mjs`, two verified specs, two reference guides) plus `workflows/`, `commands/`, and synced host bundles (`bundles/{claude-code,codex,gemini,grok-build}`).
- Added Vitest suite (`tests/`) including mechanical acceptance tests (`skill-forge-gate.test.ts` A1–A9) and live Chrome-for-Testing MV3 E2E visual proof (`scripts/e2e_visual_proof.mjs`).

## 0.1.0 — 2026-11-16

### Added
- Initialized `design-os-browser-extension` repository layout (`knowledge/`, `extension/`, `cli/`, `shared/`, `tests/`, `scripts/`).
- Built and verified `knowledge/agent-browser-extensions/` (`UKMC.v2` pack: 6 modules, 32 claims, 27 frozen/executed sources, 18 entities, independent `grok-4.7` cross-runtime review).
- Added portable `scripts/verify_bridge_primitives.py` and `scripts/self_check.py` checks.
