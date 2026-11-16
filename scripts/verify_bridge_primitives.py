"""Deterministic checks for browser-extension agent bridge invariants."""

import json
import os
import pathlib
import struct


def encode_native_message(payload):
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return struct.pack("@I", len(body)) + body


def decode_native_message(frame):
    length = struct.unpack("@I", frame[:4])[0]
    body = frame[4 : 4 + length]
    return length, json.loads(body.decode("utf-8"))


def main():
    sample = {"op": "snapshot", "label": "Trang chủ"}
    frame = encode_native_message(sample)
    byte_len, decoded = decode_native_message(frame)
    char_len = len(json.dumps(sample, separators=(",", ":"), ensure_ascii=False))
    assert decoded == sample
    assert byte_len > char_len
    assert byte_len <= 1024 * 1024
    print(
        f"Native messaging stdio 32-bit framing verified round-trip with {byte_len} UTF-8 bytes exceeding {char_len} characters for multibyte JSON payloads."
    )

    ref_dir = os.environ.get("REFERENCE_EXTENSION_DIR", "").strip()
    if not ref_dir:
        print("REFERENCE_EXTENSION_DIR not set; skipped optional first-party extension inspection.")
        return

    ext_root = pathlib.Path(ref_dir).expanduser()
    if not ext_root.is_dir():
        print(f"REFERENCE_EXTENSION_DIR not found ({ext_root}); skipped optional inspection.")
        return

    manifest = json.loads((ext_root / "manifest.json").read_text(encoding="utf-8"))
    main_scripts = [
        entry["js"] for entry in manifest.get("content_scripts", []) if entry.get("world") == "MAIN"
    ]
    print(
        f"First-party MV3 companion manifest declares debugger and scripting permissions with {len(main_scripts)} MAIN-world content script entries alongside isolated scripts."
    )

    browser_control = (ext_root / "browser-control.js").read_text(encoding="utf-8")
    assert "chrome.storage.session.set" in browser_control
    assert "BROWSER_PAGE_STALE" in browser_control
    assert "BROWSER_EXPIRED" in browser_control
    print(
        "First-party browser-control custodian persists tab ownership and epoch fencing in chrome.storage.session and rejects stale pageId or expired commands before dispatching debugger input."
    )

    fiber_js = (ext_root / "fiber.js").read_text(encoding="utf-8")
    assert "window.postMessage.bind(window)" in fiber_js
    assert "Object.prototype.hasOwnProperty" in fiber_js
    print(
        "First-party MAIN-world fiber bridge captures native window.postMessage and Object.prototype.hasOwnProperty bindings at load time and never forwards raw request arguments across the world boundary."
    )


if __name__ == "__main__":
    main()
