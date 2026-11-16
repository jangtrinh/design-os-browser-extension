# Security Policy (`design-os-browser-extension`)

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `main` | Yes |

## Security Boundaries

- **Zero external telemetry:** All local scripts and knowledge validation run offline with zero tracking (see [`PRIVACY.md`](PRIVACY.md)).
- **Untrusted page quarantine:** DOM content and `MAIN`-world `postMessage` frames are treated strictly as untrusted data.
- **Loopback broker authentication:** `POST /rpc` and `POST /cache/query` require the pairing token in the `x-browser-agent-token` header (or `Authorization: Bearer`), compared in constant time. Every route refuses a `Host` other than `127.0.0.1` / `localhost` on the broker port (DNS rebinding) and any `Origin` that is not a browser-extension origin (drive-by web pages). Set `BROWSER_AGENT_ALLOWED_EXTENSION_IDS` to pin the extension ID.
- **Token never printed by default:** `daemon start` and `daemon token` show a redacted form and the pairing file path; `daemon token --reveal` prints the raw token for pasting into the popup.
- **No anti-bot or access-control bypasses:** Challenges, authentication, and payment gates hand off directly to the human user (`BLOCKED_CHALLENGE`, `BLOCKED_AUTH`, `BLOCKED_PAYMENT`).

## Reporting a Vulnerability

Please report suspected vulnerabilities via [GitHub Security Advisories](https://github.com/jangtrinh/design-os-browser-extension/security/advisories/new) rather than public issues.
