---
id: "main-world-scripts-face-page-interference-and-no-extension-apis"
title: "Scripts executing in the MAIN world lack extension APIs and expose their logic and data to"
object_type: "claim"
status: "active"
statement: "Scripts executing in the MAIN world lack extension APIs and expose their logic and data to page interception and interference."
claim_type: "FAILURE_MODE"
confidence: "HIGH"
atom_ids: ["b3-fm-main-world-interference"]
evidence:
  - atom: "b3-fm-main-world-interference"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons-3"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-manifest-content-scripts.txt"
    quote: "Scripts in this environment don't have any access to the APIs that are only available to content scripts.\nWarning: Due to the lack of isolation, the web page can detect and interfere with the executed code.\nDo not use the MAIN world unless it is acceptable for web pages to read, access, or modify the logic or data that flows through the executed code."
link_types:
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons-3"
---

## Statement

Scripts executing in the MAIN world lack extension APIs and expose their logic and data to page interception and interference.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
