---
id: "chrome-debugger-cdp"
title: "chrome.debugger CDP Session Bridge"
object_type: "bridge-primitive"
status: "active"
layer: "input-dispatch"
portability: "chromium-only"
link_types:
  - link_type: "overcomes"
    target_id: "untrusted-synthetic-dom-events"
  - link_type: "overcomes"
    target_id: "closed-shadow-dom-and-oopif"
  - link_type: "overcomes"
    target_id: "chrome-default-profile-cdp-restriction"
---

## Notes

