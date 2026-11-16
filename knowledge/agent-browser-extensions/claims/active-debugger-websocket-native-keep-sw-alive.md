---
id: "active-debugger-websocket-native-keep-sw-alive"
title: "Active browser.debugger sessions, WebSocket traffic, and runtime.connectNative ports keep "
object_type: "claim"
status: "active"
statement: "Active browser.debugger sessions, WebSocket traffic, and runtime.connectNative ports keep or extend Chrome MV3 service worker lifetimes."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a6-chrome-sw-keepalive"]
evidence:
  - atom: "a6-chrome-sw-keepalive"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-concepts-2"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-sw-lifecycle.txt"
    quote: "Active debugger sessions created using the browser.debugger API now keep the service worker alive. This prevents service workers from timing out during calls for this API.\nChrome 116\nChrome 116 introduced the following service worker lifetime improvements:\nActive WebSocket connections now extend extension service worker lifetimes. Sending or receiving messages across a WebSocket in an extension service worker resets the service worker's idle timer."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-concepts-2"
---

## Statement

Active browser.debugger sessions, WebSocket traffic, and runtime.connectNative ports keep or extend Chrome MV3 service worker lifetimes.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
