---
id: "extension-dom-api-pierces-closed-shadow-roots"
title: "Extensions can retrieve both open and closed ShadowRoot instances via dom.openOrClosedShad"
object_type: "claim"
status: "active"
statement: "Extensions can retrieve both open and closed ShadowRoot instances via dom.openOrClosedShadowRoot without main-world interception."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a12-chrome-shadow-dom", "a12b-mdn-shadow-dom"]
evidence:
  - atom: "a12-chrome-shadow-dom"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-reference-api-dom"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-dom-api.txt"
    quote: "Gets the open shadow root or the closed shadow root hosted by the specified element. If the element doesn't attach the shadow root, it will return null."
  - atom: "a12b-mdn-shadow-dom"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons-7"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-open-or-closed-shadow-root.txt"
    quote: "In Firefox, the equivalent property is element.openOrClosedShadowRoot. This read-only property represents the shadow root hosted by the element, regardless of whether its mode is open or closed."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-reference-api-dom"
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons-7"
---

## Statement

Extensions can retrieve both open and closed ShadowRoot instances via dom.openOrClosedShadowRoot without main-world interception.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
