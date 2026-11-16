# Building a New Site Extension Adapter (`es-browser-agent`)

Follow this sequence whenever extending `design-os-browser-extension` to a new target web app (CRM, SaaS portal, internal dashboard, documentation app) beyond LinkedIn.

## 1. Query the `UKMC.v2` Knowledge Pack First

Do not invent ad-hoc workarounds. Inspect the machine-verified `bridge-primitive` and `interaction-barrier` objects first:

```bash
export PYTHONPATH="../design-os-knowledge-builder/src"
P="knowledge/agent-browser-extensions"

python3 -m knowledge_builder.cli query --root "$P" --object-type bridge-primitive --fields id,object_type,path,links_out
python3 -m knowledge_builder.cli query --root "$P" --linked-to page-csp-and-isolated-world --link-type overcomes --fields id,object_type,path
```

## 2. Capability & World Decision Table

| Target App Barrier | Required Architecture Choice | Forbidden Choice |
| --- | --- | --- |
| Anti-bot sensitive site (LinkedIn, social SaaS) | Semantic `ISOLATED` DOM/ARIA + `MAIN`-world passive response tap; `debuggerAttached: false` | Enabling `"debugger"` permission or headless Playwright CDP |
| SPA with strict inline-script CSP (`script-src 'self'`) | Manifest-declared `world: "MAIN"` script at `document_start` + origin-checked `postMessage` | Injecting `<script>` tags with inline strings into page DOM |
| Complex Canvas / closed Shadow DOM / cross-origin OOPiF | Check `Capability-Tiered Adapter`: CDP `dom.openOrClosedShadowRoot` / flat `sessionId` ONLY where explicitly authorized and safe | Stripping all browsers down to weak lowest-common-denominator selectors |
| Firefox & Chromium dual shipping | Tier-1 `background.service_worker` manifest + Tier-2 `background.scripts` + `gecko.id` manifest | Maintaining separate Chrome-only and Firefox-only forks of adapter logic |

## 3. Extension Implementation Sequence

1. **Shared Schema (`shared/<domain>-schema.ts`):** Define strict TypeScript `7.0.2+` entity interfaces and action union (`<domain>.*`).
2. **Passive + DOM Extractors (`extension/src/adapters/<domain>/`):** Implement structural entity normalization (never hardcode build hashes) + ARIA/semantic DOM fallbacks.
3. **Wire Engine & Bridge (`extension/src/background/engine.ts` + `extension/src/content/isolated-bridge.ts`):** Register `<domain>.*` actions inside the single `handleRpc(req, trustedOrigin)` switch, inheriting `PageEpochStore`, `HumanGateState`, and `CopilotQueueManager`.
4. **Update Manifests & Contracts:** Add host patterns if needed in `extension/manifests/{chromium,firefox}.manifest.json`, wire CLI + MCP tools in `cli/src/`, then regenerate contract and host bundles:
   ```bash
   node scripts/skill_contract.mjs
   node scripts/sync_host_bundles.mjs
   python3 scripts/self_check.py
   ```

## Right vs Wrong Adapter Design

- **Right:** Route reads and mutations through `PageEpochStore` so SPA route changes mint a new `epoch` and reject stale element refs cleanly.
- **Wrong:** Hold element IDs in MV3 service-worker module globals (`let lastButton`), which vanish after 30s idle termination.
