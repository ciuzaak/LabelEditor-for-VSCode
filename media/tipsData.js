// Single source of truth for tooltip text. Stable IDs are referenced from
// data-tip-id attributes on controls. Fields:
//   title:    very short label (3-6 words). May be omitted if desc is enough.
//   desc:     one sentence describing what the control does.
//   shortcut: optional keyboard shortcut string rendered as a <kbd> chip.

const TIPS = {
    // Top toolbar / image browser
    'nav.toggleBrowser':   { title: 'Toggle Image Browser', desc: 'Show or hide the image list on the left.' },
    'nav.prev':            { title: 'Previous Image', desc: 'Open the previous image in the workspace.', shortcut: 'A' },
    'nav.next':            { title: 'Next Image', desc: 'Open the next image in the workspace.', shortcut: 'D' },
    'nav.fileName':        { title: 'Current File', desc: 'Left-click copies the absolute path; right-click copies just the filename.' },
    'nav.imageInfo':       { title: 'Image Info', desc: 'Show file size, dimensions, bit depth, and DPI.' },
    'browser.search':      { title: 'Search Images', desc: 'Filter the image list by filename.' },
    'browser.refresh':     { title: 'Refresh List', desc: 'Rescan the workspace for image files.' },
    'browser.searchClose': { title: 'Close Search', desc: 'Clear the filter and close the search box.' },

    // Drawing modes
    'mode.view':      { title: 'View Mode', desc: 'Pan and select shapes. Drag on empty space to box-select; hold Shift while dragging to add to the selection.', shortcut: 'V' },
    'mode.polygon':   { title: 'Polygon Mode', desc: 'Click to place vertices; double-click or press Enter to close the polygon.', shortcut: 'P' },
    'mode.rectangle': { title: 'Rectangle Mode', desc: 'Drag to draw an axis-aligned rectangle.', shortcut: 'R' },
    'mode.line':      { title: 'Line Mode', desc: 'Click two points to draw a line.', shortcut: 'L' },
    'mode.point':     { title: 'Point Mode', desc: 'Click to place a single annotation point.', shortcut: 'O' },
    'mode.sam':       { title: 'SAM AI Mode', desc: 'Use the SAM service to generate a mask from prompts. Left-click adds a positive point; right-click adds a negative point. Hold Shift to switch to the prompt eraser.', shortcut: 'I' },

    // Sidebar action buttons
    'actions.settings': { title: 'Settings', desc: 'Open theme, view, annotation style, and image adjustment controls.' },
    'actions.tools':    { title: 'Tools', desc: 'Export SVG and run ONNX batch inference.' },
    'actions.save':     { title: 'Save', desc: 'Save annotations to the LabelMe JSON next to the image.', shortcut: 'Ctrl+S' },

    // Theme
    'theme.light': { title: 'Light Theme', desc: 'Use the light theme regardless of the VS Code appearance.' },
    'theme.dark':  { title: 'Dark Theme', desc: 'Use the dark theme regardless of the VS Code appearance.' },
    'theme.auto':  { title: 'Follow VS Code', desc: 'Match the current VS Code color theme.' },

    // View / zoom
    'view.zoomReset': { title: 'Reset Zoom', desc: 'Fit the image to the canvas.' },
    'view.zoomLock':  { title: 'Lock Zoom and Pan', desc: 'Keep the current zoom and scroll position when switching images.' },

    // Annotation style
    'style.borderWidth':      { title: 'Border Width', desc: 'Stroke width used to draw shape borders.' },
    'style.borderWidthReset': { title: 'Reset Border Width', desc: 'Restore the default border width.' },
    'style.fillOpacity':      { title: 'Fill Opacity', desc: 'Alpha for the inside fill of polygons and rectangles.' },
    'style.fillOpacityReset': { title: 'Reset Fill Opacity', desc: 'Restore the default fill opacity.' },

    // Image adjustment — channel
    'channel.lock': { title: 'Lock Channel', desc: 'Keep the current channel selection when switching images. Click to toggle.' },
    'channel.rgb':  { title: 'RGB', desc: 'Display all color channels.' },
    'channel.r':    { title: 'Red', desc: 'Display only the red channel.' },
    'channel.g':    { title: 'Green', desc: 'Display only the green channel.' },
    'channel.b':    { title: 'Blue', desc: 'Display only the blue channel.' },

    // Image adjustment — brightness / contrast
    'image.brightness':      { title: 'Brightness', desc: 'Adjust display brightness (does not modify the file).' },
    'image.brightnessReset': { title: 'Reset Brightness', desc: 'Restore brightness to 100%.' },
    'image.brightnessLock':  { title: 'Lock Brightness', desc: 'Keep brightness when switching images. Click to toggle.' },
    'image.contrast':        { title: 'Contrast', desc: 'Adjust display contrast (does not modify the file).' },
    'image.contrastReset':   { title: 'Reset Contrast', desc: 'Restore contrast to 100%.' },
    'image.contrastLock':    { title: 'Lock Contrast', desc: 'Keep contrast when switching images. Click to toggle.' },

    // CLAHE
    'image.claheToggle':    { title: 'CLAHE', desc: 'Toggle Contrast-Limited Adaptive Histogram Equalization.' },
    'image.claheReset':     { title: 'Reset CLAHE', desc: 'Restore default CLAHE parameters and disable.' },
    'image.claheLock':      { title: 'Lock CLAHE', desc: 'Keep CLAHE settings when switching images. Click to toggle.' },
    'image.claheClipLimit': { title: 'Clip Limit', desc: 'CLAHE clip limit; higher values produce stronger local contrast.' },

    // Tools menu items
    'tools.exportSvg':      { title: 'Export SVG', desc: 'Export current shapes as a standalone SVG file next to the image.' },
    'tools.onnxBatchInfer': { title: 'ONNX Batch Infer', desc: 'Run an ONNX segmentation model over selected images and write polygons.' },

    // Shape context menu (rendered dynamically in main.js)
    'context.edit':          { title: 'Edit', desc: 'Edit polygon vertices.' },
    'context.rename':        { title: 'Rename', desc: 'Change the label of the selected shape(s).', shortcut: 'Ctrl+R' },
    'context.merge':         { title: 'Merge', desc: 'Merge the selected shapes (union for overlapping polygons of the same label, otherwise grouped).', shortcut: 'Ctrl+G' },
    'context.toggleVisible': { title: 'Show/Hide', desc: 'Toggle visibility of the selected shape(s).', shortcut: 'Ctrl+H' },
    'context.delete':        { title: 'Delete', desc: 'Delete the selected shape(s).' },

    // Recently added features (no native title= today). These IDs are kept as
    // a forward-compatible inventory so a future surface (help panel, status
    // hints) can pick them up.
    'shortcut.merge':         { title: 'Merge Shapes', desc: 'Union overlapping polygons of the same label, otherwise group selected shapes into one merged annotation.', shortcut: 'Ctrl+G' },
    'shortcut.rename':        { title: 'Rename Selected', desc: 'Open the rename dialog for the selected shape(s).', shortcut: 'Ctrl+R' },
    'shortcut.toggleVisible': { title: 'Toggle Visibility', desc: 'Hide or show the selected shape(s).', shortcut: 'Ctrl+H' },
    'sam.positivePoint':      { title: 'Positive Prompt', desc: 'Left-click in SAM mode to add a positive point that pulls the mask toward it.' },
    'sam.negativePoint':      { title: 'Negative Prompt', desc: 'Right-click in SAM mode to add a negative point that pushes the mask away.' },
    'sam.eraser':             { title: 'Prompt Eraser', desc: 'Hold Shift in SAM mode to switch to the eraser; click a prompt or drag to remove it.' },
    'select.box':             { title: 'Box Select', desc: 'In View mode, drag on empty space to box-select shapes. Hold Shift to add to the current selection.' },
    'select.multi':           { title: 'Multi-Select', desc: 'Ctrl-click in the instance list to select multiple shapes.' },

    // ONNX modal
    'onnx.modelDir':       { title: 'Model Directory', desc: 'Directory holding the .onnx model and a labels.json mapping mask values (skip 0 = background) to label names.' },
    'onnx.pythonPath':     { title: 'Python Interpreter', desc: 'Path to the Python interpreter that has onnxruntime installed.' },
    'onnx.device':         { title: 'Device', desc: 'Run inference on CPU or GPU.' },
    'onnx.gpuIndex':       { title: 'GPU Index', desc: 'Which GPU to use when Device is GPU.' },
    'onnx.colorFormat':    { title: 'Color Format', desc: 'How the model expects channel order — most ONNX exports use RGB.' },
    'onnx.scope':          { title: 'Scope', desc: 'Run the model on every image in the workspace or only on the current image.' },
    'onnx.mode':           { title: 'Existing Annotations', desc: 'How to combine inference output with annotations already saved next to each image.' },
    'onnx.modelDirBrowse': { title: 'Browse', desc: 'Pick the model directory.' },
    'onnx.pythonBrowse':   { title: 'Browse', desc: 'Pick the Python executable.' },

    // SAM modal
    'sam.modelDir':       { title: 'Model Directory', desc: 'Directory holding encoder and decoder ONNX files (SAM1 or SAM2, auto-detected).' },
    'sam.pythonPath':     { title: 'Python Interpreter', desc: 'Path to the Python interpreter that has onnxruntime installed.' },
    'sam.device':         { title: 'Device', desc: 'Run the SAM service on CPU or GPU.' },
    'sam.gpuIndex':       { title: 'GPU Index', desc: 'Which GPU to use when Device is GPU.' },
    'sam.encodeMode':     { title: 'Encode Mode', desc: 'Full Image is the default. Local Crop encodes only the visible viewport when zoomed in for better small-target accuracy.' },
    'sam.port':           { title: 'Service Port', desc: 'Local port for the SAM HTTP service.' },
    'sam.modelDirBrowse': { title: 'Browse', desc: 'Pick the SAM model directory.' },
    'sam.pythonBrowse':   { title: 'Browse', desc: 'Pick the Python executable.' }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TIPS };
} else if (typeof window !== 'undefined') {
    window.TIPS = TIPS;
}
