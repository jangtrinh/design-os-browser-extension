---
id: "first-party-main-world-bridge-captures-native-bindings"
title: "First-party MAIN-world bridging captures native postMessage and hasOwnProperty bindings at"
object_type: "claim"
status: "active"
statement: "First-party MAIN-world bridging captures native postMessage and hasOwnProperty bindings at load time and emits allowlisted descriptors only."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["b13-fact-first-party-main-bridge"]
evidence:
  - atom: "b13-fact-first-party-main-bridge"
    run: "agent-browser-extensions-261116"
    source: "local-evidence-agent-browser-extensions-261116-sources"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/bridge-invariants-exec.txt"
    quote: "First-party MAIN-world fiber bridge captures native window.postMessage and Object.prototype.hasOwnProperty bindings at load time and never forwards raw request arguments across the world boundary."
link_types:
  - link_type: "supported-by"
    target_id: "local-evidence-agent-browser-extensions-261116-sources"
---

## Statement

First-party MAIN-world bridging captures native postMessage and hasOwnProperty bindings at load time and emits allowlisted descriptors only.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
