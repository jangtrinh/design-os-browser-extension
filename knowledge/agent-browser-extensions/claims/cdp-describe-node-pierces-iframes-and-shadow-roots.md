---
id: "cdp-describe-node-pierces-iframes-and-shadow-roots"
title: "CDP DOM.describeNode traverses iframes and shadow roots when pierce is enabled without sta"
object_type: "claim"
status: "active"
statement: "CDP DOM.describeNode traverses iframes and shadow roots when pierce is enabled without starting node tracking."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a13-cdp-pierce"]
evidence:
  - atom: "a13-cdp-pierce"
    run: "agent-browser-extensions-261116"
    source: "raw-githubusercontent-com-chromedevtools-devtools-protocol"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/cdp-browser-protocol-spec.txt"
    quote: "\"name\": \"pierce\",\n\"description\": \"Whether or not iframes and shadow roots should be traversed when returning the subtree\\n(default is false).\","
link_types:
  - link_type: "supported-by"
    target_id: "raw-githubusercontent-com-chromedevtools-devtools-protocol"
---

## Statement

CDP DOM.describeNode traverses iframes and shadow roots when pierce is enabled without starting node tracking.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
