---
id: "activetab-grants-temporary-host-access-on-user-gesture"
title: "The activeTab permission restricts tab host access until an explicit user gesture occurs a"
object_type: "claim"
status: "active"
statement: "The activeTab permission restricts tab host access until an explicit user gesture occurs and revokes access on cross-origin navigation or closure."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["b10-fact-activetab-gesture"]
evidence:
  - atom: "b10-fact-activetab-gesture"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-concepts-3"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-activetab.txt"
    quote: "In contrast, an extension with the \"activeTab\" permission only obtains access to a tab in response\nto an explicit user gesture. If the extension is compromised the attacker would need to wait for the\nuser to invoke the extension before obtaining access. And that access only lasts until the tab is\nnavigated or is closed."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-concepts-3"
---

## Statement

The activeTab permission restricts tab host access until an explicit user gesture occurs and revokes access on cross-origin navigation or closure.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
