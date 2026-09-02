# 007: Custom pet packs

Status: **Planned**

## Outcome

Users can install a locally stored pet pack that changes appearance, animations, dialogue, colors, and optional sounds without changing application code.

## Scope

- Define a versioned `pet.json` manifest.
- Define required core states and optional state fallbacks.
- Load local image and sound assets from a constrained pack directory.
- Validate identifiers, dimensions, paths, frame timing, authorship, and license metadata.
- Provide an install, preview, select, and remove flow.
- Include one redistributable starter pet.

## Non-goals

- Downloading packs from the internet
- Executable scripts inside packs
- A hosted community marketplace

## Acceptance criteria

- A documented example pack can be installed without rebuilding the app.
- Invalid packs produce actionable validation errors.
- Asset paths cannot escape the pack directory.
- Missing optional states use documented fallbacks.
- Removing a selected pack safely returns to the starter pet.

## Planned tests

- Manifest fixture tests for valid and invalid packs.
- Path traversal and oversized-asset tests.
- State-fallback tests.

## Implementation notes

Not implemented.
