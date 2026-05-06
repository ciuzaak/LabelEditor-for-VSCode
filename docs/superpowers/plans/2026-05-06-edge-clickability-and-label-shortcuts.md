# Edge Clickability & Label Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 40px padding ring around the image so the cursor can reliably click edge pixels, and let users pick a recent label with `Alt+1`..`Alt+9` / `Alt+0` (with chip number badges that appear only while Alt is held).

**Architecture:** All changes are in two files — `media/style.css` and `media/main.js`. The image is repositioned `+PAD` inside `canvasWrapper`; existing handlers that use `canvas.getBoundingClientRect()` automatically pick up the new offset (no change needed). Only the wheel-zoom anchor, fit-to-screen, and view-state restore math reference container/wrapper coordinates and need explicit `±PAD` corrections. A small `clampImageCoords()` helper is added at every "record image coordinate" site so cursor positions in the padding ring snap to the image edge. The label modal grows three new behaviors layered onto the existing `renderRecentLabels()` / `confirmLabel()` functions: per-chip shortcut indices, an Alt-driven badge reveal, and a global `keydown` listener that maps `Alt+N` → `pickLabelByShortcut(N)`.

**Tech Stack:** Plain JavaScript (no module system) running inside a VSCode webview, plain CSS with theme variables. No test harness exists for `media/*.js`, so verification is manual after each task — instructions follow the layout in [docs/superpowers/specs/2026-05-06-edge-clickability-and-label-shortcuts-design.md](../specs/2026-05-06-edge-clickability-and-label-shortcuts-design.md).

**Spec reference:** [docs/superpowers/specs/2026-05-06-edge-clickability-and-label-shortcuts-design.md](../specs/2026-05-06-edge-clickability-and-label-shortcuts-design.md)

**Dev loop:** Edit files under `media/` → in VSCode press `F5` to launch "Run Extension" (or reload an already-running Extension Host with Developer: Reload Window) → open an image with **LabelEditor: Open Image Annotator**. Webview JS/CSS reload on each panel open. The TypeScript under `src/` is unchanged in this plan, so `npm run compile` is not needed.

---

## Task 1: Add canvas edge padding skeleton

**Goal:** Image floats inside `canvasWrapper` with a 40px neutral ring around it. Wrapper width/height grow accordingly so scrollbars expose the ring.

**Files:**
- Modify: `media/main.js` (add constant near top, modify `updateCanvasTransform` ~line 806–836, modify wheel-zoom resize block ~line 2090–2103)
- Modify: `media/style.css` (modify `.canvas-container` / canvas-wrapper rules, plus the canvas/svg positioning)

- [ ] **Step 1: Locate the existing canvasWrapper CSS**

Open `media/style.css`. Search for `#canvasWrapper` and `.canvas-container`. Note that the SVG overlay rule sits on top of the canvas via absolute positioning. We will keep that pattern for `<canvas>` itself.

Also confirm that `--color-bg-primary` is defined in both the dark block ([style.css:4](../../../media/style.css#L4)) and the light block ([style.css:30](../../../media/style.css#L30)).

- [ ] **Step 2: Add padding to canvasWrapper and position canvas + SVG absolutely inside it**

In `media/style.css`, find the `#canvasWrapper` selector. If it does not have explicit rules yet, add a new block. Replace any existing `#canvasWrapper { ... }` with:

```css
#canvasWrapper {
    position: relative;
    padding: 40px;                                  /* CANVAS_EDGE_PADDING in JS */
    background-color: var(--color-bg-primary);     /* visible padding ring */
    box-sizing: content-box;                        /* width/height set in JS = inner size */
}

#canvasWrapper > canvas,
#canvasWrapper > svg {
    position: absolute;
    top: 40px;
    left: 40px;
}
```

Notes:
- `box-sizing: content-box` means the JS-set `width`/`height` continue to refer to the inner image area; padding is added on top of those values. This keeps the existing JS sizing logic intact.
- If the canvas/svg already had `position: absolute` rules elsewhere with `top: 0; left: 0`, those rules need to be removed or merged so the new `top: 40px; left: 40px` wins. Search `style.css` for `#canvasWrapper > canvas` and `#canvasWrapper > svg` and consolidate.

- [ ] **Step 3: Add the `CANVAS_EDGE_PADDING` constant in main.js**

In `media/main.js`, find the existing zoom constants block around [main.js:135–140](../../../media/main.js#L135-L140):

```js
const ZOOM_FIT_RATIO = 0.98;      // 适应屏幕时的缩放比例
const ZOOM_MAX = 100;               // 最大缩放倍数 (10000%)
const ZOOM_MIN = 0.1;              // 最小缩放倍数
const ZOOM_FACTOR = 1.1;           // 滚轮缩放因子
const PIXEL_RENDER_THRESHOLD = 20; // zoomLevel >= 20 (2000%) 时启用像素块渲染+网格
const PIXEL_VALUES_ZOOM = ZOOM_MAX; // 达到最大缩放时显示像素RGB/灰度值
```

After this block, add:

```js
// Padding (in CSS pixels) around the image inside canvasWrapper.
// Lets the cursor overshoot the image edge so the outermost pixels are reliably clickable.
// Must match the padding value in style.css #canvasWrapper.
const CANVAS_EDGE_PADDING = 40;
```

- [ ] **Step 4: Update `updateCanvasTransform()` so the wrapper size includes padding**

In `media/main.js`, find `updateCanvasTransform()` at [main.js:806–836](../../../media/main.js#L806-L836). Today it sets:

```js
canvasWrapper.style.width = `${displayWidth}px`;
canvasWrapper.style.height = `${displayHeight}px`;
```

Because we set `box-sizing: content-box` in CSS, those values still mean "inner content area." That's already what we want, so **no change is required** here. Add an inline comment to make the dependency explicit:

Replace lines [main.js:828–832](../../../media/main.js#L828-L832):

```js
    // Remove transform from wrapper and set explicit size
    canvasWrapper.style.transform = '';
    canvasWrapper.style.transformOrigin = '';
    canvasWrapper.style.width = `${displayWidth}px`;
    canvasWrapper.style.height = `${displayHeight}px`;
```

with:

```js
    // Remove transform from wrapper and set explicit inner size.
    // Wrapper has CSS padding = CANVAS_EDGE_PADDING on each side (box-sizing: content-box),
    // so its outer scroll size is automatically displayWidth + 2*PAD.
    canvasWrapper.style.transform = '';
    canvasWrapper.style.transformOrigin = '';
    canvasWrapper.style.width = `${displayWidth}px`;
    canvasWrapper.style.height = `${displayHeight}px`;
```

- [ ] **Step 5: Same comment update in the wheel-zoom inline resize block**

In the wheel-zoom handler around [main.js:2094–2103](../../../media/main.js#L2094-L2103):

```js
            canvas.style.width = `${displayWidth}px`;
            canvas.style.height = `${displayHeight}px`;

            svgOverlay.setAttribute('width', `${displayWidth}px`);
            svgOverlay.setAttribute('height', `${displayHeight}px`);
            svgOverlay.style.width = `${displayWidth}px`;
            svgOverlay.style.height = `${displayHeight}px`;

            canvasWrapper.style.width = `${displayWidth}px`;
            canvasWrapper.style.height = `${displayHeight}px`;
            canvasWrapper.style.transform = '';
```

No code change is needed because `box-sizing: content-box` again makes these "inner" sizes. Optionally add a one-line comment above the `canvasWrapper.style.width` assignment:

```js
            // Wrapper inner size = display size; CSS padding adds the edge ring on top.
            canvasWrapper.style.width = `${displayWidth}px`;
```

- [ ] **Step 6: Manual verify**

Press `F5` in VSCode → "Run Extension" launches a new Extension Development Host. In that host, open any image folder via the explorer context menu → "LabelEditor: Open Folder for Annotation".

Expected:
- A neutral-colored ring (~40px wide) is visible around all four sides of the image.
- The image still fits in the viewport at fit-to-screen, possibly very slightly smaller than before (Task 3 will refine this — for now scrollbars may appear at fit-to-screen; that is OK temporarily).
- Scrolling the image to the right exposes more padding past the right edge.
- Existing operations still work (selecting shapes, drawing a polygon away from the edge).

- [ ] **Step 7: Commit**

```bash
git add media/main.js media/style.css
git commit -m "Add canvas edge padding skeleton

Wraps the image in a 40px neutral ring inside canvasWrapper using CSS
padding plus absolute positioning of canvas/svg. The CANVAS_EDGE_PADDING
constant in main.js mirrors the CSS value. Wrapper inner size remains
displayWidth/displayHeight (box-sizing: content-box), so existing sizing
code keeps working. Subsequent tasks adjust scroll math and clamp mouse
coordinates."
```

---

## Task 2: Wheel-zoom anchor with padding offset

**Goal:** Wheel-zoom keeps the same image pixel under the cursor, with no drift, after the image was shifted by `PAD` inside the wrapper.

**Files:**
- Modify: `media/main.js` (wheel handler at [main.js:2049–2138](../../../media/main.js#L2049-L2138))

- [ ] **Step 1: Identify the affected math**

In the wheel handler, today:

```js
const rect = canvasContainer.getBoundingClientRect();
const mouseX = e.clientX - rect.left;
const mouseY = e.clientY - rect.top;
const scrollLeft = canvasContainer.scrollLeft;
const scrollTop = canvasContainer.scrollTop;
const imageX = (scrollLeft + mouseX) / zoomLevel;
const imageY = (scrollTop + mouseY) / zoomLevel;
// ...
const newScrollLeft = imageX * zoomLevel - mouseX;
const newScrollTop = imageY * zoomLevel - mouseY;
canvasContainer.scrollLeft = newScrollLeft;
canvasContainer.scrollTop = newScrollTop;
```

This is wrong with padding because `scrollLeft + mouseX` is a position inside the wrapper (which now starts with `PAD` of empty space before the image begins), not inside the image.

- [ ] **Step 2: Apply `-PAD` and `+PAD` corrections**

Edit [main.js:2069–2070](../../../media/main.js#L2069-L2070):

```js
            // Calculate mouse position in image coordinates before zoom
            const imageX = (scrollLeft + mouseX) / zoomLevel;
            const imageY = (scrollTop + mouseY) / zoomLevel;
```

becomes:

```js
            // Calculate mouse position in image coordinates before zoom.
            // Wrapper has CANVAS_EDGE_PADDING of empty space before the image starts,
            // so subtract PAD when converting wrapper-local position to image space.
            const imageX = (scrollLeft + mouseX - CANVAS_EDGE_PADDING) / zoomLevel;
            const imageY = (scrollTop + mouseY - CANVAS_EDGE_PADDING) / zoomLevel;
```

Edit [main.js:2107–2108](../../../media/main.js#L2107-L2108):

```js
            // Calculate new scroll position to keep the same image point under the mouse
            const newScrollLeft = imageX * zoomLevel - mouseX;
            const newScrollTop = imageY * zoomLevel - mouseY;
```

becomes:

```js
            // Calculate new scroll position to keep the same image point under the mouse.
            // Inverse of the read above: image pixel sits at +PAD inside the wrapper.
            const newScrollLeft = imageX * zoomLevel + CANVAS_EDGE_PADDING - mouseX;
            const newScrollTop = imageY * zoomLevel + CANVAS_EDGE_PADDING - mouseY;
```

- [ ] **Step 3: Manual verify**

Reload the extension host. Open an image. Place the cursor exactly on a recognizable pixel near the image edge (e.g., a corner of an object). Ctrl+scroll to zoom in and out.

Expected: The same pixel stays under the cursor before and after. No drift even when zooming near the image's right or bottom edge.

Sanity check the no-padding case: cursor over the middle of the image still zooms correctly.

- [ ] **Step 4: Commit**

```bash
git add media/main.js
git commit -m "Adjust wheel-zoom anchor for canvas edge padding

The cursor-anchored zoom math was treating wrapper-local position as
image position. With the new padding ring, image pixels are offset by
CANVAS_EDGE_PADDING inside the wrapper, so subtract PAD when reading
imageX/Y from scroll+mouse and add PAD when computing the post-zoom
scroll position."
```

---

## Task 3: Fit-to-screen and view-state restore math

**Goal:** Fit-to-screen still produces a centered image with no scrollbars, and lock-view restoration still places the saved center exactly under the viewport center, accounting for the new `PAD`.

**Files:**
- Modify: `media/main.js` — `calculateFitToScreenZoom()` at [main.js:421–431](../../../media/main.js#L421-L431), `getNormalizedViewState()` at [main.js:436–478](../../../media/main.js#L436-L478), `applyNormalizedViewState()` at [main.js:483–511](../../../media/main.js#L483-L511)

- [ ] **Step 1: Update `calculateFitToScreenZoom`**

In `media/main.js`, replace [main.js:421–431](../../../media/main.js#L421-L431):

```js
function calculateFitToScreenZoom() {
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;

    if (w === 0 || h === 0 || img.width === 0 || img.height === 0) return 1;

    const scaleX = w / img.width;
    const scaleY = h / img.height;

    return Math.min(scaleX, scaleY) * ZOOM_FIT_RATIO;
}
```

with:

```js
function calculateFitToScreenZoom() {
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;

    if (w === 0 || h === 0 || img.width === 0 || img.height === 0) return 1;

    // Reserve CANVAS_EDGE_PADDING on each side so the padding ring fits inside the
    // viewport without scrollbars at fit-to-screen.
    const usableW = Math.max(1, w - 2 * CANVAS_EDGE_PADDING);
    const usableH = Math.max(1, h - 2 * CANVAS_EDGE_PADDING);

    const scaleX = usableW / img.width;
    const scaleY = usableH / img.height;

    return Math.min(scaleX, scaleY) * ZOOM_FIT_RATIO;
}
```

- [ ] **Step 2: Update `getNormalizedViewState`**

In [main.js:462–475](../../../media/main.js#L462-L475), the function currently treats `scrollX + viewportW / 2` as a wrapper-local screen position and divides by `zoomLevel` to get the image pixel under the viewport center. With padding, the image pixel at the viewport center is at wrapper position `scrollX + viewportW / 2`, but the image itself starts at +PAD inside the wrapper, so the image-space coordinate is `(scrollX + viewportW / 2 - PAD) / zoomLevel`.

Replace:

```js
    if (imageW <= viewportW) {
        // Image fits horizontally, use center
        imageCenterX = 0.5;
    } else {
        // Calculate which point of the ORIGINAL image is at the viewport center
        const viewportCenterScreenX = scrollX + viewportW / 2;
        const viewportCenterImageX = viewportCenterScreenX / zoomLevel;
        imageCenterX = viewportCenterImageX / img.width;
    }

    if (imageH <= viewportH) {
        // Image fits vertically, use center
        imageCenterY = 0.5;
    } else {
        const viewportCenterScreenY = scrollY + viewportH / 2;
        const viewportCenterImageY = viewportCenterScreenY / zoomLevel;
        imageCenterY = viewportCenterImageY / img.height;
    }
```

with:

```js
    if (imageW <= viewportW) {
        // Image fits horizontally, use center
        imageCenterX = 0.5;
    } else {
        // Calculate which point of the ORIGINAL image is at the viewport center.
        // Subtract CANVAS_EDGE_PADDING because the image starts +PAD inside the wrapper.
        const viewportCenterScreenX = scrollX + viewportW / 2;
        const viewportCenterImageX = (viewportCenterScreenX - CANVAS_EDGE_PADDING) / zoomLevel;
        imageCenterX = viewportCenterImageX / img.width;
    }

    if (imageH <= viewportH) {
        // Image fits vertically, use center
        imageCenterY = 0.5;
    } else {
        const viewportCenterScreenY = scrollY + viewportH / 2;
        const viewportCenterImageY = (viewportCenterScreenY - CANVAS_EDGE_PADDING) / zoomLevel;
        imageCenterY = viewportCenterImageY / img.height;
    }
```

- [ ] **Step 3: Update `applyNormalizedViewState`**

In [main.js:503–510](../../../media/main.js#L503-L510), replace:

```js
    // Convert image coordinates back to scroll position
    const imageX = state.imageCenterX * img.width;
    const imageY = state.imageCenterY * img.height;
    const scrollX = imageX * zoomLevel - viewportW / 2;
    const scrollY = imageY * zoomLevel - viewportH / 2;

    canvasContainer.scrollLeft = Math.max(0, scrollX);
    canvasContainer.scrollTop = Math.max(0, scrollY);
```

with:

```js
    // Convert image coordinates back to scroll position.
    // Image pixel sits at +CANVAS_EDGE_PADDING inside the wrapper, so add PAD.
    const imageX = state.imageCenterX * img.width;
    const imageY = state.imageCenterY * img.height;
    const scrollX = imageX * zoomLevel + CANVAS_EDGE_PADDING - viewportW / 2;
    const scrollY = imageY * zoomLevel + CANVAS_EDGE_PADDING - viewportH / 2;

    canvasContainer.scrollLeft = Math.max(0, scrollX);
    canvasContainer.scrollTop = Math.max(0, scrollY);
```

- [ ] **Step 4: Manual verify fit-to-screen**

Reload the extension host. Open a small image (e.g., 200×200) and a large image (e.g., 4000×3000).

Expected:
- Small image: appears centered with the padding ring visible around it. **No scrollbars.**
- Large image: fits the viewport with the padding ring just inside the viewport edges. No scrollbars at fit-to-screen.
- Image sizes are slightly smaller than the previous baseline (~6–8% smaller on a typical viewport). This is expected.

- [ ] **Step 5: Manual verify lock view**

Click the lock icon (🔓 → 🔒) so view is locked. Pan/zoom to a recognizable image feature (say, the top-right corner of an object). Switch to the next image (Page Down or via the image list). Switch back.

Expected: The same image feature is back at the same viewport position. No drift.

- [ ] **Step 6: Commit**

```bash
git add media/main.js
git commit -m "Adjust fit-to-screen and view-state math for canvas padding

calculateFitToScreenZoom now reserves 2*PAD per axis so the padding ring
fits inside the viewport at fit-to-screen. getNormalizedViewState and
applyNormalizedViewState account for the +PAD offset of the image inside
the wrapper, keeping lock-view restoration accurate."
```

---

## Task 4: Clamp mouse coordinates to image bounds

**Goal:** When the cursor is in the padding ring, mouse-derived image coordinates snap to the image edge (e.g., `0` or `img.width`). Drawing/dragging never produces points outside `[0, img.width] × [0, img.height]`.

Implementation note: most existing handlers use `canvas.getBoundingClientRect()` and compute `x = (e.clientX - rect.left) / zoomLevel`. Because `<canvas>` is now positioned at `+PAD` inside `canvasWrapper`, `rect.left` already includes the PAD shift in viewport coordinates. So the formula's *meaning* is unchanged — what changes is that `x` can now legitimately be slightly negative or slightly larger than `img.width` (when the cursor is in the padding ring). We add clamping at the points where these coordinates are *recorded* as image data; pure hit-testing reads remain unaffected because clamping a hit-test query to image bounds doesn't change the result.

**Files:**
- Modify: `media/main.js` — add helpers near the top, then apply at the recording sites listed below

- [ ] **Step 1: Add `clampImageCoords` helper**

In `media/main.js`, find a logical home for the helper — directly after the `CANVAS_EDGE_PADDING` constant added in Task 1 is fine. Add:

```js
// Clamp an image-space (x, y) point to the image bounds.
// Use at every site that records cursor position as a shape vertex / prompt point.
// Hit-testing does not need this (clamping does not change the result).
function clampImageCoords(x, y) {
    const w = (img && img.width) ? img.width : 0;
    const h = (img && img.height) ? img.height : 0;
    return [
        Math.max(0, Math.min(w, x)),
        Math.max(0, Math.min(h, y))
    ];
}
```

The `x` (single-axis) variant isn't worth it; sites always have both x and y in scope.

- [ ] **Step 2: Clamp at the polygon/line/point/rectangle creation sites in mousedown**

In [main.js:1736–1752](../../../media/main.js#L1736-L1752):

```js
            // 只在polygon或rectangle或point或line模式下允许开始绘制
            if (currentMode === 'point') {
                // Point mode: single click creates a point and immediately finishes
                isDrawing = true;
                currentPoints = [[x, y]];
                finishPolygon();
            } else if (currentMode === 'line') {
                isDrawing = true;
                currentPoints = [[x, y]];
            } else if (currentMode === 'polygon') {
                isDrawing = true;
                currentPoints = [[x, y]];
            } else if (currentMode === 'rectangle') {
                isDrawing = true;
                // Rectangle starts with one point, we'll expand it in mousemove
                currentPoints = [[x, y]];
            }
```

Replace each `[[x, y]]` with `[clampImageCoords(x, y)]`:

```js
            // 只在polygon或rectangle或point或line模式下允许开始绘制
            if (currentMode === 'point') {
                isDrawing = true;
                currentPoints = [clampImageCoords(x, y)];
                finishPolygon();
            } else if (currentMode === 'line') {
                isDrawing = true;
                currentPoints = [clampImageCoords(x, y)];
            } else if (currentMode === 'polygon') {
                isDrawing = true;
                currentPoints = [clampImageCoords(x, y)];
            } else if (currentMode === 'rectangle') {
                isDrawing = true;
                // Rectangle starts with one point, we'll expand it in mousemove
                currentPoints = [clampImageCoords(x, y)];
            }
```

- [ ] **Step 3: Clamp at polygon/line continuation sites**

In [main.js:1773](../../../media/main.js#L1773):

```js
                        currentPoints.push([x, y]);
```

becomes:

```js
                        currentPoints.push(clampImageCoords(x, y));
```

In [main.js:1788](../../../media/main.js#L1788):

```js
                    currentPoints.push([x, y]);
```

becomes:

```js
                    currentPoints.push(clampImageCoords(x, y));
```

- [ ] **Step 4: Clamp at rectangle preview update in mousemove**

In [main.js:1968](../../../media/main.js#L1968):

```js
                    currentPoints = [startPoint, [x, y]];
```

becomes:

```js
                    currentPoints = [startPoint, clampImageCoords(x, y)];
```

(`startPoint` was already clamped when the rectangle was started in Step 2 — no need to re-clamp.)

- [ ] **Step 5: Clamp at eraser point recording sites**

There are exactly three sites:

1. [main.js:1652](../../../media/main.js#L1652): `eraserPoints.push([x, y]);` → `eraserPoints.push(clampImageCoords(x, y));`
2. [main.js:1658](../../../media/main.js#L1658): `eraserPoints[1] = [x, y];` → `eraserPoints[1] = clampImageCoords(x, y);`
3. [main.js:1923](../../../media/main.js#L1923): `eraserPoints[1] = [x, y];` → `eraserPoints[1] = clampImageCoords(x, y);`

Read-only accesses (`eraserPoints[0]`, `eraserPoints.pop()`, etc.) and `eraserPoints.slice()` at line 2639 do not need changes.

- [ ] **Step 6: Clamp at vertex drag sites in shape edit mode**

In `mousemove` for shape edit mode at [main.js:2376–2392](../../../media/main.js#L2376-L2392), the rectangle vertex special-cases write directly to `shape.points`. Replace:

```js
            if (activeVertexIndex === 0 || activeVertexIndex === 2) {
                // Moving a diagonal corner - straightforward
                if (activeVertexIndex === 0) {
                    shape.points[0] = [x, y];
                } else {
                    shape.points[1] = [x, y];
                }
            } else {
                // Moving non-diagonal corner - need to update both stored points
                const [p1, p2] = shape.points;
                if (activeVertexIndex === 1) {
                    // Top-right: affects p1[1] and p2[0]
                    shape.points = [[p1[0], y], [x, p2[1]]];
                } else {
                    // Bottom-left: affects p1[0] and p2[1]
                    shape.points = [[x, p1[1]], [p2[0], y]];
                }
            }
```

with:

```js
            if (activeVertexIndex === 0 || activeVertexIndex === 2) {
                // Moving a diagonal corner - straightforward
                if (activeVertexIndex === 0) {
                    shape.points[0] = clampImageCoords(x, y);
                } else {
                    shape.points[1] = clampImageCoords(x, y);
                }
            } else {
                // Moving non-diagonal corner - need to update both stored points.
                // Clamp each component independently because we mix x/y from cursor with
                // the orthogonal coord from the existing stored point.
                const [p1, p2] = shape.points;
                const cx = Math.max(0, Math.min(img.width, x));
                const cy = Math.max(0, Math.min(img.height, y));
                if (activeVertexIndex === 1) {
                    // Top-right: affects p1[1] and p2[0]
                    shape.points = [[p1[0], cy], [cx, p2[1]]];
                } else {
                    // Bottom-left: affects p1[0] and p2[1]
                    shape.points = [[cx, p1[1]], [p2[0], cy]];
                }
            }
```

For the polygon/line/point branch at [main.js:2396](../../../media/main.js#L2396):

```js
            shape.points[activeVertexIndex] = [x, y];
```

becomes:

```js
            shape.points[activeVertexIndex] = clampImageCoords(x, y);
```

- [ ] **Step 7: Clamp at the whole-shape drag site**

In [main.js:2365](../../../media/main.js#L2365):

```js
        shape.points = originalEditPoints.map(p => [p[0] + dx, p[1] + dy]);
```

becomes:

```js
        shape.points = originalEditPoints.map(p => clampImageCoords(p[0] + dx, p[1] + dy));
```

Note: clamping per-point during a translate has a UX cost — once a single point hits the edge, the rest of the shape can no longer follow the cursor (the shape "deforms" against the boundary). Spec accepts this: it keeps the saved JSON valid. If users complain, we can revisit and clamp the *delta* instead of each point, but ship clamping-per-point for now.

- [ ] **Step 8: Clamp at SAM prompt sites**

There are exactly two SAM prompt creation sites.

**SAM point prompt** at [main.js:6207](../../../media/main.js#L6207):

```js
                samPrompts.push({ type: 'point', data: [samPendingClick.x, samPendingClick.y], label: label });
```

becomes:

```js
                const [spx, spy] = clampImageCoords(samPendingClick.x, samPendingClick.y);
                samPrompts.push({ type: 'point', data: [spx, spy], label: label });
```

**SAM box (rectangle) prompt** at [main.js:6101](../../../media/main.js#L6101):

```js
        samPrompts = [{ type: 'rectangle', data: [x1, y1, x2, y2] }];
```

Replace the surrounding block ([main.js:6096–6101](../../../media/main.js#L6096-L6101)):

```js
        const x1 = Math.min(samDragStart.x, x);
        const y1 = Math.min(samDragStart.y, y);
        const x2 = Math.max(samDragStart.x, x);
        const y2 = Math.max(samDragStart.y, y);

        samPrompts = [{ type: 'rectangle', data: [x1, y1, x2, y2] }];
```

with:

```js
        // Clamp both corners to image bounds — the cursor may have ended up in the padding ring.
        const [cx, cy] = clampImageCoords(x, y);
        const [csx, csy] = clampImageCoords(samDragStart.x, samDragStart.y);
        const x1 = Math.min(csx, cx);
        const y1 = Math.min(csy, cy);
        const x2 = Math.max(csx, cx);
        const y2 = Math.max(csy, cy);

        samPrompts = [{ type: 'rectangle', data: [x1, y1, x2, y2] }];
```

(The `x`, `y` variables here are the cursor in image space, set at [main.js:6085–6086](../../../media/main.js#L6085-L6086). `samDragStart` is the cursor at the original mousedown — also in image space.)

No other site pushes to `samPrompts` (the file does `samPrompts = [...]` to reset, and `samPrompts = [samPrompts[samPrompts.length - 1]]` to truncate, neither of which introduces new coordinates).

- [ ] **Step 9: Clamp the visual preview lines so they match the click target**

When the cursor sits in the padding ring, the polygon/line preview line (drawn from the last vertex to the cursor) should end at the clamped image-edge position, not at the actual cursor position. Otherwise the user sees a preview pointing into the padding ring but the click lands at the image edge — confusing.

In [main.js:4099–4114](../../../media/main.js#L4099-L4114):

```js
        if (mouseEvent && (currentMode === 'polygon' || currentMode === 'line') && currentPoints.length > 0) {
            const rect = canvas.getBoundingClientRect();
            const mx = (mouseEvent.clientX - rect.left) / zoomLevel;
            const my = (mouseEvent.clientY - rect.top) / zoomLevel;
            const lastPoint = currentPoints[currentPoints.length - 1];

            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', lastPoint[0]);
            line.setAttribute('y1', lastPoint[1]);
            line.setAttribute('x2', mx);
            line.setAttribute('y2', my);
```

becomes:

```js
        if (mouseEvent && (currentMode === 'polygon' || currentMode === 'line') && currentPoints.length > 0) {
            const rect = canvas.getBoundingClientRect();
            const rawMx = (mouseEvent.clientX - rect.left) / zoomLevel;
            const rawMy = (mouseEvent.clientY - rect.top) / zoomLevel;
            const [mx, my] = clampImageCoords(rawMx, rawMy);
            const lastPoint = currentPoints[currentPoints.length - 1];

            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', lastPoint[0]);
            line.setAttribute('y1', lastPoint[1]);
            line.setAttribute('x2', mx);
            line.setAttribute('y2', my);
```

Same change for the eraser preview line at [main.js:4149–4178](../../../media/main.js#L4149-L4178). Replace:

```js
            if (mouseEvent && eraserPoints.length > 0) {
                const rect = canvas.getBoundingClientRect();
                const mx = (mouseEvent.clientX - rect.left) / zoomLevel;
                const my = (mouseEvent.clientY - rect.top) / zoomLevel;
                const lastPoint = eraserPoints[eraserPoints.length - 1];
```

with:

```js
            if (mouseEvent && eraserPoints.length > 0) {
                const rect = canvas.getBoundingClientRect();
                const rawMx = (mouseEvent.clientX - rect.left) / zoomLevel;
                const rawMy = (mouseEvent.clientY - rect.top) / zoomLevel;
                const [mx, my] = clampImageCoords(rawMx, rawMy);
                const lastPoint = eraserPoints[eraserPoints.length - 1];
```

The remaining `mx`, `my` usages in those blocks (line endpoints, closing line, etc.) require no further changes — they all read the now-clamped variables.

- [ ] **Step 10: Manual verify edge clickability**

Reload extension host. Open an image and zoom to ~500% so individual pixels are visible.

Expected for each of the four image edges:
- Scroll the edge into the middle of the viewport. The padding ring shows on the outside, the image on the inside.
- In **rectangle** mode, click and drag from inside the image to a point in the padding ring past the right edge. Release. The rectangle's right edge sits exactly on column `img.width - 1` (or `img.width`, depending on whether the existing code rounds — either is acceptable). Confirm with a label.
- In **polygon** mode, click a vertex inside the image, then click in the padding ring past the bottom edge. The new vertex appears at the image bottom edge, not below it.
- In **point** mode, click in the padding ring past the right edge. The point lands exactly at `x = img.width`.
- Drag an existing rectangle's right-edge handle into the padding ring on the right. The handle clamps to `x = img.width`.
- Move a shape so it would extend past the image edge. The shape clamps so no point goes outside.

Check the underlying coordinates with the existing image-info popup or by inspecting the saved JSON (Save the file and open the .json sidecar). All point coordinates must be inside `[0, img.width] × [0, img.height]`.

- [ ] **Step 11: Commit**

```bash
git add media/main.js
git commit -m "Clamp mouse-derived image coordinates to image bounds

Adds clampImageCoords() and applies it at every site that records a
cursor position as shape data: polygon/line/point/rectangle creation,
rectangle preview, eraser points, vertex drag, shape move, SAM prompts.
With the new padding ring, the cursor can produce coordinates outside
[0, img.width] x [0, img.height]; clamping snaps those to the nearest
edge so edge pixels become reliably clickable while no shape ever
escapes the image bounds."
```

---

## Task 5: Add chip shortcut indices and badge DOM

**Goal:** Each chip in the recent-labels modal carries a 1-based shortcut index (capped at 10) and renders a tiny `<span>` badge that says "1", "2", … "9", "0".

**Files:**
- Modify: `media/main.js` — `renderRecentLabels()` at [main.js:3197–3282](../../../media/main.js#L3197-L3282)

- [ ] **Step 1: Refactor chip creation to assign a global shortcut index**

`renderRecentLabels` currently builds two sections (Current Image, History) and inside each loops over labels and appends chips. Add a single counter shared across both sections and write `data-shortcut-index` plus a badge span on each chip whose index falls in `[1, 10]`.

Replace the function body of `renderRecentLabels()` ([main.js:3197–3282](../../../media/main.js#L3197-L3282)) with:

```js
function renderRecentLabels() {
    recentLabelsDiv.innerHTML = '';

    // 收集当前图片中已有的label，按最近使用顺序排列
    // 通过遍历shapes倒序，第一个出现的label排最前
    const currentImageLabelsOrdered = [];
    for (let i = shapes.length - 1; i >= 0; i--) {
        const label = shapes[i].label;
        if (!currentImageLabelsOrdered.includes(label)) {
            currentImageLabelsOrdered.push(label);
        }
    }

    // 过滤历史标签，排除当前图片中已有的
    const historyLabelsFiltered = recentLabels.filter(label =>
        !currentImageLabelsOrdered.includes(label)
    ).slice(0, 10);

    // Shared 1-based counter across both sections so Alt+1..Alt+9, Alt+0 map to the
    // first 10 chips in the order they appear (Current Image first, then History).
    let chipIndex = 0;

    function buildChip(label, extraClass) {
        chipIndex += 1;
        const chip = document.createElement('div');
        chip.className = 'label-chip' + (extraClass ? ' ' + extraClass : '');
        chip.textContent = label;
        if (chipIndex <= 10) {
            // Visible badge: digits 1..9 then 0 for the 10th, matching the Alt+N keymap.
            const badgeText = chipIndex === 10 ? '0' : String(chipIndex);
            chip.dataset.shortcutIndex = String(chipIndex);
            const badge = document.createElement('span');
            badge.className = 'chip-shortcut-badge';
            badge.textContent = badgeText;
            chip.appendChild(badge);
        }
        chip.onclick = () => {
            labelInput.value = label;
            // Highlight the selected chip (clear ALL sections to avoid cross-section dual highlight)
            recentLabelsDiv.querySelectorAll('.label-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            // Focus description field so user can optionally fill it before confirming
            descriptionInput.focus();
        };
        chip.ondblclick = () => {
            labelInput.value = label;
            confirmLabel();
        };
        return chip;
    }

    // 渲染当前图片标签区域（如果有的话）
    if (currentImageLabelsOrdered.length > 0) {
        const currentSection = document.createElement('div');
        currentSection.className = 'label-section current-labels';

        const currentTitle = document.createElement('div');
        currentTitle.className = 'label-section-title';
        currentTitle.textContent = 'Current Image';
        currentSection.appendChild(currentTitle);

        const currentChips = document.createElement('div');
        currentChips.className = 'label-chips';
        currentImageLabelsOrdered.forEach(label => {
            currentChips.appendChild(buildChip(label, 'current-image-label'));
        });
        currentSection.appendChild(currentChips);
        recentLabelsDiv.appendChild(currentSection);
    }

    // 渲染历史标签区域（如果有的话）
    if (historyLabelsFiltered.length > 0) {
        const historySection = document.createElement('div');
        historySection.className = 'label-section history-labels';

        const historyTitle = document.createElement('div');
        historyTitle.className = 'label-section-title';
        historyTitle.textContent = 'History';
        historySection.appendChild(historyTitle);

        const historyChips = document.createElement('div');
        historyChips.className = 'label-chips';
        historyLabelsFiltered.forEach(label => {
            historyChips.appendChild(buildChip(label, ''));
        });
        historySection.appendChild(historyChips);
        recentLabelsDiv.appendChild(historySection);
    }
}
```

This is a refactor of the same logic; the only behavior changes are: (a) the new `chipIndex` counter, (b) the `data-shortcut-index` attribute, (c) the appended `<span class="chip-shortcut-badge">`. Click and double-click handlers are preserved exactly.

- [ ] **Step 2: Manual verify**

Reload extension host. Open the label modal (e.g., draw a rectangle). Confirm chips render the same as before.

Expected: Chips look identical (no badge visible because Task 6 hasn't added CSS yet for `.chip-shortcut-badge` — the span exists but is unstyled, so it renders as inline text). It's OK that this looks weird during this task; Task 6 fixes presentation.

Open DevTools (F12 in the webview, or "Developer: Open Webview Developer Tools"). Inspect a chip. Confirm `data-shortcut-index` is set on the first 10 chips and the `<span class="chip-shortcut-badge">` child exists.

- [ ] **Step 3: Commit**

```bash
git add media/main.js
git commit -m "Tag chips with shortcut index and badge in label modal

renderRecentLabels now numbers chips globally across Current Image and
History sections (1..10), writes data-shortcut-index to each, and appends
a chip-shortcut-badge span. Click/dblclick behavior is unchanged.
Styling and reveal logic land in subsequent tasks."
```

---

## Task 6: Style the badges and add the reveal class

**Goal:** Badges are hidden by default and visible only when `#recentLabels` carries `.show-shortcuts`. Visual: 16×16 rounded square at the top-left corner of each chip, accent background, white digit.

**Files:**
- Modify: `media/style.css`

- [ ] **Step 1: Add the badge CSS**

In `media/style.css`, find the existing `.label-chip` rule (around [style.css:480](../../../media/style.css#L480)). Add `position: relative` to the existing rule so the absolutely-positioned badge is anchored to the chip:

Replace:

```css
.label-chip {
    background-color: var(--color-bg-input);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--color-border-input);
}
```

with:

```css
.label-chip {
    position: relative;                          /* anchor for shortcut badge */
    background-color: var(--color-bg-input);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--color-border-input);
}
```

Then, immediately after the existing `.label-chip.selected { ... }` rule, append:

```css
.chip-shortcut-badge {
    position: absolute;
    top: -6px;
    left: -6px;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: var(--color-accent);
    color: white;
    font-size: 10px;
    line-height: 16px;
    text-align: center;
    pointer-events: none;
    display: none;
}

#recentLabels.show-shortcuts .chip-shortcut-badge {
    display: block;
}
```

- [ ] **Step 2: Manual verify default state**

Reload extension host. Open the label modal. Chips render normally; no badges visible.

Open DevTools. Toggle the `show-shortcuts` class on `#recentLabels` manually:

```js
document.getElementById('recentLabels').classList.add('show-shortcuts');
```

Expected: Badges appear on the first 10 chips (1..9, then 0). Removing the class hides them again.

- [ ] **Step 3: Commit**

```bash
git add media/style.css
git commit -m "Style chip shortcut badges, hidden by default

Badges only render when #recentLabels has the show-shortcuts class so
they don't clutter the modal during normal mouse-driven use. Position
relative on .label-chip anchors the absolutely-positioned badge."
```

---

## Task 7: Alt+digit keydown handler

**Goal:** While the label modal is open, pressing `Alt+1`..`Alt+9` picks the matching chip's label, calls `confirmLabel()`, and closes the modal. `Alt+0` picks the 10th chip. Other modifiers (Ctrl, Meta, Shift) disable the shortcut.

**Files:**
- Modify: `media/main.js` — add the helper near `confirmLabel()` at [main.js:3284](../../../media/main.js#L3284) and the listener once at startup near other modal handlers

- [ ] **Step 1: Add `pickLabelByShortcut` helper**

In `media/main.js`, immediately after the `confirmLabel` function (right before `modalOkBtn.onclick = confirmLabel;` at [main.js:3359](../../../media/main.js#L3359)), insert:

```js
// Pick the chip with shortcutIndex N, write its label to the input, and confirm.
// Returns true if a chip with that index existed.
function pickLabelByShortcut(index) {
    const chip = recentLabelsDiv.querySelector(`.label-chip[data-shortcut-index="${index}"]`);
    if (!chip) return false;
    // chip.textContent includes the badge digit because the badge is a child <span>.
    // Read the label text from the first text node instead of textContent.
    let labelText = '';
    for (const node of chip.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            labelText += node.textContent;
        }
    }
    labelText = labelText.trim();
    if (!labelText) return false;
    labelInput.value = labelText;
    confirmLabel();
    return true;
}
```

Note: `chip.textContent` would include the badge digit (e.g., "cat1" instead of "cat") because the badge is a child element. The helper reads only direct text node children to avoid that. This depends on the structure built in Task 5: chip's text first, then badge `<span>` appended as a sibling.

- [ ] **Step 2: Add the global keydown listener**

Find the existing global keydown handlers in `media/main.js`. Around [main.js:1232](../../../media/main.js#L1232) there is a comment "Ignore shortcuts if any modal is open" and a check that early-returns. We add **a separate** listener that fires *only* when the label modal is open, so the existing global shortcut path stays unchanged.

Add this listener at module load time. A reasonable home is near the existing modal button bindings, e.g., immediately after the `modalCancelBtn.onclick = ...` binding (search for `modalCancelBtn` to find the spot — or, equivalently, immediately after the `pickLabelByShortcut` definition added in Step 1):

```js
// Alt+1..Alt+9 / Alt+0 selects the corresponding chip in the label modal and confirms.
// Bound on document so it works regardless of which element inside the modal has focus.
document.addEventListener('keydown', (e) => {
    if (labelModal.style.display !== 'flex') return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    const index = e.key === '0' ? 10 : Number(e.key);
    pickLabelByShortcut(index);
});
```

- [ ] **Step 3: Manual verify the shortcut**

Reload extension host. Open an image, draw a rectangle. The label modal opens with at least one history chip if you've labeled before, or zero chips on a fresh extension state. Add a few chips by labeling 2–3 different things first.

Test cases:
- With ≥3 chips, draw another rectangle → modal opens. Press `Alt+2`. Expected: the 2nd chip's label is committed, modal closes, the rectangle is created with that label.
- With ≥10 chips (label 10 different things first), press `Alt+0`. Expected: 10th chip's label commits.
- Press `Alt+5` when only 3 chips exist. Expected: nothing happens (silent no-op), modal stays open.
- Press `Alt+5` with focus inside the description textarea. Expected: still triggers the shortcut, modal closes (per spec, intentional).
- Press `Ctrl+Alt+1`. Expected: shortcut does NOT trigger (Ctrl modifier disqualifies).
- Press `Alt+1` outside any modal. Expected: shortcut does NOT trigger (modal not visible).
- Open batch-rename modal (select multiple shapes, right-click → Rename). Press `Alt+1`. Expected: works the same way, batch rename completes.

- [ ] **Step 4: Commit**

```bash
git add media/main.js
git commit -m "Add Alt+digit shortcut to pick a recent label and confirm

Alt+1..9 maps to chips 1..9 in the label modal, Alt+0 to chip 10.
pickLabelByShortcut reads the chip's label from direct text nodes (so
the badge digit doesn't leak into the value), writes it to the input,
and calls confirmLabel. The keydown listener only fires while
labelModal is visible and rejects other modifier combinations."
```

---

## Task 8: Reveal badges only while Alt is held

**Goal:** Badges become visible the moment the user starts holding Alt (anywhere) while the modal is open, and hide again on release or window blur. The state must not get stuck.

**Files:**
- Modify: `media/main.js` — install/teardown listeners inside `showLabelModal`/`showBatchRenameModal`/`hideLabelModal`

- [ ] **Step 1: Add reveal listener helpers**

In `media/main.js`, near the modal logic (around [main.js:3160–3195](../../../media/main.js#L3160-L3195)), add two helpers and a holder for the bound listeners so they can be removed cleanly:

```js
// Listeners for Alt-press chip badge reveal. Stored so they can be removed in hideLabelModal.
let altRevealListeners = null;

function installAltRevealListeners() {
    if (altRevealListeners) return; // already installed

    const onKeyDown = (e) => {
        // Modifiers other than Alt would mean the user is composing a real shortcut;
        // we only reveal on a pure Alt press.
        if (e.key !== 'Alt') return;
        if (e.repeat) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        recentLabelsDiv.classList.add('show-shortcuts');
    };
    const onKeyUp = (e) => {
        if (e.key !== 'Alt') return;
        recentLabelsDiv.classList.remove('show-shortcuts');
    };
    const onBlur = () => {
        // Covers Alt+Tab while Alt is held: keyup never fires inside this window.
        recentLabelsDiv.classList.remove('show-shortcuts');
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    altRevealListeners = { onKeyDown, onKeyUp, onBlur };
}

function uninstallAltRevealListeners() {
    if (!altRevealListeners) return;
    window.removeEventListener('keydown', altRevealListeners.onKeyDown);
    window.removeEventListener('keyup', altRevealListeners.onKeyUp);
    window.removeEventListener('blur', altRevealListeners.onBlur);
    altRevealListeners = null;
    recentLabelsDiv.classList.remove('show-shortcuts');
}
```

- [ ] **Step 2: Hook into modal open and close**

In `showLabelModal()` ([main.js:3176–3191](../../../media/main.js#L3176-L3191)), at the very end of the function (after `renderRecentLabels()`), add:

```js
    installAltRevealListeners();
```

In `showBatchRenameModal()` ([main.js:3163–3174](../../../media/main.js#L3163-L3174)), at the very end (after `renderRecentLabels()`), add:

```js
    installAltRevealListeners();
```

In `hideLabelModal()` ([main.js:3193–3195](../../../media/main.js#L3193-L3195)):

```js
function hideLabelModal() {
    labelModal.style.display = 'none';
}
```

becomes:

```js
function hideLabelModal() {
    labelModal.style.display = 'none';
    uninstallAltRevealListeners();
}
```

- [ ] **Step 3: Manual verify reveal cycles**

Reload extension host. Open the label modal (draw something).

Test cases:
- Press and hold Alt. Badges (1, 2, 3, …) appear on the first 10 chips.
- Release Alt. Badges disappear.
- Hold Alt, then `Alt+Tab` to another window, then come back to VSCode. Badges should NOT be stuck visible. Pressing/releasing Alt again should toggle correctly.
- Press `Alt+5` (with at least 5 chips). Badges flash visible briefly during the keypress (the user only sees the modal close because confirmLabel runs synchronously); on the next modal open the badges should NOT be stuck.
- Open the batch-rename modal. Hold Alt. Badges appear. Release. Badges disappear. Close the modal. Open the regular modal. Hold Alt. Badges appear. (Confirms listeners are correctly torn down between modal cycles.)

- [ ] **Step 4: Commit**

```bash
git add media/main.js
git commit -m "Reveal chip shortcut badges only while Alt is held

Modal open installs window-level keydown/keyup/blur listeners that
toggle the show-shortcuts class on #recentLabels. Modal close removes
them and clears the class so the next open starts clean. Window blur
covers the Alt+Tab edge case where keyup never fires."
```

---

## Task 9: Final end-to-end verification pass

**Goal:** Run every manual check from the spec's Testing section and confirm nothing regressed.

**Files:** None (verification only)

- [ ] **Step 1: Run the spec's full manual test checklist**

Re-do every check from [docs/superpowers/specs/2026-05-06-edge-clickability-and-label-shortcuts-design.md](../specs/2026-05-06-edge-clickability-and-label-shortcuts-design.md) — section "Testing":

1. Pixel-edge clicks at 1000% zoom on right/top/bottom/left edges.
2. Coordinate clamp when starting a polygon in the padding ring.
3. Zoom anchor: cursor near edge, scroll to zoom — pixel under cursor stays put.
4. Fit-to-screen: small image centered with padding ring fully visible, no scrollbars.
5. Locked view: toggle lock, switch images, saved center stays under viewport center.
6. Label shortcut: open modal with ≥3 chips, press `Alt+2`, second chip commits.
7. Same shortcut works in batch-rename mode.
8. Badge reveal: hold Alt → appear, release → disappear, Alt+Tab → not stuck.
9. No interference: typing letters into the label input behaves normally; `Alt+5` while focus is in the input still triggers shortcut (intentional).

- [ ] **Step 2: Regression spot checks**

Beyond the spec's checklist, also confirm:

- Drawing in the middle of the image still works exactly as before in polygon, line, point, rectangle, eraser, and SAM modes.
- Saving the file produces a valid `.json` sidecar; all point coordinates are inside `[0, img.width] × [0, img.height]`.
- Shape selection by clicking near the edge still selects the correct shape (no click is "lost" in the padding ring against an existing shape's edge).
- Right-click context menu still appears at the cursor position when right-clicking a shape near the edge.
- Image info popup still shows correct width/height after fit-to-screen.

- [ ] **Step 3: If any check fails, file the failure as a single fix commit and re-run**

If a regression appears, prefer minimal fixes that target the specific failure rather than re-architecting. Common likely failures and what to look at:

- Drift after wheel zoom near edge → re-check Task 2 signs (`-PAD` for read, `+PAD` for write).
- Scrollbars at fit-to-screen on small images → re-check Task 3 Step 1: `usableW = w - 2*PAD`.
- Lock-view restore lands off-center → re-check Task 3 Step 3: `+CANVAS_EDGE_PADDING` in `applyNormalizedViewState`.
- Coordinates outside image saved to `.json` → search for any newly-added `.points.push([x, y])` or `currentPoints[N] = [x, y]` site that was missed in Task 4.
- Badges leak into chip's commit text (e.g., label is "cat1" instead of "cat") → re-check Task 7 Step 1: `pickLabelByShortcut` reads only `Node.TEXT_NODE` children.
- Alt+digit doesn't fire when description textarea has focus → confirm the listener is on `document` (or `window`), not on `labelInput`.
- Stuck badges after Alt+Tab → confirm Task 8 includes the `window.blur` listener and the cleanup in `hideLabelModal`.

- [ ] **Step 4: Final commit if any fixes were needed**

If Step 3 produced fixes, commit them with a focused message:

```bash
git add media/main.js media/style.css
git commit -m "Fix <specific regression> in <task name>"
```

If no fixes were needed, no commit here. The feature is ready.
