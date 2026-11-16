---
id: "trusted-input-shadow-and-oopif"
title: "Trusted Input Dispatch, Closed Shadow DOM, and OOPiF Piercing"
object_type: "guide"
domain: "browser-engineering"
description: "How to deliver isTrusted=true user input, pierce closed Shadow DOM roots, and target cross-origin out-of-process iframes across Chromium and fallback engines."
when:
  - "element.click() or dispatchEvent() is ignored because the site checks Event.isTrusted"
  - "target controls live inside closed ShadowRoot components or cross-origin payment/auth/widget iframes"
trust_tier: "draft"
version: "1.0.0"
source_attribution:
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-event-istrusted.txt"
    sha256: "a76698bc08bc5377f2c55cbe45cffbc896231f4c1df06eb69b2c898d35d926c4"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-debugger-api.txt"
    sha256: "6c546e0fa90795072833e5093dd1475badc10016df59af7d378b792823af922d"
  - uri: "_evidence/agent-browser-extensions-261116/sources/cdp-browser-protocol-spec.txt"
    sha256: "f6d36fb11a4ab8371a57b91db422956ac8ef402efccfd9d3208e0e7cb29afc7f"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-dom-api.txt"
    sha256: "b607520127c3cc7ec31bcb6e54d2537a0c0131a73aebcf8d4458238c192f2073"
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-open-or-closed-shadow-root.txt"
    sha256: "a5d31fdde969052fcaa12919189c4665335e137191513ec6e39ffe5c0020d218"
  - uri: "_evidence/agent-browser-extensions-261116/sources/w3c-webdriver-bidi-spec.txt"
    sha256: "89d6907c9c3ac5b94d00e93538a253cf4b2e7e3fe04e6d02fd2c47d65fd2e734"
link_types:
  - link_type: "cites"
    target_id: "synthetic-dom-clicks-set-istrusted-false"
  - link_type: "cites"
    target_id: "chrome-debugger-dispatches-trusted-cdp-commands"
  - link_type: "cites"
    target_id: "cdp-input-dispatches-mouse-and-key-events"
  - link_type: "cites"
    target_id: "chrome-debugger-supports-flat-oopif-sessions"
  - link_type: "cites"
    target_id: "extension-dom-api-pierces-closed-shadow-roots"
  - link_type: "cites"
    target_id: "cdp-describe-node-pierces-iframes-and-shadow-roots"
  - link_type: "cites"
    target_id: "webdriver-bidi-provides-cross-browser-trusted-input"
  - link_type: "cites"
    target_id: "opening-devtools-detaches-extension-debugger"
  - link_type: "about"
    target_id: "chrome-debugger-cdp"
  - link_type: "about"
    target_id: "open-or-closed-shadow-dom-api"
  - link_type: "about"
    target_id: "untrusted-synthetic-dom-events"
  - link_type: "about"
    target_id: "closed-shadow-dom-and-oopif"
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

Provide the exact APIs and frame-traversal mechanics required so an agent extension can inspect closed web components, traverse cross-origin iframes (OOPiFs), and dispatch real browser-trusted pointer and keyboard events.

## When to Use / When NOT

- **Use when:** Modern frameworks, native `<select>`/dialog triggers, or security listeners ignore JS-synthesized `el.click()`, or when interactive elements sit inside `attachShadow({ mode: "closed" })` or third-party cross-origin iframes.
- **Do NOT use when:** Reading static text only in a same-origin frame without closed shadow roots, where lightweight content-script DOM queries avoid triggering Chrome's debugger infobar.

## Core Knowledge Content

Calling `HTMLElement.click()` or `EventTarget.dispatchEvent()` in a content script sets `Event.isTrusted` to `false`, causing security-conscious handlers, rich text editors, and browser-native activation checks to ignore the action.
<!-- ease:claim id=synthetic-dom-clicks-set-istrusted-false -->

On Chromium, `chrome.debugger` serves as an internal transport for Chrome DevTools Protocol (CDP), allowing an extension to attach to a tab by `tabId` and issue privileged browser instrumentation commands.
<!-- ease:claim id=chrome-debugger-dispatches-trusted-cdp-commands -->

Sending `Input.dispatchMouseEvent` (`mouseMoved`, `mousePressed`, `mouseReleased`) and `Input.dispatchKeyEvent` through `chrome.debugger` generates user-agent-level input events (`isTrusted: true`) at viewport CSS coordinates.
<!-- ease:claim id=cdp-input-dispatches-mouse-and-key-events -->

Since Chrome 125, `browser.debugger` supports flat child protocol sessions: enabling `Target.setAutoAttach` with `flatten: true` yields a `sessionId` for each out-of-process iframe (`OOPiF`), letting `sendCommand({ tabId, sessionId }, ...)` evaluate scripts or resolve node boxes inside cross-origin frames without re-attaching.
<!-- ease:claim id=chrome-debugger-supports-flat-oopif-sessions -->

For closed Web Components (`Element.attachShadow({ mode: "closed" })`), extensions do not need prototype hijacking: `chrome.dom.openOrClosedShadowRoot(el)` and Firefox `element.openOrClosedShadowRoot` return any open or closed `ShadowRoot` directly from content scripts.
<!-- ease:claim id=extension-dom-api-pierces-closed-shadow-roots -->

When traversing the DOM via CDP instead of content scripts, `DOM.describeNode` accepts `"pierce": true` to traverse both nested iframes and closed shadow roots in one call without enabling heavyweight DOM mutation tracking.
<!-- ease:claim id=cdp-describe-node-pierces-iframes-and-shadow-roots -->

Because Firefox lacks `chrome.debugger` and Safari omits CDP, cross-browser Tier-2/Tier-3 `isTrusted: true` input routes through the Native Messaging host to W3C WebDriver BiDi (`input.performActions` + `browsingContext.locateNodes`) or OS accessibility events where authorized.
<!-- ease:claim id=webdriver-bidi-provides-cross-browser-trusted-input -->

When using `chrome.debugger`, the service worker must handle `browser.debugger.onDetach`: Chrome immediately detaches the extension debugger whenever the tab closes or the user opens Chrome DevTools on that tab.
<!-- ease:claim id=opening-devtools-detaches-extension-debugger -->

Derived: Cross-engine deep interaction routing derived from Chrome debugger/dom APIs, MDN Event.isTrusted, and W3C WebDriver BiDi.
| Barrier | Tier-1 Chromium Mechanism | Tier-2 Firefox Mechanism | Tier-3 Safari Mechanism |
|---|---|---|---|
| **Closed Shadow DOM** | `chrome.dom.openOrClosedShadowRoot` or CDP `pierce: true` | `browser.dom.openOrClosedShadowRoot` | `safaridriver` shadow commands or `MAIN`-world hook if needed |
| **Cross-Origin OOPiF** | `Target.setAutoAttach({ flatten: true })` + `sessionId` | `all_frames: true` content script + `frameId` message routing | `all_frames: true` + `runtime.sendMessage` frame aggregation |
| **`isTrusted: true` Click/Type** | `chrome.debugger` `Input.dispatchMouseEvent` / `dispatchKeyEvent` | Native Host -> WebDriver BiDi `input.performActions` | Native Companion App / `safaridriver` |

Decision: Attach `chrome.debugger` lazily on the first write or deep inspection of a tab, recursively call `Target.setAutoAttach(flatten=true)` on newly attached `Target.attachedToTarget` iframe sessions, and verify `document.elementFromPoint(x, y)` before dispatching mouse clicks.
```js
// Flat OOPiF auto-attach (note: Target.setAutoAttach is non-recursive per parent session)
browser.debugger.onEvent.addListener(async (source, method, params) => {
  if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
    const child = { tabId: source.tabId, sessionId: params.sessionId };
    await browser.debugger.sendCommand(child, 'Target.setAutoAttach', {
      autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
      filter: [{ type: 'iframe', exclude: false }],
    });
  }
});
```

## Failure Modes (Mandatory)

1. **Assuming `Target.setAutoAttach` recurses automatically into nested `A -> B -> C` iframes:** Chrome docs explicitly note auto-attach only binds immediate child frames; you must re-run `Target.setAutoAttach` inside every `Target.attachedToTarget` child `sessionId`.
2. **Clicking stale element coordinates when page scrolls or an overlay covers the target:** Coordinate clicks hit the wrong button; always call `DOM.scrollIntoViewIfNeeded` and check top hit element (`elementFromPoint`) in the target frame first.
3. **Forgetting to include frame viewport offsets when clicking inside an iframe:** `Input.dispatchMouseEvent` takes coordinates relative to the **main frame's viewport**, whereas `getBoundingClientRect()` inside a child iframe is frame-local; accumulate parent `iframe.getBoundingClientRect()` offsets across the frame chain.
4. **Leaving stale tab ownership after `debugger.onDetach` (`canceled_by_user` or DevTools opened):** Future commands fail or leak overlays; purge tab state in `onDetach` and return `BROWSER_DETACHED` so the agent re-attaches deliberately.
5. **Triggering Chromium's "started debugging this browser" infobar on passive reads:** Unnecessarily attaching `chrome.debugger` when a read-only `ISOLATED` content script suffices degrades UX; attach lazily only when CDP input, OOPiF introspection, or network/AXTree capture is needed.
