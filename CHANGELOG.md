# Changelog

All notable changes to the "LabelEditor for VSCode" extension will be documented in this file.

## [0.5.0] - 2025-12-03

### Changed
- **SVG Annotation Rendering**: Migrated annotation rendering from Canvas to SVG
  - Annotations now remain sharp and crisp at any zoom level (vector graphics)
  - Fixed blurry annotation edges when zooming in on images
  - Line width and vertex sizes now stay visually constant regardless of zoom level

### Improved
- **Event Handling**: Fixed zoom not responding when mouse is over an annotation or outside the image area
- **Memory Optimization**: Implemented event delegation for SVG elements to prevent memory leaks
- **Code Cleanup**: Removed unused variables and legacy compatibility functions

### Visual
- **Preview Color**: Changed drawing preview color from red to green for better visibility

## [0.4.1] - 2025-12-02

### Fixed
- **Cross-Folder Image Loading**: Fixed critical bug where opening images from different folders would fail with "Error loading image" unless the plugin interface was reopened
  - Root cause: Webview `localResourceRoots` permissions were not updated when switching to images in different directories
  - Solution: Now automatically updates webview permissions when loading images from new folders
  - Impact: Users can now seamlessly browse and annotate images across multiple folders in a single session

### Improved
- **Zoom Default**: Adjusted initial zoom level from 90% to 98% for better screen utilization

## [0.4.0] - 2025-12-02

### Added
- **Rectangle Mode**: New drawing mode for rectangle annotations
  - Click-to-start, move-to-size, click-to-finish interaction
  - Automatically saves as 2 points (LabelMe format)
  - Dedicated toolbar button (▭) and keyboard shortcut (R)
- **View Mode Refinements**:
  - Default cursor (arrow) in View Mode
  - Default browser context menu allowed in View Mode
- **UI Polish**:
  - Updated icons for Polygon (⬠) and Rectangle (▭) modes

### Improved
- **Performance**: Optimized slider state saving (debounce) to reduce IPC traffic
- **Bug Fixes**: Fixed rendering issue where only 3 sides of a rectangle were visible during drawing

## [0.3.0] - 2025-12-02

### Added
- **Labels Management Panel**: New sidebar section for label-level operations
  - View all labels with instance counts
  - Toggle visibility for all instances of a label category
  - Customize label colors with color picker (24 presets + custom hex input)
  - Per-label color reset button
  - Session-level color persistence (resets when extension closes)
  
- **Advanced Options**: Rendering customization controls
  - Adjustable border width (1-5px)
  - Adjustable fill opacity (0-100%)
  - Settings persist across image switches
  - One-click reset to defaults
  
- **View/Polygon Mode Toggle**: Switch between viewing and editing modes
  - View Mode (👁️): Browse and select annotations without accidental edits
  - Polygon Mode (✏️): Create new polygon annotations
  - Mode selection persists across sessions
  - Default mode is View for safer navigation

- **Image Navigation Buttons**: Quick navigation controls
  - Previous/Next buttons (◀/▶) in toolbar
  - Complement existing A/D keyboard shortcuts

### Improved
- **UTF-8 Encoding**: Proper UTF-8 support for JSON files with international characters
- **Color Validation**: Strict #XXXXXX hex format validation for custom colors
- **UI Polish**: 
  - Color picker limited to 3 rows for better layout
  - Improved placeholder text (#xxxxxx format)
  - Better visual feedback for active/inactive modes

### Technical
- Session-level state persistence using vscode.setState API
- Optimized color cache management
- DocumentFragment for efficient DOM updates

## [0.2.0] - 2025-12-01

### Added
- **Undo/Redo Support**: Full undo/redo functionality with keyboard shortcuts
  - `Ctrl+Z` (`Cmd+Z` on Mac): Undo last action
  - `Ctrl+Shift+Z` or `Ctrl+Y` (`Cmd+Shift+Z` or `Cmd+Y` on Mac): Redo action
  - Supports up to 50 history states
  - Works for all annotation operations (add, edit, delete, visibility toggle)

### Improved
- **Performance Optimizations**: Significantly improved rendering and responsiveness
  - Implemented `requestAnimationFrame` throttling for smooth drawing during mouse movement
  - Added color calculation caching to avoid redundant computations
  - Optimized DOM operations with `DocumentFragment` for faster sidebar rendering
  - Replaced `JSON.parse/stringify` with `structuredClone` for 2-3x faster deep copying
  - Cached frequently accessed DOM references to reduce query overhead
- **Right-Click Behavior**: Fixed context menu appearing when undoing annotation points

### Fixed
- Context menu no longer interferes with right-click point removal during drawing

## [0.1.0] - 2025-12-01

### Initial Release

#### Features
- Polygon annotation on images
- LabelMe JSON format compatibility
- Zoom and pan with mouse-centered pivot
- Shape visibility toggle
- Label editing
- Image navigation (Previous/Next)
- Manual save workflow with unsaved changes protection
- Category-based color coding
- Resizable sidebar
- Keyboard shortcuts (A/D for navigation, Ctrl+S for save, ESC to cancel)

#### Known Issues
- Performance may degrade with very large images
- Limited to polygon shapes only

## Future Releases

See README.md for planned features and roadmap.
