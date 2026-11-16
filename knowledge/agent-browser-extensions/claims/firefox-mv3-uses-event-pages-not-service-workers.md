---
id: "firefox-mv3-uses-event-pages-not-service-workers"
title: "Firefox Manifest V3 does not support background.service_worker and executes non-persistent"
object_type: "claim"
status: "active"
statement: "Firefox Manifest V3 does not support background.service_worker and executes non-persistent event pages via background.scripts."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a9-mdn-firefox-event-pages"]
evidence:
  - atom: "a9-mdn-firefox-event-pages"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-manifest-background.txt"
    quote: "Firefox:\nbackground.service_worker is not supported (see Firefox bug 1573659).\nsupports background.scripts (or background.page) if service_worker is not specified or the service worker feature is disabled."
link_types:
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons"
---

## Statement

Firefox Manifest V3 does not support background.service_worker and executes non-persistent event pages via background.scripts.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
