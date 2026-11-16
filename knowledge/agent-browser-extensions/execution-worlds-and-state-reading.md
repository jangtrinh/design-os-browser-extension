---
id: "execution-worlds-and-state-reading"
title: "Execution Worlds, CSP Compliance, and Safe Deep State Reading"
object_type: "guide"
domain: "browser-engineering"
description: "How to combine ISOLATED content scripts, hardened MAIN-world bridges, and offscreen documents to inspect SPA framework state without violating CSP or trusting tampered globals."
when:
  - "an agent needs state invisible in plain DOM (React Fiber trees, collapsed UI rows, virtualized lists, editor models)"
  - "deciding whether logic belongs in ISOLATED world, MAIN world, Firefox wrappedJSObject, or chrome.offscreen"
trust_tier: "draft"
version: "1.0.0"
source_attribution:
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-content-scripts.txt"
    sha256: "579455c645bd35fd80e3dc851a37e89999de5e50340edb8048d6a23b8a8a3cd2"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-scripting-api.txt"
    sha256: "57497921e045aad58b4ff653a47a2b92d41d2fcb5e8fb8dd57a6c01af8e2f3d6"
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-manifest-content-scripts.txt"
    sha256: "9a7bd5f73a65b3633bee1528a4ede8fad69ac40f6efaf480954b4cc8cd831f95"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-offscreen-api.txt"
    sha256: "ba9e46f440134ce30c737e71fc884d99b45b49f690bd91aeaf2cd9646e1d2bdc"
  - uri: "_evidence/agent-browser-extensions-261116/sources/bridge-invariants-exec.txt"
    sha256: "84f478b553af193d26a21e2de876ec63a79e9842f30489c4e2dfb823135d8c3b"
link_types:
  - link_type: "cites"
    target_id: "content-scripts-default-to-isolated-world"
  - link_type: "cites"
    target_id: "scripting-execution-world-supports-main-world"
  - link_type: "cites"
    target_id: "main-world-scripts-inherit-host-page-csp"
  - link_type: "cites"
    target_id: "main-world-scripts-face-page-interference-and-no-extension-apis"
  - link_type: "cites"
    target_id: "first-party-main-world-bridge-captures-native-bindings"
  - link_type: "cites"
    target_id: "offscreen-documents-provide-dom-without-page-csp"
  - link_type: "about"
    target_id: "isolated-content-script"
  - link_type: "about"
    target_id: "main-world-bridge"
  - link_type: "about"
    target_id: "page-csp-and-isolated-world"
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

Explain how an extension crosses the JavaScript execution boundary safely to read deep SPA application state (such as React Fiber props or Redux/ProseMirror internals) while keeping privileged WebExtension APIs isolated from hostile pages.

## When to Use / When NOT

- **Use when:** Plain DOM inspection omits client-side application state (for example, collapsed tool rows, canvas state, or virtualized tables) or when site CSP blocks inline `<script>` injection.
- **Do NOT use when:** Standard semantic DOM attributes, ARIA roles, or CDP `Accessibility.getFullAXTree` already expose the target state cleanly.

## Core Knowledge Content

Content scripts execute by default in an `ISOLATED` world where they share the page DOM but cannot see JavaScript globals, expandos, or framework internals created by host page scripts.
<!-- ease:claim id=content-scripts-default-to-isolated-world -->

To observe JS-level application objects, MV3 `chrome.scripting.executeScript` and manifest `content_scripts` expose the `ExecutionWorld` option (`"ISOLATED"` vs `"MAIN"`), allowing a tiny helper to run in the page's `"MAIN"` execution environment without injecting inline `<script>` tags.
<!-- ease:claim id=scripting-execution-world-supports-main-world -->

Using manifest or `chrome.scripting` `"world": "MAIN"` avoids inline-script CSP errors (`script-src 'nonce-...'`), though any script executing inside `"MAIN"` still operates under the host page's Content Security Policy rather than the extension's CSP.
<!-- ease:claim id=main-world-scripts-inherit-host-page-csp -->

Because `"MAIN"` world shares the page's mutable global object and has zero access to `chrome.*` / `browser.*` extension APIs, a hostile or third-party script can monkey-patch `JSON.parse`, `Array.prototype.map`, or `window.postMessage` to intercept or forge messages.
<!-- ease:claim id=main-world-scripts-face-page-interference-and-no-extension-apis -->

First-party production bridges solve this by keeping the `MAIN` script tiny, capturing native `window.postMessage.bind(window)` and `Object.prototype.hasOwnProperty` bindings at `document_start`/`document_idle` load time, failing closed on unexpected shapes, and emitting strict allowlisted descriptors rather than spreading props or forwarding raw request arguments.
<!-- ease:claim id=first-party-main-world-bridge-captures-native-bindings -->

When an extension needs DOM APIs such as `DOMParser`, `URL.createObjectURL`, or `navigator.clipboard` inside the background without hitting strict website CSPs, Chromium MV3 provides `chrome.offscreen` documents (one active hidden document per profile, communicating solely via `browser.runtime`).
<!-- ease:claim id=offscreen-documents-provide-dom-without-page-csp -->

Derived: Execution-world boundary separation compiled from Chrome Content Scripts, Scripting API, MDN world warnings, and first-party fiber bridge invariants.
| Context | Sees Page JS State? | Has `browser.*` APIs? | Subject to Page CSP? | Allowed Responsibility |
|---|---|---|---|---|
| **MAIN World Helper** | Yes (`__reactFiber$`, stores) | No | Yes | Minimal read-only allowlist extractor + bound `postMessage` |
| **ISOLATED Content Script** | No (clean DOM / Xray) | Limited (`runtime`, `storage`, `dom`) | No (extension CSP) | Input validation, DOM observation, UI overlays, message relay |
| **Background SW / Event Page** | No | Full granted APIs | No | Sender verification, `chrome.debugger`, Native Host, state |
| **Offscreen Document (Chromium)** | No (isolated ext origin) | `runtime` only | No | Background `DOMParser`, clipboard, audio/canvas parsing |

Decision: Never pass extension tokens, cross-origin data, or executable eval strings from `ISOLATED` to `MAIN`; treat every `window.postMessage` event arriving from `MAIN` as untrusted page-controlled input and validate its schema against explicit allowlists.
```js
// Pattern in MAIN-world bridge (captured at load time, allowlisted output only)
const post = window.postMessage.bind(window);
const hasOwn = Object.prototype.hasOwnProperty;
function emitSafeDescriptor(rowId, toolName) {
  if (typeof toolName !== 'string' || !/^[a-z0-9_.-]{1,64}$/i.test(toolName)) return;
  post({ channel: 'agent-main-bridge', v: 1, rowId, toolName }, window.location.origin);
}
```

## Failure Modes (Mandatory)

1. **Injecting inline `<script>` tags into strict-CSP sites:** Blocked by `script-src` nonces/hashes on apps like GitHub, Gmail, or ChatGPT; always declare `"world": "MAIN"` in manifest or use `chrome.scripting.executeScript({ world: "MAIN" })`.
2. **Spreading or cloning full React props across `postMessage` (denylist bug):** Copying object props and deleting sensitive keys leaks request arguments or auth tokens whenever the app renames a field; emit explicit scalar allowlists only.
3. **Hardcoding React Fiber climb depth (e.g., `up < 30`):** Minor SPA DOM wrapper updates shift Fiber tree depth past fixed caps and cause silent `null` reads; stop climbing by structural predicate with a high runaway ceiling (e.g., `80`).
4. **Skipping `wrappedJSObject` Xray protection in Firefox:** In Gecko, `window.wrappedJSObject` is transitively unwrapped so page getters/setters can execute traps; extract primitives immediately and rewrap with `XPCNativeWrapper` if needed.
5. **Trusting `MAIN` world persistence across extension reloads:** Reloading an unpacked or updated extension leaves old `MAIN` world scripts running inside open tabs; version every `postMessage` envelope (`v: N`) and guard re-injection with a per-version sentinel.
