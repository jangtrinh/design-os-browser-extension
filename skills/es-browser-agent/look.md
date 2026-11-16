# Visual Inspection Rubric (`look.md`)

Run `node skills/es-browser-agent/look.mjs --repo-root . --output-dir <run-dir> --sheet <sheet.png>` after `validate.mjs`. Inspect the generated PNG directly before handing over.

## Machine-Measured Checks (`L1`–`L4`, Enforced by `look.mjs`)

- **L1 (`panels-populated`):** All 4 inspection panels (`Run Receipt`, `SQLite Cache & Hybrid Entities`, `Fenced Dispatch & Copilot Queue`, `Human Gate & Pacing`) render non-empty text inside `<main>`.
- **L2 (`zero-horizontal-overflow`):** `document.documentElement.scrollWidth <= window.innerWidth` at `1440px` sheet width.
- **L3 (`no-emoji-glyphs`):** Zero Unicode emoji/dingbat glyph shortcuts (`U+1F300–U+1FAFF`, `U+2600–U+27BF`) used in place of structured labels or icons.
- **L4 (`png-artifact-bounds`):** Saved PNG file exists at `--sheet`, dimensions `>= 1280x720`, byte length `> 20000`.

## Human Eye Checks (`L5`–`L8`, Checked by Viewing the PNG)

- **L5 (`hierarchy-and-contrast`):** Headings, status pills (`COMMITTED`, `QUEUED_COPILOT`, `BLOCKED_CHALLENGE`), and monospace JSON/SQL outputs are immediately scannable with crisp contrast.
- **L6 (`copilot-safety-visible`):** Every drafted write clearly displays `sent: false` and creator origin `agent-rpc` without ambiguity.
- **L7 (`human-gate-clarity`):** When the run includes a challenge/checkpoint event, the `BLOCKED_CHALLENGE` state and `postBlockRetries: 0` stand out cleanly in the gate panel.
- **L8 (`no-clipping-or-overlap`):** No truncated URLs, overflowing code blocks, or overlapping card borders inside any panel.

## Without a Browser

If no Chromium/Chrome binary is available in the local user cache (`CHROME_FOR_TESTING_PATH` or Playwright cache under home directory), `look.mjs` exits `2` and you MUST report verbatim:

`LOOK: NOT RUN — browser runtime or local Chromium cache is unavailable.`
