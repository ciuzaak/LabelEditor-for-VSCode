# Overlapping-Instance Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selecting one of several overlapping instances predictable — click picks the smallest/most-specific instance, repeat-clicks cycle down the stack with an "N / M" indicator, and hovering previews the would-be target.

**Architecture:** Extract the ordering/cycling decisions into pure functions in `media/shapeHelpers.js` (unit-tested via `node:test`). `media/shapeHelpers.js` is loaded as a `<script>` in the webview, so its functions are global to `media/main.js`. `main.js` only wires the pure functions into the existing `mousedown`/`mousemove` handlers and the `draw()` renderer, adds two module globals (`hoveredShapeIndex`, `overlapCycleState`), and a small cursor-following badge element.

**Tech Stack:** Vanilla JS webview (`media/main.js`, `media/shapeHelpers.js`, `media/style.css`), SVG overlay rendering, `node:test` + `node:assert/strict` test harness compiled by `tsconfig.test.json`.

**Spec:** [docs/superpowers/specs/2026-05-26-overlap-selection-design.md](../specs/2026-05-26-overlap-selection-design.md)

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `media/shapeHelpers.js` | Pure, DOM-free interaction logic | Add `polygonArea`, `shapeArea`, `sortOverlapCandidates`, `arraysEqual`, `resolveOverlapSelection`; extend `module.exports` |
| `test/shapeHelpers.test.ts` | Unit tests for the helpers | Add `describe` blocks for the four new public functions |
| `media/main.js` | Webview interaction + SVG render | Sort in `findAllShapesAt`; rewrite the overlap branch of the `mousedown` handler; add globals + badge helpers; add hover detection in `mousemove` + `mouseleave`; add a dash param to `drawSVGShape`; render hover outline in `draw()` |
| `media/style.css` | Badge styling | Add `#overlapCycleBadge` rule |

**Test command (whole suite):** `npm test`
This runs `tsc -p ./tsconfig.test.json && node --test "out-test/test/**/*.test.js"`.

---

## Task 1: `shapeArea` + `sortOverlapCandidates` (pure, TDD)

**Files:**
- Modify: `media/shapeHelpers.js` (append before the `module.exports` block at line 54)
- Test: `test/shapeHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the imports destructuring at the top of `test/shapeHelpers.test.ts` (currently line 7):

```ts
const { allowSelectByClick, contourToBBoxRect, labelAnchorFromPoints, shapeArea, sortOverlapCandidates, resolveOverlapSelection } = helpers;
```

Append these blocks to the end of `test/shapeHelpers.test.ts`:

```ts
describe('shapeArea', () => {
    it('returns 0 for point and linestrip (proximity targets, always most specific)', () => {
        assert.equal(shapeArea({ shape_type: 'point', points: [[5, 5]] }), 0);
        assert.equal(shapeArea({ shape_type: 'linestrip', points: [[0, 0], [10, 0]] }), 0);
    });
    it('returns w*h for a rectangle regardless of corner order', () => {
        assert.equal(shapeArea({ shape_type: 'rectangle', points: [[0, 0], [4, 3]] }), 12);
        assert.equal(shapeArea({ shape_type: 'rectangle', points: [[4, 3], [0, 0]] }), 12);
    });
    it('returns pi*r^2 for a circle ([center, edge])', () => {
        const a = shapeArea({ shape_type: 'circle', points: [[0, 0], [2, 0]] });
        assert.ok(Math.abs(a - Math.PI * 4) < 1e-9);
    });
    it('returns the shoelace area for a polygon', () => {
        assert.equal(shapeArea({ shape_type: 'polygon', points: [[0, 0], [4, 0], [4, 3], [0, 3]] }), 12);
    });
});

describe('sortOverlapCandidates', () => {
    it('orders smallest-area first, points/lines ahead of filled shapes', () => {
        const shapes = [
            { shape_type: 'polygon', points: [[0, 0], [10, 0], [10, 10], [0, 10]] }, // idx0 area 100
            { shape_type: 'rectangle', points: [[0, 0], [2, 2]] },                    // idx1 area 4
            { shape_type: 'point', points: [[1, 1]] },                                // idx2 area 0
        ];
        assert.deepEqual(sortOverlapCandidates([0, 1, 2], shapes), [2, 1, 0]);
    });
    it('keeps the input order (topmost-first) among equal areas', () => {
        const eq = [
            { shape_type: 'rectangle', points: [[0, 0], [2, 2]] }, // idx0 area 4
            { shape_type: 'rectangle', points: [[0, 0], [2, 2]] }, // idx1 area 4
        ];
        assert.deepEqual(sortOverlapCandidates([1, 0], eq), [1, 0]);
    });
    it('does not mutate the input array', () => {
        const input = [0, 1];
        sortOverlapCandidates(input, [
            { shape_type: 'rectangle', points: [[0, 0], [9, 9]] },
            { shape_type: 'rectangle', points: [[0, 0], [1, 1]] },
        ]);
        assert.deepEqual(input, [0, 1]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the `shapeArea` / `sortOverlapCandidates` suites error with `shapeArea is not a function` (helpers not exported yet).

- [ ] **Step 3: Implement the helpers**

In `media/shapeHelpers.js`, insert this block immediately before the `if (typeof module !== 'undefined' ...)` export block (currently line 54):

```js
// Overlapping-instance selection ------------------------------------------

// Polygon area via the shoelace formula (absolute value). 0 for degenerate
// input (< 3 points).
function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let sum = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
    }
    return Math.abs(sum) / 2;
}

// Area of a shape in image coordinates (zoom-independent). Points and
// linestrips have no fill and are the hardest to click, so they get area 0
// and always sort ahead of filled shapes.
function shapeArea(shape) {
    if (!shape) return Infinity;
    const pts = shape.points || [];
    switch (shape.shape_type) {
        case 'point':
        case 'linestrip':
        case 'line':
            return 0;
        case 'circle': {
            if (pts.length < 2) return 0;
            const r = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
            return Math.PI * r * r;
        }
        case 'rectangle': {
            if (pts.length < 2) return 0;
            return Math.abs(pts[1][0] - pts[0][0]) * Math.abs(pts[1][1] - pts[0][1]);
        }
        default:
            return polygonArea(pts);
    }
}

// Stable ascending-by-area sort of candidate indices. An explicit tie-break
// on original position keeps topmost-first (the input is reverse draw order)
// without relying on Array.sort stability.
function sortOverlapCandidates(indices, shapes) {
    return indices
        .map((idx, ord) => ({ idx, ord, area: shapeArea(shapes[idx]) }))
        .sort((a, b) => (a.area - b.area) || (a.ord - b.ord))
        .map(e => e.idx);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — `shapeArea` and `sortOverlapCandidates` suites green. (Export of `resolveOverlapSelection` comes in Task 2; its tests aren't added yet, so the suite is otherwise unchanged.)

- [ ] **Step 5: Commit**

```bash
git add media/shapeHelpers.js test/shapeHelpers.test.ts
git commit -m "$(cat <<'EOF'
feat: add shapeArea + sortOverlapCandidates helpers

Specificity-priority ordering for overlapping instances: points/lines
area 0, filled shapes by ascending area, stable topmost-first tie-break.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `resolveOverlapSelection` (pure, TDD)

**Files:**
- Modify: `media/shapeHelpers.js`
- Test: `test/shapeHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the end of `test/shapeHelpers.test.ts`:

```ts
describe('resolveOverlapSelection', () => {
    it('selects the smallest (pos 0) on a fresh stack', () => {
        const r = resolveOverlapSelection({ ordered: [2, 1, 0], prevMembers: [], prevPos: -1, currentSelectedIndex: -1 });
        assert.deepEqual(r, { targetIndex: 2, members: [2, 1, 0], pos: 0 });
    });
    it('advances one step when re-clicking the same stack on our own target', () => {
        const r = resolveOverlapSelection({ ordered: [2, 1, 0], prevMembers: [2, 1, 0], prevPos: 0, currentSelectedIndex: 2 });
        assert.deepEqual(r, { targetIndex: 1, members: [2, 1, 0], pos: 1 });
    });
    it('wraps back to the smallest after the last member', () => {
        const r = resolveOverlapSelection({ ordered: [2, 1, 0], prevMembers: [2, 1, 0], prevPos: 2, currentSelectedIndex: 0 });
        assert.deepEqual(r, { targetIndex: 2, members: [2, 1, 0], pos: 0 });
    });
    it('resets to smallest when selection changed elsewhere (selection mismatch)', () => {
        const r = resolveOverlapSelection({ ordered: [2, 1, 0], prevMembers: [2, 1, 0], prevPos: 0, currentSelectedIndex: 5 });
        assert.deepEqual(r, { targetIndex: 2, members: [2, 1, 0], pos: 0 });
    });
    it('resets to smallest when the candidate set differs from last click', () => {
        const r = resolveOverlapSelection({ ordered: [3, 1], prevMembers: [2, 1, 0], prevPos: 0, currentSelectedIndex: 2 });
        assert.deepEqual(r, { targetIndex: 3, members: [3, 1], pos: 0 });
    });
    it('returns no target for an empty candidate list', () => {
        const r = resolveOverlapSelection({ ordered: [], prevMembers: [], prevPos: -1, currentSelectedIndex: -1 });
        assert.deepEqual(r, { targetIndex: -1, members: [], pos: -1 });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `resolveOverlapSelection is not a function`.

- [ ] **Step 3: Implement the helper**

In `media/shapeHelpers.js`, add immediately after `sortOverlapCandidates` (still before the export block):

```js
// Shallow element-wise array equality.
function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// Decide the target shape and the next cycle state from this click's ordered
// candidates and the previous cycle state. Pure — no DOM, no globals.
//   ordered             : number[]  smallest-first candidate indices (this click)
//   prevMembers         : number[]  ordered candidates from the previous click
//   prevPos             : number    position within prevMembers we landed on
//   currentSelectedIndex: number    currently-selected shape (-1 if none)
// Returns { targetIndex, members, pos }; targetIndex is -1 when ordered is empty.
function resolveOverlapSelection({ ordered, prevMembers, prevPos, currentSelectedIndex }) {
    if (!Array.isArray(ordered) || ordered.length === 0) {
        return { targetIndex: -1, members: [], pos: -1 };
    }
    const continuing =
        arraysEqual(ordered, prevMembers) &&
        prevPos >= 0 &&
        prevMembers[prevPos] === currentSelectedIndex;
    const pos = continuing ? (prevPos + 1) % ordered.length : 0;
    return { targetIndex: ordered[pos], members: ordered, pos };
}
```

Update the export line at the bottom of the file (currently line 55) to:

```js
    module.exports = { allowSelectByClick, contourToBBoxRect, labelAnchorFromPoints, shapeArea, sortOverlapCandidates, resolveOverlapSelection };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all `shapeHelpers` suites green.

- [ ] **Step 5: Commit**

```bash
git add media/shapeHelpers.js test/shapeHelpers.test.ts
git commit -m "$(cat <<'EOF'
feat: add resolveOverlapSelection cycle resolver

Pure decision for click-to-cycle through overlapping instances: smallest
on a fresh stack, advance/wrap on repeat clicks of the same stack, and
self-heal (reset to smallest) when selection changed elsewhere.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Sort candidates in `findAllShapesAt`

**Files:**
- Modify: `media/main.js:3144` (the `return overlappingShapes;` inside `findAllShapesAt`)

No new unit test — `findAllShapesAt` reads browser globals (`shapes`, `zoomLevel`). The ordering logic it now delegates to is covered by Task 1. Verified manually in Task 6.

- [ ] **Step 1: Change the return to sort by specificity**

In `media/main.js`, inside `findAllShapesAt` (the function starting at line 3095), replace the final return:

```js
    return overlappingShapes;
```

with:

```js
    return sortOverlapCandidates(overlappingShapes, shapes);
```

This makes `findShapeIndexAt` (which returns `overlapping[0]`) and the SAM idle guard at `media/main.js:7930` automatically target the smallest/most-specific instance.

- [ ] **Step 2: Smoke-check the build is intact**

Run: `npm run compile`
Expected: PASS — TypeScript still compiles (this edit is in plain JS, so this only confirms nothing else broke). `media/*.js` are not type-checked, so also do a quick visual confirmation the line reads `return sortOverlapCandidates(overlappingShapes, shapes);`.

- [ ] **Step 3: Commit**

```bash
git add media/main.js
git commit -m "$(cat <<'EOF'
feat: order overlapping hit-test results smallest-first

findAllShapesAt now returns candidates via sortOverlapCandidates, so a
click defaults to the smallest/most-specific instance under the cursor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Cycle state, click-handler rewrite, and "N / M" badge

**Files:**
- Modify: `media/main.js` — globals near line 97; overlap branch of the `mousedown` handler at lines 1960-1999; badge helpers (add near `findAllShapesAt`, ~line 3145)
- Modify: `media/style.css` — add `#overlapCycleBadge`

- [ ] **Step 1: Add module globals**

In `media/main.js`, after line 97 (`let selectedShapeIndices = new Set(); // Multi-selection set`), add:

```js
let hoveredShapeIndex = -1;                       // index of the would-be-selected shape under the cursor (-1 = none)
let overlapCycleState = { members: [], pos: -1 }; // current click-to-cycle stack + position within it
```

- [ ] **Step 2: Add the badge helpers**

In `media/main.js`, immediately after the `findShapeIndexAt` function (ends at line 3151), add:

```js
// --- Overlap cycle badge: a small "pos / total" hint shown near the cursor
// while cycling through a stack of overlapping instances (total > 1). It is
// position:fixed on <body> so the canvas zoom transform doesn't scale it. ---
let cycleBadgeEl = null;
let cycleBadgeTimer = null;

function getCycleBadge() {
    if (!cycleBadgeEl) {
        cycleBadgeEl = document.createElement('div');
        cycleBadgeEl.id = 'overlapCycleBadge';
        cycleBadgeEl.style.display = 'none';
        document.body.appendChild(cycleBadgeEl);
    }
    return cycleBadgeEl;
}

function updateCycleBadge(clientX, clientY, pos, total) {
    if (total <= 1) { hideCycleBadge(); return; }
    const badge = getCycleBadge();
    badge.textContent = `${pos + 1} / ${total}`;
    badge.style.left = Math.min(clientX + 14, window.innerWidth - 48) + 'px';
    badge.style.top = Math.min(clientY + 14, window.innerHeight - 28) + 'px';
    badge.style.display = 'block';
    if (cycleBadgeTimer) clearTimeout(cycleBadgeTimer);
    cycleBadgeTimer = setTimeout(hideCycleBadge, 1500);
}

function hideCycleBadge() {
    if (cycleBadgeTimer) { clearTimeout(cycleBadgeTimer); cycleBadgeTimer = null; }
    if (cycleBadgeEl) cycleBadgeEl.style.display = 'none';
}
```

- [ ] **Step 3: Rewrite the overlap branch of the click handler**

In `media/main.js`, replace this exact block (lines 1960-1999):

```js
            if (overlappingShapes.length > 0) {
                let targetShape;
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: always target topmost shape (no cycling)
                    targetShape = overlappingShapes[0];
                    toggleShapeSelection(targetShape);
                } else if (isSameLocation && overlappingShapes.length > 1) {
                    // 如果在同一位置连续点击，且有多个重叠实例，则循环选择下一个
                    const currentIndex = overlappingShapes.indexOf(selectedShapeIndex);
                    if (currentIndex !== -1 && currentIndex < overlappingShapes.length - 1) {
                        targetShape = overlappingShapes[currentIndex + 1];
                    } else {
                        targetShape = overlappingShapes[0];
                    }
                    selectShape(targetShape);
                } else {
                    targetShape = overlappingShapes[0];
                    selectShape(targetShape);
                }

                // 更新点击位置和时间
                lastClickX = x;
                lastClickY = y;
                lastClickTime = now;

                renderShapeList();
                draw();
                return;
            } else {
                // Click on empty area
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click on empty: don't clear selection
                } else {
                    clearSelection();
                }
                renderShapeList();

                // 重置点击追踪
                lastClickTime = 0;
            }
```

with:

```js
            if (overlappingShapes.length > 0) {
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: toggle the smallest (most specific) shape; no cycling
                    toggleShapeSelection(overlappingShapes[0]);
                    overlapCycleState = { members: [], pos: -1 };
                    hideCycleBadge();
                } else {
                    // Smallest-first selection; repeat clicks on the same stack cycle down
                    const r = resolveOverlapSelection({
                        ordered: overlappingShapes,
                        prevMembers: overlapCycleState.members,
                        prevPos: overlapCycleState.pos,
                        currentSelectedIndex: selectedShapeIndex,
                    });
                    selectShape(r.targetIndex);
                    overlapCycleState = { members: r.members, pos: r.pos };
                    updateCycleBadge(e.clientX, e.clientY, r.pos, r.members.length);
                }

                // 更新点击位置和时间
                lastClickX = x;
                lastClickY = y;
                lastClickTime = now;

                renderShapeList();
                draw();
                return;
            } else {
                // Click on empty area
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click on empty: don't clear selection
                } else {
                    clearSelection();
                    overlapCycleState = { members: [], pos: -1 };
                    hideCycleBadge();
                }
                renderShapeList();

                // 重置点击追踪
                lastClickTime = 0;
            }
```

Note: the `isSameLocation` const (computed at line 1953) is now unused. Delete its declaration to avoid dead code — replace lines 1952-1953:

```js
            // 检测是否是在同一位置的连续点击
            const isSameLocation = distance < CLICK_THRESHOLD_DISTANCE && timeDiff < CLICK_THRESHOLD_TIME;
```

with:

```js
            // (Same-location detection for selection cycling was replaced by the
            // candidate-set cycle group in resolveOverlapSelection.)
```

Leave the `now`, `dx`, `dy`, `distance`, `timeDiff` lines (1946-1950) intact — `now` is still used to update `lastClickTime`, and `distance`/`timeDiff` feed nothing else but are cheap; removing only the unused `isSameLocation` keeps the diff minimal.

- [ ] **Step 4: Add the badge CSS**

In `media/style.css`, append:

```css
#overlapCycleBadge {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    padding: 1px 6px;
    font-size: 11px;
    line-height: 16px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.72);
    color: #fff;
    font-variant-numeric: tabular-nums;
    user-select: none;
}
```

- [ ] **Step 5: Verify the build**

Run: `npm run compile`
Expected: PASS. (`media/*.js` is not type-checked; confirm visually that the replaced block matches the new code and that `resolveOverlapSelection`, `updateCycleBadge`, `hideCycleBadge` are referenced.)

- [ ] **Step 6: Commit**

```bash
git add media/main.js media/style.css
git commit -m "$(cat <<'EOF'
feat: smallest-first selection with stable cycle + N/M badge

Click selects the smallest overlapping instance; repeat clicks on the
same stack cycle down via resolveOverlapSelection. A cursor-following
badge shows position within the stack when more than one overlaps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Hover preview

**Files:**
- Modify: `media/main.js` — cursor `mousemove` block at lines 2300-2308; add a `mouseleave` listener; `drawSVGShape` signature + 3 dash applications (~lines 5197, 5221, 5243, 5281); render loop in `draw()` at lines 4887-4905

- [ ] **Step 1: Set the hover index in the cursor mousemove block**

In `media/main.js`, replace this block (lines 2300-2308):

```js
        const hoveredIndex = allowSelectByClick(currentMode, drawClickThrough) ? findShapeIndexAt(x, y) : -1;
        const desiredCursor = hoveredIndex !== -1 ? 'pointer' :
            (currentMode === 'view' ? 'default' : 'crosshair');

        // 只在光标需要改变时更新样式
        if (currentCursor !== desiredCursor) {
            canvasWrapper.style.cursor = desiredCursor;
            currentCursor = desiredCursor;
        }
```

with:

```js
        const hoveredIndex = allowSelectByClick(currentMode, drawClickThrough) ? findShapeIndexAt(x, y) : -1;
        const desiredCursor = hoveredIndex !== -1 ? 'pointer' :
            (currentMode === 'view' ? 'default' : 'crosshair');

        // 只在光标需要改变时更新样式
        if (currentCursor !== desiredCursor) {
            canvasWrapper.style.cursor = desiredCursor;
            currentCursor = desiredCursor;
        }

        // Hover preview: redraw only when the would-be-selected shape changes.
        if (hoveredIndex !== hoveredShapeIndex) {
            hoveredShapeIndex = hoveredIndex;
            draw();
        }
```

- [ ] **Step 2: Clear hover on mouse leave**

In `media/main.js`, immediately after the `mousemove` handler that contains the block above closes (the `});` at line 2310), add:

```js
canvasWrapper.addEventListener('mouseleave', () => {
    if (hoveredShapeIndex !== -1) {
        hoveredShapeIndex = -1;
        draw();
    }
    hideCycleBadge();
});
```

- [ ] **Step 3: Add a dash parameter to `drawSVGShape`**

In `media/main.js`, change the signature at line 5197:

```js
function drawSVGShape(shapeType, points, strokeColor, fillColor, showVertices = false, shapeIndex = -1) {
```

to:

```js
function drawSVGShape(shapeType, points, strokeColor, fillColor, showVertices = false, shapeIndex = -1, strokeDashArray = null) {
```

Then apply the dash to each of the three SVG elements, right after their existing `setAttribute('stroke-width', adjustedStrokeWidth);` lines:

For the point circle — after line 5221 (`circle.setAttribute('stroke-width', adjustedStrokeWidth);`):

```js
            if (strokeDashArray) circle.setAttribute('stroke-dasharray', strokeDashArray);
```

For the filled circle — after line 5243 (`circle.setAttribute('stroke-width', adjustedStrokeWidth);`):

```js
            if (strokeDashArray) circle.setAttribute('stroke-dasharray', strokeDashArray);
```

For the polygon/polyline path — after line 5281 (`pathElement.setAttribute('stroke-width', adjustedStrokeWidth);`):

```js
        if (strokeDashArray) pathElement.setAttribute('stroke-dasharray', strokeDashArray);
```

- [ ] **Step 4: Render the hover outline in the draw loop**

In `media/main.js`, replace this block in the `shapes.forEach` render loop (lines 4887-4905):

```js
        const isSelected = isShapeSelected(index);
        const colors = getColorsForLabel(shape.label);

        let strokeColor = colors.stroke;
        let fillColor = colors.fill;

        if (isSelected) {
            strokeColor = 'rgba(255, 255, 0, 1)';
            // Use global fillOpacity but ensure at least 0.1 visibility for selection
            const selectionOpacity = Math.max(0.1, fillOpacity);
            fillColor = `rgba(255, 255, 0, ${selectionOpacity})`;
        }

        let points = shape.points;
        if (shape.shape_type === 'rectangle') {
            points = getRectPoints(points);
        }

        drawSVGShape(shape.shape_type, points, strokeColor, fillColor, false, index);
```

with:

```js
        const isSelected = isShapeSelected(index);
        const isHovered = !isDrawing && index === hoveredShapeIndex && !isSelected;
        const colors = getColorsForLabel(shape.label);

        let strokeColor = colors.stroke;
        let fillColor = colors.fill;
        let strokeDash = null;

        if (isSelected) {
            strokeColor = 'rgba(255, 255, 0, 1)';
            // Use global fillOpacity but ensure at least 0.1 visibility for selection
            const selectionOpacity = Math.max(0.1, fillOpacity);
            fillColor = `rgba(255, 255, 0, ${selectionOpacity})`;
        } else if (isHovered) {
            // Hover preview: white dashed outline over the normal fill — distinct
            // from the solid-yellow selection state.
            strokeColor = 'rgba(255, 255, 255, 0.95)';
            strokeDash = `${6 / zoomLevel},${4 / zoomLevel}`;
        }

        let points = shape.points;
        if (shape.shape_type === 'rectangle') {
            points = getRectPoints(points);
        }

        drawSVGShape(shape.shape_type, points, strokeColor, fillColor, false, index, strokeDash);
```

- [ ] **Step 5: Verify the build**

Run: `npm run compile`
Expected: PASS. Confirm visually that `drawSVGShape` is called with the 7th `strokeDash` arg and that all three `stroke-dasharray` guards were added.

- [ ] **Step 6: Commit**

```bash
git add media/main.js
git commit -m "$(cat <<'EOF'
feat: hover preview for overlapping-instance selection

Moving the cursor over instances highlights the would-be-selected shape
with a white dashed outline (redrawn only on change); cleared on
mouseleave and never shown while drawing. Selection style takes priority.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full test run + manual smoke (with user)

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all suites green, including the new `shapeArea`, `sortOverlapCandidates`, and `resolveOverlapSelection` blocks.

- [ ] **Step 2: Build for manual testing**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 3: Manual smoke test in the extension (call the user)**

Launch the extension (F5 / Extension Development Host), open an image, and verify:

1. **Smallest-first** — draw a small rectangle/polygon nested inside a larger instance; a single click in the overlap selects the **small** one.
2. **Cycle + badge** — repeat-click the same overlap; selection steps down through the stack (small → larger → … → wraps to smallest), and a `N / M` badge appears near the cursor tracking the position. Badge hides on empty-area click and after ~1.5s.
3. **Hover preview** — move the cursor over the overlap without clicking; the would-be-selected (smallest) instance shows a **white dashed** outline that updates as the cursor moves to different stacks; it disappears when the cursor leaves the canvas.
4. **Selection priority** — a selected (solid yellow) shape never shows the hover outline.
5. **Point/line priority** — a point or line sitting over a polygon is selected first when the cursor is within its click tolerance.
6. **Click-through mode** — with the "draw-through instances" toggle on in a drawing mode, neither hover preview nor click-selection fires (drawing starts instead); badge stays hidden.
7. **Zoom** — repeat checks 1-3 at a high zoom level; dashed outline and badge remain crisp (not scaled oddly).

This is the checkpoint where the user confirms the feel ("手感"). Fix any issues found, then proceed.

---

## Self-Review

**Spec coverage:**
- Feature 1 (specificity ordering) → Tasks 1 (helpers) + 3 (wiring). ✓
- Feature 2 (stable cycle + N/M badge) → Tasks 2 (resolver) + 4 (wiring, badge, CSS). ✓
- Feature 3 (hover preview) → Task 5. ✓
- Edge cases (single candidate → no badge; hover==selected → selection wins; zoom-independent area; hidden shapes skipped; points/lines first; click-through suppresses both; mid-session add/remove self-heal) → covered by helper tests (Tasks 1-2) and the `total <= 1` / `!isSelected` / `!isDrawing` guards in Tasks 4-5, validated in Task 6. ✓
- "No i18n / settings changes" → no task touches dictionaries, `LabelMePanel.ts` (badge is digits only). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type/name consistency:** `shapeArea`, `polygonArea`, `sortOverlapCandidates`, `arraysEqual`, `resolveOverlapSelection` defined in Tasks 1-2 and exported; consumed in Tasks 3-4 by the same names. `hoveredShapeIndex` / `overlapCycleState` declared in Task 4 Step 1, used in Tasks 4-5. `updateCycleBadge` / `hideCycleBadge` / `getCycleBadge` defined in Task 4 Step 2, called in Tasks 4-5. `drawSVGShape`'s new `strokeDashArray` param (Task 5 Step 3) matches the `strokeDash` argument passed in Task 5 Step 4. ✓
