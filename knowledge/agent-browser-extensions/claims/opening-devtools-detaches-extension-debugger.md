---
id: "opening-devtools-detaches-extension-debugger"
title: "Chrome forcibly terminates an extension's debugger session via onDetach when the tab close"
object_type: "claim"
status: "active"
statement: "Chrome forcibly terminates an extension's debugger session via onDetach when the tab closes or when Chrome DevTools opens on the tab."
claim_type: "FAILURE_MODE"
confidence: "HIGH"
atom_ids: ["b6-fm-devtools-detaches-debugger"]
evidence:
  - atom: "b6-fm-devtools-detaches-debugger"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-reference-api-debugger"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-debugger-api.txt"
    quote: "Fired when browser terminates debugging session for the tab. This happens when either the tab is being closed or Chrome DevTools is being invoked for the attached tab."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-reference-api-debugger"
---

## Statement

Chrome forcibly terminates an extension's debugger session via onDetach when the tab closes or when Chrome DevTools opens on the tab.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
