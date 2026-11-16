---
id: "chrome-136-blocks-remote-debugging-on-default-profile"
title: "Chrome 136 ignores --remote-debugging-port and --remote-debugging-pipe on the default Chro"
object_type: "claim"
status: "active"
statement: "Chrome 136 ignores --remote-debugging-port and --remote-debugging-pipe on the default Chrome user data directory unless a custom --user-data-dir is supplied."
claim_type: "FAILURE_MODE"
confidence: "HIGH"
atom_ids: ["b1-fm-chrome136-remote-debug"]
evidence:
  - atom: "b1-fm-chrome136-remote-debug"
    run: "agent-browser-extensions-261116"
    source: "developer-chrome-com-blog-remote-debugging-port"
    evidence_uri: "_evidence/agent-browser-extensions-261116/sources/chrome-remote-debugging-port.txt"
    quote: "Therefore, from Chrome 136 we're making changes to the behavior of\n--remote-debugging-port and --remote-debugging-pipe. These switches\nwill no longer be respected if attempting to debug the default Chrome data\ndirectory. These switches must now be accompanied by the --user-data-dir\nswitch to point to a non-standard directory."
link_types:
  - link_type: "supported-by"
    target_id: "developer-chrome-com-blog-remote-debugging-port"
---

## Statement

Chrome 136 ignores --remote-debugging-port and --remote-debugging-pipe on the default Chrome user data directory unless a custom --user-data-dir is supplied.

## Evidence

Quotes and captures are recorded in the evidence list of the frontmatter, one entry per ledger atom.
