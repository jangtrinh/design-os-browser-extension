---
id: "security-and-human-handoff"
title: "Security Quarantine, Least-Privilege Permissions, and Human Handoff Gates"
object_type: "decision-record"
domain: "browser-engineering"
description: "Defines mandatory security boundaries for agent extensions: prompt-injection quarantine of DOM text, sender validation, activeTab scoping, and non-bypass handoff at CAPTCHAs, 2FA, and paywalls."
when:
  - "auditing an agent browser extension for prompt injection, privilege escalation, or compliance with anti-bot boundaries"
  - "deciding how the extension handles CAPTCHAs, login/2FA screens, enterprise blocked hosts, and checkout gates"
trust_tier: "draft"
version: "1.0.0"
source_attribution:
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-stay-secure.txt"
    sha256: "2bb735a8ff98bbed5eb18050f822f9019e0695a0322effb5dc4d3a57cff1d807"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-native-messaging.txt"
    sha256: "c2f2f31b7c037a88012c283dbc43bb6d9556b36b0fed002974aa12e4d3e2eea0"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-activetab.txt"
    sha256: "3d3c42664ad4f5feea78fcd2f2041992cad77fba11a338957932655b7f878358"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-debugger-api.txt"
    sha256: "6c546e0fa90795072833e5093dd1475badc10016df59af7d378b792823af922d"
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-manifest-content-scripts.txt"
    sha256: "9a7bd5f73a65b3633bee1528a4ede8fad69ac40f6efaf480954b4cc8cd831f95"
link_types:
  - link_type: "cites"
    target_id: "compromised-renderer-can-forge-content-script-messages"
  - link_type: "cites"
    target_id: "service-worker-must-validate-sender-before-native-host"
  - link_type: "cites"
    target_id: "activetab-grants-temporary-host-access-on-user-gesture"
  - link_type: "cites"
    target_id: "debugger-fails-or-detaches-on-policy-blocked-hosts"
  - link_type: "cites"
    target_id: "main-world-scripts-face-page-interference-and-no-extension-apis"
  - link_type: "about"
    target_id: "human-gate-handoff"
  - link_type: "about"
    target_id: "captcha-auth-payment-human-gates"
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

Lock down the security trust boundaries of an agent browser extension so malicious web pages cannot hijack host execution or steal cross-origin secrets, and formalize non-bypass human handoff rules for CAPTCHAs, authentication, and payments.

## When to Use / When NOT

- **Use when:** Designing permission scopes, native-host message verification, DOM-to-LLM serialization, and challenge-handling workflows in any agent extension.
- **Do NOT use when:** Seeking workarounds to bypass CAPTCHAs, anti-bot challenges, access controls, or paywalls — this architecture explicitly forbids bypasses and requires clean human handoff.

## Core Knowledge Content

Content scripts execute inside the same OS renderer process as untrusted web pages, exposing them to side-channel leaks and full message forgery if a hostile page compromises the renderer.
<!-- ease:claim id=compromised-renderer-can-forge-content-script-messages -->

Because content scripts share that untrusted renderer boundary, the privileged background worker must validate `sender.origin` (or `sender.tab?.url`), reject unexpected `runtime.onMessageExternal` origins, and sanitize every payload before forwarding to a Native Messaging host.
<!-- ease:claim id=service-worker-must-validate-sender-before-native-host -->

Never inject privileged secrets, tokens, or `MAIN`-world data indiscriminately: `MAIN`-world code shares the host page's mutable JS runtime where malicious scripts can intercept or overwrite logic and values.
<!-- ease:claim id=main-world-scripts-face-page-interference-and-no-extension-apis -->

Where agent execution starts from an explicit user action (toolbar click, command shortcut, context menu), prefer `"activeTab"` + `"scripting"` over persistent `"<all_urls>"`: `"activeTab"` grants temporary access only after user gesture and revokes access automatically on cross-origin navigation or tab close.
<!-- ease:claim id=activetab-grants-temporary-host-access-on-user-gesture -->

Enterprise `ExtensionSettings` `runtime_blocked_hosts` policies also enforce hard browser-level boundaries, causing `browser.debugger.attach()` to reject or detach immediately if a tab or child frame navigates to a restricted host.
<!-- ease:claim id=debugger-fails-or-detaches-on-policy-blocked-hosts -->

Decision: Classify all web-sourced DOM/accessibility text as `quarantined: true` untrusted data (never system instructions), enforce an immutable header/cookie redaction allowlist on network logs, and immediately pause automated dispatch with an explicit handoff status whenever a human-only gate appears.
| Gate Condition Detected | Required Extension State | Required Agent Behavior | Prohibited Action |
|---|---|---|---|
| **CAPTCHA / Turnstile / Anti-Bot Check** | `BLOCKED_CHALLENGE` (tab focused, automation paused) | Surface visible browser tab to user; wait for user confirmation | Clicking, solving, waiting out, or spoofing anti-bot checks |
| **Login / SSO / MFA / Passkey Prompt** | `BLOCKED_AUTH` (no credential harvesting) | Ask user to sign in directly in the browser pane | Injecting credentials or bypassing auth domains |
| **Payment / Checkout Confirmation** | `BLOCKED_PAYMENT` (or pre-dispatch human gate) | Require user confirmation or manual completion in visible UI | Auto-submitting irreversible financial charges without explicit authorization |
| **Policy-Blocked Host (`ExtensionsSettings`)** | `BLOCKED_POLICY` (detached cleanly) | Report restriction and stop on that origin | Attempting privilege escalation or profile tampering |

## Failure Modes (Mandatory)

1. **Allowing content scripts to ask background `fetch(arbitraryUrl)` or `connectNative(arbitraryCmd)`:** Turns any XSS or compromised tab into an arbitrary local-network SSRF or RCE proxy; accept only closed-set enum RPC actions (`observe`, `click_ref`, `type_ref`) and validate `sender.id === runtime.id` plus `sender.tab`.
2. **Forwarding raw page DOM text directly into agent system prompts without delimiters/quarantine:** Enables indirect prompt injection where hidden `aria-label` or offscreen `<span>` text hijacks the agent's next tool call; wrap all page-extracted strings as untrusted quoted data and enforce pre-dispatch action confirmation on high-risk targets.
3. **Requesting `<all_urls>` + `debugger` + `nativeMessaging` in a Store submission without narrow scoping or justification:** Triggers Chrome Web Store / AMO policy rejection; use `activeTab` or `optional_host_permissions` whenever workflows are user-initiated.
4. **Attempting automated retries or synthetic mouse patterns against CAPTCHA / Turnstile frames:** Violates platform anti-abuse rules and fails reliability; detect challenge frames/selectors passively and immediately transition to `BLOCKED_CHALLENGE` for human resolution.
5. **Leaking `Authorization`, `Cookie`, or API-key headers in `chrome.debugger` `Network.*` telemetry:** Exposes user session secrets to LLM logs; redact sensitive header keys before serializing network diagnostics out of the background worker.
