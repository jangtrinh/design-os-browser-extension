---
id: "firefox-does-not-implement-debugger-api"
title: "Firefox does not implement Chrome's debugger API, causing CDP-dependent extension controls"
object_type: "claim"
status: "active"
statement: "Firefox does not implement Chrome's debugger API, causing CDP-dependent extension controls to fail without a host-assisted fallback."
claim_type: "FAILURE_MODE"
confidence: "HIGH"
atom_ids: ["b2-fm-firefox-no-debugger"]
evidence:
  - atom: "b2-fm-firefox-no-debugger"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons-2"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-chrome-incompatibilities.txt"
    quote: "Debugger API\nIn Firefox: Chrome's debugger API is not implemented."
link_types:
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons-2"
---

## Statement

Firefox does not implement Chrome's debugger API, causing CDP-dependent extension controls to fail without a host-assisted fallback.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
