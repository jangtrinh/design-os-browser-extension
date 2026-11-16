---
id: "first-party-bridge-invariants-verified-by-code"
title: "First-party browser-control custody persists tab ownership and epoch fencing in chrome.sto"
object_type: "claim"
status: "active"
statement: "First-party browser-control custody persists tab ownership and epoch fencing in chrome.storage.session and rejects stale pageId or expired commands."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a18-exec-bridge-invariants"]
evidence:
  - atom: "a18-exec-bridge-invariants"
    run: "agent-browser-extensions-261116"
    source: "local-evidence-agent-browser-extensions-261116-sources"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/bridge-invariants-exec.txt"
    quote: "First-party browser-control custodian persists tab ownership and epoch fencing in chrome.storage.session and rejects stale pageId or expired commands before dispatching debugger input."
link_types:
  - link_type: "supported-by"
    target_id: "local-evidence-agent-browser-extensions-261116-sources"
---

## Statement

First-party browser-control custody persists tab ownership and epoch fencing in chrome.storage.session and rejects stale pageId or expired commands.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
