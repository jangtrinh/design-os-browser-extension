---
id: "offscreen-documents-provide-dom-without-page-csp"
title: "Chrome MV3 offscreen documents run hidden DOM APIs immune to site CSP restrictions while e"
object_type: "claim"
status: "active"
statement: "Chrome MV3 offscreen documents run hidden DOM APIs immune to site CSP restrictions while exposing only the runtime messaging API."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["b9-fact-offscreen-dom"]
evidence:
  - atom: "b9-fact-offscreen-dom"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-reference-api-offscreen"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-offscreen-api.txt"
    quote: "Service workers don't have DOM access, and many websites have content security policies that\nlimit the functionality of content scripts. The Offscreen API allows the extension to use DOM\nAPIs in a hidden document without interrupting the user experience by opening new windows or\ntabs. The runtime API is the only extensions API\nsupported by offscreen documents."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-reference-api-offscreen"
---

## Statement

Chrome MV3 offscreen documents run hidden DOM APIs immune to site CSP restrictions while exposing only the runtime messaging API.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
