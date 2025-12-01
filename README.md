# LabelEditor for VSCode

A VS Code extension for annotating images with polygon shapes, compatible with the LabelMe JSON format. Perfect for creating datasets for machine learning and computer vision projects.

> **Note**: This extension is in early development. Many features are still being refined and improved. Contributions and feedback are welcome!

## ✨ Features

- **Polygon Annotation**: Click to draw polygon shapes on images
- **Label Management**: Assign and edit labels for each annotated region
- **Undo/Redo Support**: Full undo/redo functionality with up to 50 history states
- **LabelMe Format**: Compatible with LabelMe JSON format for easy integration with ML pipelines
- **Zoom & Pan**: Smooth zooming with mouse-centered pivot and full scrolling support
- **Instance Management**: 
  - Toggle visibility of shapes
  - Edit labels in place
  - Delete unwanted annotations
- **Navigation**: Quick switching between images with keyboard shortcuts (A/D)
- **Manual Save**: Control when to save your annotations (Ctrl+S)
- **Unsaved Changes Protection**: Warning dialog when navigating with unsaved changes
- **Visual Feedback**: Category-based color coding and smooth polygon rendering
- **Performance Optimized**: Fast rendering even with many annotations

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

1. Right-click any image file (.jpg, .jpeg, .png, .bmp) in the Explorer
2. Select **"LabelEditor: Open Image Annotator"**
3. Click to add polygon vertices
4. Click near the first point to close the polygon
5. Enter a label name
6. Save with Ctrl+S

### Keyboard Shortcuts
- **Left Click**: Add point / Select shape
- **Right Click**: Undo last point while drawing
- **Ctrl+Z** (`Cmd+Z` on Mac): Undo last action
- **Ctrl+Shift+Z** or **Ctrl+Y** (`Cmd+Shift+Z` or `Cmd+Y` on Mac): Redo action
- **ESC**: Cancel current drawing
- **A**: Previous image
- **D**: Next image
- **Ctrl+S** (`Cmd+S` on Mac): Save annotations
- **Delete/Backspace**: Delete selected shape

### Sidebar Actions
- **👁️ Eye Icon**: Toggle shape visibility
- **✎ Pencil Icon**: Edit shape label
- **× Delete Icon**: Remove shape

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
      "visible": true
    }
  ],
  "imagePath": "image.jpg",
  "imageData": null,
  "imageHeight": 1080,
  "imageWidth": 1920
}
\`\`\`

## 🛠️ Known Limitations

This extension is still under active development. Some known limitations include:

- No support for other shape types (rectangles, circles, etc.) yet
- No batch annotation features
- No import from other formats
- Performance may degrade with very large images (10000x10000+)
- No support for video frame annotation

## 🤖 Development

**All code in this extension was written by AI:**
- **Gemini 2.0 Flash Thinking Experimental**
- **Claude Sonnet 4.5**

This project serves as a demonstration of AI-assisted development capabilities.

## 📝 Roadmap

Planned features for future releases:

- [x] ~~Undo/Redo support~~ **Added in v0.2.0**
- [x] ~~Performance optimizations~~ **Added in v0.2.0**
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
