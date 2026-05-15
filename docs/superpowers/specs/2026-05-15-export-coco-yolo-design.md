# Export to COCO / YOLO — Design

**Date:** 2026-05-15
**Roadmap item:** Export to other formats (COCO, YOLO, etc.)

## Goals

1. Tools menu gains an "Export Dataset" entry.
2. Modal lets the user choose:
   - Format: **COCO Instances**, **YOLO bbox** (detection), **YOLO seg** (segmentation).
   - Scope: All images / Current image.
   - Class list: auto-derived from labels seen across selected images, editable order (first row = class 0).
   - Output directory (browse).
3. Conversion runs in the extension host (TypeScript), reads each image's adjacent `.json`, writes converted output to the user-chosen directory.
4. All settings persist across sessions (per `_globalState`).

Non-goals: import (still listed as known limitation), VOC/Pascal/CreateML support, RLE mask output, splitting into train/val (user can do this externally), running on a subset selected via UI checkboxes.

## Format spec

### COCO Instances (`coco`)
Single file: `<outDir>/annotations.json`.

```json
{
  "info": { "description": "Exported by LabelEditor for VSCode", "version": "1.0", "date_created": "<ISO>" },
  "licenses": [],
  "images": [
    { "id": <int>, "file_name": "<relative path>", "width": W, "height": H }
  ],
  "categories": [
    { "id": <1-based>, "name": "<label>", "supercategory": "none" }
  ],
  "annotations": [
    {
      "id": <int>, "image_id": <int>, "category_id": <int>,
      "segmentation": [[x1,y1, x2,y2, ...]],  // flat polygon ring(s)
      "bbox": [x, y, w, h],
      "area": <float>, "iscrowd": 0
    }
  ]
}
```

- Image IDs assigned sequentially in alphanumeric path order.
- `category_id` is 1-based per COCO convention.
- Annotation `id` sequential across all images.
- Shapes converted as follows:

  | shape_type | segmentation | bbox |
  |---|---|---|
  | `polygon` | one flat ring `[x1,y1,…]` | tight AABB |
  | `rectangle` | the 4-corner ring | bbox direct |
  | `circle` | polygonized 32 segments | bbox direct (`cx-r,cy-r,2r,2r`) |
  | `linestrip` | **skipped** (warn) | — |
  | `point` | **skipped** (warn) | — |

- `area` = polygon area via shoelace; for rectangle = w·h.
- Images that have **zero** convertible shapes still appear in `images[]` (allows pure-negative samples).

### YOLO bbox (`yolo-bbox`)
- One `.txt` per image at `<outDir>/<imagename>.txt`, plus `<outDir>/classes.txt`.
- Each line: `<class_index> <cx_norm> <cy_norm> <w_norm> <h_norm>` (normalized 0..1).
- `class_index` is 0-based, derived from the editable class list.
- Conversions:
  - polygon → AABB of points.
  - rectangle → as stored.
  - circle → AABB.
  - linestrip → AABB (open polyline can still have a bbox).
  - point → 1×1 pixel bbox at the point.
- Empty `.txt` files written for images with zero shapes.

### YOLO seg (`yolo-seg`)
- One `.txt` per image at `<outDir>/<imagename>.txt`, plus `<outDir>/classes.txt`.
- Each line: `<class_index> x1_norm y1_norm x2_norm y2_norm ...` (polygon, normalized).
- Conversions:
  - polygon → as stored.
  - rectangle → 4-corner polygon.
  - circle → polygonized 32 segments.
  - linestrip → **skipped** (warn).
  - point → **skipped** (warn).
- Closing point omitted (YOLO seg format leaves it implicit).

### `classes.txt` (YOLO formats)
One label per line, in the user-confirmed order.

## UX

### Modal layout
Reuses the existing `.modal` / `.onnx-infer-content` style:

```
Export Dataset
[Format ▢ COCO  ▢ YOLO bbox  ▢ YOLO seg]
[Scope  ▢ All Images  ▢ Current Image]
[Output Directory  [path...] [📂 Browse]]
[Classes
  - Auto-detected from selected scope:
    [1] person      [↑] [↓] [×]
    [2] car         [↑] [↓] [×]
    [+ Add class] ]
Images to process: N  •  Annotations to convert: M  •  Skipped: K
[Run] [Cancel]
```

- Class list initialised by scanning all labels in scope; user can reorder, rename, or delete.
- Skipped count reflects format-specific drops (linestrip, point).
- Status bar shows `Exported to <path> · N images · M annotations` on success.

### Tools menu entry
Insert below ONNX entry:
```html
<div class="sidebar-dropdown-item" id="exportDatasetMenuItem" data-tip-id="tools.exportDataset">
  <svg class="icon icon-sm"><use href="#icon-download"/></svg> Export Dataset
</div>
```

## Architecture

### New file: `src/exportFormats.ts` (pure functions; testable)

```ts
export interface ExportShape { label: string; shape_type: string; points: number[][] }
export interface ExportImage { fileName: string; width: number; height: number; shapes: ExportShape[] }

export function buildCocoDocument(images: ExportImage[], classes: string[]): object;
export function buildYoloBboxLines(image: ExportImage, classes: string[]): string;
export function buildYoloSegLines(image: ExportImage, classes: string[]): string;
export function buildClassesTxt(classes: string[]): string;

// helpers (exported for testing)
export function polygonAabb(points: number[][]): { x: number; y: number; w: number; h: number };
export function polygonArea(points: number[][]): number;
export function polygonizeCircle(center: number[], edge: number[], segments?: number): number[][];
```

### Wiring in `src/LabelMePanel.ts`
- New message handlers:
  - `exportDatasetPrepare` → scan workspace `.json` files in scope, return `{ images: ExportImage[], detectedClasses: string[] }` for the modal preview.
  - `browseExportOutputDir` → native folder picker; returns path.
  - `exportDatasetRun` → run the conversion with config from the modal, write files, show toast or VS Code dialog on completion. Returns success/failure to webview to dismiss modal.
- Loading per-image `.json`: read sibling JSON files for each image in scope. If a JSON is missing, that image still appears in `images[]` with `shapes: []`. Image dimensions are read from the JSON's `imageWidth/imageHeight` when present; otherwise probe the image file (use existing `getImageMetadata` plus a quick PNG/JPEG dimension probe — extend `labelMeUtils.ts` with a `getImageDimensions` helper if needed).

### Wiring in `media/main.js`
- New DOM refs for the modal; new `showExportDatasetModal()` / `hideExportDatasetModal()` / `submitExportDataset()`.
- Browse button → posts `browseExportOutputDir`.
- Class list editor: drag-reorder via [↑]/[↓] buttons (drag-and-drop is YAGNI).
- Class auto-detection: posts `exportDatasetPrepare`, populates list when extension responds.
- Persist last format + last output dir in `globalState` via existing `saveGlobalSettings`.

## Edge cases

| Case | Handling |
|---|---|
| Image has no `.json` | Image appears in `images[]` with zero annotations; for YOLO formats an empty `.txt` is written. |
| Label not in user's class list (after the user removed/renamed it) | Shape is skipped; counted under "Skipped". |
| Output directory contains existing `<image>.txt` from a prior export | Overwritten silently for YOLO; COCO writes one `annotations.json` overwriting any existing. (User picked the directory; this matches their intent.) |
| Empty class list at submit | Disable Run button; tooltip "Add at least one class". |
| Filename collisions across different folders | YOLO uses image's basename only; if two images share a basename a warning is shown and the second-and-later are suffixed `_2`, `_3`, ... — only for YOLO. COCO uses relative path. |
| Negative-coord points | Clamped to image bounds in the converted output (only for YOLO normalization; COCO keeps as-is). |
| Image dimensions missing from JSON and unreadable from file | Skip image with warning. |
| User cancels mid-run | Not supported — conversion is synchronous (per image) and fast for typical sizes; no cancel UI. |

## Tests

`test/exportFormats.test.ts`:
- `buildCocoDocument` — image+category mapping; bbox/area for polygon and rectangle; skip for point/linestrip; circle polygonization.
- `buildYoloBboxLines` — normalization; rectangle direct; circle to bbox; class index lookup; class not found → empty/skip; multi-line per image.
- `buildYoloSegLines` — rectangle expanded to 4 corners; circle to 32 points; line skipped.
- `polygonAabb` — degenerate cases (single point, two points).
- `polygonArea` — convex / concave / closed-ring input.
- `polygonizeCircle` — 32 points, first ≈ last+epsilon, radius via hypot.

Manual smoke:
- Sample workspace with 3 images (mixed shapes) → export COCO → resulting `annotations.json` is valid (parseable, has expected counts).
- Same workspace → YOLO seg → check normalization is 0..1.
- Same workspace → YOLO bbox → spot-check one polygon's bbox.
- Cancel modal mid-edit → no files written.
- Re-open modal → last format and output dir restored.
