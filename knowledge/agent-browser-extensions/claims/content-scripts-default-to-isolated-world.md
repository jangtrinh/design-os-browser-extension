---
id: "content-scripts-default-to-isolated-world"
title: "Extension content scripts execute by default in an isolated world hidden from host page sc"
object_type: "claim"
status: "active"
statement: "Extension content scripts execute by default in an isolated world hidden from host page scripts and other extensions."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a3-chrome-isolated-world", "a3b-mdn-isolated-world"]
evidence:
  - atom: "a3-chrome-isolated-world"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-develop-concepts"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-content-scripts.txt"
    quote: "Key term: An isolated world is a private execution environment that isn't accessible to the page or other\nextensions. A practical consequence of this isolation is that JavaScript variables in an extension's\ncontent scripts are not visible to the host page or other extensions' content scripts."
  - atom: "a3b-mdn-isolated-world"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons-3"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-manifest-content-scripts.txt"
    quote: "The default content scripts execution environment.\nThis environment is isolated from the page's context: while they share the same document, the global scopes and available APIs differ."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-develop-concepts"
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons-3"
---

## Statement

Extension content scripts execute by default in an isolated world hidden from host page scripts and other extensions.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
