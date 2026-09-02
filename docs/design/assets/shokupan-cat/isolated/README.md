# Isolated Shokupan-cat concept assets

Each multi-pose concept sheet has been split into one transparent PNG per grid
cell. The files retain a consistent cell canvas within each group so animation
frames do not jump when exchanged.

## Contents

- `designs/`: four early character-design directions
- `idle-actions/`: eight optional idle-action key poses
- `idle-loop/`: eight ordered breathing-loop frames
- `reactions/`: eight focus-state and meme-inspired reaction key poses

The files have real alpha channels. They remain generated concept art, not
pixel-clean production sprites; final frames still need manual alignment,
palette cleanup, and animation review.

## Rebuild

The extraction is deterministic and does not regenerate or repaint the source
art. It crops the documented source grids and flood-fills only background-like
pixels connected to the outside edge. It deliberately does **not** apply a
global color key, because the cat's cream fur is close to the source background
color. A validation pass rejects any enclosed transparent holes:

```sh
node scripts/split-design-sheets.mjs
```

The script requires `ffmpeg` and `ffprobe` on the local development machine.
It validates each source sheet's dimensions before writing any group.
