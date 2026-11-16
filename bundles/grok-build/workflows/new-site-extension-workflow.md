# New Site Extension & Adapter Workflow (`design-os-browser-extension`)

Standard engineering workflow for AI Agents using the `knowledge/agent-browser-extensions/` (`UKMC.v2`) knowledge pack and `design-os-browser-extension` runtime engine to support a new web application beyond LinkedIn.

## Step 1 — Classify Target Barriers via `UKMC.v2` Knowledge Graph

Query the compiled ontology index before designing content scripts or transport:

```bash
export PYTHONPATH="${KNOWLEDGE_BUILDER_REPO:-../design-os-knowledge-builder}/src"
P="knowledge/agent-browser-extensions"

python3 -m knowledge_builder.cli query --root "$P" --object-type interaction-barrier --fields id,object_type,path
python3 -m knowledge_builder.cli query --root "$P" --object-type bridge-primitive --fields id,object_type,path,links_out
```

Classify the target site:
- **Strict CSP (`script-src 'self'`):** Declare `"world": "MAIN"` in manifest at `document_start`; communicate via native bound `window.postMessage` filtered by `event.source === window && event.origin === window.location.origin`.
- **Anti-Bot Sensitive Property:** Keep `"debugger"` out of permissions (`debuggerAttached: false`); use semantic DOM/ARIA + passive `fetch`/`XHR` response tapping instead of headless CDP bots or hardcoded GraphQL hashes.
- **Closed Shadow DOM / Cross-Origin OOPiF (Internal Tools / Explicitly Authorized):** Apply Capability-Tiered Adapter cleanly onto Tier-1 Chromium while keeping Tier-2 Firefox / Tier-3 Safari safe fallbacks.

## Step 2 — Extend Shared Contracts (`shared/`)

1. Add domain schemas and typed RPC action names in `shared/<domain>-schema.ts` (TypeScript `>= 7.0.2`).
2. Reuse `PageFence`, `HumanGateState`, `DispatchOutcome`, and `CallerOrigin` from `shared/rpc-envelope.ts`.

## Step 3 — Implement Passive + DOM Extractors (`extension/`)

1. Add `extension/src/adapters/<domain>/` modules (`< 200` lines per file cleanly separated into normalizer, DOM extractor, and safe composer/writer).
2. Wire new actions into `extension/src/content/isolated-bridge.ts` and the unified `ExtensionEngine.handleRpc(req, trustedOrigin)` switch in `extension/src/background/engine.ts`.
3. Update `host_permissions` and `content_scripts.matches` identically in BOTH `extension/manifests/chromium.manifest.json` and `extension/manifests/firefox.manifest.json`.

## Step 4 — Expose CLI, SQLite Cache & MCP Tools (`cli/`)

1. Add indexing tables/upserts to `cli/src/db/sqlite-cache.ts` (read-only `SELECT`/`WITH` access preserved).
2. Add subcommands in `cli/src/commands/dispatch.ts` and tool schemas in `cli/src/mcp/stdio-server.ts`.

## Step 5 — Regenerate Contract, Host Bundles & Verify

```bash
node scripts/skill_contract.mjs
node scripts/sync_host_bundles.mjs
npm run typecheck
npm run build
npm test
python3 scripts/self_check.py
```

Capture real Chromium visual evidence (`scripts/e2e_visual_proof.mjs` / `skills/es-browser-agent/look.mjs`) before committing.
