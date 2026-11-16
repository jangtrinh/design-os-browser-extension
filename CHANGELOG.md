# Changelog

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
