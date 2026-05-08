# Merge Annotations + Rename/Hide Shortcuts — Design

**Date:** 2026-05-08
**Branch:** `feature/merge-annotations`

## Goals

1. **Merge selected annotations.** Right-click → *Merge*, or `Ctrl+G`. Combines multi-selected polygon/rectangle instances whose geometries overlap into one shape per overlap group.
2. **`Ctrl+R`** — trigger the existing Rename action on selected shape(s).
3. **`Ctrl+H`** — trigger the existing Hide/Show toggle on selected shape(s).

Non-goals: changing label/visibility semantics; affecting `point`/`linestrip` shapes; cross-image merging; merging the underlying raster.

## Semantics

### Merge eligibility
- Triggers only when:
  - `selectedShapeIndices.size >= 2`
  - Every selected shape is `polygon` **or** `rectangle`
- If any selected shape is `point` or `linestrip`, the menu item is hidden and `Ctrl+G` is a no-op.

### Overlap detection (per pair)
- A rectangle is converted to a 4-corner polygon ring via `getRectPoints`.
- Two rings overlap **iff** `polygonClipping.intersection([ringA], [ringB])` returns a non-empty `MultiPolygon`. Edge-only/vertex-only contact (zero-area intersection) does **not** count as overlap.

### Grouping
- Overlap pairs are fed into a **union-find (DSU)** structure over the selected indices.
- Each connected component of size ≥ 2 becomes a *merge group*.
- Components of size 1 (isolated, non-overlapping selections) are left untouched. This applies even when several disjoint groups exist in one selection (e.g. `{A,B}` + `{C,D}` produces two merged outputs).

### Output shape per group
Decided by the **whole selection's** composition (not the individual group):

| Selection composition | Output `shape_type` for every group | Geometry |
|---|---|---|
| Every selected shape is `rectangle` | `rectangle` | AABB of every group member's corners — `[[minX, minY], [maxX, maxY]]` |
| Selection contains at least one `polygon` | `polygon` | `polygonClipping.union(rings...)` → take the **largest-area outer ring**, drop holes (inner rings) |

This means a selection like `{poly_A, rect_B, rect_C}` where only `B` and `C` overlap still emits a polygon (rectangles are treated as polygons), because the selection itself is mixed.

Rationale for "largest outer ring": because all members of a group are pairwise-connected through transitive overlaps, the union should yield a single outer polygon. If polygon-clipping happens to return a `MultiPolygon` with multiple disjoint pieces (e.g., due to numerical edge cases), we pick the largest by signed-area magnitude.

### Label resolution
For each merge group:
- If every member has the same `label` → use that label, no prompt.
- If labels differ → mark the group as needing a prompt.

If **any** group needs a prompt, open the existing `labelModal` once (mode flag `isMergePending`). The modal pre-fills with the **mode label** across mixed-group members (most-frequent; tie → first by index).

On confirm:
- Mixed groups → use the user-chosen label.
- Unanimous groups → keep their unanimous label (untouched).

On cancel: abort the entire merge (no groups committed).

If **no** group needs a prompt → merge applies immediately, no modal.

### Other metadata inheritance
Each merged shape inherits non-geometric metadata from the **lowest-original-index member** of its group:
- `group_id` (or `null`)
- `flags` (deep-cloned)
- `description` (or omitted)
- `visible` (preserved if explicitly set; default visible)

### Persistence and undo
- One `pushHistory()` snapshot before mutation, one `saveHistory()` after — same pattern as eraser/edit.
- Merged outputs are inserted at the lowest original index of their group; old shapes are removed; surviving non-group selections (size-1 components) remain in place. Selection is updated to the new merged shapes' indices.
- `markDirty()` fires; status bar shows e.g. `Merged 5 shapes into 2 instances` or `No overlapping shapes to merge`.

## Architecture

### New file: `media/mergeShapesHelpers.js`
Pure functions, no DOM. Loaded as a `<script>` in the webview and `require()`'d from Node tests (mirrors `samPromptHelpers.js`).

Polygon-clipping is passed in as a parameter so tests can inject the Node-resolved package.

```text
shapeToOuterRing(shape)            // [[x,y], ...] (open ring)
ringsOverlap(pc, ringA, ringB)     // boolean
buildOverlapGroups(pc, shapes, indices)
                                   // -> Array<Array<index>>, each length>=2,
                                   // sorted by ascending min-index
computeAABBPoints(rings)           // -> [[minX,minY], [maxX,maxY]]
unionOuterRing(pc, rings)          // -> [[x,y], ...] (largest outer ring,
                                   //                   holes dropped)
ringSignedArea(ring)               // -> number (for picking largest)
resolveGroupLabel(shapes, group)   // -> {label} | {needsPrompt: true,
                                   //                modeLabel: string}
buildMergedShape(shapes, group, allRect, label)
                                   // -> new shape object (rect or polygon)
```

### Wiring in `media/main.js`
- `mergeSelectedShapes()` — orchestrator. Validates, builds groups, resolves labels, either opens label modal (mode `isMergePending`) or commits.
- `finalizeMergePending(label)` / `cancelMergePending()` — invoked from `confirmLabel()` / `cancelLabelInput()` when `isMergePending` is true.
- Keyboard handler additions in the existing `keydown` block:
  - `Ctrl+G` → `mergeSelectedShapes()` (preventDefault).
  - `Ctrl+R` → `showBatchRenameModal()` if ≥1 selected, else no-op (preventDefault).
  - `Ctrl+H` → toggle visibility on selected shapes (call the same logic as `contextMenuToggleVisible` click). preventDefault.
- **Side-fix:** the bare letter handlers for `V`, `P`, `R`, `L`, `O`, `I`, `D` currently fire even when Ctrl/Meta is held. Add `!e.ctrlKey && !e.metaKey` guards so `Ctrl+R`/`Ctrl+P`/etc. don't double-trigger mode switches. (`A` already has this guard.)

### Wiring in `src/LabelMePanel.ts`
- HTML scaffold gains a new menu item:
  ```html
  <div class="context-menu-item" id="contextMenuMerge">Merge</div>
  ```
  Inserted between `contextMenuRename` and `contextMenuToggleVisible`.
- Add `mergeShapesUri` script tag, after `polyClipUri` and `samHelpersUri`, before `scriptUri`.

### Wiring in `media/main.js` for the menu item
- New global ref `contextMenuMerge`.
- In `showShapeContextMenu`:
  - Show/hide the entry based on eligibility (≥2 selected, all polygon/rectangle).
  - Update text: `Merge (N)`.
- Click handler → `hideShapeContextMenu(); mergeSelectedShapes();`.

## Failure modes / edge cases

| Case | Handling |
|---|---|
| `selectedShapeIndices.size < 2` | Menu hidden; shortcut no-op. |
| Mix includes point/linestrip | Menu hidden; shortcut no-op (status bar message). |
| All selected are pairwise non-overlapping | Status bar: `No overlapping shapes to merge`. No mutation. |
| User cancels label modal mid-merge | Abort; no mutation. |
| `polygonClipping` global not loaded | Status bar error: `Polygon clipping unavailable`. No-op. |
| Union output is empty (numerical) | Skip that group; status bar reports skipped count. |
| Merged polygon has < 3 points | Skip that group. |

## Testing

Unit tests in `test/mergeShapesHelpers.test.ts` (mirrors `samPromptHelpers.test.ts` pattern). Tests cover:

- **`ringsOverlap`** — non-overlap, edge-touch (zero-area), full overlap, containment.
- **`buildOverlapGroups`** — 2 disjoint pairs, 3-cycle (transitive), single isolate, all-overlap.
- **`computeAABBPoints`** — bounding box for two rectangles, three rectangles.
- **`unionOuterRing`** — two overlapping squares → single rect outline; doughnut union (drops hole); two disjoint squares (defensive — picks larger).
- **`buildMergedShape`** — all-rectangle ⇒ rectangle output; mixed ⇒ polygon output; metadata inheritance (label/group_id/flags/description from lowest-index).
- **`resolveGroupLabel`** — unanimous → `{label}`; mixed → `{needsPrompt, modeLabel}`.

Manual smoke (post-implementation):
- Two overlapping rectangles → one bounding rectangle, label preserved.
- Two overlapping polygons → fused polygon outline.
- Polygon + rectangle overlap → polygon output.
- Selection of 4 with two disjoint overlap pairs → two merged outputs.
- Mixed labels → modal opens, choosing applies to merged outputs.
- Selection of 2 non-overlapping → status bar message, no-op.
- Undo restores all originals; redo re-merges.
- Ctrl+R opens rename (single and batch).
- Ctrl+H toggles visibility, identical to context menu.
