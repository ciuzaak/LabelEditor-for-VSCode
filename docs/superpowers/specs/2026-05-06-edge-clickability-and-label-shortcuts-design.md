# Edge clickability & label shortcut keys — design

Date: 2026-05-06

## Problems

1. **Edge pixels are hard to click.** Mouse listeners are bound to `canvasWrapper`, whose width/height equal the image's display size (`img.width * zoomLevel`). When the cursor moves a pixel past the image edge it leaves the wrapper, no event fires, and the user cannot reliably click the outermost row/column of pixels.
2. **Label modal requires the mouse.** Picking a recent label means clicking a chip and (optionally) confirming. There is no keyboard shortcut, so a fast workflow keeps switching hand position.

## Solution overview

Three localized changes — none of them rewrite the canvas or modal architecture.

- Add a small fixed padding around the image inside `canvasWrapper`, with mouse coordinates clamped to image bounds. Cursor can freely overshoot the image edge by up to the padding amount.
- Bind `Alt+1`..`Alt+9` and `Alt+0` to the first ten label chips in the modal. Pressing one writes the label, calls `confirmLabel()`, and closes the modal.
- Show a small "1" / "2" / … shortcut badge on each chip only while the user is holding `Alt`.

## 1. Canvas edge padding

### Constant

```js
const CANVAS_EDGE_PADDING = 40; // px in CSS pixels, independent of zoomLevel
```

A single named constant in `main.js` so the value is easy to tune later.

### DOM / layout

Layout chain stays `.canvas-container` (scroll viewport) → `#canvasWrapper` → `<canvas>` + `<svg>`. Changes:

- `canvasWrapper` gets `position: relative` and a 40 px padding on all sides via inline style (so its size can be recomputed dynamically together with image size). Its width and height become `displayWidth + 2 * PAD` and `displayHeight + 2 * PAD`.
- `canvas` and `svgOverlay` stay sized to `displayWidth` × `displayHeight`. They are positioned with `position: absolute; left: PAD; top: PAD;` so the visible image rectangle is offset by `PAD` from the wrapper origin.
- The padding region renders with `background: var(--color-bg-primary)` (already defined in [style.css:4](media/style.css#L4) and the light-theme block at [style.css:30](media/style.css#L30)) so it adapts to dark/light themes and the boundary against the image is obvious without being visually loud.

All zoom and resize paths that currently set `canvasWrapper.style.width / height` (around [main.js:2090–2103](media/main.js#L2090-L2103) and [main.js:828–832](media/main.js#L828-L832)) are updated to add `2 * PAD` on each axis. SVG overlay sizing is unaffected.

### Coordinate transform

All mouse-to-image conversions in `main.js` currently look like:

```js
const imageX = (scrollLeft + mouseX) / zoomLevel;
const imageY = (scrollTop + mouseY) / zoomLevel;
```

(see [main.js:2069–2070](media/main.js#L2069-L2070) and the per-event handlers in mousedown/mousemove/mouseup on `canvasWrapper`).

These become:

```js
const imageX = clamp((scrollLeft + mouseX - PAD) / zoomLevel, 0, img.width);
const imageY = clamp((scrollTop + mouseY - PAD) / zoomLevel, 0, img.height);
```

Centralized in a small helper:

```js
function clientToImageCoords(e) {
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const ix = (canvasContainer.scrollLeft + mouseX - CANVAS_EDGE_PADDING) / zoomLevel;
    const iy = (canvasContainer.scrollTop + mouseY - CANVAS_EDGE_PADDING) / zoomLevel;
    return {
        x: Math.max(0, Math.min(img.width, ix)),
        y: Math.max(0, Math.min(img.height, iy)),
    };
}
```

All event handlers that compute image-space coordinates from a mouse event are migrated to call this helper. Two consequences:

- Cursor in the padding ring still produces valid `(x, y)` clamped to the image edge. Drawing rectangles, polygons, points, lines, SAM prompts, vertex drag, shape move — all benefit.
- Code paths that previously rounded or floored image coordinates need no change; they keep operating on the same range as before.

### Zoom anchor

The wheel-zoom handler in [main.js:2049–2138](media/main.js#L2049-L2138) recomputes `scrollLeft / scrollTop` so the same image point stays under the cursor. Because the new transform shifts everything by `PAD`, the inverse `newScrollLeft = imageX * zoomLevel - mouseX` becomes `newScrollLeft = imageX * zoomLevel + PAD - mouseX` (and likewise for Y). Without this fix, zooming near an edge would visibly drift.

### Fit-to-screen and centering

Two adjustments:

1. **`calculateFitToScreenZoom`** computes the zoom that fits the image inside the viewport. With padding, the image's effective drawable area is the viewport minus `2 * PAD` on each axis. Update the formula so the fitted image plus its padding ring still fits without scrollbars:

   ```js
   const fitW = (viewportW - 2 * CANVAS_EDGE_PADDING) / img.width;
   const fitH = (viewportH - 2 * CANVAS_EDGE_PADDING) / img.height;
   return Math.min(fitW, fitH) * ZOOM_FIT_RATIO;
   ```

   The visual effect: a small image at fit-to-screen is up to ~6–8% smaller than today on a typical viewport. Acceptable trade-off; the alternative is scrollbars appearing at fit-to-screen, which is worse.

2. **Centering scroll**. Anywhere we set `scrollLeft = imageX * zoomLevel - viewportW / 2` to center an image point ([main.js:506–510](media/main.js#L506-L510), [main.js:789–798](media/main.js#L789-L798), and similar), add `+PAD`:

   ```js
   const scrollX = imageX * zoomLevel + CANVAS_EDGE_PADDING - viewportW / 2;
   const scrollY = imageY * zoomLevel + CANVAS_EDGE_PADDING - viewportH / 2;
   ```

   This compensates for the image being offset inside the wrapper by `PAD`. Audit every site that computes a scroll position from an image coordinate (locked-view restore, "go to shape" if any, fit-to-screen reset) and apply the offset consistently.

## 2. Alt+digit selects a label and confirms

### Key bindings

- `Alt+1` … `Alt+9` → chips 1..9
- `Alt+0` → chip 10
- All other keys are unchanged.

### Chip ordering

Chips are numbered globally in the order `renderRecentLabels()` produces them: first all Current-Image chips (in the existing reverse-of-shape iteration), then all History chips. If there are fewer than `N` chips, `Alt+N` is a no-op (silently ignored, no error feedback).

### Implementation

In `renderRecentLabels()` ([main.js:3197–3282](media/main.js#L3197-L3282)) every chip element gets `data-shortcut-index` set to its 1-based global position when that position is in `[1..10]`. A new function:

```js
function pickLabelByShortcut(index) {
    const chip = recentLabelsDiv.querySelector(`.label-chip[data-shortcut-index="${index}"]`);
    if (!chip) return false;
    labelInput.value = chip.textContent;
    confirmLabel();
    return true;
}
```

A `keydown` listener on `document` is added once at startup but does work only when the modal is visible:

```js
document.addEventListener('keydown', (e) => {
    if (labelModal.style.display !== 'flex') return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    const index = e.key === '0' ? 10 : Number(e.key);
    pickLabelByShortcut(index);
});
```

Notes:
- `e.preventDefault()` blocks the browser/host default for `Alt+digit` (menu mnemonic activation, etc.) inside the webview.
- The shortcut applies in all three contexts that share the modal (new-shape, edit-existing, batch rename) because they all call `showLabelModal` / `showBatchRenameModal` and toggle the same `labelModal.style.display`.
- `confirmLabel()` already handles MRU update, dirty marking, history save, and modal close — no duplication needed.
- The shortcut intentionally bypasses the description field. Users who need a description still use mouse / keyboard the existing way.

## 3. Alt-pressed reveals chip shortcut badges

### DOM

In `renderRecentLabels()`, when a chip gets `data-shortcut-index = N`, also append a child:

```html
<span class="chip-shortcut-badge">N</span>
```

(Use `0` as the visible label for index 10, matching the `Alt+0` keybinding.)

### CSS

```css
.label-chip { position: relative; }
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
#recentLabels.show-shortcuts .chip-shortcut-badge { display: block; }
```

### Reveal logic

While `labelModal` is open, listen on `window`:

- `keydown` with `e.key === 'Alt'` and `!e.repeat` → `recentLabelsDiv.classList.add('show-shortcuts')`
- `keyup` with `e.key === 'Alt'` → `recentLabelsDiv.classList.remove('show-shortcuts')`
- `window.blur` → also remove the class (covers the case where the user `Alt+Tab`s away while holding Alt; otherwise the badges would stick on next focus)

`showLabelModal` / `showBatchRenameModal` install these listeners; `hideLabelModal` removes them. The class is also force-removed on hide so the next open starts clean.

## Out of scope

- Allowing annotation points outside the image (negative coordinates / coordinates beyond `img.width`). The clamp keeps shapes inside image bounds, matching LabelMe / COCO conventions.
- Auto-pan when cursor approaches viewport edge during a drag. Padding plus existing scroll covers the practical cases without adding state.
- Configurable padding amount in settings. The constant is one line and rebuilding the extension is cheap.
- Configurable shortcut keymap. Alt+digit is a fixed convention.

## Testing

Manual checks (no automated UI test harness exists in this repo):

1. Pixel-edge clicks
   - Open an image, zoom to 1000%, scroll the right edge of the image to the middle of the viewport.
   - Draw a rectangle whose right edge is on the last column of image pixels. Confirm the recorded coordinate is exactly `img.width`.
   - Repeat for top, bottom, left edges.
2. Coordinate clamp
   - Start a polygon, click in the padding ring outside the image. The vertex should land on the image boundary, not at a negative coordinate.
3. Zoom anchor
   - Place cursor near (but not on) the image edge, scroll to zoom in/out. The pixel under the cursor should not drift.
4. Fit-to-screen
   - Open a small image. It should appear centered with the padding ring fully visible around it.
5. Locked view
   - Toggle lock view, switch images. The saved center should still produce a centered display.
6. Label shortcut
   - Open the modal with at least 3 recent labels. Press `Alt+2`. The second chip's label is committed, the modal closes, the shape is created.
   - Same test in batch-rename mode.
7. Badge reveal
   - Open modal. Press and hold Alt. Badges appear. Release. Badges disappear.
   - Hold Alt, then `Alt+Tab` to another window. Switch back. Badges should not be stuck.
8. No interference
   - Type a normal letter into the label input. No modal-confirm side effect. Press `Alt+5` while focus is in the input — still triggers the shortcut (this is intentional).
