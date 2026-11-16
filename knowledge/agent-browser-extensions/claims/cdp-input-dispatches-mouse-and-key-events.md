---
id: "cdp-input-dispatches-mouse-and-key-events"
title: "Chrome DevTools Protocol Input.dispatchMouseEvent and Input.dispatchKeyEvent dispatch brow"
object_type: "claim"
status: "active"
statement: "Chrome DevTools Protocol Input.dispatchMouseEvent and Input.dispatchKeyEvent dispatch browser-level input events directly to the page."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a1b-cdp-dispatch-mouse"]
evidence:
  - atom: "a1b-cdp-dispatch-mouse"
    run: "agent-browser-extensions-261116"
    source: "raw-githubusercontent-com-chromedevtools-devtools-protocol"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/cdp-browser-protocol-spec.txt"
    quote: "\"name\": \"dispatchMouseEvent\",\n\"description\": \"Dispatches a mouse event to the page.\","
link_types:
  - link_type: "supported-by"
    target_id: "raw-githubusercontent-com-chromedevtools-devtools-protocol"
---

## Statement

Chrome DevTools Protocol Input.dispatchMouseEvent and Input.dispatchKeyEvent dispatch browser-level input events directly to the page.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
