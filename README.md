# LabelEditor for VSCode

A VS Code extension for annotating images with polygon, rectangle, line, and point shapes, compatible with the LabelMe JSON format. Perfect for creating datasets for machine learning and computer vision projects.

> **Note**: This extension is in early development. Many features are still being refined and improved. Contributions and feedback are welcome!

## ✨ Features

### Core Annotation
- **Multiple Shape Types**: Draw polygon, rectangle, line, and point annotations
- **Multiple Drawing Modes**: Toggle between viewing and editing modes
  - 👁️ **View Mode**: Browse and select without accidental edits (default)
  - ⬠ **Polygon Mode**: Create new polygon annotations
  - ▭ **Rectangle Mode**: Create new rectangle annotations
  - ⟋ **Line Mode**: Create polyline annotations
  - • **Point Mode**: Create point landmarks
- **Unified Edit Mode** (New in v0.10.0): seamlessly move shapes or adjust vertices by simply clicking on them
- **Context Menu** (New in v0.10.0): Right-click any shape to Edit, Rename, Hide, or Delete
- **Label Management**: Assign and edit labels for each annotated region
- **Undo/Redo Support**: Full undo/redo functionality with up to 50 history states

### Image Browser (New in v0.7.0)
- **Sidebar Image List**: Browse all images in the workspace from a dedicated sidebar
  - Toggle with ☰ button in toolbar
  - Shows all images organized by folder structure
  - Click any image to navigate instantly
  - Current image is highlighted
  - Resizable sidebar width
  - 🔄 **Refresh button** to rescan images (New in v0.9.0)
- **Open Folder for Annotation** (New in v0.9.0): Right-click any folder to open only images within that folder
- **Virtual Scrolling**: Handles 8000+ images without performance issues
  - Only renders visible items for smooth performance
  - No lag when resizing sidebar even with thousands of images

### Labels Management Panel
- **Label Overview**: See all label categories with instance counts
- **Batch Visibility Toggle**: Show/hide all instances of a specific label
- **Custom Colors**: 
  - 24 preset colors + custom hex input (#XXXXXX)
  - Colors persist globally (saved to VS Code global state)
  - Per-label reset to default color
- **Global Persistence**: Settings maintained even after closing VS Code

### Advanced Options
- **Theme Switching** (New in v0.8.0):
  - ☀️ Light mode for bright environments
  - 🌙 Dark mode matching VS Code dark themes
  - 🔄 Auto mode - follows VS Code's current theme
- **Image Info Popup** (New in v0.13.5): Click ℹ in the toolbar to view image metadata (dimensions, file size, DPI, bit depth)
- **Brightness & Contrast Control** (New in v0.13.4): Adjust image display without modifying original data
  - Sliders with individual reset (↺) and lock (🔓/🔒) buttons
  - Lock preserves value across images; unlock resets to 100% on each new image
- **Border Width Control**: Adjust polygon outline thickness (1-5px)
- **Fill Opacity Control**: Adjust polygon fill transparency (0-100%)
- **Settings Persistence**: All preferences saved globally
- **Individual Reset Buttons**: Reset each setting independently

### Navigation & Workflow
- **LabelMe Format**: Compatible with LabelMe JSON format for ML pipelines
- **Zoom & Pan**: Smooth zooming with mouse-centered pivot and full scrolling
- **Image Browser**: Quick access to all workspace images via sidebar (☰)
- **Image Navigation**: Quick prev/next buttons + keyboard shortcuts (A/D)
- **Copy Image Path** (New in v0.9.0): Click filename in toolbar to copy absolute path; right-click to copy filename only
- **Manual Save**: Control when to save annotations (Ctrl+S)
- **Unsaved Changes Protection**: Warning dialog when navigating with unsaved changes

### Instance Management
- **Multi-Instance Selection** (New in v0.13.3): Select and operate on multiple instances at once
  - **Ctrl+Click**: Toggle individual shapes in/out of selection (canvas or instance list)
  - **Shift+Click**: Range select in instance list
  - **Ctrl+A**: Select all instances
  - **View Mode Box Select**: Drag to draw a selection rectangle; Ctrl+Drag to add to selection
  - **Batch Operations**: Right-click context menu or sidebar buttons to batch Rename, Hide/Show, or Delete
  - **ESC**: Clear multi-selection
- **Visibility Toggle**: Show/hide individual shapes (👁️)
- **Edit Labels**: In-place label editing (✎)
- **Instance Description** (New in v0.11.1): Optional description text for each annotation
  - Add descriptions when creating or editing annotations
  - Shown as subtitle in the sidebar instances list
  - Omitted from JSON when empty (backward compatible)
- **Delete Annotations**: Remove unwanted shapes (×)
- **Visual Feedback**: Category-based color coding and smooth rendering

### ONNX Batch Inference (New in v0.11.2)
- **Automated Annotation**: Run ONNX segmentation models on workspace images
  - Access via Tools → 🤖 ONNX Batch Infer
  - Configurable: model directory, Python interpreter, CPU/GPU, RGB/BGR
  - Scope: infer on all images or current image only
  - Existing annotations: skip / merge / overwrite
  - Browse buttons (📂) for path selection via native dialog
  - All settings persist across sessions
  - Progress displayed in VS Code terminal with tqdm
  - Requires: Python with `onnxruntime`, `opencv-python`, `numpy`, `tqdm`
  - Output: polygon annotations only (currently)

### SAM AI Annotation (New in v0.12.0)
- **Interactive Segmentation**: Annotate with the Segment Anything Model (SAM)
  - Enter SAM mode via toolbar button (🧠) or keyboard shortcut (`I`)
  - **Left click**: Positive point prompt
  - **Shift+Left click**: Negative point prompt
  - **Left click + Drag**: Rectangle (box) prompt
  - **Right click**: Undo last prompt
  - **Double click**: Confirm annotation and enter label
  - Real-time mask preview with SVG overlay
  - Lazy encoding: image embedding computed on first interaction for efficiency
  - Supports SAM1 and SAM2 ONNX models with automatic detection
  - Configuration: model directory, Python interpreter, device (CPU/GPU), port
  - All settings persist across sessions
  - SAM service runs as a standalone Python HTTP server in VS Code terminal
  - Requires: Python with `onnxruntime`, `opencv-python`, `numpy`

#### SAM Model Setup
1. Download SAM2 ONNX models from [HuggingFace](https://huggingface.co/vietanhdev/segment-anything-2-onnx-models)
2. Place the encoder and decoder `.onnx` files in the same folder:
   ```
   sam_model/
   ├── encoder.onnx    (or any filename containing "encoder")
   └── decoder.onnx    (or any filename containing "decoder")
   ```
   > If the filenames don't contain "encoder"/"decoder", the service will assume the larger file is the encoder.
3. In VS Code, press `I` to enter SAM mode
4. If the SAM service is not running, a configuration modal will appear — select the model folder and Python interpreter, then click OK to start the service
5. The service runs in a terminal tab and persists until you manually close it

### Eraser Tool (New in v0.13.2)
- **Erase Portions of Annotations**: Remove parts of existing annotations using polygon or rectangle erasers
  - **Shift+Click**: Start a polygon eraser (click to add points, close to apply)
  - **Shift+Long-press+Drag**: Start a rectangle eraser (second click to confirm)
  - Works in all editing modes (Polygon, Rectangle, Line, Point)
  - Boolean subtraction removes the erased area from all overlapping annotations
  - Interior punch-outs are decomposed into hole-free polygons (LabelMe compatible)
  - Right-click or ESC to cancel

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

### Labels Management
- Click the **color indicator** to customize label colors
- Click **eye icon** to toggle visibility for all instances of a label
- Click **reset icon** (↻) to restore default color

### Advanced Options
- Click the **⚙️ icon** to open advanced settings
- Choose **theme**: Light (☀️), Dark (🌙), or Auto (🔄)
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
- **I**: Switch to SAM AI Mode
- **Ctrl+Z** (`Cmd+Z` on Mac): Undo last action
- **Ctrl+Shift+Z** or **Ctrl+Y**: Redo action
- **Shift+Click**: Start polygon eraser
- **Shift+Long-press+Drag**: Start rectangle eraser
- **Ctrl+A** (`Cmd+A` on Mac): Select all instances
- **ESC**: Cancel current drawing / Cancel eraser / Clear selection
- **A**: Previous image
- **D**: Next image
- **Ctrl+S** (`Cmd+S` on Mac): Save annotations
- **Delete/Backspace**: Delete selected shape

### Toolbar Buttons
- **◀ / ▶**: Navigate between images
- **👁️ / ⬠ / ▭ / ⟋ / • / 🧠**: Switch between View, Polygon, Rectangle, Line, Point, and SAM modes
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

- No support for circle/ellipse shape types yet
- No import from other formats
- Performance may degrade with very large images (10000x10000+)
- No support for video frame annotation
- SAM mode requires a local Python environment with ONNX Runtime

## 🤖 Development

**All code in this extension was written by AI:**
- **Gemini 3 Pro**
- **Gemini 3.1 Pro**
- **Claude Sonnet 4.5**
- **Claude Opus 4.5**
- **Claude Opus 4.6**

**Code review by AI:**
- **GPT 5.3 Codex**
- **GPT 5.4**

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
- [ ] Circle shapes
- [ ] Export to other formats (COCO, YOLO, etc.)
- [x] ~~Image display adjust (brightness, contrast)~~ **Added in v0.13.4**
- [ ] Keyboard shortcuts customization
- [ ] Multi-language support

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📜 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Inspired by the LabelMe annotation tool
- Built for the VS Code extension ecosystem
- Developed entirely by AI language models

---

**Enjoy annotating! 🎨**
