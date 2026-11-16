---
id: "chrome-mv3-forbids-background-event-pages"
title: "Unlike Firefox MV3 event pages, Chrome Manifest V3 forbids background or event pages and m"
object_type: "claim"
status: "active"
statement: "Unlike Firefox MV3 event pages, Chrome Manifest V3 forbids background or event pages and mandates service workers."
claim_type: "CONTRADICTION"
confidence: "HIGH"
atom_ids: ["a10-contra-chrome-sw-background"]
evidence:
  - atom: "a10-contra-chrome-sw-background"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons-4"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-background-scripts.txt"
    quote: "The getBackgroundPage() methods discussed in this section cannot be used in a cross-browser extension, because Manifest Version 3 extensions in Chrome cannot use background or event pages."
link_types:
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons-4"
  - link_type: "contradicts"
    target_id: "firefox-mv3-uses-event-pages-not-service-workers"
resolution: "Chrome MV3 mandates background.service_worker and ignores or rejects event pages, whereas Firefox MV3 runs background.scripts event pages and ignores/rejects background.service_worker. Cross-browser extensions resolve this by persisting state in browser.storage.session and generating dual background keys or per-target manifests (e.g. WXT -b chrome / -b firefox) behind a single RPC interface."
---

## Statement

Unlike Firefox MV3 event pages, Chrome Manifest V3 forbids background or event pages and mandates service workers.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
