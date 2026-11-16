---
id: "chrome-debugger-supports-flat-oopif-sessions"
title: "Since Chrome 125, browser.debugger supports flat child sessions via sessionId to command o"
object_type: "claim"
status: "active"
statement: "Since Chrome 125, browser.debugger supports flat child sessions via sessionId to command out-of-process iframes without separate attach calls."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a2-chrome-flat-sessions"]
evidence:
  - atom: "a2-chrome-flat-sessions"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-reference-api-debugger"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-debugger-api.txt"
    quote: "Starting in Chrome 125, the browser.debugger API supports flat sessions. This\nlets you add additional targets as children to your main debugger session and\nmessage them without needing another call to browser.debugger.attach. Instead,\nyou can add a sessionId property when calling browser.debugger.sendCommand to\nidentify the child target you would like to send a command to."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-reference-api-debugger"
---

## Statement

Since Chrome 125, browser.debugger supports flat child sessions via sessionId to command out-of-process iframes without separate attach calls.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
