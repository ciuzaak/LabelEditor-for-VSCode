# LabelEditor for VSCode

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version/ciuzaak.labeleditor-vscode.png)](https://marketplace.visualstudio.com/items?itemName=ciuzaak.labeleditor-vscode)
[![VS Marketplace Installs](https://vsmarketplacebadges.dev/installs/ciuzaak.labeleditor-vscode.png)](https://marketplace.visualstudio.com/items?itemName=ciuzaak.labeleditor-vscode)
[![Open VSX](https://raster.shields.io/open-vsx/v/ciuzaak/labeleditor-vscode?label=Open%20VSX)](https://open-vsx.org/extension/ciuzaak/labeleditor-vscode)
[![Open VSX Downloads](https://raster.shields.io/open-vsx/dt/ciuzaak/labeleditor-vscode?label=OVSX%20Downloads)](https://open-vsx.org/extension/ciuzaak/labeleditor-vscode)

Annotate images directly in VS Code — polygon, rectangle, line, point, and **SAM AI-assisted** masks — and save in the LabelMe JSON format used by most ML pipelines, or work **natively in YOLO format** (open a `data.yaml`, edit, save `.txt`). No extra app, no context switch.

## ✨ Features

### Annotation Tools
- **Shape types**: polygon, rectangle, line, point, and circle — all saved in LabelMe JSON (circle as center + edge `points`)
- **Drawing modes**: 👁️ View (browse/select, default) · ⬠ Polygon · ▭ Rectangle · ⟋ Line · • Point · ◯ Circle
- **Unified edit mode**: click a shape to move it or drag its vertices; circle handles translate (center) or resize (edge)
- **Context menu**: right-click any shape to Edit, Rename, Hide, or Delete
- **Labels & descriptions**: assign and edit a label per region, plus an optional description shown in the sidebar (omitted from JSON when empty)
- **Undo / redo** with up to 50 history states

### Selecting & Editing Instances
- **Smart overlap selection**: clicking overlapping instances picks the **smallest / most specific** one (points and lines before filled shapes); click again in place to **cycle down** the stack with an `N / M` badge; hovering shows a dashed outline of what a click would select
- **Multi-select**: Ctrl+Click to toggle (canvas or list), Shift+Click to range-select in the list, Ctrl+A for all, drag a box in View mode (Ctrl+Drag to add), Esc to clear
- **Batch operations**: Rename, Hide/Show, or Delete the whole selection from the context menu or sidebar
- **Eraser**: Shift+Click for a polygon eraser, Shift+Long-press+Drag for a rectangle eraser — boolean-subtracts the area from all overlapping shapes (interior cut-outs become hole-free polygons); right-click / Esc to cancel
- **Merge** (`Ctrl+G`): union multi-selected overlapping polygons/rectangles (all-rectangles → bounding box; otherwise → polygon); a single undo restores the originals
- **Draw Over Instances** (opt-in): when on, clicking inside an existing instance in a drawing mode starts a **new** annotation instead of selecting it; right-click still selects/deletes
- Per-instance visibility toggle, in-place label editing, and delete

### AI-Assisted Annotation (SAM)
- **Interactive segmentation** with the Segment Anything Model — enter via the ✨ button or `I`
  - **Left click** positive prompt · **Shift+Left click** negative · **Left-drag** box prompt · **Right click** undo last · **Double click** confirm
  - Point and box prompts combine (a new box replaces the previous one); real-time mask preview
- **Encode mode**: Full Image (default) or Local Crop — Local Crop encodes only the zoomed viewport for far better accuracy on small targets (encoded region shown as a yellow dashed box)
- **Encode source**: Original file (default) or Adjusted View — encodes with Brightness/Contrast/CLAHE/Channel baked in, useful for low-contrast / medical / microscopy data
- **Output shape**: Polygon (default) or Rectangle (mask reduced to its bounding box, with a WYSIWYG preview)
- Supports SAM1 & SAM2 ONNX models (auto-detected); runs as a standalone Python HTTP server in a VS Code terminal and works over **Remote-SSH**
- Requires Python with `onnxruntime`, `opencv-python`, `numpy`

**SAM model setup**
1. Download SAM2 ONNX models from [HuggingFace](https://huggingface.co/vietanhdev/segment-anything-2-onnx-models)
2. Put the encoder and decoder `.onnx` files in one folder (filenames containing "encoder"/"decoder"; otherwise the larger file is assumed to be the encoder)
3. Press `I` to enter SAM mode; if the service isn't running, a config modal lets you pick the model folder and Python interpreter and starts it in a terminal tab

### ONNX Batch Inference
- Tools menu → **ONNX Batch Infer**: run an ONNX segmentation model across all images or just the current one
- Configurable model directory, Python interpreter, CPU/GPU, and RGB/BGR; existing annotations can skip / merge / overwrite; progress shown in the terminal
- Requires Python with `onnxruntime`, `opencv-python`, `numpy`, `tqdm` (outputs LabelMe polygons, or YOLO `.txt` when launched from a YOLO dataset)

### YOLO Format Mode
- **Work directly in YOLO format** — right-click a YOLO `data.yaml` → **"LabelEditor: Open as YOLO Dataset"**
- Resolves the dataset's `path` + `train` / `val` / `test` image directories and **imports existing `.txt` labels** (Ultralytics `images/` → `labels/` convention); detection lines (`cls cx cy w h`) load as rectangles, segmentation lines as polygons
- Edits **save back as `.txt`**, choosing bbox vs segmentation per shape automatically (one file may mix both)
- Drawing is scoped to 👁️ View · ✨ SAM · ⬠ Polygon · ▭ Rectangle
- **Class list is the `data.yaml`**: the label dialog offers the yaml's classes (order = class index); entering a new class prompts to add it, appended at the next index and written straight back to `data.yaml` (its list / dict / block-sequence style is preserved, `nc` is bumped)

### Image Browser & Navigation
- **Sidebar image list**: every workspace image organized by folder, click to jump, current image highlighted, resizable — virtual scrolling handles 8000+ images smoothly; **symbolic links** to images and folders are followed (with cycle protection)
- **Quick search**: filter the list by filename as you type
- **Advanced search**: the sliders button in the search box opens a condition builder — add **Name** (substring), **Name (regex)**, and **Class** (multi-select via a searchable, scrollable picker) conditions; conditions AND together while multiple classes in one condition OR. Results are **ranked by match relevance** with a clearable banner. Name/regex search reads no annotation files; class search indexes sidecar JSON once (cached, with progress and cancel), so it stays fast on large datasets
- **Open Folder for Annotation**: right-click a folder to work with just its images
- **Multi-panel**: open several images/folders side-by-side; re-opening the same one reveals its existing panel
- **Zoom & pan** with mouse-centered pivot; prev/next buttons and `A` / `D` (navigation stays within the active filter's results)
- **Copy image path**: click the filename to copy the absolute path, right-click for the name only
- **Manual save** (`Ctrl+S`) with an unsaved-changes warning on navigation

### Display & Image Adjustment
- **Theme**: ☀️ Light / 🌙 Dark / ◐ Auto (follows VS Code)
- **Brightness & Contrast** sliders and **RGB channel** isolation (view R/G/B as grayscale), each with reset and a lock that preserves the value across images
- **CLAHE**: brighten low-contrast images without color distortion (luminance-only), with a clip-limit slider
- **On-canvas class names** (opt-in): draw each instance's label as a colour-matched pill at its corner, readable at any zoom
- **Image info** popup (dimensions, file size, DPI, bit depth); border width (1–5px) and fill opacity (0–100%) controls
- All adjustments affect display only — never the original file

### Dataset Export — COCO / YOLO
- Tools menu → **Export Dataset**: **COCO** Instances or **YOLO**, over all images or the current one
- **YOLO** exports a ready-to-train Ultralytics dataset (`data.yaml` + `images/train/` + `labels/train/`), auto-selecting bbox vs segmentation per shape; **COCO** writes `annotations.json`
- **Copy images** option: bundle the images into the dataset for a self-contained copy, or leave them out (the folder structure is still created)
- Classes reflect the current dataset (the YOLO class order comes from its `data.yaml`); reorder / rename / remove rows to control class indices (first row = `0` for YOLO, `1` for COCO)
- Output directory defaults to `<dataset>/export`; a run that writes zero annotations warns (likely a class-name mismatch) instead of silently "succeeding"; filename collisions across nested folders are auto-suffixed

### Labels Panel
- All label categories with live instance counts; show/hide every instance of a label at once
- 24 preset colors + custom hex, with per-label reset; colors persist globally

### Workspace & UX
- **Rebindable keyboard shortcuts** (Settings → Keyboard Shortcuts) with conflict detection and per-row / global reset; `Ctrl+Y` and `Backspace` stay as secondary Redo / Delete
- **Multi-language**: English / 简体中文 (Settings → Language) — strings live in `media/i18n.js`, PRs for more locales welcome
- **In-webview notifications**: status messages appear inline in the toolbar (severity-colored) instead of stacking as native popups; native dialogs are reserved for Save / Discard / Cancel prompts
- **Rich hover tooltips** on every control (title, description, and the live keyboard shortcut)
- **macOS-style UI**: SVG icons, blur-backdrop modals, click-outside-dismiss menus, and segmented controls
- All settings persist globally across sessions

## 📦 Installation

### From OpenVSX
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "LabelEditor for VSCode"
4. Click Install

### From Source
1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to open Extension Development Host

## 🚀 Usage

### Basic Workflow
1. Right-click any image file (.jpg, .jpeg, .png, .bmp) in the Explorer
2. Select **"LabelEditor: Open Image Annotator"**
3. Or right-click a folder and select **"LabelEditor: Open Folder for Annotation"** to work only with images in that folder
4. Switch to **Polygon Mode** (⬠) or **Rectangle Mode** (▭) as needed
5. For polygons: Click to add vertices, click near the first point to close
6. For rectangles: Click to set start point, move and click to set end point
7. Enter a label name
8. Save with Ctrl+S

### YOLO Dataset Workflow
1. Right-click a YOLO `data.yaml` in the Explorer
2. Select **"LabelEditor: Open as YOLO Dataset"**
3. Existing `.txt` labels load automatically (boxes and polygons); annotate with Polygon / Rectangle / SAM
4. Pick a class from the `data.yaml` list, or type a new one and confirm to add it to the yaml
5. Save with Ctrl+S — labels are written back as YOLO `.txt`

### Labels Management
- Click the **color indicator** to customize label colors
- Click **eye icon** to toggle visibility for all instances of a label
- Click **reset icon** (↻) to restore default color

### Advanced Options
- Click the **⚙️ icon** to open advanced settings
- Choose **theme**: Light (☀️), Dark (🌙), or Auto (◐)
- Adjust **brightness** and **contrast** with sliders (display only, lock to preserve across images)
- Adjust **border width** and **fill opacity** with sliders
- Click **↺** on any setting to reset to default

### Keyboard Shortcuts
- **Left Click**: Add point / Select shape
- **Right Click**: Undo last point while drawing
- **Ctrl+Wheel**: Zoom in/out
- **V**: Switch to View Mode
- **P**: Switch to Polygon Mode
- **R**: Switch to Rectangle Mode
- **L**: Switch to Line Mode
- **O**: Switch to Point Mode
- **C**: Switch to Circle Mode (New in v1.0.0)
- **I**: Switch to SAM AI Mode
- **Ctrl+Z** (`Cmd+Z` on Mac): Undo last action
- **Ctrl+Shift+Z** or **Ctrl+Y**: Redo action
- **Shift+Click**: Start polygon eraser
- **Shift+Long-press+Drag**: Start rectangle eraser
- **Ctrl+A** (`Cmd+A` on Mac): Select all instances
- **Ctrl+G** (New in v0.15.0): Merge selected polygon/rectangle instances (overlapping ones only)
- **Ctrl+R** (New in v0.15.0): Rename the selected shape (single or batch)
- **Ctrl+H** (New in v0.15.0): Toggle visibility of the selected shape(s)
- **ESC**: Cancel current drawing / Cancel eraser / Clear selection
- **A**: Previous image
- **D**: Next image
- **Ctrl+S** (`Cmd+S` on Mac): Save annotations
- **Delete/Backspace**: Delete selected shape
- **Ctrl+D** (in label modal, New in v0.14.1): Reveal chip shortcut badges, then press a digit (`1`-`9`, or `0` for the 10th) to commit that label

### Toolbar Buttons
- **◀ / ▶**: Navigate between images
- **👁️ / ⬠ / ▭ / ⟋ / • / ✨**: Switch between View, Polygon, Rectangle, Line, Point, and SAM modes
- **⚙️**: Open advanced rendering options
- **Save**: Save current annotations

## 📄 Output Format

Annotations are saved in LabelMe JSON format:

\`\`\`json
{
  "version": "5.0.1",
  "flags": {},
  "shapes": [
    {
      "label": "person",
      "points": [[x1, y1], [x2, y2], ...],
      "group_id": null,
      "shape_type": "polygon",
      "flags": {},
      "description": "optional annotation note"
    }
  ],
  "imagePath": "image.jpg",
  "imageData": null,
  "imageHeight": 1080,
  "imageWidth": 1920
}
\`\`\`

Note: `visible` property is not saved to JSON - it's a session-only UI state. `description` is only included when non-empty.

## 🛠️ Known Limitations

This extension is still under active development. Some known limitations include:

- No support for ellipse shape type yet (Circle is shipped — `points: [[cx, cy], [edgeX, edgeY]]`, LabelMe-compatible)
- No import from other formats (export to COCO and YOLO is supported via the Tools menu)
- Performance may degrade with very large images (10000x10000+)
- No support for video frame annotation
- SAM mode requires a local Python environment with ONNX Runtime

## 🤖 Development

**Most code in this extension was written by AI:**
- **Gemini 3 Pro**
- **Gemini 3.1 Pro**
- **Claude Sonnet 4.5**
- **Claude Opus 4.5**
- **Claude Opus 4.6**
- **Claude Opus 4.7** (1M context)
- **Claude Opus 4.8** (1M context)

**Code review by AI:**
- **GPT 5.3 Codex**
- **GPT 5.4**

Community PRs are also welcome — see CHANGELOG for per-release contributor credit.

This project serves as a demonstration of AI-assisted development capabilities.

## 📝 Roadmap

Planned features for future releases:

- [x] ~~Undo/Redo support~~ **Added in v0.2.0**
- [x] ~~Performance optimizations~~ **Added in v0.2.0**
- [x] ~~Labels management panel~~ **Added in v0.3.0**
- [x] ~~Custom label colors~~ **Added in v0.3.0**
- [x] ~~View/Edit mode toggle~~ **Added in v0.3.0**
- [x] ~~Advanced rendering options~~ **Added in v0.3.0**
- [x] ~~Rectangle shapes~~ **Added in v0.4.0**
- [x] ~~Global settings persistence~~ **Added in v0.6.0**
- [x] ~~Image Browser with virtual scrolling~~ **Added in v0.7.0**
- [x] ~~Theme switching (Light/Dark/Auto)~~ **Added in v0.8.0**
- [x] ~~Refresh image list button~~ **Added in v0.9.0**
- [x] ~~Open folder for annotation~~ **Added in v0.9.0**
- [x] ~~Click to copy image path~~ **Added in v0.9.0**
- [x] ~~Point annotations~~ **Added in v0.9.2**
- [x] ~~Line (polyline) annotations~~ **Added in v0.9.2**
- [x] ~~Unified Edit Mode~~ **Added in v0.10.0**
- [x] ~~Context Menu (Rename/Hide/Delete)~~ **Added in v0.10.0**
- [x] ~~SVG Export~~ **Added in v0.11.0**
- [x] ~~Instance Description~~ **Added in v0.11.1**
- [x] ~~ONNX Batch Inference~~ **Added in v0.11.2**
- [x] ~~SAM AI Annotation~~ **Added in v0.12.0**
- [x] ~~Circle shapes~~ **Added in v1.0.0**
- [x] ~~Export to other formats (COCO, YOLO, etc.)~~ **Added in v1.0.0**
- [x] ~~Image display adjust (brightness, contrast)~~ **Added in v0.13.4**
- [x] ~~Keyboard shortcuts customization~~ **Added in v1.0.0**
- [x] ~~Multi-language support~~ **Added in v1.0.0**
- [x] ~~Advanced search (filename / regex / class, ranked)~~ **Added in v1.3.0**

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📜 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Inspired by the LabelMe annotation tool
- Built for the VS Code extension ecosystem
- Developed primarily by AI language models, with feature contributions from the community — see "Development" above

---

**Enjoy annotating! 🎨**
