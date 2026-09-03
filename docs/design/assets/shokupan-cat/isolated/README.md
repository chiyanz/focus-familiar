# Isolated Shokupan-cat concept assets

The approved mascot design and each retained pose are stored as separate
transparent PNGs. Files within an animation group retain a consistent canvas so
frames do not jump when exchanged.

## Contents

- `designs/`: the canonical crust-cap Shokupan-cat design
- `idle-actions/`: eight optional idle-action key poses
- `idle-loop/`: eight ordered breathing-loop frames
- `reactions/`: eight focus-state and meme-inspired reaction key poses

There are 25 retained files: one canonical design, eight idle actions, eight
breathing-loop frames, and eight reactions. Each has a real alpha channel while
preserving the cat's cream and white interior pixels.

All silhouettes include a one-pixel cocoa-brown exterior contour. This keeps
the pale fur from reading as a white fringe on dark desktops while preserving
fully transparent backgrounds. The macOS-only cleanup is reproducible and
idempotent:

```bash
find docs/design/assets/shokupan-cat/isolated src/renderer/assets/shokupan-cat \
  -name '*.png' -print0 | sort -z | \
  xargs -0 swift scripts/polish-sprite-edges.swift --in-place
npm run test:sprite-edges
```

These remain generated concept art, not pixel-clean production sprites; final
frames still need manual alignment, palette cleanup, and animation review. The
consolidated source sheets and rejected design directions were intentionally
removed after isolation. They remain recoverable from Git history if needed for
provenance or debugging.
