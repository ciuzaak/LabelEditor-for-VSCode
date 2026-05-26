# Design: Overlapping-instance selection — specificity priority, stable cycling, hover preview

Date: 2026-05-26

When multiple instances overlap, clicking to select one currently feels unpredictable. This redesigns three coupled behaviors:

1. **Specificity priority** — a click selects the *smallest* / most specific instance under the cursor, not whatever was drawn last.
2. **Stable cycle group** — repeated clicks cycle down through the overlapping stack reliably, with a lightweight "N / M" indicator.
3. **Hover preview** — moving the cursor over an overlap highlights the instance that *would* be selected, before clicking.

The risky ordering/cycling logic is extracted into pure, unit-tested functions in `media/shapeHelpers.js`; `media/main.js` only wires them into the existing event handlers and renderer.

---

## Background — current behavior

- Hit-testing lives in [`findAllShapesAt(x, y)`](../../../media/main.js#L3094-L3145). It walks `shapes` from last to first and collects every shape whose geometry contains (or, for points/lines, is near) the click. The returned order is **pure reverse draw order** (topmost first).
- The left-click handler ([media/main.js:1955-1999](../../../media/main.js#L1955-L1999)) then:
  - **Ctrl/Cmd+click** → toggle `overlappingShapes[0]` (topmost) into the multi-select set.
  - **Same-location repeat click** (`distance < CLICK_THRESHOLD_DISTANCE && timeDiff < CLICK_THRESHOLD_TIME` *and* `length > 1`) → advance to the next index after `selectedShapeIndex`, wrapping to `[0]`.
  - otherwise → select `overlappingShapes[0]`.
- The cursor mousemove block ([media/main.js:2300](../../../media/main.js#L2300)) already computes `hoveredIndex = findShapeIndexAt(x, y)` but uses it **only** to switch the cursor to `pointer`. There is no hover highlight of the shape itself.
- `draw()` ([media/main.js:4884](../../../media/main.js#L4884)) rebuilds the SVG overlay each call; a selected shape is drawn with `rgba(255,255,0,1)` stroke + yellow fill.
- `allowSelectByClick(currentMode, drawClickThrough)` ([media/shapeHelpers.js:10](../../../media/shapeHelpers.js#L10)) gates whether clicks select at all (false in drawing modes when click-through is on).

### Why it feels weird

1. **Ordering is by draw order, not size** — a small instance nested inside a larger one is unreachable on first click; you select the big one.
2. **Cycling resets on micro-movement / slow clicks** — the distance+time threshold means a 6px jitter or a pause drops you back to "select topmost".
3. **No feedback** — wrapping back to the top is silent; you can't tell how deep the stack is or where you are in it.

---

## Feature 1 — Specificity-priority ordering

### Requirement

`findAllShapesAt` returns candidates **smallest-first**. Points and linestrips (proximity targets, effectively zero area, hardest to hit) always rank ahead of filled shapes. Filled shapes (circle / rectangle / polygon) sort by ascending area. Ties keep topmost-first.

### Pure helpers (in `media/shapeHelpers.js`, exported + tested)

```js
// Area in image coordinates (zoom-independent). Points & linestrips => 0
// so they always sort ahead of filled shapes.
function shapeArea(shape) {
    const pts = shape.points || [];
    switch (shape.shape_type) {
        case 'point':
        case 'linestrip':
            return 0;
        case 'circle': {                 // pts = [center, edge]
            const r = circleRadius(pts);  // hypot(edge-center)
            return Math.PI * r * r;
        }
        case 'rectangle': {              // pts = [[x1,y1],[x2,y2]]
            const w = Math.abs(pts[1][0] - pts[0][0]);
            const h = Math.abs(pts[1][1] - pts[0][1]);
            return w * h;
        }
        default:                         // polygon — shoelace, absolute value
            return polygonArea(pts);
    }
}

// Stable ascending-by-area sort. `indices` arrives topmost-first, so a
// stable sort preserves topmost-first within equal areas.
function sortOverlapCandidates(indices, shapes) {
    return [...indices].sort((a, b) => shapeArea(shapes[a]) - shapeArea(shapes[b]));
}
```

`circleRadius` / `polygonArea` are small local helpers (or reuse existing math in main.js, mirrored here so shapeHelpers stays self-contained for the test runner). Rectangle points are the stored 2-point form — no need to expand to 4 corners for area.

### Wiring

`findAllShapesAt` keeps collecting hits exactly as today, then returns `sortOverlapCandidates(hits, shapes)`. `findShapeIndexAt` (returns `overlapping[0]`) and the SAM idle guard at [media/main.js:7930](../../../media/main.js#L7930) automatically benefit — `[0]` is now the smallest.

> Note: a point's clickable disc (radius `10/zoom`) and a line's threshold band are *proximity* hits, not containment. Assigning them area 0 means that when a point/line sits over a polygon and the cursor is within its tolerance, the point/line wins. This is intentional — they are the more specific target.

---

## Feature 2 — Stable cycle group + "N / M" indicator

### Requirement

Repeated clicks on the same overlapping stack cycle through it deterministically, regardless of small cursor movement or click timing. Cycling back past the last member returns to the smallest. While a stack has more than one member, a lightweight `pos / total` badge appears near the cursor.

### Pure resolver (in `media/shapeHelpers.js`, exported + tested)

```js
// Decide the target and the next cycle state from the ordered candidates
// and the previous cycle state. No DOM, no globals — pure.
//   ordered             : number[]  smallest-first candidate indices (this click)
//   prevMembers         : number[]  ordered candidates from the previous click
//   prevPos             : number    index within prevMembers we landed on
//   currentSelectedIndex: number    the currently-selected shape (-1 if none)
// returns { targetIndex, members, pos }
function resolveOverlapSelection({ ordered, prevMembers, prevPos, currentSelectedIndex }) {
    const sameGroup =
        arraysEqual(ordered, prevMembers) &&
        prevMembers[prevPos] === currentSelectedIndex; // still on our own cycle
    const pos = sameGroup ? (prevPos + 1) % ordered.length : 0;
    return { targetIndex: ordered[pos], members: ordered, pos };
}
```

- **First click on a stack** → `sameGroup` false → `pos = 0` → selects the smallest.
- **Repeat click, same stack, still on our last target** → advance one step, wrap to 0 after the last.
- **Selection changed elsewhere** (list click, keyboard, delete) between canvas clicks → `currentSelectedIndex` no longer equals `prevMembers[prevPos]` → resets to `pos = 0`. Self-healing; no manual state reset needed.
- The set-equality check means a few pixels of jitter that keep the *same* shapes under the cursor stay in the same group — no time/distance threshold required.

### Wiring in the click handler ([media/main.js:1955-1999](../../../media/main.js#L1955-L1999))

- Module-level `let overlapCycleState = { members: [], pos: -1 };`.
- Replace the `isSameLocation` branch:

```js
const ordered = allowSelectByClick(currentMode, drawClickThrough) ? findAllShapesAt(x, y) : [];
if (ordered.length > 0) {
    if (e.ctrlKey || e.metaKey) {
        toggleShapeSelection(ordered[0]);          // unchanged: topmost = smallest now
        overlapCycleState = { members: [], pos: -1 };
    } else {
        const r = resolveOverlapSelection({
            ordered,
            prevMembers: overlapCycleState.members,
            prevPos: overlapCycleState.pos,
            currentSelectedIndex: selectedShapeIndex,
        });
        selectShape(r.targetIndex);
        overlapCycleState = { members: r.members, pos: r.pos };
        updateCycleBadge(e.clientX, e.clientY, r.pos, r.members.length);
    }
    renderShapeList();
    draw();
    return;
} else {
    // empty-area branch unchanged; also clear the cycle state + hide badge
    overlapCycleState = { members: [], pos: -1 };
    hideCycleBadge();
    ...
}
```

The old `lastClickX/Y/Time` same-location tracking used only for cycling can be removed for selection; verify it is not relied on elsewhere (e.g. double-click-to-finish-line uses its own `lastPoint` tracking, which is separate).

### Cycle badge

- One absolutely-positioned `<div id="overlapCycleBadge">` appended to the canvas wrapper, hidden by default.
- `updateCycleBadge(clientX, clientY, pos, total)`: when `total > 1`, set text `${pos + 1} / ${total}`, position a few px from the cursor (clamped inside the wrapper), show it. When `total <= 1`, hide.
- `hideCycleBadge()` called on: empty click, selection change from the list/keyboard, Escape, mode switch.
- Content is digits + `/` only → **no i18n keys needed**.
- Styling in [media/style.css](../../../media/style.css): small, high-contrast pill, `pointer-events: none`, above the SVG overlay.

---

## Feature 3 — Hover preview

### Requirement

When selection-by-click is allowed and the user is not mid-draw, the instance that a click *would* select is highlighted as the cursor moves. The highlight is visually distinct from the yellow selection state; selection wins when a shape is both hovered and selected.

### Wiring

- Module-level `let hoveredShapeIndex = -1;`.
- In the existing cursor mousemove block ([media/main.js:2300](../../../media/main.js#L2300)) — which already computes the hovered index for the cursor — compute `const next = allowSelectByClick(...) && !isDrawing ? (findAllShapesAt(x, y)[0] ?? -1) : -1;` and only when `next !== hoveredShapeIndex`: assign and call `draw()`. This bounds the redraw cost to actual hover-target changes, not every mouse move (SVG `innerHTML` is rebuilt on each `draw()`).
- Clear `hoveredShapeIndex = -1` (and redraw if it changed) on `mouseleave` of the canvas wrapper, when drawing starts, and when the mode/click-through makes selection disallowed.

### Rendering ([media/main.js:4884](../../../media/main.js#L4884))

In the `shapes.forEach` render loop, after computing `isSelected`:

```js
const isHovered = index === hoveredShapeIndex && !isSelected;
```

When `isHovered`, draw the shape with its normal fill but an added **white dashed outline** (e.g. stroke `rgba(255,255,255,0.9)`, dash pattern scaled by `1/zoomLevel`, width slightly above normal). Selection styling is checked first and takes precedence, so a selected shape never shows the hover outline. The dashed white reads clearly over arbitrary label colors and over the solid-yellow selection, keeping the two states unambiguous.

---

## Files touched

| File | Change |
|------|--------|
| [media/shapeHelpers.js](../../../media/shapeHelpers.js) | add & export `shapeArea`, `sortOverlapCandidates`, `resolveOverlapSelection` (+ tiny `circleRadius`/`polygonArea`/`arraysEqual` helpers) |
| [test/shapeHelpers.test.ts](../../../test/shapeHelpers.test.ts) | tests for area per shape type, sort (point/line first, ascending area, stable tie = topmost-first), resolver (first-click=smallest, advance, wrap, external-change reset) |
| [media/main.js](../../../media/main.js) | `findAllShapesAt` returns sorted; click handler uses resolver + `overlapCycleState` + badge; mousemove sets `hoveredShapeIndex` & redraws on change; `mouseleave` clears hover; `draw()` renders hover outline; new globals + badge DOM helpers |
| [media/style.css](../../../media/style.css) | `#overlapCycleBadge` styling |

No changes to persisted settings, `LabelMePanel.ts`, or i18n dictionaries.

---

## Edge cases

- **Single candidate** — `pos` is always 0; badge stays hidden (`total <= 1`).
- **Hovered == selected** — selection style wins; no hover outline drawn.
- **Zoom** — areas are computed in image coordinates, so ordering is zoom-independent and consistent with click vs. hover.
- **Hidden shapes** — already skipped inside `findAllShapesAt`; never candidates.
- **Points / linestrips** — area 0 → always ahead of filled shapes.
- **Drawing modes with click-through on** (`allowSelectByClick` false) — both hover preview and click-selection are suppressed; badge hidden.
- **Multi-select (Ctrl)** — toggles the smallest (`ordered[0]`) and resets the cycle state, so a following plain click starts a fresh cycle from the smallest. Shift-range selection in the list is untouched.
- **Shapes added/removed mid-session** — the cycle state is recomputed from current `shapes` on every click; stale indices can't carry over because set-equality fails and resets to `pos = 0`.

---

## Testing

- **Unit (automated, TDD-first)** — `shapeHelpers.test.ts` covers `shapeArea`, `sortOverlapCandidates`, and `resolveOverlapSelection` per the cases above. These are pure and run in the existing test harness.
- **Manual smoke (with the user)** — verify in the real extension: (a) clicking a small instance nested in a large one selects the small one; (b) repeat-clicking cycles down the stack and the `N / M` badge tracks position, wrapping correctly; (c) hovering over an overlap shows the white dashed preview on the would-be target and updates as the cursor moves; (d) hover/selection suppressed in drawing modes when click-through is on.
