# Design: Click-through guard, SAM rectangle output, on-canvas class labels

Date: 2026-05-25

Three independent features for the LabelEditor VSCode extension:

1. Optional setting to "click through" existing instances in non-view drawing modes (so you can start annotating from an already-labeled region).
2. SAM mode can output a **rectangle** (bounding box) instead of a polygon, chosen in the SAM service configuration.
3. Optionally display each instance's class name directly on the shape in the canvas.

All three are opt-in toggles defaulting to the current behavior, so existing workflows are unchanged.

---

## Feature 1 — Click-through guard in drawing modes

### Problem

In the canvas `mousedown` handler ([media/main.js:1927-1979](../../../media/main.js#L1927-L1979)), every mode first runs `findAllShapesAt(x, y)`. If the click lands on an existing instance, the handler selects that instance and `return`s early — so in a drawing mode you cannot start a new annotation on top of an already-labeled region. This blocks the common workflow "start labeling from inside / next to an existing instance".

### Solution

Add a boolean setting **`drawClickThrough`**, default **`false`** (preserves current behavior; user opts in).

- Lives in **More Settings** under a new group header **"标注行为 / Annotation behavior"**.
- When `true`, in any non-view mode (`point`/`line`/`polygon`/`rectangle`/`circle`/`sam`), a left-click that lands on an existing instance is **ignored for selection** and proceeds to start the annotation.

### Implementation

In the `mousedown` handler, gate the hit-test/selection block:

```js
const allowSelectByClick = (currentMode === 'view') || !drawClickThrough;
if (!isDrawing) {
    // ... existing same-location / click tracking ...
    const overlappingShapes = allowSelectByClick ? findAllShapesAt(x, y) : [];
    if (overlappingShapes.length > 0) { /* select + return (unchanged) */ }
    else { /* clear selection on empty / proceed to draw (unchanged) */ }
    // drawing-start branches unchanged
}
```

- View mode is **never** affected (always selectable) — the `currentMode === 'view'` short-circuit guarantees it.
- SAM idle handler ([media/main.js:7797-7801](../../../media/main.js#L7797-L7801)) gets the same gate: when `drawClickThrough` is on, do **not** return-to-select; let the SAM interaction place its prompt instead.
- **Right-click is unchanged** — the context menu ([media/main.js:2164](../../../media/main.js#L2164)) still selects/deletes existing shapes in drawing modes, serving as the escape hatch when click-through is on.

### Persistence & i18n

- State var `let drawClickThrough = false;` in main.js, loaded from `vscodeState`/`initialGlobalSettings` with the same fallback pattern as `claheEnabled`.
- Saved via `saveGlobalSettings('drawClickThrough', value)`.
- Injected into `initialGlobalSettings` in [src/LabelMePanel.ts](../../../src/LabelMePanel.ts) (~line 1267).
- i18n key `settings.drawClickThrough` (+ tip text) in en and zh-CN dicts.

---

## Feature 2 — SAM rectangle output

### Requirement

In the SAM service configuration, allow choosing whether SAM produces a polygon (current) or a rectangle (axis-aligned bounding box of the mask).

### Approach (frontend bbox conversion — chosen)

The Python service (`scripts/sam_service.py`) is **not changed**; `/decode` keeps returning a `contour`. The frontend converts the contour to a bounding box when the rectangle option is on. This needs no service restart, works with an already-running service, and is a minimal change.

### Setting

Add **`samOutputFormat`**: `'polygon'` (default) | `'rectangle'`.

- Lives in the **SAM settings modal** ([src/LabelMePanel.ts:1123-1177](../../../src/LabelMePanel.ts#L1123-L1177)) as a radio group, alongside model dir / device / port / encode mode.
- Persisted and injected the same way as the other SAM settings (`samEncodeMode`, `samEncodeAdjusted`, …) — globalState + `initialGlobalSettings`.

### Implementation

- **Commit conversion** in `samConfirmAnnotation` ([media/main.js:7704-7705](../../../media/main.js#L7704-L7705)):

  ```js
  if (samOutputFormat === 'rectangle') {
      const b = getPolygonBBox(samMaskContour);
      currentPoints = [[b.minX, b.minY], [b.maxX, b.maxY]];
  } else {
      currentPoints = samMaskContour.map(p => [p[0], p[1]]);
  }
  ```

- **shape_type** in the shape-creation block ([media/main.js:3970](../../../media/main.js#L3970)):

  ```js
  } else if (currentMode === 'sam') {
      shapeType = (samOutputFormat === 'rectangle') ? 'rectangle' : 'polygon';
  }
  ```

  (A rectangle shape is the 2-point axis-aligned format `[[minX,minY],[maxX,maxY]]`, matching the rest of the codebase.)

- **WYSIWYG preview**: when `samOutputFormat === 'rectangle'`, the live SAM preview (`drawSAMOverlay`) draws the bounding rectangle of `samMaskContour` instead of the contour, so the user sees the final box before confirming. Extract the bbox once and reuse for preview + commit.

### i18n

Keys `sam.outputFormat`, `sam.outputPolygon`, `sam.outputRectangle` in en + zh-CN.

---

## Feature 3 — On-canvas class name labels

### Requirement

Optionally show each instance's class name (`shape.label`) directly on the shape in the canvas. Chosen style: **top-left corner with a colored background pill**; chosen visibility: **when the toggle is on, show for all visible instances**.

### Setting

Add boolean **`showShapeLabels`**, default **`false`**, in **More Settings** under the existing **Appearance** group.

### Rendering

Reuse the established SVG `<text>` + zoom-scaled font pattern from `drawPixelValues` ([media/main.js:5056-5108](../../../media/main.js#L5056-L5108)). Insertion point is the shapes `forEach` in `drawSVGAnnotations` ([media/main.js:4859-4881](../../../media/main.js#L4859-L4881)), right after `drawSVGShape(...)`:

```js
if (showShapeLabels && shape.label) {
    drawShapeLabel(shape, points, colors.stroke); // points already rect-expanded above
}
```

`drawShapeLabel(shape, points, color)`:

1. Compute anchor from `getPolygonBBox(points)` ([media/main.js:3474](../../../media/main.js#L3474)) → top-left `(minX, minY)`. For `point` shapes, anchor next to the point.
2. Create `<text>` (white fill, `font-size = 12 / zoomLevel`, `pointer-events:none`) with `shape.label`; append to overlay; call `getBBox()` to measure width/height.
3. Insert a rounded `<rect>` background pill (fill = shape stroke color, small zoom-scaled padding) **behind** the text, sized to the measured bbox.
4. Position the pill+text just above / at the top-left corner.
5. Skip the label when the shape's bbox is smaller than the label (avoids clutter on tiny instances).

Selected instances keep showing their label. Labels never intercept pointer events.

### Persistence & i18n

- Same `saveGlobalSettings` / `initialGlobalSettings` pattern as Feature 1.
- i18n key `settings.showShapeLabels` (+ tip) in en + zh-CN.

---

## Testing

- Unit-test the pure helpers following the existing `test/*.test.ts` pattern:
  - contour → bbox conversion (Feature 2): correct min/max, handles malformed/short contours.
  - click-through gate decision (Feature 1): `allowSelectByClick` truth table across modes × flag.
- Manual smoke test in the extension host (drawing over instances, SAM rectangle output incl. preview, labels at various zoom levels and shape types).

## Out of scope

- No change to `scripts/sam_service.py` or the export formats.
- No oriented/rotated bounding boxes — rectangles stay axis-aligned per the data model.
- No per-shape label toggle; the setting is global.
