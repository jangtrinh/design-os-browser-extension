---
id: "storage-session-persists-in-memory-across-sw-restarts"
title: "The storage.session area stores up to 10 MB in memory across worker restarts and restricts"
object_type: "claim"
status: "active"
statement: "The storage.session area stores up to 10 MB in memory across worker restarts and restricts content script access by default."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a7-chrome-storage-session", "a7b-webkit-storage-session"]
evidence:
  - atom: "a7-chrome-storage-session"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-docs-extensions-reference-api-storage"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-storage-api.txt"
    quote: "Session storage holds data in memory while an extension is loaded. The storage is cleared if the extension is disabled, reloaded, updated, and when the browser restarts. By default, it's not exposed to content scripts, but this behavior can be changed by calling browser.storage.session.setAccessLevel(). The storage limit is 10 MB (1 MB in Chrome 111 and earlier)."
  - atom: "a7b-webkit-storage-session"
    run: "agent-browser-extensions-261116"
    source: "webkit-org-blog-13966-webkit-features-in-safari-16-4"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/webkit-safari-extensions-16-4.txt"
    quote: "The storage.session API, now supported in Safari 16.4, enables extensions to store data in memory for the duration of the browser session, making it a useful tool for storing data that takes a long time to compute or is needed quickly between non-persistent background page loads."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-docs-extensions-reference-api-storage"
  - link_type: "supported-by"
    target_id: "webkit-org-blog-13966-webkit-features-in-safari-16-4"
---

## Statement

The storage.session area stores up to 10 MB in memory across worker restarts and restricts content script access by default.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
