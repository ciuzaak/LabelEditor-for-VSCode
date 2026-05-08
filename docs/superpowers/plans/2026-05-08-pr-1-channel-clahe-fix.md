# PR #1 Channel + CLAHE Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land PR #1's RGB channel + CLAHE feature on a local `pr-1-fixed` branch with the algorithm rewritten to be correct (YCbCr-luminance, proper tile sizing, float clip threshold) and cached so it doesn't reprocess on every mouse move.

**Architecture:** Three changes in two files — `src/LabelMePanel.ts` hygiene (revert dead try/catch, JSON.stringify for `selectedChannel`), then `media/main.js` gets a module-level offscreen-canvas cache and a rewritten CLAHE that runs in YCbCr Y-plane with an 8×8 tile grid sized adaptively to the image.

**Tech Stack:** Plain JS (webview), TypeScript (extension host). No new deps. node:test for the existing utils suite (untouched).

**Spec:** [`docs/superpowers/specs/2026-05-08-pr-1-channel-clahe-fix-design.md`](../specs/2026-05-08-pr-1-channel-clahe-fix-design.md)

---

## File Structure

| Path | Action | Responsibility |
|------|--------|---------------|
| `src/LabelMePanel.ts` | Modify | Revert icon try/catch; switch `selectedChannel` to `JSON.stringify` |
| `media/main.js` | Modify | Replace `applyChannelAndClahe`/`applyClahe` with cached YCbCr CLAHE; integrate cache into `draw()` |

No new files.

---

### Task 1: Hygiene fixes in `src/LabelMePanel.ts`

**Files:**
- Modify: `src/LabelMePanel.ts:218-223` (icon block) and `src/LabelMePanel.ts:1019` (selectedChannel template)

- [ ] **Step 1: Revert the icon try/catch to a single line**

In `src/LabelMePanel.ts`, replace the block at lines 218-223:

```typescript
        // Set panel icon - use fallback if icon.png doesn't exist
        try {
            this._panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');
        } catch (e) {
            console.warn('Icon file not found, using default', e);
        }
```

with:

```typescript
        // Set panel icon
        this._panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');
```

(`vscode.Uri.joinPath` does not throw on missing files — it just constructs a URI — so the try/catch was dead.)

- [ ] **Step 2: Switch `selectedChannel` template to JSON.stringify**

In `src/LabelMePanel.ts:1019`, replace:

```typescript
                        selectedChannel: "${this._globalState.get('selectedChannel') ?? 'rgb'}",
```

with:

```typescript
                        selectedChannel: ${JSON.stringify(this._globalState.get('selectedChannel') ?? 'rgb')},
```

(Matches the `onnxColor` / `onnxMode` siblings further down in the same template literal.)

- [ ] **Step 3: Compile TypeScript**

Run: `npm run compile`
Expected: exits 0, no errors.

- [ ] **Step 4: Run existing tests**

Run: `npm test`
Expected: 5 tests pass (matches baseline).

- [ ] **Step 5: Commit**

```bash
git add src/LabelMePanel.ts
git commit -m "Drop dead icon try/catch and JSON-encode selectedChannel template"
```

---

### Task 2: Rewrite CLAHE in `media/main.js` with YCbCr + cache

**Files:**
- Modify: `media/main.js` — three regions: cache state declaration (~line 225), `draw()` integration (~line 4124), `applyChannelAndClahe`/`applyClahe` replacement (~lines 4923-5086)

- [ ] **Step 1: Add cache state declarations**

Find the existing CLAHE state block in `media/main.js`:

```javascript
// CLAHE settings
let claheEnabled = false;    // CLAHE enabled/disabled
let claheClipLimit = 2.0;    // CLAHE clip limit parameter
let claheLocked = false;     // 锁定CLAHE：切换图片时保留
```

Append immediately after it:

```javascript
// Processed-image cache for channel selection / CLAHE.
// Key encodes the inputs that affect output; cache hit avoids reprocessing on every draw().
let processedCanvas = null;
let processedKey = '';
```

- [ ] **Step 2: Replace `applyChannelAndClahe` and `applyClahe`**

Locate the two functions in `media/main.js` (between `applyImageAdjust`/`updateBrightnessResetBtn`, currently lines ~4923-5086). Replace the entire range — both functions and their preceding comments — with:

```javascript
// Render channel-selected and/or CLAHE-processed image into the cached offscreen canvas.
// Returns the cached canvas, or null if the source image is not ready.
// CLAHE runs in YCbCr space on the Y plane only, so colors are preserved.
function getProcessedCanvas() {
    if (!img.src || !img.complete || !img.width || !img.height) return null;

    const w = img.width;
    const h = img.height;
    const key = img.src + '|' + selectedChannel + '|' + claheEnabled + '|' + claheClipLimit + '|' + w + 'x' + h;
    if (processedCanvas && key === processedKey) return processedCanvas;

    if (!processedCanvas) {
        processedCanvas = document.createElement('canvas');
    }
    if (processedCanvas.width !== w || processedCanvas.height !== h) {
        processedCanvas.width = w;
        processedCanvas.height = h;
    }
    const pCtx = processedCanvas.getContext('2d');
    pCtx.drawImage(img, 0, 0, w, h);
    const imageData = pCtx.getImageData(0, 0, w, h);
    const data = imageData.data;

    if (selectedChannel !== 'rgb') {
        const offset = selectedChannel === 'r' ? 0 : selectedChannel === 'g' ? 1 : 2;
        for (let i = 0; i < data.length; i += 4) {
            const v = data[i + offset];
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
        }
    }

    if (claheEnabled) {
        applyClaheYCbCr(data, w, h, claheClipLimit);
    }

    pCtx.putImageData(imageData, 0, 0);
    processedKey = key;
    return processedCanvas;
}

// CLAHE in YCbCr (Rec.601). Equalizes Y; Cb/Cr pass through. In-place on `data` (RGBA).
function applyClaheYCbCr(data, width, height, clipLimit) {
    const n = width * height;
    const y = new Uint8Array(n);
    const cb = new Uint8Array(n);
    const cr = new Uint8Array(n);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        y[p]  = Math.round( 0.299 * r + 0.587 * g + 0.114 * b);
        cb[p] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5      * b);
        cr[p] = Math.round(128 + 0.5      * r - 0.418688 * g - 0.081312 * b);
    }

    claheOnPlane(y, width, height, clipLimit);

    for (let p = 0, i = 0; p < n; p++, i += 4) {
        const Y  = y[p];
        const Cb = cb[p] - 128;
        const Cr = cr[p] - 128;
        const r = Y + 1.402 * Cr;
        const g = Y - 0.344136 * Cb - 0.714136 * Cr;
        const b = Y + 1.772 * Cb;
        data[i]     = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    }
}

// CLAHE on a single 8-bit plane. 8x8 tile grid sized adaptively to the plane.
// Float clip threshold avoids the floor-to-zero collapse seen in the source PR.
function claheOnPlane(plane, width, height, clipLimit) {
    const tilesX = 8;
    const tilesY = 8;
    const tileW = Math.ceil(width / tilesX);
    const tileH = Math.ceil(height / tilesY);

    const cdfs = new Array(tilesX * tilesY);

    for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
            const startX = tx * tileW;
            const startY = ty * tileH;
            const endX = Math.min(startX + tileW, width);
            const endY = Math.min(startY + tileH, height);
            const tilePixels = (endX - startX) * (endY - startY);

            const hist = new Uint32Array(256);
            for (let py = startY; py < endY; py++) {
                const row = py * width;
                for (let px = startX; px < endX; px++) {
                    hist[plane[row + px]]++;
                }
            }

            const clipThreshold = clipLimit * tilePixels / 256;
            let excess = 0;
            for (let i = 0; i < 256; i++) {
                if (hist[i] > clipThreshold) {
                    excess += hist[i] - clipThreshold;
                    hist[i] = clipThreshold;
                }
            }
            const redistribution = excess / 256;

            const cdf = new Uint8Array(256);
            let acc = 0;
            const scale = 255 / tilePixels;
            for (let i = 0; i < 256; i++) {
                acc += hist[i] + redistribution;
                let v = Math.round(acc * scale);
                if (v > 255) v = 255;
                cdf[i] = v;
            }
            cdfs[ty * tilesX + tx] = cdf;
        }
    }

    // Bilinear interpolation between the 4 surrounding tile CDFs.
    // fx/fy are the pixel position in tile-center coordinates, clamped to the valid range
    // so that edge / corner pixels collapse to a single CDF without reaching across the boundary.
    for (let py = 0; py < height; py++) {
        const row = py * width;
        const rawFy = (py + 0.5) / tileH - 0.5;
        const fy = rawFy < 0 ? 0 : rawFy > tilesY - 1 ? tilesY - 1 : rawFy;
        const ty1 = Math.floor(fy);
        const ty2 = ty1 + 1 > tilesY - 1 ? tilesY - 1 : ty1 + 1;
        const dy = fy - ty1;

        for (let px = 0; px < width; px++) {
            const rawFx = (px + 0.5) / tileW - 0.5;
            const fx = rawFx < 0 ? 0 : rawFx > tilesX - 1 ? tilesX - 1 : rawFx;
            const tx1 = Math.floor(fx);
            const tx2 = tx1 + 1 > tilesX - 1 ? tilesX - 1 : tx1 + 1;
            const dx = fx - tx1;

            const v = plane[row + px];
            const v11 = cdfs[ty1 * tilesX + tx1][v];
            const v12 = cdfs[ty1 * tilesX + tx2][v];
            const v21 = cdfs[ty2 * tilesX + tx1][v];
            const v22 = cdfs[ty2 * tilesX + tx2][v];

            const top = v11 * (1 - dx) + v12 * dx;
            const bot = v21 * (1 - dx) + v22 * dx;
            plane[row + px] = Math.round(top * (1 - dy) + bot * dy);
        }
    }
}
```

- [ ] **Step 3: Wire `draw()` to use the cache**

Find the `draw()` function (currently around line 4124). Replace its current top:

```javascript
function draw(mouseEvent) {
    // Canvas只绘制图片
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Apply channel selection and CLAHE processing
    if (selectedChannel !== 'rgb' || claheEnabled) {
        applyChannelAndClahe();
    } else {
        ctx.drawImage(img, 0, 0, img.width, img.height);
    }

    // SVG绘制标注
    drawSVGAnnotations(mouseEvent);
```

with:

```javascript
function draw(mouseEvent) {
    // Canvas只绘制图片
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const needsProcessing = selectedChannel !== 'rgb' || claheEnabled;
    const source = needsProcessing ? getProcessedCanvas() : null;
    if (source) {
        ctx.drawImage(source, 0, 0, img.width, img.height);
    } else {
        ctx.drawImage(img, 0, 0, img.width, img.height);
    }

    // SVG绘制标注
    drawSVGAnnotations(mouseEvent);
```

(If `getProcessedCanvas()` returns `null` because the image isn't ready yet, fall back to drawing the raw `img` — same as before.)

- [ ] **Step 4: Compile TypeScript**

Run: `npm run compile`
Expected: exits 0 (no TS files changed in this task, but make sure nothing broke).

- [ ] **Step 5: Run existing tests**

Run: `npm test`
Expected: 5 tests pass.

- [ ] **Step 6: Sanity-check the diff**

Run: `git diff --stat media/main.js`
Expected: a single file modified, net change roughly -160 / +180 lines (replacing two functions, adding two new helpers, two cache state lines, draw() rewire). No unrelated edits.

Run: `git diff media/main.js | grep -E "^[+-]" | grep -v "^[+-][+-][+-]" | wc -l`
Just inspect to make sure changes are localized to the targeted regions.

- [ ] **Step 7: Commit**

```bash
git add media/main.js
git commit -m "Rewrite CLAHE in YCbCr, add offscreen-canvas cache for processed image"
```

---

### Task 3: Final verification

**Files:** None modified.

- [ ] **Step 1: Re-run full test suite**

Run: `npm test`
Expected: all 5 tests pass.

- [ ] **Step 2: Re-run TypeScript compile**

Run: `npm run compile`
Expected: exits 0, no errors.

- [ ] **Step 3: Inspect the cumulative diff against `main`**

Run: `git diff main -- src/LabelMePanel.ts media/main.js | wc -l`
Read the output of `git diff main -- src/LabelMePanel.ts media/main.js` and verify:
- Three logical changes in `src/LabelMePanel.ts` (icon line, selectedChannel template — and the original PR additions for new globalState fields, which we keep)
- `media/main.js` adds cache state, replaces algorithm, rewires draw(); CLAHE/channel UI handlers from the original PR are preserved
- No edits outside the planned regions

- [ ] **Step 4: Note manual verification needed**

Manual testing requires running the extension in VSCode (Extension Development Host). Document in the final report to the user that the following should be checked manually:
1. Open a workspace with images, open the editor.
2. Toggle each channel (R/G/B/RGB) — image visibly changes.
3. Drag the CLAHE clip-limit slider with default value (2.0) — image gets enhanced, NOT garbage. (This is the regression that proves bug #1 is fixed.)
4. With CLAHE on, draw a rectangle — interaction stays smooth, no per-frame stutter. (This proves bug #2 is fixed.)
5. With CLAHE on a colorful image, confirm colors are preserved (no greyish wash). (This proves bug #3 is fixed.)
6. Switch images with channel/CLAHE locked vs unlocked — original PR's lock semantics still work.

- [ ] **Step 5: Final summary commit (if needed)**

If the cumulative diff in step 3 shows anything unintended, fix and commit. Otherwise skip — no commit needed.
