---
id: "transport-and-mv3-lifecycle"
title: "Sub-50ms Agent Transport and MV3 Lifecycle Resilience"
object_type: "guide"
domain: "browser-engineering"
description: "How an extension sustains sub-50ms bidirectional RPC with external AI agents while bypassing Chrome 136+ remote-debugging limits and surviving MV3 worker termination."
when:
  - "connecting a local AI agent CLI or daemon to a user's real browser profile without --remote-debugging-port"
  - "designing MV3 service worker keepalive, state recovery, and large payload chunking"
trust_tier: "draft"
version: "1.0.0"
source_attribution:
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-remote-debugging-port.txt"
    sha256: "43e7b52210e30e9590f4940b223958a4648ba2e413c2df92d186a2f7dd83e21d"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-sw-lifecycle.txt"
    sha256: "c82b348195ee0b812fe860b8170ec497e5fa58c6bf363d7376827394e36faf6f"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-sw-websockets.txt"
    sha256: "b09b55b04ad1f2393353a6336dba4069cea674ea499ef2928b40ddeda636262f"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-storage-api.txt"
    sha256: "9ed2604fac98b658e2bbf6213e6a0f8277342e41621938593109cde6ebbeb6b0"
  - uri: "_evidence/agent-browser-extensions-261116/sources/chrome-native-messaging.txt"
    sha256: "c2f2f31b7c037a88012c283dbc43bb6d9556b36b0fed002974aa12e4d3e2eea0"
  - uri: "_evidence/agent-browser-extensions-261116/sources/mdn-native-messaging.txt"
    sha256: "bdd916a12ccf3acee99c9282dab91af858cccf0c411093ad45e08990ad74f147"
  - uri: "_evidence/agent-browser-extensions-261116/sources/webkit-safari-extensions-16-4.txt"
    sha256: "9c5bd929ebbb28bfc8c7e32152583aeac3f8504b90d9a4ba6e1001ba85853e51"
link_types:
  - link_type: "cites"
    target_id: "chrome-136-blocks-remote-debugging-on-default-profile"
  - link_type: "cites"
    target_id: "mv3-service-workers-terminate-when-idle"
  - link_type: "cites"
    target_id: "active-debugger-websocket-native-keep-sw-alive"
  - link_type: "cites"
    target_id: "websocket-20s-heartbeat-prevents-sw-idle-shutdown"
  - link_type: "cites"
    target_id: "storage-session-persists-in-memory-across-sw-restarts"
  - link_type: "cites"
    target_id: "native-messaging-communicates-over-stdio"
  - link_type: "cites"
    target_id: "native-messaging-enforces-1mb-host-reply-ceiling"
  - link_type: "about"
    target_id: "chrome-default-profile-cdp-restriction"
  - link_type: "about"
    target_id: "mv3-worker-idle-termination"
  - link_type: "about"
    target_id: "native-messaging-stdio"
  - link_type: "about"
    target_id: "sw-websocket-keepalive"
  - link_type: "about"
    target_id: "chromium-mv3"
  - link_type: "about"
    target_id: "firefox-gecko"
  - link_type: "depends-on"
    target_id: "cross-browser-capability-matrix"
---

## Purpose

Specify how an external agent daemon communicates with an installed browser extension at sub-50ms latency using user-session profiles, without relying on `--remote-debugging-port` or losing state when MV3 workers unload.

## When to Use / When NOT

- **Use when:** Controlling the user's real signed-in browser session over localhost or stdio from an agent CLI (`jev-browser`, MCP server, or desktop agent).
- **Do NOT use when:** Launching disposable automated CI test browsers (`Chrome for Testing` or Playwright with fresh `--user-data-dir`), where standard external WebSocket CDP already works directly.

## Core Knowledge Content

Since Chrome 136, `--remote-debugging-port` and `--remote-debugging-pipe` are silently ignored against the default user data directory to block cookie-theft exploits, requiring a non-standard `--user-data-dir` for flag-based external CDP.
<!-- ease:claim id=chrome-136-blocks-remote-debugging-on-default-profile -->

Running an extension bridge avoids the Chrome 136 profile block legally because the user explicitly installs and enables the extension inside their real profile. However, extension background scripts are ephemeral: Chrome terminates an MV3 service worker after 30 seconds of inactivity or after 5 minutes on a single request.
<!-- ease:claim id=mv3-service-workers-terminate-when-idle -->

Two sanctioned IPC transports connect an agent daemon to the extension: Native Messaging (`connectNative` stdio) and Localhost WebSocket (`ws://127.0.0.1`). Chrome explicitly keeps MV3 service workers alive during active `browser.debugger` sessions, active WebSocket traffic, and active `runtime.connectNative()` ports.
<!-- ease:claim id=active-debugger-websocket-native-keep-sw-alive -->

When using WebSockets (such as the `127.0.0.1` bridge loop used in local agent connectors), sending a ping frame every 20 seconds resets the service worker's idle timer well inside the 30-second shutdown window.
<!-- ease:claim id=websocket-20s-heartbeat-prevents-sw-idle-shutdown -->

All mutable bridge custody state (attached `tabId` leases, `pageId` tokens, active `epoch`, pending command receipts) must never live solely in JS globals; persist it in `browser.storage.session`, which stores up to 10 MB in memory across worker restarts on Chrome and Safari 16.4+ while remaining hidden from content scripts by default.
<!-- ease:claim id=storage-session-persists-in-memory-across-sw-restarts -->

For zero-port-conflict, browser-launched IPC across Chrome, Firefox, and Safari, Native Messaging communicates over `stdin`/`stdout` with JSON UTF-8 payloads framed by a 32-bit native byte-order length header.
<!-- ease:claim id=native-messaging-communicates-over-stdio -->

Crucially, Native Messaging caps a single message from the native host to the browser at 1 MB (while Chrome->host allows up to 64 MiB), forcing large DOM snapshots or base64 screenshots to either use the 1.8 MB-bounded localhost HTTP/WebSocket transport or chunked Native Messaging frames.
<!-- ease:claim id=native-messaging-enforces-1mb-host-reply-ceiling -->

Derived: Transport trade-off matrix derived from Chrome 136 blog, SW lifecycle, WebSocket docs, and Native Messaging limits.
| Transport | Real Default Profile? | SW Keepalive | Max Single Payload | Multi-Browser Host Manifest |
|---|---|---|---|---|
| **Native Messaging (`connectNative`)** | Yes | Yes (port open) | 1 MB host->browser / 64 MiB browser->host | `allowed_origins` (Chrome) vs `allowed_extensions` (Firefox) |
| **Localhost WebSocket (`127.0.0.1`)** | Yes | Yes (with 20s ping) | Practical ~1.8 MB JSON cap before chunking | Works identically across Chrome/Firefox/Safari |
| **External `--remote-debugging-port`** | Blocked on Chrome 136+ default dir | N/A | Full CDP | Chromium-only |

Decision: Default to `connectNative` (auto-reconnecting on `onDisconnect`) or `127.0.0.1` WebSocket with a 20-second keepalive heartbeat, hydrated on every wake from `chrome.storage.session` before processing any RPC command.
```js
// Synchronous top-level registration + 20s keepalive heartbeat
let ws = null;
function connectBridge(url) {
  ws = new WebSocket(url);
  const timer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send('{"op":"ping"}');
    else clearInterval(timer);
  }, 20_000);
}
```

## Failure Modes (Mandatory)

1. **Corrupting Native Messaging 32-bit framing with debug `print()` or Windows text-mode `
`:** Any non-framed byte written to `stdout` breaks length decoding (`Error when communicating with the native messaging host`); always send diagnostics to `stderr` and run Python hosts with `-u` / `O_BINARY` on Windows.
2. **Exceeding 1 MB host->browser Native Messaging limit on large screenshots/DOM dumps:** Chrome drops the pipe silently; compress screenshots (JPEG/WebP), truncate DOM prose, or stream multi-part chunks under 512 KB.
3. **Registering listeners after `await ready()`:** In both Chrome SWs and Firefox Event Pages, asynchronously registered `onMessage`/`onAlarm` listeners fail to wake dormant workers; attach all listeners synchronously at top-level module evaluation, then `await ready()` inside each callback.
4. **Assuming string character count equals Native Messaging byte length:** Multibyte UTF-8 characters (Vietnamese, CJK, emoji) make `len(str) < len(bytes)`, truncating trailing JSON braces; always pack `len(payload.encode("utf-8"))`.
5. **Infinite reconnect spin when Native Host crashes immediately:** Unbounded reconnect in `onDisconnect` burns CPU; apply exponential backoff (`250ms -> 5s`) and emit `BRIDGE_HOST_DISCONNECTED` after 3 consecutive failures.
