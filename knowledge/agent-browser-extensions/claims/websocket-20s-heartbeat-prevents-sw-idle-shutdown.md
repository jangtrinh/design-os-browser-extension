---
id: "websocket-20s-heartbeat-prevents-sw-idle-shutdown"
title: "A 20-second WebSocket keepalive interval resets the idle timer before Chrome's 30-second s"
object_type: "claim"
status: "active"
statement: "A 20-second WebSocket keepalive interval resets the idle timer before Chrome's 30-second service worker shutdown threshold."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["b8-fact-ws-20s-keepalive"]
evidence:
  - atom: "b8-fact-ws-20s-keepalive"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-how-to-web-platform"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-sw-websockets.txt"
    quote: "// Set the interval to 20 seconds to prevent the service worker from becoming inactive."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-how-to-web-platform"
---

## Statement

A 20-second WebSocket keepalive interval resets the idle timer before Chrome's 30-second service worker shutdown threshold.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
