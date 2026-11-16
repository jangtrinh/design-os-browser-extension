---
id: "fast-snapshot-and-fenced-dispatch"
title: "Compact Snapshots, Page/Epoch Fencing, and Safe Action Dispatch"
object_type: "guide"
domain: "browser-engineering"
description: "How to keep agent observe-act loops sub-second using compact indexed snapshots and fencing tokens (pageId, epoch, lease) that prevent stale clicks and blind retries."
when:
  - "designing observation compression so an LLM/System-One agent does not choke on multi-megabyte raw DOM dumps"
  - "preventing race conditions, double-submits, or navigation drift between snapshot and click"
trust_tier: "draft"
version: "1.0.0"
source_attribution:
  - uri: "_evidence/agent-browser-extensions-261116/sources/bridge-invariants-exec.txt"
    sha256: "84f478b553af193d26a21e2de876ec63a79e9842f30489c4e2dfb823135d8c3b"
  - uri: "_evidence/agent-browser-extensions-261116/sources/cdp-browser-protocol-spec.txt"
    sha256: "f6d36fb11a4ab8371a57b91db422956ac8ef402efccfd9d3208e0e7cb29afc7f"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-debugger-api.txt"
    sha256: "6c546e0fa90795072833e5093dd1475badc10016df59af7d378b792823af922d"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-storage-api.txt"
    sha256: "9ed2604fac98b658e2bbf6213e6a0f8277342e41621938593109cde6ebbeb6b0"
link_types:
  - link_type: "cites"
    target_id: "first-party-bridge-invariants-verified-by-code"
  - link_type: "cites"
    target_id: "cdp-describe-node-pierces-iframes-and-shadow-roots"
  - link_type: "cites"
    target_id: "chrome-debugger-supports-flat-oopif-sessions"
  - link_type: "cites"
    target_id: "storage-session-persists-in-memory-across-sw-restarts"
  - link_type: "cites"
    target_id: "opening-devtools-detaches-extension-debugger"
  - link_type: "about"
    target_id: "session-epoch-lease-fencing"
  - link_type: "about"
    target_id: "chromium-mv3"
  - link_type: "about"
    target_id: "firefox-gecko"
  - link_type: "about"
    target_id: "safari-webkit"
  - link_type: "depends-on"
    target_id: "cross-browser-capability-matrix"
---

## Purpose

Ensure every observation-action cycle between the browser extension and an AI agent is both compact (hundreds of tokens instead of megabytes of HTML) and transactionally fenced against page navigation, worker restarts, and command timeouts.

## When to Use / When NOT

- **Use when:** Any autonomous or semi-autonomous agent executes multi-step DOM reads and mutations (`click`, `type`, `select`, `submit`).
- **Do NOT use when:** Building a passive read-only page highlighter with no external agent loop or state-mutating RPC actions.

## Core Knowledge Content

First-party production browser-control custodians verify that every controlled tab must carry persisted `lease` ownership, an active `epoch`, and a navigation-bound `pageId` stored in `chrome.storage.session`, rejecting commands whenever `pageId` turns stale or `epoch`/TTL expires before dispatching input.
<!-- ease:claim id=first-party-bridge-invariants-verified-by-code -->

Rather than dumping full `outerHTML` (which blows agent context windows and triggers IPC byte caps), extract a flat indexed list of visible interactive elements by traversing shadow roots and frames via `dom.openOrClosedShadowRoot` / CDP `pierce: true` alongside `Accessibility.getFullAXTree`.
<!-- ease:claim id=cdp-describe-node-pierces-iframes-and-shadow-roots -->

Using flat CDP `sessionId` handles keeps child iframe refs anchored to their owning frame context so an action on `[ref=14]` inside a nested frame translates directly into the exact frame coordinates without guessing across CSS selectors.
<!-- ease:claim id=chrome-debugger-supports-flat-oopif-sessions -->

Because MV3 service workers may restart between an agent's `snapshot` call and its `click` call, persisting the tab lease, active `epoch`, and `receipt` ack buffer inside `browser.storage.session` prevents duplicate dispatch or lost completion receipts across restarts.
<!-- ease:claim id=storage-session-persists-in-memory-across-sw-restarts -->

Any `debugger.onDetach` event, `Page.frameNavigated`, `Page.navigatedWithinDocument`, or `Runtime.executionContextsCleared` event immediately rotates `pageId` and clears cached element ref maps so an action targeting the pre-navigation DOM fails fast with `BROWSER_PAGE_STALE`.
<!-- ease:claim id=opening-devtools-detaches-extension-debugger -->

Derived: Five-stage fenced dispatch state machine derived from first-party `browser-control.js` invariants and CDP lifecycle events.
| Stage | Invariant Checked | On Failure / Mismatch |
|---|---|---|
| **1. Admission** | `tabs.get(tabId).owner === command.owner` and `command.epoch === epoch` | Reject `BROWSER_DETACHED` / `BROWSER_EXPIRED`; zero input dispatched |
| **2. Freshness** | `command.args.pageId === state.pageId` (valid UUID, not ref/frameId) | Reject `BROWSER_PAGE_STALE`; require fresh `snapshot` |
| **3. Target Hit Test** | Scroll into view + `elementFromPoint(x, y)` matches target ref or descendant | Reject `BROWSER_ELEMENT_OCCLUDED` before mouse press |
| **4. Bounded Dispatch** | Race `sendCommand` against bounded timeout; retire tab lease on hang | Never blind-retry; mark `UNCERTAIN` and reconcile read-only |
| **5. Postcondition** | Re-observe DOM/URL delta + persist `receipt` in `storage.session` | Agent reconciles live state instead of assuming success |

Decision: Never let the extension auto-replay a timed-out or disconnected write command; retire the tab handle, return an explicit stale/uncertain error code, and force the agent to take a fresh fenced snapshot.
```js
// Fencing check executed right before any CDP or DOM mutation
function assertFenced(state, command, currentEpoch) {
  if (!state) throw new Error('BROWSER_DETACHED: attach deliberately first.');
  if (command.epoch !== currentEpoch || command.expiresAt <= Date.now()) {
    throw new Error('BROWSER_EXPIRED: no input dispatched.');
  }
  if (command.pageId !== state.pageId) {
    throw new Error('BROWSER_PAGE_STALE: navigation invalidated refs; snapshot again.');
  }
}
```

## Failure Modes (Mandatory)

1. **Blindly retrying a timed-out `click` on a submit/checkout button:** The first click may already have reached the page handler before timeout; always retire the lease and force read-only postcondition inspection (`UNCERTAIN` -> reconcile).
2. **Keeping ref maps alive across SPA hash/history navigations (`Page.navigatedWithinDocument`):** Clicking stale ref IDs hits newly mounted buttons on the next route; invalidate `pageId` on both full navigations and same-document route changes.
3. **Sending unbounded DOM text payloads (`>1.8 MB`) back to the agent host:** Exhausts IPC buffers or triggers truncation; cap per-node text length, filter invisible nodes (`display: none`, zero rect), and return structured ref tables (`[id, role, name, value, rect]`).
4. **Copying `frameId` or element `ref` into the `pageId` slot:** Breaks freshness detection; enforce UUID syntax validation on `pageId` and separate `ref` (`[a-z0-9]+`) formatting.
5. **Dropping completion receipts when the service worker wakes and restarts mid-poll:** Causes the agent host to re-send an already completed action; write `receipt` to `chrome.storage.session` immediately upon action completion and clear only after host `ack`.
