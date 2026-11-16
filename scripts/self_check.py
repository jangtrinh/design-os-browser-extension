"""Offline deterministic repository and knowledge-pack self-check."""

import os
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
    "knowledge/agent-browser-extensions/ontology.yaml",
    "knowledge/agent-browser-extensions/index.json",
    "scripts/verify_bridge_primitives.py",
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
    "knowledge/agent-browser-extensions/ontology.proposal.yaml",
    "scripts/verify_bridge_primitives.py",
    "scripts/self_check.py",
]


def fail(message: str):
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


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

    inv = subprocess.run(
        [sys.executable, str(ROOT / "scripts/verify_bridge_primitives.py")],
        capture_output=True,
        text=True,
    )
    if inv.returncode != 0:
        fail(f"verify_bridge_primitives.py failed:\n{inv.stdout}\n{inv.stderr}")

    kb_candidates = []
    if os.environ.get("KNOWLEDGE_BUILDER_REPO"):
        kb_candidates.append(Path(os.environ["KNOWLEDGE_BUILDER_REPO"]).expanduser())
    kb_candidates.append(ROOT.parent / "design-os-knowledge-builder")
    for candidate in kb_candidates:
        validate_py = candidate / "skills" / "es-knowledge-forge" / "validate.py"
        if validate_py.is_file():
            val = subprocess.run(
                [sys.executable, str(validate_py), "--root", str(ROOT / "knowledge/agent-browser-extensions")],
                capture_output=True,
                text=True,
            )
            if val.returncode != 0:
                fail(f"knowledge pack validate.py failed:\n{val.stdout}\n{val.stderr}")
            break

    print("ok: design-os-browser-extension self-check passed")


if __name__ == "__main__":
    main()
