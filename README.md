# DESIGN:OS Browser Extension

<p>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/cover-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/readme/cover-light.png">
  <img src="docs/images/readme/cover-dark.png" alt="design:os by Jang" width="100%">
</picture>
</p>

A browser extension that lets an AI agent read and, with your approval, act inside your own signed-in browser. Version 0.3.0 has a Chromium and Firefox MV3 extension, a loopback broker on `127.0.0.1:4347`, a `browser-agent` CLI, a stdio MCP server with 22 tools, and a `node:sqlite` cache. It grew out of a `UKMC.v2` research pack in [`knowledge/agent-browser-extensions/`](knowledge/agent-browser-extensions/), built with [`design-os-knowledge-builder`](https://github.com/jangtrinh/design-os-knowledge-builder).

Reads come from the page you have open, through its accessibility tree. Anything that writes (send, post, comment, connect, typing, form submits) is blocked until you click **Allow once** in the extension popup. Safari is researched but not packaged.

FREE + source-available ([PolyForm Shield 1.0.0](LICENSE)). No telemetry. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

<p>
  <a href="#quickstart">Quickstart</a> · <a href="#how-it-works">How it works</a> · <a href="#use-with-your-ai-agent">Use with your agent</a> · <a href="#what-the-pack-covers">Research pack</a> · <a href="#repository-layout">Layout</a> · <a href="#limits">Limits</a>
</p>

## Quickstart

Needs Node 22 or later (for `node:sqlite`) and Python 3.10 or later. TypeScript 7.0.2 and Vitest come in as dev dependencies.

```bash
git clone https://github.com/jangtrinh/design-os-browser-extension.git
cd design-os-browser-extension

npm ci
npm run typecheck
npm run build
npm test                                   # 17 Vitest suites, 79 tests
python3 scripts/self_check.py --require-build
```

Connect your own Chromium or Firefox:

```bash
# 1. Print the pairing token and start the loopback broker
node cli/dist/browser-agent.js daemon token --reveal --json
node cli/dist/browser-agent.js daemon start

# 2. Load the unpacked extension
#    Chromium (Chrome, Arc, Brave): extension/dist/chromium
#    Firefox 128+: about:debugging -> extension/dist/firefox/manifest.json
#    Open the popup, paste the pairing token, then Save & Connect.

# 3. Read from an open LinkedIn tab or from the local cache
node cli/dist/browser-agent.js linkedin status --json
node cli/dist/browser-agent.js linkedin profile --json
node cli/dist/browser-agent.js linkedin draft --kind message --target <public-id> --body "Hi" --prefill --json
node cli/dist/browser-agent.js linkedin cache --sql "SELECT public_identifier, full_name, source FROM profiles LIMIT 20" --json

# 4. The shared readers, the MCP server, and the fixture E2E run
node cli/dist/browser-agent.js reader list --json
node cli/dist/browser-agent.js mcp
npm run test:e2e
```

`browser-agent --help` lists every command. To query the research pack, clone [`design-os-knowledge-builder`](https://github.com/jangtrinh/design-os-knowledge-builder) next to this repository:

```bash
export PYTHONPATH="${KNOWLEDGE_BUILDER_REPO:-../design-os-knowledge-builder}/src"
P="knowledge/agent-browser-extensions"
python3 -m knowledge_builder.cli pack status --root "$P"
python3 -m knowledge_builder.cli pack check --root "$P"
python3 -m knowledge_builder.cli query --root "$P" --object-type bridge-primitive --fields id,object_type,path
```

## How it works

<p>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/flow-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/readme/flow-light.png">
  <img src="docs/images/readme/flow-dark.png" alt="design:os by Jang" width="100%">
</picture>
</p>

1. **Reads from the accessibility tree.** The LinkedIn adapter (`extension/src/adapters/linkedin/`) reads profile, post, feed, search, analytics and comments in the `ISOLATED` world by role and accessible name. The older `/voyager/api/` JSON tap captured 0 entities in the [2026-11-16 live pilot](docs/pilot/2026-11-16-linkedin-live/README.md), so it was dropped. The `MAIN`-world `passive-observer.ts` only watches the page's own HTTP `429` and `451` statuses and never reads response bodies. The manifest asks for `storage`, `tabs` and `alarms`; there is no `chrome.debugger`.
2. **Fenced writes.** Every UI action carries `(tabId, pageId, epoch, leaseId)` from `storage.session` (`extension/src/core/page-epoch-store.ts`). A stale page returns `BROWSER_PAGE_STALE`, and a write that times out becomes `UNCERTAIN` and is not retried.
3. **A human on every write.** `browser_act` runs only `click_ref` and `fill_ref`, and only on allowlisted hosts (LinkedIn and local fixtures). Clicks that navigate, expand or paginate count as reads. Anything that writes returns `BLOCKED_POLICY` with an `approvalId` until you click **Allow once** in the popup. The approval is single-use, bound to that ref, tab, epoch and text, and expires after 2 minutes (`extension/src/core/act-approvals.ts`). Drafts are pre-filled but never sent (`sent: false`).
4. **Hand back to the person.** Checkpoint and auth-wall URLs, CAPTCHA frames and `429`/`451` responses stop the run with `BLOCKED_CHALLENGE`, `BLOCKED_AUTH` or `BLOCKED_PAYMENT`, so you can resolve them in the open tab (`extension/src/core/human-gate-detector.ts`).
5. **Local broker and cache.** The CLI broker listens on `127.0.0.1:4347` and requires the pairing token on `/rpc` and `/cache/query`. Reads are stored in `node:sqlite` and can be queried with read-only `SELECT` or `WITH` statements from the CLI or MCP (`linkedin_query_cache`, `reader_query_cache`).
6. **Shared readers (`dos.reader.v1`).** A read-only layer for scheduled routines: 18 reader views across 10 sites (`linkedin`, `x`, `youtube-studio`, `producthunt`, `reddit`, `threads`, `facebook` following lists, `unikorn`, `jobs`, `generic`), 4 checks (`duplicate_text`, `profile_links`, `link_status`, `subreddit_rules`), a per-site pacing budget with back-off, an Account Guard that pauses a site until you resume it (`PAUSED_BY_GUARD`), and redacted evidence bundles. The spec is [`docs/specs/shared-browser-layer.md`](docs/specs/shared-browser-layer.md).

## Use with your AI agent

Check the skill contract, then copy the skill into `~/.claude/skills/`, `~/.gemini/config/skills/` and `~/.agents/skills/` (an existing `es-browser-agent` folder there is replaced):

```bash
node scripts/skill_contract.mjs
node scripts/sync_host_bundles.mjs --install-local
```

- Skill: [`skills/es-browser-agent/SKILL.md`](skills/es-browser-agent/SKILL.md), with [`concepts.md`](skills/es-browser-agent/concepts.md), [`rules.md`](skills/es-browser-agent/rules.md), [`look.md`](skills/es-browser-agent/look.md) and the source-bound [`contract.md`](skills/es-browser-agent/contract.md).
- Workflows: [`workflows/linkedin-agent-workflow.md`](workflows/linkedin-agent-workflow.md), [`workflows/new-site-extension-workflow.md`](workflows/new-site-extension-workflow.md), and the commands [`commands/linkedin.md`](commands/linkedin.md) and [`commands/doctor.md`](commands/doctor.md).
- Host bundles: synced copies under `bundles/{claude-code,codex,gemini,grok-build}/`, plus `.mcp.json`, `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/` and `.grok-plugin/`. `node scripts/sync_host_bundles.mjs --check` confirms they match.

## What the pack covers

This is the real `look.py` sheet for the pack, rendered by knowledge-builder from `index.json` and the run ledger. The local checkout path in its header is barred out; nothing else is edited.

<p>
<img src="docs/images/readme/look-sheet-agent-browser-extensions.png" alt="design:os by Jang" width="100%">
</p>

<sub>design:os by Jang</sub>

The research starts from problems an agent hits in a real browser, each backed by a claim in the pack:

- Chrome 136 ignores `--remote-debugging-port` on the default user data directory.
- Chrome stops an MV3 extension service worker after 30 seconds of inactivity; a 20-second WebSocket keepalive resets that timer.
- Clicks sent with `HTMLElement.click()` or `dispatchEvent()` carry `isTrusted: false`.
- Firefox MV3 rejects `background.service_worker` and runs event pages through `background.scripts`.
- Safari web extensions ship inside a native Xcode app container for App Store distribution.
- Native Messaging caps one message at 1 MB from the host and 64 MiB to the host.

The six documents:

| Document | Type | Covers |
| :--- | :--- | :--- |
| [`cross-browser-capability-matrix.md`](knowledge/agent-browser-extensions/cross-browser-capability-matrix.md) | comparison | What Chromium, Firefox and Safari each allow, and the `service_worker` versus `background.scripts` split |
| [`transport-and-mv3-lifecycle.md`](knowledge/agent-browser-extensions/transport-and-mv3-lifecycle.md) | guide | Native Messaging framing and size caps, a `127.0.0.1` WebSocket with keepalive, `storage.session` recovery |
| [`execution-worlds-and-state-reading.md`](knowledge/agent-browser-extensions/execution-worlds-and-state-reading.md) | guide | `ISOLATED` and `MAIN` worlds, page CSP, reading SPA state, `chrome.offscreen` |
| [`trusted-input-shadow-and-oopif.md`](knowledge/agent-browser-extensions/trusted-input-shadow-and-oopif.md) | guide | `isTrusted`, `chrome.debugger` `Input.*`, out-of-process iframes, closed shadow roots, WebDriver BiDi |
| [`fast-snapshot-and-fenced-dispatch.md`](knowledge/agent-browser-extensions/fast-snapshot-and-fenced-dispatch.md) | guide | Compact DOM snapshots and `pageId` / `epoch` / `lease` fencing before any write |
| [`security-and-human-handoff.md`](knowledge/agent-browser-extensions/security-and-human-handoff.md) | decision record | Treating page text as untrusted, `sender.origin` checks, `activeTab`, and handing CAPTCHAs, sign-ins and payments back to the person |

The 18 entities are 3 browser engines, 8 bridge primitives and 7 interaction barriers. Canonical glossary terms live in [CONTEXT.md](CONTEXT.md).

## Repository layout

| Path | What is there |
| :--- | :--- |
| [`knowledge/agent-browser-extensions/`](knowledge/agent-browser-extensions/) | The `UKMC.v2` pack: `ontology.yaml`, 6 documents, 32 claims, 27 sources, 18 entities, `index.json`, `_evidence/` |
| [`shared/`](shared/) | TypeScript Agent RPC envelope, capability tiers, 32-bit native framing, LinkedIn schemas |
| [`extension/`](extension/) | Chromium and Firefox MV3 source and builds, page epoch store, popup, site adapters |
| [`cli/`](cli/) | Loopback broker, `node:sqlite` cache, `browser-agent` CLI, MCP stdio server, shared readers |
| [`skills/es-browser-agent/`](skills/es-browser-agent/), [`workflows/`](workflows/), [`commands/`](commands/), [`bundles/`](bundles/) | Agent skill, playbooks and synced host bundles |
| [`tests/`](tests/) | 17 Vitest suites (79 tests): fencing, human gates, normalizer, SQLite and MCP, manifests, skill gates, shared readers |
| [`scripts/`](scripts/) | `build.mjs`, `e2e_visual_proof.mjs`, `skill_contract.mjs`, `sync_host_bundles.mjs`, `self_check.py`, `verify_bridge_primitives.py` |
| [`docs/`](docs/) | The shared browser layer spec and the 2026-11-16 LinkedIn pilot |

## Limits

- Safari is not packaged. A Safari web extension needs a native macOS or iOS app container; see [`cross-browser-capability-matrix.md`](knowledge/agent-browser-extensions/cross-browser-capability-matrix.md).
- The extension asks for host access to every `https://` site (`https://*/*`) so the readers can work across sites. Writes are still limited to the allowlisted hosts and need your approval.
- The research pack's gate is `DEEPEN` (0 of 3 low-delta rounds). Treat it as a strong first round, not a finished survey.
- `npm run test:e2e` drives Chrome for Testing against local fixture pages, not live accounts. Live site readers run only inside your signed-in session and can break when a site changes its markup.
- The extension is loaded unpacked; it is not published to the Chrome Web Store or Firefox Add-ons.

## DESIGN:OS

Browser Extension is one of the DESIGN:OS tools. The others: [Studio](https://github.com/jangtrinh/design-os-studio), [CLI](https://github.com/jangtrinh/design-os), [Bridge](https://github.com/jangtrinh/design-os-figma-plugin), [SVG Animation](https://github.com/jangtrinh/design-os-svg-animation), [3D Blender](https://github.com/jangtrinh/design-os-3d-blender), [Knowledge Builder](https://github.com/jangtrinh/design-os-knowledge-builder) and [mcp-bridge-go](https://github.com/jangtrinh/mcp-bridge-go). More on [jangtrinh.github.io](https://jangtrinh.github.io/).

Changelog: [CHANGELOG.md](CHANGELOG.md) · Index for AI agents: [llms.txt](llms.txt) · Agent rules: [AGENTS.md](AGENTS.md)

## Contributing and license

- [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md)
- [PolyForm Shield 1.0.0](LICENSE). FREE to use and modify, including for paid client work; you may not resell it or build a competing product from it.

If `design-os-browser-extension` saves you time, a star on GitHub helps other engineers and AI agents find it.

<p align="left">
  <a href="https://buymeacoffee.com/jangtrinh">
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee">
  </a>
</p>

Built by [Jang Trịnh](https://github.com/jangtrinh), creative technologist and autonomous system architect.

[GitHub](https://github.com/jangtrinh) · [LinkedIn](https://www.linkedin.com/in/jangtrinh/) · [Hub](https://jangtrinh.github.io/) · [YouTube](https://www.youtube.com/@designosbyjang) · [X](https://x.com/Jangtrinhvn)
