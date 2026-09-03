# Isolated Shokupan-cat concept assets

The approved mascot design and each retained pose are stored as separate
transparent PNGs. Files within an animation group retain a consistent canvas,
and the idle-loop frames are normalized to a shared silhouette center and
baseline so frames do not jump when exchanged.

## Contents

- `designs/`: the canonical crust-cap Shokupan-cat design
- `idle-actions/`: eight optional idle-action key poses
- `idle-loop/`: eight ordered breathing-loop frames
- `reactions/`: eight focus-state and meme-inspired reaction key poses

There are 25 retained files: one canonical design, eight idle actions, eight
breathing-loop frames, and eight reactions. Each has a real alpha channel while
preserving the cat's cream and white interior pixels.

All silhouettes include an approximately four-source-pixel cocoa-brown
exterior contour. This keeps the pale fur from reading as a white fringe on
dark desktops after the browser window scales the sprite down while preserving
fully transparent backgrounds. The macOS-only cleanup is reproducible and
idempotent:

```bash
find docs/design/assets/shokupan-cat/isolated src/renderer/assets/shokupan-cat \
  -name '*.png' -print0 | sort -z | \
  xargs -0 swift scripts/polish-sprite-edges.swift --in-place
npm run test:sprite-edges
```

The breathing-loop layout pass is also reproducible and only translates pixels
on the existing canvas; it does not rescale or filter the artwork. Run the
contour cleanup before alignment so the baseline includes the final silhouette:

```bash
swift scripts/normalize-idle-loop.swift --in-place \
  docs/design/assets/shokupan-cat/isolated/idle-loop/*.png \
  src/renderer/assets/shokupan-cat/idle-loop/*.png
npm run test:sprite-alignment
```

The validator checks the shared 384x512 canvas, center (x=192 +/- 1 px),
baseline (y=460 +/- 1 px), and fully transparent RGB channels. These remain
generated concept art, not pixel-clean production sprites; palette cleanup and
animation review may still refine the final look. The consolidated source sheets
and rejected design directions were intentionally removed after isolation. They
remain recoverable from Git history if needed for provenance or debugging.
