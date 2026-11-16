---
id: "mv3-service-workers-terminate-when-idle"
title: "Chrome terminates an MV3 extension service worker after 30 seconds of inactivity or when a"
object_type: "claim"
status: "active"
statement: "Chrome terminates an MV3 extension service worker after 30 seconds of inactivity or when a single request exceeds 5 minutes."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a5-chrome-sw-terminate"]
evidence:
  - atom: "a5-chrome-sw-terminate"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-concepts-2"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-sw-lifecycle.txt"
    quote: "Normally, Chrome terminates a service worker when one of the following conditions is met:\nAfter 30 seconds of inactivity. Receiving an event or calling an extension API resets this timer.\nWhen a single request, such as an event or API call, takes longer than 5 minutes to process."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-concepts-2"
---

## Statement

Chrome terminates an MV3 extension service worker after 30 seconds of inactivity or when a single request exceeds 5 minutes.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
