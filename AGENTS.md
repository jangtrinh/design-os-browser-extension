# AGENTS.md — `design-os-browser-extension`

Read [`.project-agent.md`](.project-agent.md) and [`CONTEXT.md`](CONTEXT.md) first. This repository hosts the verified `UKMC.v2` knowledge pack [`knowledge/agent-browser-extensions/`](knowledge/agent-browser-extensions/) and the workspace scaffolding used by AI agents to design, build, and test cross-browser agent extensions.

## Progressive Lookup Protocol (Query Before Authoring)

Query the compiled `index.json` first rather than reading every module file blindly:

```bash
export PYTHONPATH="${KNOWLEDGE_BUILDER_REPO:-../design-os-knowledge-builder}/src"
P="knowledge/agent-browser-extensions"

# 1. List available bridge primitives and their outgoing links
python3 -m knowledge_builder.cli query --root "$P" --object-type bridge-primitive --fields id,object_type,path,links_out

# 2. Find which primitive solves a specific interaction barrier
python3 -m knowledge_builder.cli query --root "$P" --linked-to page-csp-and-isolated-world --link-type overcomes --fields id,object_type,path
python3 -m knowledge_builder.cli query --root "$P" --linked-to untrusted-synthetic-dom-events --link-type overcomes --fields id,object_type,path

# 3. Inspect documents tied to a browser engine (chromium-mv3, firefox-gecko, safari-webkit)
python3 -m knowledge_builder.cli query --root "$P" --linked-to firefox-gecko --link-type about --fields id,object_type,path
```

## Workspace Layout

- `knowledge/agent-browser-extensions/` — Verified `UKMC.v2` ontology-first knowledge pack (`ontology.yaml`, 6 modules, 32 claims, 27 sources, 18 entities).
- `shared/` — Shared TypeScript `>= 7.0.2` `Agent RPC` envelope, capability schema, UTF-8 native framing, and LinkedIn schemas.
- `extension/` — Capability-Tiered WebExtension MV3 engine (`chromium` + `firefox` manifests), `Page Epoch` store, Operate popup, and LinkedIn Zero-Drift Hybrid Adapter.
- `cli/` — Loopback WebSocket broker (`127.0.0.1:4347`), `node:sqlite` cache, `browser-agent` CLI (`--json`), and 14-tool stdio MCP server.
- `skills/es-browser-agent/` — Canonical `es:skill-forge v2` tool-product skill (`SKILL.md`, `rules.md`, `concepts.md`, `look.md`, generated `contract.md`, `build.mjs`, `validate.mjs`, `look.mjs`, `examples/`, `references/`).
- `workflows/` & `commands/` — Agent interaction SOPs (`linkedin-agent-workflow.md`, `new-site-extension-workflow.md`, `doctor.md`, `linkedin.md`).
- `bundles/` — Deterministic synced copies for `claude-code`, `codex`, `gemini`, and `grok-build` (`scripts/sync_host_bundles.mjs`).
- `tests/` — Vitest cross-engine contract, fencing, human-gate, SQLite cache, and MCP suite.
- `scripts/` — Esbuild bundler (`build.mjs`), live Chrome MV3 E2E visual proof harness (`e2e_visual_proof.mjs`), and deterministic self-checks (`verify_bridge_primitives.py`, `self_check.py`).

## Non-Negotiable Architecture & Repo Rules

1. **Capability-Tiered Adapter, Never Lowest-Common-Denominator:** Compile one `Agent RPC` contract across Tier-1 Chromium (`chrome.debugger`, `world: "MAIN"`, `offscreen`) and Tier-2/3 Firefox/Safari (`background.scripts` event pages, `wrappedJSObject`/`MAIN`, Native Messaging / WebDriver BiDi, Safari Xcode App Container).
2. **Fenced Dispatch Only:** Every mutation must enforce `lease`, `epoch`, and `pageId` freshness; never blind-retry `UNCERTAIN` timed-out writes.
3. **Human Gate Handoff Boundary:** Never emit CAPTCHA solvers, anti-bot evasion, or auth bypasses. Route challenges, logins/2FA, and payments to `BLOCKED_CHALLENGE` / `BLOCKED_AUTH` / `BLOCKED_PAYMENT` for direct human resolution in the browser pane.
4. **Never Hand-Edit Claims, Sources, or `index.json`:** Extend the pack exclusively through `knowledge_builder.cli` (`ingest --freeze` -> `run record` -> `promote-claim` -> `index` -> cross-runtime `run review` -> `validate.py`).
5. **Development & Git Discipline:** Keep code files modular (<200 lines where sensible), run `python3 scripts/self_check.py` before committing, use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), and keep commit messages free of AI tool references or secrets.

## [IMPORTANT] ES Workflow (mandatory)

- Every coding task: apply the `/es:lazy` ladder — reuse codebase → stdlib → native platform → installed dep → one line → only then minimum code. Deliberate corner-cuts carry an `es-debt: <ceiling>, <upgrade trigger>` comment.
- Every feature request: route through `/es:feature-dev` (classify → brainstorm → plan → dev → review). Never skip straight to code on non-trivial work.
- Use `CONTEXT.md` canonical terms in all naming (code, plans, commits); never use terms listed under `_Avoid_`. New terms crystallise via `/es:brainstorm` grilling.
- An es-* skill misled or lacks a rule? Do NOT patch the skill mid-task — record a `gap` in the evolution ledger (`/es:librarian` branch `record`); `/es:librarian run` graduates it with a judge + human merge.
- End of ANY substantial task (pipeline or not): Reflect — distil AT MOST ONE durable lesson. Product lesson → `.brv`/`CONTEXT.md`; kit lesson → `gap`; nothing durable → record NOTHING.
