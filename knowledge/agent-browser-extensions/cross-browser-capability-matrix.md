---
id: "cross-browser-capability-matrix"
title: "Cross-Browser Extension Capability Matrix and Tiered Agent RPC"
object_type: "comparison"
domain: "browser-engineering"
description: "Compares Chromium MV3, Firefox Gecko, and Safari WebKit capabilities and defines how one Agent RPC contract maps onto tiered browser adapters."
when:
  - "scaffolding an agent browser extension that must run across Chrome, Edge, Arc, Brave, Firefox, or Safari"
  - "choosing between a lowest-common-denominator API subset and a capability-tiered adapter"
trust_tier: "draft"
version: "1.0.0"
source_attribution:
  - uri: "_evidence/agent-browser-extensions-261116/sources/w3c-wecg-charter.txt"
    sha256: "240490bd7c53ceccaa5fa3a5ea047e655a9a37667d3dd4d47aa5c30f8b71ab06"
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-manifest-background.txt"
    sha256: "bd63bbeb314dca2081b964a493bd04a70b7c9ea4add07ffa4753192196877059"
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-background-scripts.txt"
    sha256: "4b2fa7abfe23a2a53634aef675d237b1c7e2893784fb9b340f5273454448104c"
  - uri: "_evidence/agent-browser-extensions-261116/sources/webkit-safari-14-extensions.txt"
    sha256: "5a29b2782d36ba9d59e46054fb311ed6252bfddbb6bd5aaee25f5f82ec836bf6"
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-cross-browser-extension.txt"
    sha256: "e7aa180b074aa26c0b906d688cb370331d272498826197de834dac9f876a135b"
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-chrome-incompatibilities.txt"
    sha256: "1945ad12a4362bc30ccf4ccb5f457d2689cf3b7b1070a3b752a2ddd147083c46"
  - uri: "_evidence/agent-browser-extensions-261116/sources/wxt-target-browsers.txt"
    sha256: "191ecda10485027f843082dc1dbaf436beb3c6d6d8bf5e68d700a71676457ed3"
link_types:
  - link_type: "cites"
    target_id: "w3c-wecg-balances-common-core-with-vendor-autonomy"
  - link_type: "cites"
    target_id: "firefox-mv3-uses-event-pages-not-service-workers"
  - link_type: "cites"
    target_id: "chrome-mv3-forbids-background-event-pages"
  - link_type: "cites"
    target_id: "safari-web-extensions-require-native-app-container"
  - link_type: "cites"
    target_id: "firefox-does-not-implement-debugger-api"
  - link_type: "cites"
    target_id: "wxt-compiles-per-browser-manifests-and-entrypoint-targets"
  - link_type: "about"
    target_id: "chromium-mv3"
  - link_type: "about"
    target_id: "firefox-gecko"
  - link_type: "about"
    target_id: "safari-webkit"
  - link_type: "about"
    target_id: "engine-api-divergence"
  - link_type: "about"
    target_id: "native-messaging-stdio"
  - link_type: "about"
    target_id: "chrome-debugger-cdp"
  - link_type: "compares"
    target_id: "chromium-mv3"
  - link_type: "compares"
    target_id: "firefox-gecko"
  - link_type: "compares"
    target_id: "safari-webkit"
  - link_type: "compares"
    target_id: "transport-and-mv3-lifecycle"
  - link_type: "compares"
    target_id: "execution-worlds-and-state-reading"
  - link_type: "compares"
    target_id: "trusted-input-shadow-and-oopif"
  - link_type: "compares"
    target_id: "fast-snapshot-and-fenced-dispatch"
---

## Purpose

Define why an AI agent bridge cannot rely on one lowest-common-denominator extension API across every browser, and specify the Capability-Tiered Engine Adapter behind one stable Agent RPC contract.

## When to Use / When NOT

- **Use when:** Designing a browser extension that exposes fast observation and reliable web actions to an AI agent on Chromium, Firefox, or Safari.
- **Do NOT use when:** Targeting a Chromium-only kiosk/profile with no cross-browser requirement — still read `transport-and-mv3-lifecycle` and `trusted-input-shadow-and-oopif` before choosing direct CDP vs `chrome.debugger`.

## Core Knowledge Content

The W3C WebExtensions Community Group specifies a shared base permission model, manifest core, and Native Messaging architecture while explicitly expecting browser vendors to retain proprietary APIs beyond the common core.
<!-- ease:claim id=w3c-wecg-balances-common-core-with-vendor-autonomy -->

Derived: Because vendor capabilities diverge sharply at the background lifecycle and debugger layers, forcing one identical implementation onto every browser strips Chromium of CDP-grade trusted input while still failing Firefox and Safari packaging rules; compile one typed Agent RPC envelope (`observe`, `act`, `read_state`, `handoff`) across three capability tiers.

Derived: Synthesized capability tiers from W3C charter scope, MDN incompatibilities, and WebKit packaging rules.
| Capability Tier | Target Engines | Background Context | Deep Input & Frame Transport | Packaging |
|---|---|---|---|---|
| **Tier 1 (Full CDP)** | Chromium (Chrome, Edge, Arc, Dia, Brave) | MV3 Service Worker (`background.service_worker`) | `chrome.debugger` flat sessions + `chrome.scripting` (`MAIN`/`ISOLATED`) | `.zip` / CRX |
| **Tier 2 (Event + Host/BiDi)** | Firefox (Gecko) | Non-persistent Event Page (`background.scripts`) | `ISOLATED`/`MAIN` + `wrappedJSObject` + Native Host / WebDriver BiDi | `.xpi` signed zip |
| **Tier 3 (App-Bundled)** | Safari (WebKit) | Event Page or SW (`preferred_environment`) | Content scripts + `NSExtensionContext` native host / `safaridriver` | Xcode App Bundle |

Manifest V3 background execution diverges directly across engines: Firefox MV3 rejects `background.service_worker` and runs event pages declared under `background.scripts`.
<!-- ease:claim id=firefox-mv3-uses-event-pages-not-service-workers -->

Conversely, Chrome MV3 forbids persistent or non-persistent background/event pages and mandates a service worker, creating a direct manifest contradiction if a single static configuration assumes one context type.
<!-- ease:claim id=chrome-mv3-forbids-background-event-pages -->

Firefox also omits `chrome.debugger` entirely, meaning any extension RPC handler that invokes `debugger.sendCommand` without checking runtime capabilities fails at runtime on Gecko.
<!-- ease:claim id=firefox-does-not-implement-debugger-api -->

Safari introduces a distinct packaging boundary: Safari Web Extensions must wrap standard HTML/CSS/JS extension resources inside a native Xcode application bundle rather than shipping a standalone root-manifest zip.
<!-- ease:claim id=safari-web-extensions-require-native-app-container -->

Build tooling such as WXT resolves manifest contradictions cleanly by generating per-browser builds and manifests from shared typed entrypoints and target flags (`-b chrome`, `-b firefox`, `-b safari`).
<!-- ease:claim id=wxt-compiles-per-browser-manifests-and-entrypoint-targets -->

Decision: Use one Agent RPC protocol (`capabilities() -> { trustedInput, oopifSessions, mainWorld, closedShadow }`) so the caller negotiates Tier-1 `chrome.debugger` on Chromium and falls back to Tier-2/Tier-3 Native Messaging or WebDriver BiDi on Firefox and Safari.
```json
{
  "rpc": "agent.capabilities",
  "tier": "chromium-tier1",
  "features": {
    "trustedInput": "chrome.debugger:Input",
    "oopifSessions": "Target.setAutoAttach(flatten=true)",
    "closedShadowDom": "chrome.dom.openOrClosedShadowRoot",
    "backgroundModel": "service_worker"
  }
}
```

## Failure Modes (Mandatory)

1. **Shipping Chrome-only `background.service_worker` to Firefox MV3:** Firefox ignores `service_worker` or fails to wake background listeners in older releases; always emit `background.scripts` for Gecko builds or dual-key via WXT.
2. **Calling `chrome.debugger` unconditionally in shared agent handlers:** Throws missing-API errors on Firefox and Safari; feature-detect `globalThis.browser?.debugger ?? globalThis.chrome?.debugger` and route non-Chromium `trustedClick` calls to the Native Host / WebDriver BiDi adapter.
3. **Treating `getBackgroundPage()` as portable:** Fails in Chrome MV3 service workers (`undefined`/unsupported) and returns `null` when event pages sleep in Firefox; standardize all UI-to-background calls on `runtime.sendMessage` / `runtime.connect`.
4. **Assuming zip packaging installs on Safari:** Safari rejects loose zip bundles for production distribution and requires Xcode App Extension container signing and App Store / notarized macOS distribution.
5. **Relying on `browser.*` Promises without checking pre-Chrome-148 or DevTools contexts:** Before Chrome 148 (and Chrome 152 for `devtools_page`), `browser.*` requires `webextension-polyfill` or WXT's typed `browser` shim.
