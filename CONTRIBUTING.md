# Contributing to `design-os-browser-extension`

Thank you for contributing to **DESIGN:OS Browser Extension** (`DESIGN:OS`).

## Verification Gate Before Submitting a PR

Every change must pass the local self-check (and pack validation when `design-os-knowledge-builder` is present):

```bash
python3 scripts/self_check.py
```

## Guidelines

1. **Ontology-First Pack Edits:** Never hand-edit `claims/`, `sources/`, `captures.jsonl`, or `index.json`. Use `knowledge_builder.cli` actions and re-run `validate.py`.
2. **Non-Bypass Safety Rule:** Do not contribute CAPTCHA solvers, anti-bot evasion, or authentication bypass code.
3. **Conventional Commits:** Use `feat:`, `fix:`, `docs:`, or `chore:` prefixes with zero AI references in commit messages.
