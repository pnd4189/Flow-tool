# Retouch Studio QA inputs

- `astronaut.png`: scikit-image v0.25.2's NASA astronaut photo (Eileen Collins), public-domain sample. Source: https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png . Used for real photo selection, background replacement, facial-pixel preservation and undo/redo checks.
- `illustration.svg` / `illustration.png`: synthetic 2D image authored for this editor's QA, rendered locally with ImageMagick. Used for arbitrary-aspect image editing, backpack selection/removal and exact preservation of the character side.

Outputs and measured checks live in `../test-results/`. A successful pixel-preservation check does not establish the aesthetic quality of an AI-generated region; evaluate both independently.
