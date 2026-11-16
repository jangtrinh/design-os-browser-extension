---
id: "chrome-debugger-dispatches-trusted-cdp-commands"
title: "The chrome.debugger API attaches to tab targets to transport Chrome DevTools Protocol comm"
object_type: "claim"
status: "active"
statement: "The chrome.debugger API attaches to tab targets to transport Chrome DevTools Protocol commands for DOM, network, and input control."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a1-chrome-debugger"]
evidence:
  - atom: "a1-chrome-debugger"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-reference-api-debugger"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-debugger-api.txt"
    quote: "The chrome.debugger API serves as an alternate transport for Chrome's remote debugging protocol. Use chrome.debugger to attach to one or more tabs to instrument network interaction, debug JavaScript, mutate the DOM and CSS, and more."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-reference-api-debugger"
---

## Statement

The chrome.debugger API attaches to tab targets to transport Chrome DevTools Protocol commands for DOM, network, and input control.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
