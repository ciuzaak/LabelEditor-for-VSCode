# Implementation Plan — Circle Shapes

**Spec:** [`2026-05-15-circle-shapes-design.md`](../specs/2026-05-15-circle-shapes-design.md)

## Step 1 — Pure helpers

Inline in `media/main.js` (not extracted; small and only used here):
- `getCircleRadius(points)` — `Math.hypot(points[1][0]-points[0][0], points[1][1]-points[0][1])`.
- `polygonizeCircle(cx, cy, r, segments)` — return `[[x,y], ...]` open ring of `segments` vertices around the circle.

## Step 2 — `src/LabelMePanel.ts`

1. Add a new SVG symbol inside `_getIconSprite`:
   ```html
   <symbol id="icon-circle-outline" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="9"/></symbol>
   ```
2. Insert the mode button into the segmented `mode-toggle-group` between Point and SAM:
   ```html
   <button id="circleModeBtn" class="mode-btn segmented-item" data-tip-id="mode.circle"><svg class="icon" aria-hidden="true"><use href="#icon-circle-outline"/></svg></button>
   ```

## Step 3 — `src/labelMeUtils.ts` (`buildSvg`)

Add a circle branch at the top of the loop in `buildSvg`, before the point/rectangle/polygon handling:
```ts
if (shapeType === 'circle' && points.length >= 2) {
    const cx = points[0][0], cy = points[0][1];
    const r = Math.hypot(points[1][0]-cx, points[1][1]-cy);
    pathElements.push(`  <circle id="circle${idx}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="black" stroke-width="1" />`);
    continue;
}
```

## Step 4 — `media/main.js` wiring

In dependency order:

1. **DOM ref** — `const circleModeBtn = document.getElementById('circleModeBtn');` next to the other mode buttons.
2. **Mode UI** — extend the mode-button activation block (~line 451) to handle `'circle'`.
3. **`setMode`** — already accepts string; verify the existing wire-up. Add click handler analogous to `pointModeBtn`.
4. **Keyboard** — extend the bare-letter `keydown` block:
   ```js
   if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) { setMode('circle'); ... }
   ```
5. **Drawing** — in the canvas `mousedown` left-click block:
   - Add `currentMode === 'circle'` branch alongside rectangle's two-click flow.
   - Initial click: `currentPoints = [[x, y], [x, y]]; isDrawing = true;`
   - Mouse-move in `mousemove`: update `currentPoints[1]`; trigger `draw()`.
   - Second click: finalize shape; show label modal.
6. **`finishPolygon`/`finalizeShape`** — when creating a new shape, set `shapeType = 'circle'` if `currentMode === 'circle'`.
7. **`getShapeBoundingBox`** — circle case: `cx-r, cy-r, cx+r, cy+r`.
8. **`findAllShapesAt`** — circle case: disc hit-test.
9. **`findVertexAt`** — circle case: only 2 vertices, center and edge.
10. **Vertex drag** — in the `isDraggingVertex` branch, circle special case:
    - `activeVertexIndex === 0` → translate both points by delta from `originalEditPoints`.
    - `activeVertexIndex === 1` → set `points[1] = clampImageCoords(x, y)`.
11. **Whole-shape drag** — already works generically (`originalEditPoints.map(p => p + delta)`); circle gets it free.
12. **Eraser (`performErase`)** — circle case before the generic polygon branch:
    - Polygonize the circle to a ring; treat exactly like a polygon (after which the result type is `'polygon'`, same as rectangle decay).
13. **`drawSVGShape`** — circle case: emit `<circle cx cy r>` (filled if completed, stroke-only while drawing). When `showVertices || isInEditMode`, draw the 2 vertex handles at center + edge.
14. **Linestrip/polygon/rectangle existing paths** — unchanged.

## Step 5 — Tooltips

Add to `media/tipsData.js`:
```js
'mode.circle': { title: 'Circle Mode', desc: 'Click to set center, click again on the circumference. Shift-click switches to eraser.', shortcut: 'C' },
```

## Step 6 — Tests

`test/circleHelpers.test.ts`:
- `getCircleRadius([[0,0],[3,4]])` → 5.
- `polygonizeCircle(0,0,1,4)` → roughly the unit square's outer vertices (cos/sin sampled).
- Bounding box correctness for a circle at (10, 20) r=5.

`test/labelMeUtils.test.ts` (extend):
- `buildSvg` emits a `<circle>` element for a circle shape.

## Step 7 — README

- "Circle Mode" added to mode list, keyboard shortcut table, and shape types under "Output Format".
- Move "Circle shapes" from the roadmap "planned" section to "added" with v0.17.0 marker.
- Remove "No support for circle/ellipse shape types yet" from Known Limitations (leave ellipse — circle ≠ ellipse).

## Step 8 — Bump version

`package.json` version → `0.17.0`. Add CHANGELOG entry.

## Smoke checklist

- [ ] `C` enters Circle Mode; toolbar highlights.
- [ ] Click center, click edge → shape appears with label modal.
- [ ] Save & reload → circle restored.
- [ ] Edit Mode: drag center moves whole circle; drag edge resizes.
- [ ] Eraser cuts circle → result is polygon(s).
- [ ] SVG export contains `<circle>`.
- [ ] Merge eligibility: selecting a circle hides Merge.
- [ ] Visibility / Rename / Ctrl+R / Ctrl+H / Delete all work.
