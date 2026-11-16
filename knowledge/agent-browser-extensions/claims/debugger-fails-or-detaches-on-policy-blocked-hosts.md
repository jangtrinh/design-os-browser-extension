---
id: "debugger-fails-or-detaches-on-policy-blocked-hosts"
title: "Enterprise runtime_blocked_hosts policies block browser.debugger.attach() and detach activ"
object_type: "claim"
status: "active"
statement: "Enterprise runtime_blocked_hosts policies block browser.debugger.attach() and detach active debugger sessions if any frame navigates to a restricted host."
claim_type: "FAILURE_MODE"
confidence: "HIGH"
atom_ids: ["b5-fm-enterprise-blocked-hosts"]
evidence:
  - atom: "b5-fm-enterprise-blocked-hosts"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-reference-api-debugger"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-debugger-api.txt"
    quote: "Calling browser.debugger.attach() fails with the error\n\"This page cannot be scripted due to an ExtensionsSettings policy.\" if the URL of the target, or of any frame in it, matches\nruntime_blocked_hosts. If an attached target, or any frame in it, navigates to a blocked host, Chrome detaches the debugger."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-reference-api-debugger"
---

## Statement

Enterprise runtime_blocked_hosts policies block browser.debugger.attach() and detach active debugger sessions if any frame navigates to a restricted host.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
