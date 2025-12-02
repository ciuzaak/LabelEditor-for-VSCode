# LabelEditor for VSCode

A VS Code extension for annotating images with polygon shapes, compatible with the LabelMe JSON format. Perfect for creating datasets for machine learning and computer vision projects.

> **Note**: This extension is in early development. Many features are still being refined and improved. Contributions and feedback are welcome!

## ✨ Features

### Core Annotation
- **Polygon Annotation**: Click to draw polygon shapes on images
- **View/Polygon Mode**: Toggle between viewing and editing modes
  - 👁️ **View Mode**: Browse and select without accidental edits (default)
  - ✏️ **Polygon Mode**: Create new annotations
- **Label Management**: Assign and edit labels for each annotated region
- **Undo/Redo Support**: Full undo/redo functionality with up to 50 history states

### Labels Management Panel
- **Label Overview**: See all label categories with instance counts
- **Batch Visibility Toggle**: Show/hide all instances of a specific label
- **Custom Colors**: 
  - 24 preset colors + custom hex input (#XXXXXX)
  - Colors persist across image switches within session
  - Per-label reset to default color
- **Session Persistence**: Settings maintained until extension closes

### Advanced Options
- **Border Width Control**: Adjust polygon outline thickness (1-5px)
- **Fill Opacity Control**: Adjust polygon fill transparency (0-100%)
- **Settings Persistence**: Preferences saved across image navigation
- **Quick Reset**: One-click return to default settings

### Navigation & Workflow
- **LabelMe Format**: Compatible with LabelMe JSON format for ML pipelines
- **Zoom & Pan**: Smooth zooming with mouse-centered pivot and full scrolling
- **Image Navigation**: Quick prev/next buttons + keyboard shortcuts (A/D)
- **Manual Save**: Control when to save annotations (Ctrl+S)
- **Unsaved Changes Protection**: Warning dialog when navigating with unsaved changes

### Instance Management
- **Visibility Toggle**: Show/hide individual shapes (👁️)
- **Edit Labels**: In-place label editing (✎)
- **Delete Annotations**: Remove unwanted shapes (×)
- **Visual Feedback**: Category-based color coding and smooth rendering

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
3. Switch to **Polygon Mode** (✏️ button) if needed
4. Click to add polygon vertices
5. Click near the first point to close the polygon
6. Enter a label name
7. Save with Ctrl+S

### Labels Management
- Click the **color indicator** to customize label colors
- Click **eye icon** to toggle visibility for all instances of a label
- Click **reset icon** (↻) to restore default color

### Advanced Options
- Click the **⚙️ icon** to open advanced settings
- Adjust **border width** and **fill opacity** with sliders
- Click **Reset** to restore defaults

### Keyboard Shortcuts
- **Left Click**: Add point / Select shape
- **Right Click**: Undo last point while drawing
- **V**: Switch to View Mode
- **P**: Switch to Polygon Mode
- **Ctrl+Z** (`Cmd+Z` on Mac): Undo last action
- **Ctrl+Shift+Z** or **Ctrl+Y**: Redo action
- **ESC**: Cancel current drawing
- **A**: Previous image
- **D**: Next image
- **Ctrl+S** (`Cmd+S` on Mac): Save annotations
- **Delete/Backspace**: Delete selected shape

### Toolbar Buttons
- **◀ / ▶**: Navigate between images
- **👁️ / ✏️**: Switch between View and Polygon modes
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
      "flags": {}
    }
  ],
  "imagePath": "image.jpg",
  "imageData": null,
  "imageHeight": 1080,
  "imageWidth": 1920
}
\`\`\`

Note: `visible` property is not saved to JSON - it's a session-only UI state.

## 🛠️ Known Limitations

This extension is still under active development. Some known limitations include:

- No support for other shape types (rectangles, circles, etc.) yet
- No batch annotation features
- No import from other formats
- Performance may degrade with very large images (10000x10000+)
- No support for video frame annotation

## 🤖 Development

**All code in this extension was written by AI:**
- **Gemini 2.0 Flash Experimental**
- **Claude Sonnet 3.5**

This project serves as a demonstration of AI-assisted development capabilities.

## 📝 Roadmap

Planned features for future releases:

- [x] ~~Undo/Redo support~~ **Added in v0.2.0**
- [x] ~~Performance optimizations~~ **Added in v0.2.0**
- [x] ~~Labels management panel~~ **Added in v0.3.0**
- [x] ~~Custom label colors~~ **Added in v0.3.0**
- [x] ~~View/Edit mode toggle~~ **Added in v0.3.0**
- [x] ~~Advanced rendering options~~ **Added in v0.3.0**
- [ ] Rectangle and circle shapes
- [ ] Batch annotation mode
- [ ] Export to other formats (COCO, YOLO, etc.)
- [ ] Image pre-processing (brightness, contrast)
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
