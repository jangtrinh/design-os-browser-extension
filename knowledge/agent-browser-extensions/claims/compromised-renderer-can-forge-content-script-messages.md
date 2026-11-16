---
id: "compromised-renderer-can-forge-content-script-messages"
title: "Because content scripts share the renderer process with web pages, a compromised renderer "
object_type: "claim"
status: "active"
statement: "Because content scripts share the renderer process with web pages, a compromised renderer can leak data or hijack content-script privileges."
claim_type: "FAILURE_MODE"
confidence: "HIGH"
atom_ids: ["b4-fm-renderer-compromise"]
evidence:
  - atom: "b4-fm-renderer-compromise"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-security"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-stay-secure.txt"
    quote: "To interact with DOM of web pages, content scripts need to execute in the same renderer process as\nthe web page. This makes content scripts vulnerable to leaking data via side channel attacks\n(e.g., Spectre), and to being taken over by an attacker if a malicious web page compromises\nthe renderer process."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-security"
---

## Statement

Because content scripts share the renderer process with web pages, a compromised renderer can leak data or hijack content-script privileges.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
