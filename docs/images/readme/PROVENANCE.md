# Asset provenance

## Clay mark (new, needs Jang's acceptance)
`design-os-browser-extension.webp` (256x256 RGBA WebP) is a new mark. The hub (`jangtrinh/jangtrinh.github.io`, `assets/logos/`) has no mark for this repository, so one was generated in the hub's 3D matte soft clay family.

- Tool: Grok Bot image generation (GenerateImage), 2026-11-16, Asia/Saigon.
- Form: one chunky rounded cube with one short, fat, rounded peg on its right face (an abstract plug-in block). No text, no logo, no third-party mark as subject or reference.
- Style references: three hub marks, used for material, light, colour ramp and camera only: `design-os-knowledge-builder.webp` (staircase block), `design-os-skills-pack.webp` (slab), `design-os-voice-ux.webp` (capsule).
- Prompt (abridged): "A single 3D matte soft clay icon matching the reference marks exactly in material, lighting, orange colour ramp and camera angle. Subject: one chunky bold primitive: a thick, softly rounded cube with ONE short, fat, rounded cylindrical peg sticking out of its right side face... One amber-orange hue only: shadow #df5e18, mid #fca849, light #fec75f... Three-quarter view from slightly above... Plain pure white background, no floor, no cast shadow, no glow, no text."
- Generated file sha256: `fa7ff1dfb402f1ebf7736f4efbcf1a0bd33cc569430c47642a58e445a817e1fb` (1024x1024 JPEG).
- Edits: the white background was keyed to transparency (alpha from the blue channel, colour un-premultiplied), the form was cropped to its bounds, padded to fill 92% of a square, and downscaled with Lanczos to 256x256. Nothing was redrawn or recoloured.
- A first attempt (a rounded slab with a folder-like tab) was dropped because it read as a literal folder icon.

## Covers, flow diagrams and social preview
1600x720 covers, 1600x1000 flow, 1280x640 social. Be Vietnam Pro (400, 600, 800) with the system mono stack, rendered with headless Chrome, then quantised to an indexed palette. Family tokens: dark #09090b / #121215 / #27272a, light #fafafa / #f4f4f5 / #e4e4e7, one accent #fca849 (the mark on covers, the arrows on the flow). Footer: FREE + source-available (PolyForm Shield). `social-preview.png` is not uploaded in repository Settings.

Every number on the cards comes from the repository: `pack status` and `pack check` from knowledge-builder on `knowledge/agent-browser-extensions` (6 documents by type, 32 claims, 27 sources, 18 entities by type, 6 claims with 2+ publishers, 0 uncited, 0 verify failures, gate DEEPEN at 0 of 3 low-delta rounds), and `_evidence/agent-browser-extensions-261116/captures.jsonl` (40 captures: 39 fetched, 1 executed). Version 0.1.0 is from `CHANGELOG.md`.

## Look sheet
`look-sheet-agent-browser-extensions.png` is real output of knowledge-builder `skills/es-knowledge-forge/look.py --root knowledge/agent-browser-extensions` (L1 to L4 ok). The local checkout path in the header line was covered with a grey bar for privacy, and the palette was reduced to keep the file small. Nothing else was changed.
