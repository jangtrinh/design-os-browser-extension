---
id: "native-messaging-communicates-over-stdio"
title: "Native messaging exchanges UTF-8 JSON payloads over stdin and stdout preceded by a 32-bit "
object_type: "claim"
status: "active"
statement: "Native messaging exchanges UTF-8 JSON payloads over stdin and stdout preceded by a 32-bit native byte-order length header."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a8-chrome-native-messaging", "a8b-mdn-native-messaging"]
evidence:
  - atom: "a8-chrome-native-messaging"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-concepts-native"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-native-messaging.txt"
    quote: "Chrome starts each native messaging host in a separate process and communicates with it using\nstandard input (stdin) and standard output (stdout). The same format is used to send messages in\nboth directions; each message is serialized using JSON, UTF-8 encoded and is preceded with 32-bit\nmessage length in native byte order."
  - atom: "a8b-mdn-native-messaging"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons-5"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-native-messaging.txt"
    quote: "On the application side, you use standard input to receive messages and standard output to send them.\nEach message is serialized using JSON, UTF-8 encoded and is preceded with an unsigned 32-bit value containing the message length in native byte order."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-concepts-native"
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons-5"
---

## Statement

Native messaging exchanges UTF-8 JSON payloads over stdin and stdout preceded by a 32-bit native byte-order length header.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
