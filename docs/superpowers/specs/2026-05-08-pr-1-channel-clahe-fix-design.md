# PR #1 Channel + CLAHE Fix — Design

**Date**: 2026-05-08
**Branch**: `pr-1-fixed` (off `pull/1/head`)
**Source PR**: lizongnan:main → main, "Add RGB channel selection and CLAHE image enhancement features"

## Goal

Take the RGB channel selection + CLAHE feature from PR #1 and produce a locally-merged version that ships only after fixing two correctness/performance issues that make the PR unmergeable as-is, plus minor code-hygiene fixes. Do not approve the GitHub PR.

## What's wrong with the PR (the things this fix addresses)

1. **CLAHE clip threshold collapses to 0 with default parameters.** With `tileSize = 8` and `clipLimit = 2.0`, `Math.floor(2.0 * 8 * 8 / 256) = 0`. Every histogram bin gets clipped to 0; the algorithm produces garbage output with the default slider position.

2. **Performance: full-image CLAHE runs on every `draw()` call.** `draw()` is invoked from many mouse-move handlers ([media/main.js:1937](../../../media/main.js#L1937), [1951](../../../media/main.js#L1951), [1961](../../../media/main.js#L1961), [1976](../../../media/main.js#L1976), [1997](../../../media/main.js#L1997) etc.). With CLAHE enabled, each mouse move triggers `getImageData` + per-pixel histogram + per-pixel bilinear interpolation. Annotation interaction becomes unusable on large images.

3. **CLAHE re-applied to RGB via grayscale ratio causes color shift** ([media/main.js:5079](../../../media/main.js#L5079) — `ratio = newGray / (grayValue + 1)`). Saturated pixels get clipped, dark pixels get a `+1` bias.

4. **Unrelated try/catch on icon path** ([src/LabelMePanel.ts:218-223](../../../src/LabelMePanel.ts#L218-L223)). `vscode.Uri.joinPath` does not throw on missing files; the try/catch is dead code.

5. **`selectedChannel` interpolated raw into HTML template** ([src/LabelMePanel.ts:1019](../../../src/LabelMePanel.ts#L1019)). Inconsistent with sibling fields that use `JSON.stringify`.

## Non-goals

- Not changing PR's UI labels, slider ranges, or globalState field names (no breaking change to anyone who has already pulled the PR locally).
- Not adding a Web Worker, build step for `media/`, or new JS file in `media/`.
- Not adding webview unit tests (matches current state — `media/main.js` has none).
- Not refactoring brightness/contrast (already uses CSS `filter`, works).
- Not touching SAM/ONNX code paths.

## Design

### File touch list

- `media/main.js` — rewrite `applyChannelAndClahe` and `applyClahe`, add module-level cache, rename to match repo conventions, drop verbose WHAT comments
- `src/LabelMePanel.ts` — revert icon try/catch to single line; switch `selectedChannel` to `JSON.stringify`

No new files.

### CLAHE algorithm rewrite

**Tile sizing.** Fixed grid of 8×8 tiles (64 tiles total). Each tile is `tileW = ceil(width / 8)` pixels wide and `tileH = ceil(height / 8)` pixels tall. This matches OpenCV's `createCLAHE` default `tileGridSize=(8,8)` and guarantees enough pixels per tile for a meaningful histogram on any reasonable image (a 256×256 image puts 32×32 = 1024 pixels in each tile).

**Clip threshold.** Compute `clipThreshold = clipLimit * tilePixelCount / 256` as a plain `Number` (no `Math.floor`). Slider range stays `[1, 10]`, default `2.0`. With the new tile size on a 1024×768 image, threshold = `2.0 * (128*96) / 256 = 96` — sensible.

**Color space.** Convert RGB → YCbCr ([JFIF / Rec.601](https://en.wikipedia.org/wiki/YCbCr#JPEG_conversion)):

```
Y  =       0.299 R + 0.587 G + 0.114 B
Cb = 128 - 0.168736 R - 0.331264 G + 0.5 B
Cr = 128 + 0.5 R - 0.418688 G - 0.081312 B
```

Apply CLAHE to Y only. Cb and Cr pass through. Convert back:

```
R = Y                           + 1.402   (Cr - 128)
G = Y - 0.344136 (Cb - 128)     - 0.714136 (Cr - 128)
B = Y + 1.772   (Cb - 128)
```

Both maps clamp to `[0, 255]`. This eliminates the ratio-based hack and preserves saturation.

**Bilinear interpolation between 4-tile neighborhood.** Keep PR's existing structure here — it's correct. Only the histogram clip and tile sizing change.

### Channel selection

Unchanged in semantics: when `selectedChannel ∈ {r, g, b}`, replicate the picked channel to all three RGB outputs to render as grayscale. When channel is selected AND CLAHE is enabled, channel selection runs first (output is grayscale), then CLAHE on the Y channel of that grayscale (Y == R == G == B, so CLAHE's effect is identical to running on the channel directly).

### Caching strategy

Module-level state (top of `media/main.js`, near the existing `brightness`/`contrast` declarations):

```js
let processedCanvas = null;
let processedKey = '';
```

`getProcessedCanvas()`:

1. Compute `key = img.src + '|' + selectedChannel + '|' + claheEnabled + '|' + claheClipLimit`.
2. If `key === processedKey && processedCanvas`, return `processedCanvas`.
3. Otherwise: lazy-create `processedCanvas` (with current `img.width`/`img.height`), run RGB→YCbCr → CLAHE on Y → YCbCr→RGB, write to canvas, update `processedKey = key`.

`draw()`:

```js
const source = (selectedChannel !== 'rgb' || claheEnabled) ? getProcessedCanvas() : img;
ctx.drawImage(source, 0, 0, img.width, img.height);
```

Mouse moves keep the same key → cache hit → just one `drawImage`. Settings change or image switch → key mismatch → one re-process.

**Invalidation:** automatic via key. No explicit invalidation needed when switching images (`img.src` changes), changing channel, toggling CLAHE, or moving the clip slider.

### Minor fixes

- **`src/LabelMePanel.ts:218-223`** — restore `this._panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');`
- **`src/LabelMePanel.ts:1019`** — `selectedChannel: ${JSON.stringify(this._globalState.get('selectedChannel') ?? 'rgb')},` (follows the `onnxColor` / `onnxMode` pattern in the same template; `theme` is the only string field that doesn't use `JSON.stringify`, and that's a minor inconsistency we don't widen)

## Verification

- `npm run compile` — TypeScript build passes
- `npm test` — 11 existing utils tests pass
- Manual: load a workspace, open editor, toggle each channel, enable CLAHE at default + max clip, confirm:
  - default CLAHE produces a visibly enhanced (not garbage) image
  - dragging a polygon point with CLAHE on stays smooth (no per-frame reprocessing)
  - color saturation preserved when CLAHE on (no greyish wash)
  - switching images resets channel/CLAHE per the existing lock-button rules

## Risks

- **YCbCr conversion arithmetic**: small chance of off-by-one rounding causing tests to differ from PR's grayscale-ratio output; not a correctness issue, but a behavior change. Mitigated by clamping to `[0, 255]`.
- **Cache key staleness on `img.src` reuse**: if the same URL points to a changed file, key won't catch it. In practice the extension uses webview URIs that include version-busting paths; not a real concern.
- **Memory footprint**: one extra full-resolution offscreen canvas per panel. For a 4K image that's ~32 MB. Acceptable for an annotation tool.

## Out of scope (explicitly)

- Web Worker offload
- Pure-function extraction + unit tests for CLAHE
- UI changes (label rewording, slider range tuning)
- brightness/contrast unification with CLAHE
- Performance below cache-hit threshold (the 100 ms or so for a 1080p first-process is acceptable)
