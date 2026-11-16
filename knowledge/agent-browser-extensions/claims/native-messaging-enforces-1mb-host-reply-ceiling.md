---
id: "native-messaging-enforces-1mb-host-reply-ceiling"
title: "Native messaging enforces a 1 MB maximum single-message size from the host to Chrome and 6"
object_type: "claim"
status: "active"
statement: "Native messaging enforces a 1 MB maximum single-message size from the host to Chrome and 64 MiB from Chrome to the host."
claim_type: "BENCHMARK"
confidence: "HIGH"
atom_ids: ["a17-bench-native-msg-quotas"]
evidence:
  - atom: "a17-bench-native-msg-quotas"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-concepts-native"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-native-messaging.txt"
    quote: "The maximum size of a single message from the native messaging\nhost is 1 MB, mainly to protect Chrome from misbehaving native applications. The maximum size of the\nmessage sent to the native messaging host is 64 MiB."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-concepts-native"
---

## Statement

Native messaging enforces a 1 MB maximum single-message size from the host to Chrome and 64 MiB from Chrome to the host.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
