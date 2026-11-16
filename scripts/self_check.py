"""Offline deterministic repository, TypeScript toolchain, build/test, and knowledge-pack self-check."""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED_FILES = [
    "LICENSE",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".project-agent.md",
    "CONTEXT.md",
    "SECURITY.md",
    "PRIVACY.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "CHANGELOG.md",
    "llms.txt",
    "package.json",
    "tsconfig.json",
    "extension/tsconfig.json",
    "vitest.config.ts",
    ".mcp.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    "skills/design-os-browser-agent/SKILL.md",
    "knowledge/agent-browser-extensions/ontology.yaml",
    "knowledge/agent-browser-extensions/index.json",
    "scripts/verify_bridge_primitives.py",
    "scripts/build.mjs",
    "scripts/e2e_visual_proof.mjs",
]
PORTABLE_CHECK_FILES = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".project-agent.md",
    "CONTEXT.md",
    "SECURITY.md",
    "PRIVACY.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
    "llms.txt",
    "package.json",
    ".mcp.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    "skills/design-os-browser-agent/SKILL.md",
    "knowledge/agent-browser-extensions/ontology.proposal.yaml",
    "scripts/verify_bridge_primitives.py",
    "scripts/build.mjs",
    "scripts/e2e_visual_proof.mjs",
    "scripts/self_check.py",
]


def fail(message: str):
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_semver(version_text: str) -> tuple[int, int, int]:
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", version_text)
    if not match:
        fail(f"unable to parse tsc version from output: {version_text!r}")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def run_step(cmd: list[str], label: str) -> str:
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        fail(f"{label} failed:\n{res.stdout}\n{res.stderr}")
    return res.stdout


def main():
    for rel in REQUIRED_FILES:
        if not (ROOT / rel).is_file():
            fail(f"missing required file: {rel}")

    license_first = (ROOT / "LICENSE").read_text(encoding="utf-8").splitlines()[0]
    expected_notice = "Required Notice: Copyright (c) 2026 Jang Trinh (https://github.com/jangtrinh)"
    if license_first.strip() != expected_notice:
        fail(f"LICENSE top notice mismatch: {license_first!r}")

    readme = (ROOT / "README.md").read_text(encoding="utf-8").lower()
    if "open source" in readme or "open-source" in readme or "mit license" in readme:
        fail("README.md must describe PolyForm Shield 1.0.0 as source-available, never open source or MIT")

    home_prefix = "/Users/" + "jang"
    for rel in PORTABLE_CHECK_FILES:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if home_prefix in text:
            fail(f"hardcoded local home path found in {rel}")

    tsc_bin = ROOT / "node_modules" / ".bin" / "tsc"
    if not tsc_bin.is_file():
        fail("missing local TypeScript compiler binary at node_modules/.bin/tsc; run npm install")
    tsc_ver_out = run_step([str(tsc_bin), "--version"], "tsc --version")
    ver = parse_semver(tsc_ver_out)
    if ver < (7, 0, 2):
        fail(f"TypeScript >= 7.0.2 required, found {ver}")

    run_step(["npm", "run", "typecheck"], "npm run typecheck")
    run_step(["npm", "run", "build"], "npm run build")
    run_step(["npm", "test"], "npm test")

    for artifact in [
        "cli/dist/browser-agent.js",
        "extension/dist/chromium/manifest.json",
        "extension/dist/firefox/manifest.json",
    ]:
        if not (ROOT / artifact).is_file():
            fail(f"expected built artifact missing: {artifact}")

    run_step([sys.executable, str(ROOT / "scripts/verify_bridge_primitives.py")], "verify_bridge_primitives.py")

    kb_candidates = []
    if os.environ.get("KNOWLEDGE_BUILDER_REPO"):
        kb_candidates.append(Path(os.environ["KNOWLEDGE_BUILDER_REPO"]).expanduser())
    kb_candidates.append(ROOT.parent / "design-os-knowledge-builder")
    for candidate in kb_candidates:
        validate_py = candidate / "skills" / "es-knowledge-forge" / "validate.py"
        if validate_py.is_file():
            run_step(
                [sys.executable, str(validate_py), "--root", str(ROOT / "knowledge/agent-browser-extensions")],
                "knowledge pack validate.py",
            )
            break

    print("ok: design-os-browser-extension self-check passed")


if __name__ == "__main__":
    main()
