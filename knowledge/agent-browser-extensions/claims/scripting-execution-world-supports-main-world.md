---
id: "scripting-execution-world-supports-main-world"
title: "The ExecutionWorld enum lets extensions target ISOLATED or MAIN world shared with host pag"
object_type: "claim"
status: "active"
statement: "The ExecutionWorld enum lets extensions target ISOLATED or MAIN world shared with host page JavaScript."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a4-chrome-main-world", "a4b-mdn-main-world"]
evidence:
  - atom: "a4-chrome-main-world"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-reference-api-scripting"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-scripting-api.txt"
    quote: "\"ISOLATED\"\nSpecifies the isolated world, which is the execution environment unique to this extension.\n\"MAIN\"\nSpecifies the main world of the DOM, which is the execution environment shared with the host page's JavaScript."
  - atom: "a4b-mdn-main-world"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons-3"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-manifest-content-scripts.txt"
    quote: "The web page's execution environment.\nThis environment is shared with the web page without isolation."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-reference-api-scripting"
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons-3"
---

## Statement

The ExecutionWorld enum lets extensions target ISOLATED or MAIN world shared with host page JavaScript.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
