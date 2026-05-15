# Circle Shapes — Design

**Date:** 2026-05-15
**Roadmap item:** Circle shapes

## Goals

1. New shape type `circle` selectable from a toolbar mode and a keyboard shortcut.
2. Round-trip via LabelMe JSON using the standard 2-point representation `points: [[cx, cy], [edgeX, edgeY]]` (radius derived).
3. Draw / select / move / vertex-edit / delete / hide / rename — same affordances as existing shapes.
4. Eraser produces a polygon when partially removed; full removal deletes the circle.
5. SVG export uses a real `<circle>` element.

Non-goals: ellipse shapes, Merge integration (Merge stays polygon/rectangle only — circle selections are ineligible), SAM output as circle (SAM still emits polygons).

## LabelMe Format

```json
{ "label": "x", "shape_type": "circle", "points": [[cx, cy], [edgeX, edgeY]], ... }
```

- `points[0]` = center, `points[1]` = a point on the circumference.
- Radius = `hypot(edgeX - cx, edgeY - cy)`.
- This matches the canonical LabelMe convention (no separate radius field).

## UX

### Mode entry
- Sidebar toolbar gains a 7th mode button (`circleModeBtn`) between Point (`O`) and SAM. Icon: existing `#icon-search` reused? No — add a dedicated `#icon-circle-outline` glyph: a single unfilled circle.
- Keyboard shortcut: **`C`** (currently free; `Ctrl+C` is browser default, not consumed). Guard with `!e.ctrlKey && !e.metaKey`.

### Drawing
- Two-click flow:
  1. First click → set center, enter `isDrawing`, store `currentPoints = [[cx, cy], [cx, cy]]`.
  2. Mouse-move while drawing → live update `currentPoints[1]` to clamped mouse position; draw rubber-band circle.
  3. Second click → finalize, show label modal.
- Right-click during drawing cancels (like polygon).
- ESC during drawing cancels.

### Selection / hit-test
- A circle is hit when `hypot(x - cx, y - cy) <= radius` (filled-disc click target). The outline is not preferred; users click-anywhere-inside, matching polygon.
- Bounding box for `findShapesInRect` and `getShapeBoundingBox`: `[cx-r, cy-r, cx+r, cy+r]`.

### Edit mode (vertex-edit)
- Two handles drawn: center (yellow) and edge (yellow).
- Dragging center: translate both points (`points[1] += delta`).
- Dragging edge: replace `points[1]` only; radius follows.
- Whole-shape drag (click inside, drag): translates both points.

### Eraser
- Convert circle to a 32-segment polygon (`polygonizeCircle(cx, cy, r, 32)`) at the moment of erasing.
- Pipe through the existing `computePolygonDifference` path; the result is one-or-more **polygons** (the circle becomes a polygon when partially erased — same one-way conversion rectangle→polygon already supports).

### Rename / hide / delete / description
- Same as other shapes (label modal, visibility toggle, delete key, sidebar instance row).

### Merge
- Excluded. `mergeSelectedShapes` already gates on `polygon | rectangle`; circles in the selection make the menu item hidden and `Ctrl+G` a no-op.

### SVG export (`labelMeUtils.buildSvg`)
- For `shape_type === 'circle'`, emit `<circle cx cy r>` with `fill="none" stroke="black" stroke-width="1"`.
- Bypass the existing cubic-curve smoothing path for circles.

## Architecture

### `media/main.js` changes
- New mode `'circle'` recognized everywhere `currentMode` is checked.
- New DOM ref `circleModeBtn`.
- Drawing branch in canvas `mousedown` / `mousemove`.
- New `getCircleRadius(points)` helper: `Math.hypot(points[1][0]-points[0][0], points[1][1]-points[0][1])`.
- New `polygonizeCircle(cx, cy, r, segments=32)` helper — returns `[[x,y], ...]` ring.
- Update branches:
  - `getShapeBoundingBox` — circle case.
  - `findAllShapesAt` — circle case (disc hit-test).
  - `findVertexAt` — circle has 2 vertices (center, edge).
  - Vertex-drag branch in `mousemove` — circle special case (center translates both; edge updates only second point).
  - `performErase` — polygonize circle, then re-use the polygon branch logic; result type becomes polygon when partially erased.
  - `drawSVGShape` — circle case using `<circle>` (cleanest) or `<ellipse>` if needed; use a real `<circle>` with `cx,cy,r`. For drawing-in-progress, same.
- Tip data: new entries `mode.circle`, `shape.circle*` if needed (we'll keep generic edit tips).

### `src/LabelMePanel.ts` HTML
- New mode button in the `mode-toggle-group` segmented group, between Point and SAM:
  ```html
  <button id="circleModeBtn" class="mode-btn segmented-item" data-tip-id="mode.circle"><svg class="icon" aria-hidden="true"><use href="#icon-circle-outline"/></svg></button>
  ```
- New `#icon-circle-outline` symbol in `_getIconSprite`: `<circle cx="12" cy="12" r="9"/>` with the shared stroke attrs.

### `src/labelMeUtils.ts` (`buildSvg`)
- Add a circle branch before the polygon path-builder:
  ```ts
  if (shapeType === 'circle' && points.length >= 2) {
    const [cx, cy] = points[0]; const r = Math.hypot(points[1][0]-cx, points[1][1]-cy);
    pathElements.push(`  <circle id="circle${idx}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="black" stroke-width="1" />`);
    continue;
  }
  ```

### Tooltips (`media/tipsData.js`)
- New entry: `'mode.circle': { title: 'Circle Mode', desc: 'Click to set center, click again on the circumference. Shift-click switches to eraser.', shortcut: 'C' }`.

## Tests

- Unit: extract `polygonizeCircle` and `circleBoundingBox` to a pure helper if needed; otherwise add quick smoke tests in a new `test/circleHelpers.test.ts` covering radius from `hypot`, bbox correctness, and 32-segment ring closure.
- Manual smoke (post-impl):
  - Press `C` → mode active → click-click draws a circle → label modal appears.
  - Save → reopen image → circle restored with correct center+edge points.
  - Vertex-edit: drag center moves whole circle; drag edge resizes.
  - Eraser overlapping circle yields one or two polygons.
  - SVG export contains `<circle cx cy r>`.
  - Visibility/rename/delete/Ctrl+H/Ctrl+R all work.
  - Merge: circle in selection hides Merge entry / no-ops on Ctrl+G.
  - SAM-mode, polygon-mode, etc still work; switching to Circle does not break others.

## Edge cases

| Case | Handling |
|---|---|
| User clicks twice in the same pixel (zero radius) | Reject; show toast "Circle too small"; stay in drawing state with center kept (allow second-click retry). |
| Circle partially outside image | Clamp center via `clampImageCoords`; edge point not clamped (radius can exceed image bounds, like rectangle). |
| Eraser fully covers circle | Removed (same as rectangle/polygon). |
| ESC during drawing | Cancel; clear `currentPoints`. |
| Right-click during drawing | Cancel (mirrors polygon behavior). |
