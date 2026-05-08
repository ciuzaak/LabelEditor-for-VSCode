# Implementation Plan — Merge Annotations + Ctrl+R/Ctrl+H

**Spec:** [`2026-05-08-merge-annotations-design.md`](../specs/2026-05-08-merge-annotations-design.md)
**Branch:** `feature/merge-annotations`

## Step 1 — `media/mergeShapesHelpers.js` (new file, pure)

Mirror the layout of `media/samPromptHelpers.js`:
- ES5-compatible function declarations.
- `module.exports = { ... }` guard at the bottom for Node/test.
- All polygon-clipping calls receive `pc` as first parameter (no global lookup) so tests can inject `require('polygon-clipping')`.

Functions:

| Function | Behavior |
|---|---|
| `getRectPointsLocal(points)` | Mirror of main.js helper; expand 2-corner rectangle to 4 vertices. Idempotent: pass-through if `points.length !== 2`. |
| `shapeToOuterRing(shape)` | Returns `[[x,y],...]` (open ring). Rectangles use `getRectPointsLocal`. |
| `closeRing(ring)` | Returns ring with the first point appended at the end if not already closed. |
| `ringSignedArea(ring)` | Standard shoelace; sign tells orientation; `Math.abs` used for size comparison. |
| `ringsOverlap(pc, ringA, ringB)` | `pc.intersection([closeRing(ringA)], [closeRing(ringB)])` returns non-empty `MultiPolygon`. Wrapped in try/catch returning `false` on throw. |
| `buildOverlapGroups(pc, shapes, indices)` | DSU. Iterate all unordered pairs of selected indices, call `ringsOverlap`, union. Return `Array<Array<index>>`, each sorted ascending, only groups of size ≥ 2, outer array sorted by min-index. |
| `computeAABBPoints(rings)` | Iterate every ring point; return `[[minX, minY], [maxX, maxY]]`. |
| `unionOuterRing(pc, rings)` | `pc.union(...rings.map(r => [closeRing(r)]))` → returns `MultiPolygon`. Filter polygons whose outer ring has ≥ 3 distinct vertices, pick polygon with the largest absolute outer-ring area, drop closing point and inner rings. Return `[[x,y],...]` open ring. Returns `null` if nothing valid. |
| `resolveGroupLabel(shapes, group)` | If all `shapes[i].label` equal → `{label}`. Otherwise compute mode label (most frequent; tie → first by index) → `{needsPrompt: true, modeLabel}`. |
| `buildMergedShape(shapes, group, label, options)` | `options` = `{ allRectangles, points }`. Inherits `group_id`/`flags`/`description`/`visible` from `shapes[group[0]]` (group already sorted, so element 0 is lowest index). Returns a freshly constructed shape object. |

## Step 2 — Load helpers in `src/LabelMePanel.ts`

- Add `mergeHelpersUri` analogous to `samHelpersUri`.
- Add `<script src="${mergeHelpersUri}"></script>` after `samHelpersUri`, before `scriptUri`.
- Add `<div class="context-menu-item" id="contextMenuMerge">Merge</div>` between the rename and toggle-visible items in `shapeContextMenu`.

## Step 3 — Implement `mergeSelectedShapes()` in `media/main.js`

New code lives near the existing eraser/edit/delete helpers (around line 2400-2450 area, just after the context-menu click handlers).

Pseudocode:
```js
let isMergePending = false;
let pendingMergeGroups = null;          // Array<Array<index>>
let pendingMergeOutputs = null;         // Array<{rings|points, allRect}>
let pendingMergeLabels = null;          // Array<string|null> (null => use input)

function mergeSelectedShapes() {
    if (selectedShapeIndices.size < 2) return;
    const indices = [...selectedShapeIndices];
    if (!indices.every(i => shapes[i].shape_type === 'polygon'
                         || shapes[i].shape_type === 'rectangle')) {
        setStatus('Merge supports polygon/rectangle only', 'warning');
        return;
    }
    const pc = window.polygonClipping || (typeof polygonClipping !== 'undefined' ? polygonClipping : null);
    if (!pc) { setStatus('Polygon clipping unavailable', 'error'); return; }

    const groups = mergeHelpers.buildOverlapGroups(pc, shapes, indices);
    if (groups.length === 0) {
        setStatus('No overlapping shapes to merge', 'warning');
        return;
    }

    // Pre-compute geometry per group.
    const outputs = groups.map(group => {
        const allRect = group.every(i => shapes[i].shape_type === 'rectangle');
        const rings = group.map(i => mergeHelpers.shapeToOuterRing(shapes[i]));
        if (allRect) {
            return { allRect: true, points: mergeHelpers.computeAABBPoints(rings) };
        }
        const outer = mergeHelpers.unionOuterRing(pc, rings);
        return { allRect: false, points: outer };
    });

    // Skip groups with degenerate output.
    const valid = outputs.map((o, i) => ({ group: groups[i], out: o }))
                         .filter(({out}) => Array.isArray(out.points)
                                         && out.points.length >= (out.allRect ? 2 : 3));
    if (valid.length === 0) {
        setStatus('Merge produced no valid geometry', 'warning');
        return;
    }

    // Resolve labels.
    const labels = valid.map(({group}) => mergeHelpers.resolveGroupLabel(shapes, group));
    const anyPrompt = labels.some(l => l.needsPrompt);

    if (!anyPrompt) {
        finalizeMerge(valid, labels.map(l => l.label));
        return;
    }

    // Open modal in merge-pending mode.
    pendingMergeGroups = valid.map(v => v.group);
    pendingMergeOutputs = valid.map(v => v.out);
    pendingMergeLabels = labels.map(l => l.needsPrompt ? null : l.label);
    isMergePending = true;
    const modeLabel = labels.find(l => l.needsPrompt).modeLabel;
    showLabelModalForMerge(modeLabel);
}

function finalizeMerge(valid, perGroupLabel) {
    pushHistory();
    // Build new shapes; remove old; insert at min-index.
    const removeIdx = new Set(valid.flatMap(v => v.group));
    const newShapes = [];
    const inserts = new Map();          // minIndex -> mergedShape
    valid.forEach(({group, out}, i) => {
        const merged = mergeHelpers.buildMergedShape(
            shapes, group, perGroupLabel[i],
            { allRectangles: out.allRect, points: out.points }
        );
        inserts.set(group[0], merged);
    });
    for (let i = 0; i < shapes.length; i++) {
        if (inserts.has(i)) newShapes.push(inserts.get(i));
        else if (!removeIdx.has(i)) newShapes.push(shapes[i]);
    }
    shapes.length = 0;
    shapes.push(...newShapes);

    // Update selection to point at the new merged shapes.
    selectedShapeIndices.clear();
    newShapes.forEach((s, i) => {
        if ([...inserts.values()].includes(s)) selectedShapeIndices.add(i);
    });
    selectedShapeIndex = selectedShapeIndices.size > 0
        ? [...selectedShapeIndices][selectedShapeIndices.size - 1]
        : -1;

    markDirty();
    saveHistory();
    renderShapeList();
    renderLabelsList();
    draw();
    setStatus(`Merged into ${valid.length} instance${valid.length > 1 ? 's' : ''}`,
              'success');
}
```

`showLabelModalForMerge(modeLabel)`:
- Set `labelInput.value = modeLabel`, `descriptionInput.value = ''`.
- `labelModal.style.display = 'flex'`.
- Focus + select label input.
- Render recent labels.
- (Does **not** set `editingShapeIndex` or `isBatchRenaming` — `isMergePending` is the sole flag.)

In `confirmLabel()`: branch first on `isMergePending`. If true, take label from input, fill `null` slots in `pendingMergeLabels`, call `finalizeMerge`, hide modal, reset merge-pending state. Other branches unchanged.

In `cancelLabelInput()`: also branch on `isMergePending` and reset state without mutation.

## Step 4 — Wire menu item

- Add `const contextMenuMerge = document.getElementById('contextMenuMerge');` near other refs (~line 227).
- In `showShapeContextMenu`:
  ```js
  if (contextMenuMerge) {
      const eligible = selectedShapeIndices.size >= 2
          && [...selectedShapeIndices].every(i =>
              shapes[i].shape_type === 'polygon' || shapes[i].shape_type === 'rectangle');
      contextMenuMerge.style.display = eligible ? '' : 'none';
      if (eligible) contextMenuMerge.textContent = `Merge (${selectedShapeIndices.size})`;
  }
  ```
- Add a click handler symmetric to other menu handlers, calling `mergeSelectedShapes()`.

## Step 5 — Wire shortcuts

In the existing `keydown` block (~line 1387), add three new branches before the bare-letter branches:

```js
// Ctrl+G: Merge selected shapes
if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    mergeSelectedShapes();
    return;
}

// Ctrl+R: Rename selected shape(s)
if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    if (selectedShapeIndices.size > 1) showBatchRenameModal();
    else if (selectedShapeIndex !== -1) showLabelModal(selectedShapeIndex);
    return;
}

// Ctrl+H: Toggle visibility of selected shape(s)
if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
    e.preventDefault();
    toggleSelectedVisibility();
    return;
}
```

Extract the body of the `contextMenuToggleVisible` click handler into `toggleSelectedVisibility()` so both call sites share one implementation.

Add `!e.ctrlKey && !e.metaKey` guards to the bare letter branches for `V`, `O`, `L`, `P`, `R`, `I`, `D` so they don't fire on Ctrl+letter combinations.

## Step 6 — Unit tests

Create `test/mergeShapesHelpers.test.ts`. Mirror style of `test/samPromptHelpers.test.ts`:

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'mergeShapesHelpers.js'));
const pc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'polygon-clipping'));
```

Test cases (each `describe`):
1. **`ringsOverlap`** — disjoint, edge-touch (zero-area, expect `false`), full overlap, full containment.
2. **`buildOverlapGroups`** — two disjoint pairs (returns 2 groups), single isolate among 3 (returns 1 group of 2), 3-cycle transitive (returns 1 group of 3), no overlaps (returns 0 groups).
3. **`computeAABBPoints`** — three squares with known min/max produce expected bounding box.
4. **`unionOuterRing`** — two overlapping unit squares offset by 0.5 produce expected dimensions; donut case (square minus interior square) returns the outer square (drop hole). Sanity: two disjoint squares would not be a real merge group, but defensively test that the helper picks the larger of two output polygons.
5. **`resolveGroupLabel`** — uniform labels return `{label}`; mixed return `{needsPrompt: true, modeLabel}` with the most-frequent label.
6. **`buildMergedShape`** — all-rectangle group → `shape_type === 'rectangle'`, points length 2; mixed group → `shape_type === 'polygon'`; metadata inherited from group's lowest-index member (`label`/`group_id`/`flags`/`description`).

## Step 7 — Verify

```sh
npm run compile     # tsc against src/
npm run test        # tsc against test/+src/, then node --test
```

Both must pass with no errors. **No** UI smoke testing here — that requires F5 in VSCode.

## Step 8 — Commit & notify

One commit covers the implementation and tests:
> `Add merge annotations feature + Ctrl+R/Ctrl+H shortcuts`

Then notify the user that the feature is ready for smoke test in the Extension Development Host.

## Risk register

- **polygon-clipping numerical edge cases** — handled by try/catch in `ringsOverlap`, validity filter in `unionOuterRing`, and per-group skip in orchestrator.
- **Status bar API name** — `setStatus(...)` may not exist in this codebase; use direct `statusSpan.textContent = ...` or whatever the existing pattern is. Verify when implementing.
- **`renderLabelsList` may not be needed** — only call if labels visibly change (mixed-group case). The existing toggle-visible handler does call it; mirror that.
