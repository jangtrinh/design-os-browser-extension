---
id: "safari-web-extensions-require-native-app-container"
title: "Safari Web Extensions package standard web extension code inside native Xcode app containe"
object_type: "claim"
status: "active"
statement: "Safari Web Extensions package standard web extension code inside native Xcode app containers for App Store distribution."
claim_type: "FACT"
confidence: "HIGH"
atom_ids: ["a11-safari-native-app", "a11b-mdn-safari-packaging"]
evidence:
  - atom: "a11-safari-native-app"
    run: "agent-browser-extensions-261116"
    source: "webkit-org-blog-11340-web-extensions-in-safari-14"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/webkit-safari-14-extensions.txt"
    quote: "This release brings support for Safari Web Extensions. They are a type of extension primarily built with JavaScript, HTML, and CSS packaged with native apps. This allows extension developers to maintain a single codebase that can be packaged for other browsers.\nIt also means developers with extensions for other browsers can easily bring their projects to Safari with a command-line tool. It jump-starts your development by converting your web extension into an Xcode project, ready to build and test."
  - atom: "a11b-mdn-safari-packaging"
    run: "agent-browser-extensions-261116"
    source: "developer-mozilla-org-en-us-docs-mozilla-add-ons-6"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/mdn-cross-browser-extension.txt"
    quote: "Firefox, Chrome, Edge, and Opera all use a simple zip format that requires the manifest.json file to be at the root of the zip package. Safari requires extensions to be packaged in a similar way to apps."
link_types:
  - link_type: "supported-by"
    target_id: "webkit-org-blog-11340-web-extensions-in-safari-14"
  - link_type: "supported-by"
    target_id: "developer-mozilla-org-en-us-docs-mozilla-add-ons-6"
---

## Statement

Safari Web Extensions package standard web extension code inside native Xcode app containers for App Store distribution.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
