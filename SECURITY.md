# Security Policy (`design-os-browser-extension`)

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `main` | Yes |

## Security Boundaries

- **Zero external telemetry:** All local scripts and knowledge validation run offline with zero tracking (see [`PRIVACY.md`](PRIVACY.md)).
- **Untrusted page quarantine:** DOM content and `MAIN`-world `postMessage` frames are treated strictly as untrusted data.
- **No anti-bot or access-control bypasses:** Challenges, authentication, and payment gates hand off directly to the human user (`BLOCKED_CHALLENGE`, `BLOCKED_AUTH`, `BLOCKED_PAYMENT`).

## Reporting a Vulnerability

Please report suspected vulnerabilities via [GitHub Security Advisories](https://github.com/jangtrinh/design-os-browser-extension/security/advisories/new) rather than public issues.
