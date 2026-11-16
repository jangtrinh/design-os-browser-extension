# DESIGN:OS Browser Extension (`design-os-browser-extension`)

**Ontology-first cross-browser WebExtension engineering knowledge pack (`UKMC.v2`), Capability-Tiered Agent RPC bridge, and LinkedIn Zero-Drift Hybrid Adapter for AI agents operating inside real signed-in browsers.**

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm_Shield_1.0.0-202020?style=flat-square&labelColor=202020&color=444444" alt="PolyForm Shield 1.0.0 License"></a>
  <img src="https://img.shields.io/badge/TypeScript-7.0.2+-202020?style=flat-square&labelColor=202020&color=444444" alt="TypeScript 7.0.2+">
  <img src="https://img.shields.io/badge/Claude_Code_%C2%B7_Codex_%C2%B7_Gemini_%C2%B7_Antigravity-skill-202020?style=flat-square&labelColor=202020&color=444444" alt="Compatible agents">
  <img src="https://img.shields.io/badge/knowledge-UKMC.v2_Verified-202020?style=flat-square&labelColor=202020&color=444444" alt="UKMC.v2 Knowledge Pack">
</p>

---

## Why this exists

Generic browser-extension snippets fail when AI agents build bridges for real user browsers: Chrome 136+ blocks `--remote-debugging-port` on default profiles, MV3 service workers terminate after 30 seconds of idle time, synthetic `.click()` emits `isTrusted: false`, closed Shadow DOM and cross-origin OOPiFs hide controls, Firefox MV3 rejects `background.service_worker`, and brittle site scrapers hardcode internal API hashes that break on every deploy.

`design-os-browser-extension` is a local-first, source-available **DESIGN:OS** workspace pairing a machine-verified `UKMC.v2` knowledge pack ([`knowledge/agent-browser-extensions/`](knowledge/agent-browser-extensions/)) with a compiled **TypeScript 7.0.2+ Agent RPC WebExtension Engine**, a **LinkedIn Zero-Drift Hybrid Adapter**, a **`node:sqlite` cache**, a JSON **`browser-agent` CLI**, and a **12-tool MCP stdio server**.

---

## Workspace Layout

| Directory / File | Purpose | Status |
| :--- | :--- | :--- |
| [`knowledge/agent-browser-extensions/`](knowledge/agent-browser-extensions/) | Verified `UKMC.v2` knowledge pack (6 modules, 32 claims, 27 sources, 18 entities, 0 verify failures) | Ready & Independently Reviewed |
| [`shared/`](shared/) | Typed `Agent RPC` envelope, capability schema, UTF-8 native framing, and LinkedIn schemas | Implemented & Typechecked |
| [`extension/`](extension/) | Cross-browser MV3 engine (`chromium` + `firefox`), `Page Epoch` store, Operate popup, and LinkedIn adapter | Built (`extension/dist/{chromium,firefox}`) |
| [`cli/`](cli/) | Loopback WebSocket broker (`127.0.0.1:4347`), `node:sqlite` cache, `browser-agent` CLI, and MCP stdio server | Built (`cli/dist/browser-agent.js`) |
| [`skills/design-os-browser-agent/SKILL.md`](skills/design-os-browser-agent/SKILL.md) | Agent runtime guide + host manifests ([`.claude-plugin/`](.claude-plugin/plugin.json), [`.codex-plugin/`](.codex-plugin/plugin.json), [`.mcp.json`](.mcp.json)) | Ready |
| [`tests/`](tests/) | Unit & integration suite (`vitest`) covering fencing, Human Gate Handoff, passive normalizer, SQLite, and MCP | Passing |
| [`scripts/`](scripts/) | Esbuild bundler (`build.mjs`), live Chromium MV3 E2E proof (`e2e_visual_proof.mjs`), and `self_check.py` | Ready |

---

## Architecture Highlights

1. **Zero-Drift Hybrid LinkedIn Reader (`extension/src/adapters/linkedin/`):** Combines semantic DOM/ARIA + hydration extraction (`ISOLATED` world) with a passive `MAIN`-world response observer (`passive-observer.ts` loaded at `document_start`) capturing `/voyager/api/` normalized `included[]` entities across rotated `queryId` hashes — **0 hardcoded query hashes, 0 synthetic API calls, and 0 `chrome.debugger` permissions**.
2. **Fenced Dispatch & Page Epoch (`extension/src/core/page-epoch-store.ts`):** Every action checks `(tabId, pageId, epoch, leaseId)` stored in `storage.session`, rejects stale navigation refs (`BROWSER_PAGE_STALE`), and retires timed-out actions to `UNCERTAIN` (`retryable: false`).
3. **Human-Only Copilot Approval Queue (`extension/src/adapters/linkedin/copilot-composer.ts`):** `linkedin.draft.create` pre-fills the visible composer without clicking Send (`sent: false`). Only clicks inside `extension-popup` may mark queue items approved (`agent-rpc` self-approval is refused with `BLOCKED_POLICY`).
4. **Human Gate Handoff (`extension/src/core/human-gate-detector.ts`):** URL checkpoints (`/checkpoint/`, `/authwall`, `/premium/`), CAPTCHA iframes, and HTTP `429`/`451` signals immediately transition to `BLOCKED_CHALLENGE`, `BLOCKED_AUTH`, or `BLOCKED_PAYMENT` for manual resolution in the open tab.
5. **Local SQLite Cache & Dual Agent Surface (`cli/`):** Reads auto-persist into `node:sqlite` for sub-5ms read-only `SELECT` / `WITH` queries over CLI (`browser-agent linkedin cache`) or MCP (`linkedin_query_cache`).

---

## Quickstart & Commands

Install dependencies and verify builds + live Chromium MV3 E2E tests (Node `>= 22`, Python `>= 3.10`, TypeScript `>= 7.0.2`):

```bash
npm install
npm run typecheck
npm run build
npm test
npm run test:e2e
python3 scripts/self_check.py
```

Run the local broker and connect your browser extension (`127.0.0.1:4347`):

```bash
# 1. Print your local pairing token and start the broker
node cli/dist/browser-agent.js daemon token --json
node cli/dist/browser-agent.js daemon start

# 2. Load unpacked in Chrome/Arc/Brave: extension/dist/chromium
#    Or load temporary add-on in Firefox 128+: extension/dist/firefox/manifest.json
#    Open the extension popup -> paste pairing token -> Save & Connect.

# 3. Query active LinkedIn tab or local SQLite cache as JSON
node cli/dist/browser-agent.js linkedin status --json
node cli/dist/browser-agent.js linkedin profile --json
node cli/dist/browser-agent.js linkedin search --category people --query "AI" --json
node cli/dist/browser-agent.js linkedin draft --kind message --target linh-nguyen --body "Hi Linh..." --prefill --json
node cli/dist/browser-agent.js linkedin cache --sql "SELECT public_identifier, full_name, source FROM profiles LIMIT 20" --json

# 4. Run stdio MCP server (configured in .mcp.json)
node cli/dist/browser-agent.js mcp
```

---

## Use with your AI Agent — Skills & Workflows

Install the canonical skill and workflows into Claude Code, Codex CLI, Antigravity, and Gemini CLI directly from this checkout:

```bash
node scripts/skill_contract.mjs
node scripts/sync_host_bundles.mjs --install-local
```

- **Skill entrypoints:** [`skills/es-browser-agent/SKILL.md`](skills/es-browser-agent/SKILL.md), [`rules.md`](skills/es-browser-agent/rules.md), [`look.md`](skills/es-browser-agent/look.md), and [`contract.md`](skills/es-browser-agent/contract.md).
- **Agent interaction workflows:** [`workflows/linkedin-agent-workflow.md`](workflows/linkedin-agent-workflow.md) (LinkedIn Search/Read/Cache/Copilot/Handoff SOP) and [`workflows/new-site-extension-workflow.md`](workflows/new-site-extension-workflow.md) (building new adapters from `knowledge/agent-browser-extensions/`).
- **Portable host bundles:** `bundles/claude-code`, `bundles/codex`, `bundles/gemini`, `bundles/grok-build` (verified via `node scripts/sync_host_bundles.mjs --check`).

Query the underlying `UKMC.v2` knowledge pack via [`design-os-knowledge-builder`](https://github.com/jangtrinh/design-os-knowledge-builder):

```bash
export PYTHONPATH="${KNOWLEDGE_BUILDER_REPO:-../design-os-knowledge-builder}/src"
P="knowledge/agent-browser-extensions"

python3 -m knowledge_builder.cli pack check --root "$P"
python3 -m knowledge_builder.cli query --root "$P" --object-type bridge-primitive --fields id,object_type,path
python3 "${KNOWLEDGE_BUILDER_REPO:-../design-os-knowledge-builder}/skills/es-knowledge-forge/validate.py" --root "$P"
```

---

## Governance & License

- **Security & Privacy**: Zero telemetry — see [`SECURITY.md`](SECURITY.md) and [`PRIVACY.md`](PRIVACY.md).
- **Contributing & Conduct**: See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- **Changelog & LLM Index**: Track updates in [`CHANGELOG.md`](CHANGELOG.md) and [`llms.txt`](llms.txt).
- **License**: [PolyForm Shield 1.0.0](LICENSE) © [Jang Trinh](https://github.com/jangtrinh). Source-available: free to use and modify, including for paid client work; you may not resell it or build a competing product from it.
