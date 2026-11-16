---
id: "main-world-scripts-inherit-host-page-csp"
title: "Scripts injected into the MAIN world are governed by the host web page's Content Security "
object_type: "claim"
status: "active"
statement: "Scripts injected into the MAIN world are governed by the host web page's Content Security Policy rather than the extension CSP."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["b12-fact-main-world-csp"]
evidence:
  - atom: "b12-fact-main-world-csp"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-concepts"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-content-scripts.txt"
    quote: "When a content script is injected into the main world, the CSP of the page\napplies."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-concepts"
---

## Statement

Scripts injected into the MAIN world are governed by the host web page's Content Security Policy rather than the extension CSP.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
