# Implementation Plan — Export to COCO / YOLO

**Spec:** [`2026-05-15-export-coco-yolo-design.md`](../specs/2026-05-15-export-coco-yolo-design.md)

## Step 1 — `src/exportFormats.ts` (new, pure)

Functions exported:
- `polygonAabb(points)` → `{x, y, w, h}`.
- `polygonArea(points)` — shoelace; absolute value.
- `polygonizeCircle(center, edge, segments=32)` — same as the circle-shapes helper, duplicated here so this module has no webview dependency.
- `shapeToCocoBbox(shape)` — wraps the above.
- `shapeToCocoSegmentation(shape)` — flat ring `[x1,y1,...]` for polygon/rectangle/circle; returns `null` for point/linestrip.
- `buildCocoDocument(images, classes)` — returns the JS object; caller `JSON.stringify`s.
- `buildYoloBboxLines(image, classes)` → string with `\n` terminators; empty if no convertible shapes.
- `buildYoloSegLines(image, classes)` → string.
- `buildClassesTxt(classes)` → string.

ES2018+ TypeScript; no runtime deps.

## Step 2 — `src/labelMeUtils.ts` — `getImageDimensions(filePath)`

Best-effort dimension probe used as a fallback when an image's `.json` has no `imageWidth/Height`:
- PNG: read IHDR (4-byte width @ 16, 4-byte height @ 20).
- JPEG: scan for the first SOF marker (existing JPEG parser already iterates markers; extract `samples_per_line` and `number_of_lines` at SOF).
- BMP: width/height in the DIB header.
- Falls back to `(0, 0)` (caller treats as skip-with-warning).

Extracted from the existing `getImageMetadata` parsers (refactor: pull the dimension reads into shared sub-helpers; do not duplicate).

## Step 3 — `src/LabelMePanel.ts`

### Message handlers
- `exportDatasetPrepare` → scan `.json` files for the current scope and reply with `{ images: ExportImage[], detectedClasses: string[] }`.
- `browseExportOutputDir` → folder picker; reply `{ value }`.
- `exportDatasetRun` → run conversion; write files; reply `{ ok, written, skipped, error? }`.

### Scope resolution
- `scope === 'all'` → use `this._workspaceImages` (already maintained).
- `scope === 'current'` → just the current image.

### Reading per-image annotations
For each image:
1. Resolve sibling `.json` path (`replace extension`).
2. If exists, parse; collect `shapes`, prefer `imageWidth/Height` from JSON.
3. Else fall back to `getImageDimensions(imagePath)` and `shapes: []`.

### Writing output
- COCO: `fs.writeFile(path.join(outDir, 'annotations.json'), JSON.stringify(doc))`.
- YOLO: per image `fs.writeFile(path.join(outDir, basenameWithoutExt + '.txt'), lines)`; plus `classes.txt`.
- For YOLO basename collisions across nested folders, maintain a `Map<basename, number>` and suffix `_2`, `_3`, …; record renames in the response so the webview can surface the warning.

### Errors
- Wrap each per-image conversion in try/catch — failures are tallied as "skipped" with the error in a `warnings` array. Run continues for the rest.

## Step 4 — HTML scaffold (`LabelMePanel.ts`)

Add a new modal `#exportDatasetModal`:
- Format radio (coco / yolo-bbox / yolo-seg).
- Scope radio (all / current).
- Output dir text + browse button.
- Class list (editable rows; up / down / × per row; "+ Add class" link).
- Stats line: "Images: N · Convertible: M · Skipped: K".
- Buttons: Run / Cancel.

Add `exportDatasetMenuItem` to `toolsMenuDropdown`.

`initialGlobalSettings` injection: include `exportFormat`, `exportOutputDir`, last class list (lightweight – just remember the order/edits user picked).

## Step 5 — Webview (`media/main.js`)

- DOM refs for the modal.
- `showExportDatasetModal()` → posts `exportDatasetPrepare` then opens modal once response arrives.
- Render class list with reorder/remove/add controls; user-edited list takes precedence over auto-detected on re-open.
- `submitExportDataset()` → posts `exportDatasetRun` with config; show notification on response.
- Handler for `browseExportOutputDir` response → set the input.
- Persist last-used `exportFormat` / `exportOutputDir` via `saveGlobalSettings`.

## Step 6 — Tooltips

Add to `tipsData.js`:
```
'tools.exportDataset': { title: 'Export Dataset', desc: 'Convert annotations to COCO or YOLO format.' },
'export.format':       { title: 'Format', desc: 'COCO Instances writes one annotations.json; YOLO formats write one .txt per image plus classes.txt.' },
'export.scope':        { title: 'Scope', desc: 'Export every image in the workspace or only the current image.' },
'export.outputDir':    { title: 'Output Directory', desc: 'Folder where the converted files will be written.' },
'export.outputDirBrowse': { title: 'Browse', desc: 'Pick the output folder.' },
'export.classes':      { title: 'Classes', desc: 'Order defines class indices (first = 0 for YOLO, 1 for COCO).' }
```

## Step 7 — Tests

`test/exportFormats.test.ts`:
- `polygonAabb` (single point, two-point, full ring).
- `polygonArea` (square area = side²; CCW ring positive after abs).
- `polygonizeCircle` — 32 verts, hypot ≈ r.
- `buildCocoDocument` — three images, mixed shapes; resulting category IDs 1-based; segmentation flat; bbox correct.
- `buildYoloBboxLines` — normalization to 0..1; skips when label not in class list (warn); 1×1 px bbox for point input.
- `buildYoloSegLines` — rectangle expanded to 4 corners; circle to 32; linestrip dropped.
- `buildClassesTxt` — newline-separated.

## Step 8 — README + CHANGELOG

- Roadmap: move "Export to other formats" to ✓.
- New Features section: "Dataset Export (New in v0.18.0)".

## Smoke checklist

- [ ] Tools menu → Export Dataset opens modal.
- [ ] Class list auto-fills from workspace labels.
- [ ] Re-order class, run COCO → `annotations.json` valid; counts match.
- [ ] Run YOLO bbox → `.txt` per image; coordinates normalized.
- [ ] Run YOLO seg → polygon points present.
- [ ] Re-open modal → last format / dir restored.
- [ ] Cancel button closes without writing files.
