# Changelog

All notable changes to the "LabelEditor for VSCode" extension will be documented in this file.

## [0.13.4] - 2026-04-07

### Added
- **Brightness & Contrast Controls**: Adjust image display brightness and contrast without modifying the original image
  - Sliders in ⚙️ Settings panel, placed right after Zoom
  - Range: 10%–300%, default 100%, step 5%
  - Each slider has its own **reset** (↺) and **lock** (🔓/🔒) button
  - **Lock**: Preserves the value when switching images; **Unlock** (default): resets to 100% on each new image
  - Brightness and contrast lock independently
  - Uses CSS filter — purely visual, does not affect original image data or pixel inspection values
  - All settings persist across sessions

## [0.13.3] - 2026-04-06

### Added
- **Multi-Instance Selection**: Select and operate on multiple annotation instances at once
  - **Ctrl+Click** (canvas or instance list): Toggle individual shapes in/out of selection
  - **Shift+Click** (instance list): Range select from last-clicked to current item
  - **Ctrl+A**: Select all instances (including hidden ones, so they can be batch-shown)
  - **View Mode Box Select**: Drag to draw a selection rectangle; all shapes whose bounding box intersects are selected. Ctrl+Drag to add to existing selection
  - **ESC**: Clear multi-selection (lowest priority, after canceling menus/drawing/edit mode)
  - **Delete/Backspace**: Batch delete all selected shapes
  - **Right-Click Context Menu**: Adapts for multi-selection
    - Shows count in menu items (e.g. "Delete (5)")
    - **Rename**: Batch rename all selected to the same label
    - **Hide/Show**: Deterministic — hides all if any are visible, shows all if all are hidden
    - **Delete**: Batch delete all selected
    - **Edit** is hidden when multiple shapes are selected (vertex editing is single-shape only)
  - **Instance List Buttons**: Eye/Pencil/Delete buttons apply to all selected when clicking on a multi-selected item
  - **Instances Count**: Shows `(selected/total)` when multiple selected, e.g. `(3/10)`

### Fixed
- **Edit Mode Safety**: Changing selection (single-click, Ctrl+click, Shift+click, Ctrl+A, box select) now properly exits vertex edit mode to prevent stale edit handles
- **Undo/Redo Edit Mode**: Undo and redo now exit edit mode before swapping history snapshots, preventing crashes from stale `shapeBeingEdited` indices
- **Labels Panel Sync**: Per-instance visibility changes (single and batch) now refresh the Labels sidebar to keep `allHidden` state accurate
- **Keyboard Shortcut Guard**: Non-Ctrl keyboard shortcuts (A/D navigation, V/P/R/L/O mode switches, Delete, ESC) no longer fire when an input/textarea/select element is focused (e.g. image search box)
- **Context Menu Staleness**: Context menu is now hidden on programmatic selection changes (Ctrl+A, undo/redo, image switch) and when sidebar buttons are clicked

## [0.13.2] - 2026-03-31

### Added
- **Eraser Tool**: Erase portions of existing annotations across all editing modes (except SAM and View)
  - **Shift+Click**: Start erasing with a polygon shape
  - **Shift+Long-press+Drag**: Start erasing with a rectangle shape; second click to confirm
  - Erased area is subtracted from all overlapping annotations using boolean difference
  - Fully erased instances are automatically deleted
  - Supports polygon, rectangle, linestrip, and point annotations
  - Rectangle annotations convert to polygon when the remainder is non-rectangular
  - Interior punch-outs (holes) are decomposed into multiple hole-free polygons via recursive vertical/horizontal slicing, since LabelMe format does not support holes
  - Right-click or ESC to cancel an in-progress erase
  - Shift key only needed for the initial click; subsequent clicks don't require Shift

### Changed
- **SAM Box Annotation**: Adjusted interaction to "Click-Drag-Click" pattern
  - Long-press (≥300ms) or drag to set the first corner
  - Second click to confirm the box and trigger SAM decoding
  - Right-click to cancel the pending box
  - ESC now also cancels a pending box second-click

### Fixed
- **Eraser State Reset**: Eraser state (points, mode, drag) is now properly cleared when switching images or modes
- **No-Op Erase Detection**: Erasing in empty space no longer creates spurious undo history entries; uses polygon area comparison instead of exact point matching
- **Selection Index Stability**: Inserting new shape fragments during erase no longer silently shifts `selectedShapeIndex` to a different shape

## [0.13.1] - 2026-03-30

### Fixed
- **Windows Startup Race Condition**: Fixed UI rendering failure on Windows where JavaScript executed before CSS finished loading via external `<link>`, causing layout chaos. CSS is now inlined into the HTML template

### Changed
- **Pixel Value Display Simplified**: Pixel values are now always displayed as raw R,G,B from the canvas, removing header-based channel detection to avoid unnecessary file I/O overhead

## [0.13.0] - 2026-03-29

### Added
- **High-Zoom Pixel Inspection**: Enhanced zoom for pixel-level annotation workflows
  - Maximum zoom increased to 10,000% (100×)
  - **Pixelated Rendering**: Nearest-neighbor interpolation activates at ≥2,000% zoom, showing sharp pixel blocks
  - **Pixel Grid Overlay**: Dynamic grid lines appear at ≥2,000% zoom, precisely aligned with pixel boundaries
  - **Pixel Value Display**: At maximum zoom (10,000%), each pixel shows its R,G,B value
    - Text color adapts to pixel brightness for readability
    - Only renders values for pixels in the current viewport for performance
    - Updates on scroll and viewport resize

### Fixed
- **Pixel Grid Alignment**: Zoom level snaps to integer values in pixel rendering mode (≥2,000%), ensuring every image pixel maps to exactly N×N screen pixels for perfect grid alignment
- **Grid Color on Theme Change**: Pixel grid overlay color now updates immediately when switching between light and dark themes
- **Pixel Values on Viewport Resize**: Pixel value labels now refresh when the panel is resized (window resize, sidebar drag, etc.)
- **Zero-Viewport Guard**: `drawPixelValues()` now safely handles collapsed viewport during aggressive panel resizing

## [0.12.6] - 2026-03-26

### Fixed
- **Async Startup Performance**: Opening large image folders no longer blocks the UI
  - File scanning runs in the background; sidebar shows "(scanning...)" until complete
  - `webviewReady` handshake ensures image list is only sent after the webview is fully initialized
  - Scan generation tracking prevents stale results from overwriting the UI after rapid folder switches
- **Panel Title**: Title now reflects the workspace folder name or single image filename, set once at creation and stable during navigation
- **Empty Folder Handling**: Opening an empty folder correctly shows "(0)" and "No images found" without "Error loading image" flashes
- **Panel Reuse State**: Reusing a panel for a single image no longer gets stuck in "(scanning...)" state
- **Sidebar Residue**: Re-scanning the same folder immediately clears the old sidebar list instead of showing stale entries until the new scan completes

### Changed
- **Single Image Mode**: Opening a single image bypasses background scanning entirely for instant startup
- **Incremental Image Updates**: Image switching uses `postMessage` instead of full HTML regeneration

## [0.12.5] - 2026-03-26

### Fixed
- **SAM Mode Left-Click Selection**: Left-clicking an existing annotation in SAM idle state now selects it (consistent with other modes)
  - Only applies when SAM is idle (no active prompts, mask, or pending click); during active annotation, left-click still adds SAM prompts as before
- **SAM Mode Deselection**: Clicking empty space to start SAM annotation now properly clears any previously selected shape highlight

## [0.12.4] - 2026-03-26

### Fixed
- **SAM Mode Right-Click Context Menu**: Right-clicking an existing annotation in SAM mode now shows the context menu (Edit/Rename/Hide/Delete) instead of undoing the last SAM prompt, consistent with other modes
  - Only applies when SAM is idle (no active prompts or mask); during active annotation, right-click still undoes prompts as before
  - Properly handles edge cases: context menu dismiss, edit mode exit, and pending click debounce window

### Changed
- **Updated Extension Icon**: New icon design

## [0.12.3] - 2026-03-25

### Fixed
- **Critical: Plugin Fails to Load**: Fixed JavaScript syntax error (`Invalid left-hand side in assignment`) caused by optional chaining `?.` on the left side of an assignment in SAM GPU config

## [0.12.2] - 2026-03-25

### Added
- **GPU Selection for ONNX/SAM**: Multi-GPU machines now show a GPU dropdown in ONNX Batch Infer and SAM Config modals
  - GPU selection persists across sessions via globalState
  - Automatically falls back to GPU 0 if the previously selected GPU is no longer available
- **ESC Clears SAM Prompts**: Pressing ESC in SAM mode now clears all active points, boxes, and mask previews at once

### Fixed
- **SAM ESC vs Search Conflict**: Pressing ESC to close the sidebar search box in SAM mode no longer accidentally clears in-progress SAM prompts
- **GPU Detection Blocking**: GPU detection (`nvidia-smi`) now runs asynchronously, preventing the extension host from freezing for up to 5 seconds
- **GPU Submit Before Detection**: Submitting ONNX/SAM config before GPU detection completes now correctly uses the persisted GPU index instead of defaulting to undefined

## [0.12.1] - 2026-03-25

### Added
- **SAM Local Crop Mode**: Optional viewport-based encoding for improved accuracy on small targets
  - Select "Full Image" or "Local Crop" encode mode when configuring SAM service
  - In local mode, zoomed-in viewport is used as the encoding region instead of the full image
  - Visual indicator (yellow dashed rectangle) shows the currently encoded crop region
  - Subpixel-accurate crop extraction preserves fractional viewport origin via `cv2.warpAffine`
  - Smart state machine: fresh sequence detection, prompt-aware cache, modal cancel/restore

### Fixed
- **Mask Polygon Alignment**: Added +0.5 pixel-center offset to mask-derived contour points in both SAM and ONNX batch inference, fixing systematic upper-left bias when zoomed in
- **SAM Toolbar Icon**: Changed SAM mode button from 🤖 to 🧠 to match README and CHANGELOG documentation

## [0.12.0] - 2026-03-24

### Added
- **SAM AI Annotation Mode**: Interactive annotation powered by Segment Anything Model (SAM)
  - New toolbar button (🧠) and keyboard shortcut (`I`) to enter SAM mode
  - Supports both SAM1 and SAM2 ONNX models with automatic variant detection
  - **Left click**: Positive point prompt
  - **Shift+Left click**: Negative point prompt
  - **Left click + Drag**: Rectangle (box) prompt
  - **Right click**: Undo last prompt
  - **Double click**: Confirm annotation and enter label
  - Point and box prompts are mutually exclusive (adding one clears the other)
  - Real-time SVG overlay visualization for prompts and generated mask contours
  - Lazy encoding: image embedding is computed on first interaction, not on mode entry
  - Stale decode invalidation: fast prompt changes won't apply outdated results
  - Configuration modal for model directory, Python interpreter, device (CPU/GPU), and port
  - All SAM settings persist across sessions (globalState)
  - SAM service runs as a standalone Python HTTP server in VS Code terminal
  - Requires: Python with `onnxruntime`, `opencv-python`, `numpy`
  - Recommended models: [SAM2 ONNX Models](https://huggingface.co/vietanhdev/segment-anything-2-onnx-models)

### Fixed
- **Label/Color Dialog Double-Click**: Double-clicking a recommended label chip or a preset color now immediately confirms the dialog
- **Label Dialog Cross-Section Highlight**: Clicking a label chip in "Current Image" then in "History" (or vice versa) no longer leaves both highlighted simultaneously
- **Modal Keyboard Shortcuts**: All popup dialogs (Label, Color Picker, ONNX Infer, SAM Config) now consistently support ESC to cancel and Enter to confirm
  - Enter is not intercepted when focus is on a button (Cancel, Browse) or textarea (Description), preserving native behavior

## [0.11.2] - 2026-03-23

### Added
- **ONNX Batch Inference**: Run ONNX segmentation models on workspace images via Tools → 🤖 ONNX Batch Infer
  - Configurable model directory, Python interpreter, CPU/GPU device, RGB/BGR color format
  - Scope selection: infer on all images or current image only
  - Existing annotation handling: skip / merge / overwrite
  - Browse buttons (📂) for model directory and Python interpreter selection via native dialog
  - All settings persist across sessions (globalState)
  - Progress and errors displayed in VS Code terminal (tqdm)
  - Bundled Python script supports Chinese file paths, dynamic ONNX inputs, and smart resize
  - labels.json format hint (ⓘ) and polygon-only output note in the modal
  - Cross-platform terminal command (PowerShell `&` operator detection)
- **Right-Click Copy Filename**: Right-click the filename in toolbar to copy just the filename (basename)
  - Left-click still copies the absolute path

### Fixed
- **Modal Keyboard Shortcut Leak**: Global shortcuts (D, A, P, etc.) no longer fire when typing in the ONNX config or color picker modals

## [0.11.1] - 2026-03-23

### Added
- **Instance Description Field**: Optional description for each annotation instance
  - New textarea in the label modal, below the label input
  - Description is saved to JSON only when non-empty (backward compatible)
  - Displayed as a grey subtitle in the sidebar instances list
  - Pre-filled when editing existing annotations
  - Label chips now fill input without auto-submitting, allowing description entry

## [0.11.0] - 2026-03-17

### Fixed
- **SVG Export — Point Annotations**: Point-mode annotations are now correctly exported as SVG `<circle>` elements instead of being silently dropped
- **SVG Export — Zero-Size Guard**: Export SVG is now blocked until the image finishes loading, preventing blank SVGs with `width="0"` and `height="0"`

## [0.10.6] - 2026-03-13

### Fixed
- **Save Race Condition (P0)**: Fixed data-loss bug where navigating during an in-flight save could discard newer edits
  - Reworked save-navigate protocol: extension now waits for webview confirmation before navigating
  - Added `isSaving` lock to prevent concurrent saves on both extension and webview sides
  - Save completions are now version-aware — only marks clean if user hasn't edited since save started

- **Premature markClean (P0)**: `save()` no longer clears dirty state immediately
  - Dirty state is now driven by backend `saveComplete` confirmation
  - Added `saveFailed` message to preserve dirty state on write errors

- **Pending Navigation Leak (P1)**: Fixed stale pending navigation firing on a later unrelated save
  - Deferred navigation is cleared on save failure
  - Manual toolbar saves no longer trigger navigation-initiated pending navigations

- **Undo/Redo Visibility (P1)**: Fixed label-level visibility reverting after undo/redo
  - History snapshots now preserve per-shape `visible` state
  - `applyLabelVisibilityState()` re-applied after every undo/redo to maintain label-level overrides

- **Tab-Switch State Loss (P1)**: Fixed webview state being destroyed when switching tabs
  - Enabled `retainContextWhenHidden` on all panel creation paths
  - Removed unnecessary `onDidChangeViewState` full-rebuild handler

- **localResourceRoots (P1)**: Fixed images from subdirectories failing to load after navigation
  - `updateWebviewOptions` now includes root path, not just current image directory

### Changed
- **Single Image Mode**: Opening a single image no longer scans the entire workspace
  - Only the clicked image is loaded; use Refresh button to scan the directory
  - Switching to folder mode via `Open Folder for Annotation` always refreshes image list

- **Folder Mode Transition (P1)**: Fixed image list staying stuck at one image when switching from single-image mode to folder mode

## [0.10.5] - 2026-01-07

### Fixed
- **Edit Mode Persistence**: Fixed bug where edit mode was not exited when switching images
  - Previously, if you entered edit mode and then switched images (with no changes or after discarding), edit mode would incorrectly persist
  - Now properly calls `exitShapeEditMode(false)` when handling image updates
  
- **Undo/Redo Dirty State**: Fixed save button remaining highlighted after undoing to saved state
  - Introduced `savedHistoryIndex` to track the history position when last saved
  - Undo/redo now correctly detects when state matches saved state and updates dirty indicator accordingly
  - Properly handles edge cases: history truncation (branching) and MAX_HISTORY limit

### Added
- **Section Counts**: Labels and Instances headers now display count statistics
  - Shows "Labels (N)" and "Instances (M)" for quick overview
  - Updates dynamically as annotations are added/removed

- **Disabled System Context Menu**: Right-click context menu is now disabled globally to prevent browser default menu
- **Disabled Text Selection**: Text selection is disabled throughout the plugin interface for a more app-like experience

### Improved
- **Image List Sorting**: Updated to VS Code-style hierarchical natural sorting
  - Folders like "folder2" now correctly appear before "folder10"
  - Path segments are compared individually for proper multi-level folder sorting
  - Uses `localeCompare` with `{ numeric: true, sensitivity: 'base' }`

## [0.10.3] - 2025-12-31

### Fixed
- **Lock View State Sync**: Fixed wheel zoom not updating locked view state when image fits in viewport
  - Previously relied on scroll event which doesn't fire when scrollLeft/scrollTop reset to 0
  - Now explicitly saves state after every wheel zoom operation
- **Lock View Resize Handling**: Added debounced resize handler to preserve Lock View state when window is resized
  - Prevents visual jumps in relative zoom when switching images after resizing

## [0.10.2] - 2025-12-31

### Added
- **Sidebar Split Layout**: Right sidebar now has three independent sections
  - **Config Section**: Always fully visible (mode buttons, save, advanced options)
  - **Labels Section**: Independent scrolling for label list
  - **Instances Section**: Independent scrolling for instance list
  - **Adjustable Height Ratio**: Drag the resizer between Labels and Instances to adjust their relative heights
  - Height ratio persists across sessions

- **Lock View Mode**: New option to preserve zoom level and position when navigating between images
  - Toggle On/Off in Advanced Options (below Theme)
  - Uses normalized position storage (relative to image center)
  - Ensures consistent view across different image sizes
  - Small images that fit in viewport won't corrupt saved state
  - Setting persists across sessions (globalState)

### Fixed
- **Divide-by-Zero Protection**: Added safety check in `getNormalizedViewState()` for zero-dimension images

## [0.10.0] - 2025-12-31

### Added
- **Context Menu Integration**: Comprehensive context menu for shapes
  - **Right-click** any shape to open the menu (works in both View and Edit modes)
  - **Edit**: Enter unified edit mode for vertex manipulation and dragging
  - **Rename**: Quickly rename the label of the selected shape
  - **Hide**: Toggle visibility of the selected shape
  - **Delete**: Delete the selected shape (with red danger styling)

### Improved
- **Unified Edit Mode**: Seamlessly combined Drag and Edit modes
  - Simply click a shape to start dragging it
  - Click a vertex/point to start adjusting its position
  - No need to switch between separate "Move" and "Edit" tool modes
  - Visual cursor feedback (Move vs Crosshair)
- **Edit Interaction**:
  - **Click-Outside to Cancel**: Clicking outside a shape while editing now cancels changes (same as ESC)
  - **Context Menu Consistency**: Right-click context menu now works reliably in all modes, including View mode
## [0.9.5] - 2025-12-30

### Fixed
- **Zoom Annotation Alignment**: Fixed annotation misalignment with target positions during zoom on large images
  - Root cause: `Math.floor()` rounding errors in display dimension calculations
  - Now uses exact floating-point values for sub-pixel accurate canvas/SVG alignment
  
- **Recent Labels Persistence**: Fixed intermittent issue where recent labels were not saved after first annotation
  - Root cause: Async write race condition and missing vscodeState backup
  - Now uses dual-save mechanism (vscodeState + globalState) for reliable persistence

### Improved
- **Code Quality**: All async message handlers now properly use `await` for consistent error handling

## [0.9.4] - 2025-12-23

### Added
- **Image Search**: Filter image list by name with real-time search
  - 🔍 Search button in sidebar header
  - `Ctrl+F` shortcut to toggle search box
  - Shows filtered count (e.g., "5/20")
- **Search Logic**:
  - Auto-expands sidebar if collapsed when searching
  - `Esc` or Close button to clear search
  - Toggle logic: Open -> Focus -> Close

### Fixed
- **Search State Persistence**: Search query survives webview reloads (e.g., when clicking images)

## [0.9.3] - 2025-12-23

### Added
- **Point Mode (•)**: New annotation mode for point landmarks
  - Single click to create a point annotation
  - Keyboard shortcut: `O`
  - LabelMe compatible: saves as `shape_type: "point"`
  - Cancel clears the point (unlike other modes that allow continue drawing)

- **Line Mode (⟋)**: New annotation mode for polyline annotations
  - Click to add points to create a line
  - Double-click the last point to complete
  - Right-click to undo last point
  - Keyboard shortcut: `L`
  - LabelMe compatible: saves as `shape_type: "linestrip"`

- **Panel Icon**: Editor tab now displays the extension icon for better visibility

### Improved
- **Mode Button Order**: Reordered to View → Polygon → Rectangle → Line → Point
- **Mode Switching**: Switching between any modes now cancels ongoing drawing (prevents orphaned points)

## [0.8.0] - 2025-12-06

### Added
- **Theme Switching**: Full light/dark theme support with three options
  - ☀️ Light mode - bright theme for well-lit environments
  - 🌙 Dark mode - dark theme matching VS Code dark themes
  - 🔄 Auto mode - automatically follows VS Code's current theme
  - Theme preference persists across sessions

- **Themed Scrollbars**: Scrollbars now match the current theme colors

- **Individual Reset Buttons**: Border Width and Fill Opacity now have separate ↺ reset icons
  - Only appear when value differs from default
  - Matches existing color reset button style

- **Auto-Scroll to Selected Instance**: When clicking an annotation on canvas, the sidebar automatically scrolls to show the selected item

### Fixed
- **Settings Persistence Bug**: Fixed issue where settings (theme, border width, opacity) were reset after switching images on first change
  - Now uses synchronous vscodeState for immediate persistence
  
- **Advanced Options State**: Dropdown expand/collapse state now persists across image switches

- **saveState Overwrite Bug**: Fixed critical bug where saveState() was overwriting global settings

### Improved
- **Code Cleanup**: Removed ~50 lines of dead/duplicate code
  - Deleted unused `updateBorderWidth()` and `updateFillOpacity()` functions
  - Removed duplicate `body.theme-dark` CSS (`:root` already defines dark as default)

## [0.7.0] - 2025-12-06

### Added
- **Image Browser Sidebar**: New sidebar panel for browsing all images in the workspace
  - Toggle with ☰ button in toolbar
  - Shows all images with folder structure
  - Click to navigate to any image instantly
  - Highlights current image
  - Resizable sidebar width
  
- **Virtual Scrolling**: Handles 8000+ images smoothly
  - Only renders visible items (~50 DOM elements)
  - Smooth sidebar resizing even with thousands of images
  - No performance degradation with large image collections

### Improved
- **Image Switching Performance**: Dramatically faster image navigation
  - Images no longer trigger full workspace scan on every switch
  - Incremental updates via postMessage instead of full HTML regeneration
  - Cached workspace image list (scan once per session)
  
- **Code Quality**: Removed duplicate virtual scroll code, added stale callback protection

## [0.6.3] - 2025-12-05

### Improved
- **Label Suggestions Enhancement**: Redesigned the label suggestion panel in the label input modal
  - Split into two distinct sections: "Current Image" and "History"
  - **Current Image**: Shows labels already used in the current image, ordered by most recently annotated
  - **History**: Shows globally stored historical labels, ordered by most recently used (max 10)
  - No duplicate labels between sections - history is automatically filtered
  - If no annotations exist in the current image, the "Current Image" section is hidden
  - Historical labels now persist across VS Code sessions (saved to globalState)

## [0.6.2] - 2025-12-05

### Improved
- **Cancel Label Input Behavior**: Improved the cancel behavior when entering label text
  - Clicking "Cancel" or pressing ESC now only reverts the "close polygon" action instead of clearing all points
  - Users can continue drawing after canceling, allowing for fine-tuning annotations
  - Applies to both polygon and rectangle modes

### Fixed
- **ESC Key in Label Modal**: Fixed ESC key not responding in the label input dialog
  - Moved ESC listener to document level to ensure it works regardless of focus location

## [0.6.1] - 2025-12-04

### Fixed
- **Overlapping Instance Selection**: Fixed bug where overlapping annotations could not be clicked/selected
  - Implemented click-through cycling: repeatedly click the same location to cycle through overlapping instances
  - Hidden shapes are now properly excluded from click detection
  - Supports all overlapping annotation types (polygon and rectangle)

- **Border Width Decimal Values**: Fixed bug where decimal border width values (1.5, 2.5, etc.) were not supported
  - Changed value parsing from `parseInt` to `parseFloat` to preserve decimal precision

### Improved
- **Code Quality & Performance**:
  - Fixed color cache invalidation bug when fill opacity changes
  - Eliminated variable shadowing in `findShapeIndexAt()` function
  - Optimized event listener management in color picker to prevent memory leaks
  - Reduced cursor style thrashing by ~99% during mouse movement
  - Replaced all `var` declarations with `const`/`let` for better code quality

## [0.6.0] - 2025-12-03

### Added
- **Global Settings Persistence**: 
  - Custom label colors, border width, and fill opacity settings are now saved globally.
  - Settings persist even after closing and reopening VS Code.
  - Added "Reset" functionality to restore default settings.

### Fixed
- **Image Loading Bug**: Fixed a critical issue where images failed to open due to a missing variable declaration (`vscodeState`).
- **Fill Opacity Issues**: 
  - Fixed an issue where setting opacity to 0 would reset it to default.
  - Fixed an issue where resetting options didn't immediately update the view.
  - Selected shapes now respect the global fill opacity setting.

### Improved
- **Code Quality & Performance**:
  - Converted synchronous file I/O to async/await for non-blocking operations
  - Added resource cleanup on page unload to prevent memory leaks
  - Extracted magic numbers into named constants for better maintainability
  - Optimized color picker with event delegation and DocumentFragment
  - Enhanced error handling with user notifications
  - Removed duplicate preset colors from the color palette

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
