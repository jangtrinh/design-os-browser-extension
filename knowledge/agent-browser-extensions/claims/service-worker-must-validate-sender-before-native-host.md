---
id: "service-worker-must-validate-sender-before-native-host"
title: "Service workers must validate sender.origin and sanitize payloads before forwarding conten"
object_type: "claim"
status: "active"
statement: "Service workers must validate sender.origin and sanitize payloads before forwarding content-script messages to a native messaging host."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["b7-fact-validate-sender"]
evidence:
  - atom: "b7-fact-validate-sender"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-concepts-native"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-native-messaging.txt"
    quote: "Warning: Because content scripts share a renderer process with untrusted web\npages, your service worker must validate sender.origin (or sender.url) and\nsanitize the message payload before forwarding any data to the native host."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-concepts-native"
---

## Statement

Service workers must validate sender.origin and sanitize payloads before forwarding content-script messages to a native messaging host.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
