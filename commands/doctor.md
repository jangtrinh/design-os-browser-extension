---
description: Diagnose DESIGN:OS Browser Agent installation, TypeScript 7 toolchain, host bundles, and loopback broker readiness
allowed-tools: Bash, Read, Glob
---

# `/doctor` — Browser Agent Health Diagnostics

Run a read-only check of the workspace, TypeScript `>= 7.0.2` build, contract checksums, host bundle parity, and loopback broker (`127.0.0.1:4347`). Do not mutate source files.

## Steps

1. Run repository self-check & contract/bundle verification:
   ```bash
   python3 scripts/self_check.py
   node scripts/skill_contract.mjs --check
   node scripts/sync_host_bundles.mjs --check
   ```
2. Probe live broker status without failing if idle:
   ```bash
   node cli/dist/browser-agent.js daemon status --json || true
   ```
3. Summarize a concise health table:
   - TypeScript compiler version (`>= 7.0.2`) and `npm test` status
   - `extension/dist/chromium` & `extension/dist/firefox` build presence (`debuggerAttached: false`)
   - Installed host skill parity (`~/.gemini/config/skills/es-browser-agent`, `~/.claude/skills/es-browser-agent`, `~/.agents/skills/es-browser-agent`)
   - Live WebSocket attachment on `127.0.0.1:4347`
