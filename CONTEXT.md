# design-os-browser-extension

Ontology-first cross-browser WebExtension engineering knowledge base (`UKMC.v2`) and workspace for building fast, deep, transactionally fenced AI agent browser bridges.

## Language

**Capability-Tiered Adapter**:
One typed Agent RPC contract mapped onto engine-specific extension and host capabilities (Tier-1 Chromium `chrome.debugger`/CDP, Tier-2 Firefox Event Pages + Native Host/WebDriver BiDi, Tier-3 Safari Xcode App Container) rather than stripping Chromium down to a weak common subset.
_Avoid_: lowest-common-denominator API, universal chrome.debugger

**Agent RPC**:
Typed JSON contract (`observe`, `act`, `read_state`, `handoff`, `capabilities`) exchanged between an external agent daemon and the browser extension over Native Messaging stdio or `127.0.0.1` WebSocket.
_Avoid_: ad-hoc eval injection, raw HTML dump

**Fenced Dispatch**:
Mutating browser action execution guarded by tab ownership `lease`, controller `epoch`, and navigation-bound `pageId` verification before `Input.*` dispatch, retiring timed-out actions to read-only reconciliation (`UNCERTAIN`).
_Avoid_: blind retry, fire-and-forget click

**Page Epoch**:
Monotonic session/navigation freshness fence stored in `browser.storage.session` so MV3 service worker restarts or SPA route transitions invalidate stale element refs immediately.
_Avoid_: in-memory global state, persistent ref cache

**Human Gate Handoff**:
Mandatory non-bypass pause transition (`BLOCKED_CHALLENGE`, `BLOCKED_AUTH`, `BLOCKED_PAYMENT`, `BLOCKED_POLICY`) handing live visible browser control back to the human user at CAPTCHAs, anti-bot gates, 2FA, or paywalls.
_Avoid_: CAPTCHA solver, stealth bypass, anti-bot evasion, untrusted click fallback
