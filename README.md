# DESIGN:OS Browser Extension (`design-os-browser-extension`)

**Ontology-first cross-browser WebExtension engineering knowledge pack (`UKMC.v2`) and Capability-Tiered Agent RPC workspace for fast, deep, verified AI web interaction.**

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm_Shield_1.0.0-202020?style=flat-square&labelColor=202020&color=444444" alt="PolyForm Shield 1.0.0 License"></a>
  <img src="https://img.shields.io/badge/Claude_Code_%C2%B7_Codex_%C2%B7_Gemini_%C2%B7_Antigravity-skill-202020?style=flat-square&labelColor=202020&color=444444" alt="Compatible agents">
  <img src="https://img.shields.io/badge/knowledge-UKMC.v2_Verified-202020?style=flat-square&labelColor=202020&color=444444" alt="UKMC.v2 Knowledge Pack">
</p>

---

## Why this exists

Generic browser-extension snippets fail when AI agents build bridges for real user browsers: Chrome 136+ blocks `--remote-debugging-port` on default profiles, MV3 service workers terminate after 30 seconds of idle time, synthetic `.click()` emits `isTrusted: false`, closed Shadow DOM and cross-origin OOPiFs hide controls, and Firefox MV3 rejects `background.service_worker` while Safari mandates native Xcode app containers.

`design-os-browser-extension` is a local-first, source-available **DESIGN:OS** workspace containing a machine-verified `UKMC.v2` knowledge pack compiled by [`design-os-knowledge-builder`](https://github.com/jangtrinh/design-os-knowledge-builder) alongside workspace scaffolding (`extension/`, `cli/`, `shared/`, `tests/`) for implementing Capability-Tiered Agent RPC bridges.

---

## Workspace Layout

| Directory | Purpose | Status |
| :--- | :--- | :--- |
| [`knowledge/agent-browser-extensions/`](knowledge/agent-browser-extensions/) | Verified `UKMC.v2` knowledge pack (6 modules, 32 claims, 27 sources, 18 entities, 0 verify failures) | Ready & Independently Reviewed |
| [`extension/`](extension/) | Cross-browser WebExtension source & engine-tiered manifests | Scaffold ready for implementation |
| [`cli/`](cli/) | Host-side Native Messaging stdio / `127.0.0.1` WebSocket agent bridge | Scaffold ready for implementation |
| [`shared/`](shared/) | Shared `Agent RPC` envelope, capability negotiation, and fencing contracts | Scaffold ready for implementation |
| [`tests/`](tests/) | Cross-engine behavioral, fencing, and browser test suite | Scaffold ready for implementation |
| [`scripts/`](scripts/) | Deterministic invariant and repository self-checks (`self_check.py`, `verify_bridge_primitives.py`) | Ready |

---

## Knowledge Modules

1. [`cross-browser-capability-matrix.md`](knowledge/agent-browser-extensions/cross-browser-capability-matrix.md) — Capability-Tiered Engine Adapter across Chromium MV3, Firefox Gecko, and Safari WebKit, plus resolving `service_worker` vs `background.scripts` manifest divergence.
2. [`transport-and-mv3-lifecycle.md`](knowledge/agent-browser-extensions/transport-and-mv3-lifecycle.md) — Native Messaging stdio (32-bit UTF-8 framing, 1 MB/64 MiB bounds), `127.0.0.1` WebSocket 20s keepalive, Chrome 136+ default-profile resilience, and `storage.session` recovery.
3. [`execution-worlds-and-state-reading.md`](knowledge/agent-browser-extensions/execution-worlds-and-state-reading.md) — `ISOLATED` vs `MAIN` execution worlds, page CSP boundaries, prototype-hardened SPA/Fiber state extraction, and `chrome.offscreen`.
4. [`trusted-input-shadow-and-oopif.md`](knowledge/agent-browser-extensions/trusted-input-shadow-and-oopif.md) — `Event.isTrusted`, `chrome.debugger` `Input.*`, flat OOPiF `sessionId` traversal, `dom.openOrClosedShadowRoot`, and WebDriver BiDi fallback.
5. [`fast-snapshot-and-fenced-dispatch.md`](knowledge/agent-browser-extensions/fast-snapshot-and-fenced-dispatch.md) — Compact indexed DOM/AX snapshots and `pageId` / `epoch` / `lease` fencing against navigation races and blind retries.
6. [`security-and-human-handoff.md`](knowledge/agent-browser-extensions/security-and-human-handoff.md) — Untrusted DOM quarantine, `sender.origin` validation, `activeTab` least privilege, and non-bypass `BLOCKED_CHALLENGE` / `BLOCKED_AUTH` / `BLOCKED_PAYMENT` human handoff.

---

## Quickstart & Query Commands

Run deterministic repository checks locally (Python >= 3.10, stdlib only):

```bash
python3 scripts/self_check.py
python3 scripts/verify_bridge_primitives.py
```

Query the knowledge graph using [`design-os-knowledge-builder`](https://github.com/jangtrinh/design-os-knowledge-builder):

```bash
export PYTHONPATH="${KNOWLEDGE_BUILDER_REPO:-../design-os-knowledge-builder}/src"
P="knowledge/agent-browser-extensions"

# Inspect pack coverage and stopping gate
python3 -m knowledge_builder.cli pack status --root "$P"
python3 -m knowledge_builder.cli pack check --root "$P"

# Query bridge primitives and barrier resolutions
python3 -m knowledge_builder.cli query --root "$P" --object-type bridge-primitive --fields id,object_type,path
python3 -m knowledge_builder.cli query --root "$P" --linked-to closed-shadow-dom-and-oopif --link-type overcomes --fields id,object_type,path

# Deterministic pack validation
python3 "${KNOWLEDGE_BUILDER_REPO:-../design-os-knowledge-builder}/skills/es-knowledge-forge/validate.py" --root "$P"
```

---

## Governance & License

- **Security & Privacy**: Zero telemetry — see [`SECURITY.md`](SECURITY.md) and [`PRIVACY.md`](PRIVACY.md).
- **Contributing & Conduct**: See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- **Changelog & LLM Index**: Track updates in [`CHANGELOG.md`](CHANGELOG.md) and [`llms.txt`](llms.txt).
- **License**: [PolyForm Shield 1.0.0](LICENSE) © [Jang Trinh](https://github.com/jangtrinh). Source-available: free to use and modify, including for paid client work; you may not resell it or build a competing product from it.
