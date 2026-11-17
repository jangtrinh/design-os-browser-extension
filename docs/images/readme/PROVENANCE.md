# Asset provenance

## Clay mark
`design-os-browser-extension.webp` (256x256 RGBA WebP) is the same file as the hub's `assets/logos/design-os-browser-extension.webp` in `jangtrinh/jangtrinh.github.io` (sha256 `3ac67d51e07c4f724b500a85c45ecd32582da95c18da16f24891907f511d4f7a`). It was generated in the hub's 3D matte soft clay family.

- Tool: Grok Bot image generation (GenerateImage), 2026-11-16, Asia/Saigon.
- Form: one chunky rounded cube with one short, fat, rounded peg on its right face (an abstract plug-in block). No text, no logo, no third-party mark as subject or reference.
- Style references: three hub marks, used for material, light, colour ramp and camera only: `design-os-knowledge-builder.webp` (staircase block), `design-os-skills-pack.webp` (slab), `design-os-voice-ux.webp` (capsule).
- Prompt (abridged): "A single 3D matte soft clay icon matching the reference marks exactly in material, lighting, orange colour ramp and camera angle. Subject: one chunky bold primitive: a thick, softly rounded cube with ONE short, fat, rounded cylindrical peg sticking out of its right side face... One amber-orange hue only: shadow #df5e18, mid #fca849, light #fec75f... Three-quarter view from slightly above... Plain pure white background, no floor, no cast shadow, no glow, no text."
- Generated file sha256: `fa7ff1dfb402f1ebf7736f4efbcf1a0bd33cc569430c47642a58e445a817e1fb` (1024x1024 JPEG).
- Edits: the white background was keyed to transparency (alpha from the blue channel, colour un-premultiplied), the form was cropped to its bounds, padded to fill 92% of a square, and downscaled with Lanczos to 256x256. Nothing was redrawn or recoloured.
- A first attempt (a rounded slab with a folder-like tab) was dropped because it read as a literal folder icon.

## Covers, flow diagrams and social preview
1600x720 covers, 1600x1000 flow, 1280x640 social, re-rendered on 2026-11-17 (Asia/Saigon) for v0.3.0. Be Vietnam Pro (400, 600, 800), rendered with headless Chrome, then quantised to an indexed palette. Family tokens: dark #09090b / #121214, light #f4f4f5 / #e4e4e7, one accent #fca849 (the mark on covers, the arrows on the flow). Footer: FREE + source-available (PolyForm Shield). `social-preview.png` is not uploaded in repository Settings.

Every number on the cards comes from the repository at v0.3.0: `pack status` and `pack check` on `knowledge/agent-browser-extensions` (6 documents, 32 claims, 27 sources, 18 entities, 0 verify failures, gate DEEPEN at 0 of 3 low-delta rounds); the built manifests (Firefox `strict_min_version` 128.0; permissions `storage`, `tabs`, `alarms`); `extension/src/core/act-approvals.ts` (single-use approvals, 120 000 ms TTL); `shared/rpc-envelope.ts` (port 4347); the MCP `tools/list` response (22 tools); `cli/src/reader/register-all.ts` (10 sites, 4 checks); and `npm test` (17 suites, 79 tests). Version 0.3.0 is from `package.json` and `CHANGELOG.md`.

## Look sheet
`look-sheet-agent-browser-extensions.png` is real output of knowledge-builder `skills/es-knowledge-forge/look.py --root knowledge/agent-browser-extensions` (L1 to L4 ok). The local checkout path in the header line was covered with a grey bar for privacy, and the palette was reduced to keep the file small. Nothing else was changed.
