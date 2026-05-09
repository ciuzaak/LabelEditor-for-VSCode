const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const svgOverlay = document.getElementById('svgOverlay');
const canvasWrapper = document.getElementById('canvasWrapper');
const saveBtn = document.getElementById('saveBtn');
const statusSpan = document.getElementById('status');

// Attach the status bus to the same DOM node. notifyBus is the only writer of
// #status from this point forward; direct statusSpan.textContent writes are
// intentionally not used.
if (window.notifyBus) {
    window.notifyBus.attach({ statusEl: statusSpan });
}

// Attach the rich tooltip to every static [data-tip-id] element. attach is
// idempotent (skips already-bound nodes), so it is safe to re-call after
// dynamic renders.
if (window.tooltip && window.TIPS) {
    window.tooltip.attach(document, window.TIPS);
}
const shapeList = document.getElementById('shapeList');
const labelModal = document.getElementById('labelModal');
const labelInput = document.getElementById('labelInput');
const descriptionInput = document.getElementById('descriptionInput');
const modalOkBtn = document.getElementById('modalOkBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const recentLabelsDiv = document.getElementById('recentLabels');
const resizer = document.getElementById('resizer');
const sidebar = document.getElementById('sidebar');
const canvasContainer = document.querySelector('.canvas-container'); // 缓存DOM引用

// SVG命名空间
const SVG_NS = 'http://www.w3.org/2000/svg';


// Navigation buttons
const prevImageBtn = document.getElementById('prevImageBtn');
const nextImageBtn = document.getElementById('nextImageBtn');

// Mode toggle buttons
const viewModeBtn = document.getElementById('viewModeBtn');
const pointModeBtn = document.getElementById('pointModeBtn');
const lineModeBtn = document.getElementById('lineModeBtn');
const polygonModeBtn = document.getElementById('polygonModeBtn');
const rectangleModeBtn = document.getElementById('rectangleModeBtn');
const samModeBtn = document.getElementById('samModeBtn');


// Labels management elements
const labelsList = document.getElementById('labelsList');
const colorPickerModal = document.getElementById('colorPickerModal');
const customColorInput = document.getElementById('customColorInput');
const colorOkBtn = document.getElementById('colorOkBtn');
const colorCancelBtn = document.getElementById('colorCancelBtn');

// Settings/Tools dropdown elements
const settingsMenuBtn = document.getElementById('settingsMenuBtn');
const settingsMenuDropdown = document.getElementById('settingsMenuDropdown');
const borderWidthSlider = document.getElementById('borderWidthSlider');
const borderWidthValue = document.getElementById('borderWidthValue');
const borderWidthResetBtn = document.getElementById('borderWidthResetBtn');
const fillOpacitySlider = document.getElementById('fillOpacitySlider');
const fillOpacityValue = document.getElementById('fillOpacityValue');
const fillOpacityResetBtn = document.getElementById('fillOpacityResetBtn');
const brightnessSlider = document.getElementById('brightnessSlider');
const brightnessValue = document.getElementById('brightnessValue');
const brightnessResetBtn = document.getElementById('brightnessResetBtn');
const brightnessLockBtn = document.getElementById('brightnessLockBtn');
const contrastSlider = document.getElementById('contrastSlider');
const contrastValue = document.getElementById('contrastValue');
const contrastResetBtn = document.getElementById('contrastResetBtn');
const contrastLockBtn = document.getElementById('contrastLockBtn');

// Image Browser elements
const imageBrowserToggleBtn = document.getElementById('imageBrowserToggleBtn');
const imageBrowserSidebar = document.getElementById('imageBrowserSidebar');
const imageBrowserResizer = document.getElementById('imageBrowserResizer');
const imageBrowserList = document.getElementById('imageBrowserList');
const refreshImagesBtn = document.getElementById('refreshImagesBtn');
const searchImagesBtn = document.getElementById('searchImagesBtn');
const searchInputContainer = document.getElementById('searchInputContainer');
const searchInput = document.getElementById('searchInput');
const searchCloseBtn = document.getElementById('searchCloseBtn');

// Theme elements
const themeLightBtn = document.getElementById('themeLightBtn');
const themeDarkBtn = document.getElementById('themeDarkBtn');
const themeAutoBtn = document.getElementById('themeAutoBtn');

let img = new Image();

let shapes = [];
let currentPoints = [];
let isDrawing = false;
let selectedShapeIndex = -1;
let selectedShapeIndices = new Set(); // Multi-selection set
let isBatchRenaming = false; // Whether label modal is renaming multiple shapes
// Box selection state (view mode drag-to-select)
let isBoxSelecting = false;
let boxSelectStart = null;   // {x, y} in image coords
let boxSelectCurrent = null; // {x, y} in image coords
let editingShapeIndex = -1;
let recentLabels = initialGlobalSettings.recentLabels || [];

// Dirty State
let isDirty = false;

// Current interaction mode ('view', 'point', 'line', 'polygon', 'rectangle', or 'sam')
let currentMode = 'view'; // 默认为view模式

// --- SAM State ---
let samServicePort = 8765;
let samServiceRunning = false;
let samCurrentImagePath = null;   // 当前已 encode 的图片路径
let samPrompts = [];              // 当前的 prompt 列表
let samMaskContour = null;        // 当前推理结果（轮廓点数组）
let samIsDragging = false;        // 是否正在拖拽框选
let samDragStart = null;          // 框选起点 {x, y}
let samDragCurrent = null;        // 框选当前位置
let samIsEncoding = false;        // 是否正在 encode
let samIsDecoding = false;        // 是否正在 decode
let samDecodeVersion = 0;         // 用于无效化过期的 decode 响应
const SAM_DRAG_THRESHOLD = 5;     // 拖拽阈值（像素）
let samBoxSecondClick = false;    // 框选模式等待第二次点击
let samMouseDownTime = 0;         // mousedown 时间戳，用于长按检测
const SAM_LONG_PRESS_MS = 300;    // SAM 长按阈值（ms）
let samEncodeMode = 'full';       // 'full' | 'local' — encode entire image or visible viewport
let samCachedCrop = null;         // { x, y, w, h } — crop region of the currently cached encoding (null = full image)
let samIsFreshSequence = true;    // True if we are starting a new prompt sequence and can adopt a new crop

// --- Shift feedback state ---
let shiftPressed = false;
const ERASER_CURSOR_DATA_URI = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'>' +
    '<path d=\'M3 17l6-6 5 5 7-7v3l-7 7-5-5-6 6z\' fill=\'%23ff6b35\' stroke=\'white\' stroke-width=\'1.5\'/>' +
    '</svg>'
) + '") 3 17, crosshair';

// --- Eraser State ---
let eraserActive = false;          // Whether currently in eraser drawing mode
let eraserPoints = [];             // Points of the eraser shape being drawn
let eraserMode = null;             // 'polygon' | 'rectangle' | null
let eraserMouseDownTime = 0;       // Timestamp of mousedown for long-press detection
let eraserMouseDownPos = null;     // {x, y} position of mousedown
let eraserIsDragging = false;      // Whether mouse has moved enough to be a drag
let eraserDragCurrent = null;      // {x, y} current drag position for rectangle preview during initial drag
let eraserRectSecondClick = false; // Whether we're waiting for second click after long-press/drag to complete rectangle
const ERASER_LONG_PRESS_MS = 300;  // Long-press threshold (ms)
const ERASER_DRAG_THRESHOLD = 5;   // Drag threshold (px in image coords)

// Zoom & Pan variables
let zoomLevel = 1;
let zoomAnimationFrameId = null; // 缩放节流

// 常量定义
const ZOOM_FIT_RATIO = 0.98;      // 适应屏幕时的缩放比例
const ZOOM_MAX = 100;               // 最大缩放倍数 (10000%)
const ZOOM_MIN = 0.1;              // 最小缩放倍数
const ZOOM_FACTOR = 1.1;           // 滚轮缩放因子
const PIXEL_RENDER_THRESHOLD = 20; // zoomLevel >= 20 (2000%) 时启用像素块渲染+网格
const PIXEL_VALUES_ZOOM = ZOOM_MAX; // 达到最大缩放时显示像素RGB/灰度值

// Padding (in CSS pixels) around the image inside canvasWrapper.
// Lets the cursor overshoot the image edge so the outermost pixels are reliably clickable.
// Must match the padding value in style.css #canvasWrapper.
const CANVAS_EDGE_PADDING = 5;

// Clamp an image-space (x, y) point to the image bounds.
// Use at every site that records cursor position as a shape vertex / prompt point.
// Hit-testing does not need this (clamping does not change the result).
function clampImageCoords(x, y) {
    const w = (img && img.width) ? img.width : 0;
    const h = (img && img.height) ? img.height : 0;
    return [
        Math.max(0, Math.min(w, x)),
        Math.max(0, Math.min(h, y))
    ];
}

const CLOSE_DISTANCE_THRESHOLD = 100; // 多边形闭合距离阈值

// Undo/Redo History (实例级别 - 只记录shapes的变化)
let history = []; // 历史记录栈
let historyIndex = -1; // 当前历史位置
let savedHistoryIndex = -1; // 保存时的历史位置，用于判断是否需要更新dirty状态
let pendingSaveHistoryIndex = -1; // 发起保存请求时的历史位置，用于确认保存完成时匹配
let isSaving = false; // Whether a save is currently in flight (blocks concurrent saves)
let saveTriggeredByNavigation = false; // Whether the current save was initiated by a navigation request
const MAX_HISTORY = 50; // 最大历史记录数

// 性能优化变量
let animationFrameId = null; // requestAnimationFrame节流
const colorCache = new Map(); // 颜色计算缓存

// Image load request ID to prevent stale callbacks
let currentImageLoadId = 0;

// Image metadata for info popup (initialImageMetadata is injected via HTML script tag)
let currentImageMetadata = (typeof initialImageMetadata !== 'undefined') ? initialImageMetadata : null;

// 点击位置追踪 - 用于支持点击叠加实例时的循环选择
let lastClickTime = 0;
let lastClickX = 0;
let lastClickY = 0;
const CLICK_THRESHOLD_TIME = 500; // 500ms内视为同一位置的连续点击
const CLICK_THRESHOLD_DISTANCE = 5; // 5px内视为同一位置

// 光标状态追踪 - 避免频繁更新样式
let currentCursor = 'default';

// Labels管理 - 全局颜色自定义（会话级别，切换图片保留，关闭插件重置）
let customColors = new Map(); // 存储用户自定义的标签颜色
let currentEditingLabel = null; // 当前正在编辑颜色的标签
let paletteClickHandler = null; // 颜色选择器的点击处理器引用
let paletteDblClickHandler = null; // 颜色选择器的双击处理器引用（双击=确认）

const PRESET_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
    '#52C41A', '#FA8C16', '#EB2F96', '#722ED1',
    '#13C2C2', '#1890FF', '#FAAD14', '#F5222D',
    '#FA541C', '#FADB14', '#A0D911', '#2F54EB',
    '#9254DE', '#597EF7', '#36CFC9', '#FF7A45'
];

// Shape edit mode for vertex editing and shape dragging
let isEditingShape = false;          // Whether in shape edit mode
let shapeBeingEdited = -1;          // Shape being edited (for vertex/drag manipulation)
let originalEditPoints = null;       // Store original points for cancellation
let dragStartPoint = null;           // {x, y} for drag offset calculation
let isDraggingVertex = false;        // Whether currently dragging a vertex
let isDraggingWholeShape = false;    // Whether currently dragging the whole shape
let activeVertexIndex = -1;          // Vertex being dragged

// Context menu element reference
const shapeContextMenu = document.getElementById('shapeContextMenu');
const contextMenuEdit = document.getElementById('contextMenuEdit');
const contextMenuRename = document.getElementById('contextMenuRename');
const contextMenuMerge = document.getElementById('contextMenuMerge');
const contextMenuToggleVisible = document.getElementById('contextMenuToggleVisible');
const contextMenuDelete = document.getElementById('contextMenuDelete');


// Labels可见性管理 - 全局状态（会话级别，切换图片保留，关闭插件重置）
let labelVisibilityState = new Map(); // 存储每个label的可见性状态 (true=visible, false=hidden)

// 高级选项 - 全局渲染设置（会话级别，切换图片保留，关闭插件重置）
let borderWidth = 2; // 边界粗细，默认2px
let fillOpacity = 0.3; // 填充透明度，默认30%

// Image adjust - brightness and contrast (display only, does not affect original image)
let brightness = 100; // 亮度，默认100%
let contrast = 100;   // 对比度，默认100%
let brightnessLocked = false; // 锁定亮度：切换图片时保留
let contrastLocked = false;   // 锁定对比度：切换图片时保留

// RGB Channel selection
let selectedChannel = 'rgb'; // 'rgb', 'r', 'g', 'b'
let channelLocked = false;   // 锁定通道选择：切换图片时保留

// CLAHE settings
let claheEnabled = false;    // CLAHE enabled/disabled
let claheClipLimit = 2.0;    // CLAHE clip limit parameter
let claheLocked = false;     // 锁定CLAHE：切换图片时保留

// Processed-image cache for channel selection / CLAHE.
// Key encodes the inputs that affect output; cache hit avoids reprocessing on every draw().
let processedCanvas = null;
let processedKey = '';

// Theme state
let currentTheme = 'auto'; // 'light', 'dark', 'auto'
let vscodeThemeKind = 2; // 1=Light, 2=Dark, 3=HighContrast, 4=HighContrastLight

// Lock View state - preserves zoom and position when navigating between images
let lockViewEnabled = false;
let lockedViewState = null; // { zoomFactor, imageCenterX, imageCenterY } - normalized view state

// Initialize from global settings injected by extension
const vscodeState = vscode.getState() || {};
if (typeof initialGlobalSettings !== 'undefined') {
    if (initialGlobalSettings.customColors) {
        customColors = new Map(Object.entries(initialGlobalSettings.customColors));
    }
    // Check vscodeState first (synchronous, survives HTML regeneration), then fall back to initialGlobalSettings
    if (vscodeState.borderWidth !== undefined) {
        borderWidth = vscodeState.borderWidth;
    } else if (initialGlobalSettings.borderWidth !== undefined) {
        borderWidth = initialGlobalSettings.borderWidth;
    }
    if (vscodeState.fillOpacity !== undefined) {
        fillOpacity = vscodeState.fillOpacity;
    } else if (initialGlobalSettings.fillOpacity !== undefined) {
        fillOpacity = initialGlobalSettings.fillOpacity;
    }
    if (vscodeState.brightness !== undefined) {
        brightness = vscodeState.brightness;
    } else if (initialGlobalSettings.brightness !== undefined) {
        brightness = initialGlobalSettings.brightness;
    }
    if (vscodeState.contrast !== undefined) {
        contrast = vscodeState.contrast;
    } else if (initialGlobalSettings.contrast !== undefined) {
        contrast = initialGlobalSettings.contrast;
    }
    if (vscodeState.brightnessLocked !== undefined) {
        brightnessLocked = vscodeState.brightnessLocked;
    } else if (initialGlobalSettings.brightnessLocked !== undefined) {
        brightnessLocked = initialGlobalSettings.brightnessLocked;
    }
    if (vscodeState.contrastLocked !== undefined) {
        contrastLocked = vscodeState.contrastLocked;
    } else if (initialGlobalSettings.contrastLocked !== undefined) {
        contrastLocked = initialGlobalSettings.contrastLocked;
    }
    if (vscodeState.selectedChannel !== undefined) {
        selectedChannel = vscodeState.selectedChannel;
    } else if (initialGlobalSettings.selectedChannel !== undefined) {
        selectedChannel = initialGlobalSettings.selectedChannel;
    }
    if (vscodeState.channelLocked !== undefined) {
        channelLocked = vscodeState.channelLocked;
    } else if (initialGlobalSettings.channelLocked !== undefined) {
        channelLocked = initialGlobalSettings.channelLocked;
    }
    if (vscodeState.claheEnabled !== undefined) {
        claheEnabled = vscodeState.claheEnabled;
    } else if (initialGlobalSettings.claheEnabled !== undefined) {
        claheEnabled = initialGlobalSettings.claheEnabled;
    }
    if (vscodeState.claheClipLimit !== undefined) {
        claheClipLimit = vscodeState.claheClipLimit;
    } else if (initialGlobalSettings.claheClipLimit !== undefined) {
        claheClipLimit = initialGlobalSettings.claheClipLimit;
    }
    if (vscodeState.claheLocked !== undefined) {
        claheLocked = vscodeState.claheLocked;
    } else if (initialGlobalSettings.claheLocked !== undefined) {
        claheLocked = initialGlobalSettings.claheLocked;
    }
    if (vscodeState.theme !== undefined) {
        currentTheme = vscodeState.theme;
    } else if (initialGlobalSettings.theme) {
        currentTheme = initialGlobalSettings.theme;
    }
    if (initialGlobalSettings.vscodeThemeKind !== undefined) {
        vscodeThemeKind = initialGlobalSettings.vscodeThemeKind;
    }
    // Restore recentLabels from vscodeState first (survives HTML regeneration)
    if (vscodeState.recentLabels !== undefined && Array.isArray(vscodeState.recentLabels)) {
        recentLabels = vscodeState.recentLabels;
    } else if (initialGlobalSettings.recentLabels) {
        recentLabels = initialGlobalSettings.recentLabels;
    }
}

// 从vscode state恢复labelVisibilityState
if (vscodeState && vscodeState.labelVisibility) {
    labelVisibilityState = new Map(Object.entries(vscodeState.labelVisibility).map(([k, v]) => [k, v === 'true' || v === true]));
}

// 从vscode state恢复currentMode
if (vscodeState && vscodeState.currentMode) {
    currentMode = vscodeState.currentMode;
}

// 从vscode state恢复lockViewEnabled (先从vscode state，再从globalSettings)
if (vscodeState && vscodeState.lockViewEnabled !== undefined) {
    lockViewEnabled = vscodeState.lockViewEnabled;
} else if (initialGlobalSettings.lockViewEnabled !== undefined) {
    lockViewEnabled = initialGlobalSettings.lockViewEnabled;
}
if (vscodeState && vscodeState.lockedViewState) {
    lockedViewState = vscodeState.lockedViewState;
}

// 从vscode state恢复SAM配置 (先从vscode state，再从globalSettings)
if (vscodeState && vscodeState.samEncodeMode) {
    samEncodeMode = vscodeState.samEncodeMode;
} else if (initialGlobalSettings.samEncodeMode) {
    samEncodeMode = initialGlobalSettings.samEncodeMode;
}
if (vscodeState && vscodeState.samPort !== undefined) {
    samServicePort = vscodeState.samPort;
} else if (initialGlobalSettings.samPort !== undefined) {
    samServicePort = initialGlobalSettings.samPort;
}

// 初始化UI显示值
if (borderWidthSlider && borderWidthValue) {
    borderWidthSlider.value = borderWidth;
    borderWidthValue.textContent = borderWidth;
}
if (fillOpacitySlider && fillOpacityValue) {
    fillOpacitySlider.value = fillOpacity * 100;
    fillOpacityValue.textContent = Math.round(fillOpacity * 100);
}
if (brightnessSlider && brightnessValue) {
    brightnessSlider.value = brightness;
    brightnessValue.textContent = brightness;
}
if (contrastSlider && contrastValue) {
    contrastSlider.value = contrast;
    contrastValue.textContent = contrast;
}

// Initialize channel radios
const channelRadios = document.querySelectorAll('input[name="imageChannel"]');

function updateChannelRadios() {
    channelRadios.forEach(r => { r.checked = r.value === selectedChannel; });
}
updateChannelRadios();

// Initialize CLAHE controls
const claheClipLimitSlider = document.getElementById('claheClipLimitSlider');
const claheClipLimitValue = document.getElementById('claheClipLimitValue');
const claheToggleBtn = document.getElementById('claheToggleBtn');
const claheControls = document.getElementById('claheControls');
const claheResetBtn = document.getElementById('claheResetBtn');
const claheLockBtn = document.getElementById('claheLockBtn');

if (claheClipLimitSlider && claheClipLimitValue) {
    claheClipLimitSlider.value = claheClipLimit;
    claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
}

function updateClaheToggleUI() {
    if (claheToggleBtn) {
        claheToggleBtn.textContent = claheEnabled ? 'On' : 'Off';
        claheToggleBtn.classList.toggle('active', claheEnabled);
    }
    if (claheControls) {
        claheControls.style.display = claheEnabled ? '' : 'none';
    }
}
updateClaheToggleUI();

// 恢复设置下拉菜单的展开状态
if (settingsMenuDropdown && vscodeState.settingsMenuExpanded) {
    settingsMenuDropdown.style.display = 'block';
}
// 初始化模式按钮UI
if (viewModeBtn && pointModeBtn && lineModeBtn && polygonModeBtn && rectangleModeBtn) {
    viewModeBtn.classList.remove('active');
    pointModeBtn.classList.remove('active');
    lineModeBtn.classList.remove('active');
    polygonModeBtn.classList.remove('active');
    rectangleModeBtn.classList.remove('active');
    if (samModeBtn) samModeBtn.classList.remove('active');

    if (currentMode === 'view') {
        viewModeBtn.classList.add('active');
    } else if (currentMode === 'point') {
        pointModeBtn.classList.add('active');
    } else if (currentMode === 'line') {
        lineModeBtn.classList.add('active');
    } else if (currentMode === 'polygon') {
        polygonModeBtn.classList.add('active');
    } else if (currentMode === 'rectangle') {
        rectangleModeBtn.classList.add('active');
    } else if (currentMode === 'sam') {
        if (samModeBtn) samModeBtn.classList.add('active');
    }
}

// Load initial data if available
if (existingData) {
    shapes = (existingData.shapes || []).map(shape => {
        // 如果该label有全局可见性状态，应用它；否则默认为可见
        const visible = labelVisibilityState.has(shape.label)
            ? labelVisibilityState.get(shape.label)
            : true;
        return {
            ...shape,
            visible: visible
        };
    });
}

// 初始化历史记录
saveHistory();
// markClean必须在saveHistory之后调用，确保savedHistoryIndex正确记录初始历史位置
markClean();

// --- Zoom Functions ---
const zoomLockBtn = document.getElementById('zoomLockBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const zoomPercentageSpan = document.getElementById('zoomPercentage');
const pixelGridOverlay = document.getElementById('pixelGridOverlay');

// Update zoom UI state (lock button icon and reset button visibility)
// Shared SVG snippets used by every lock-button updater (zoom, brightness,
// contrast, channel, CLAHE). Static data-tip-id on each button supplies the
// description; the icon conveys the on/off state.
const LOCK_OPEN_SVG = '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock-open"/></svg>';
const LOCK_CLOSED_SVG = '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock"/></svg>';

function updateZoomUI() {
    // Update lock button icon and state.
    if (zoomLockBtn) {
        zoomLockBtn.innerHTML = lockViewEnabled ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        zoomLockBtn.classList.toggle('locked', lockViewEnabled);
    }

    // Update zoom percentage display
    updateZoomPercentage();

    // Update reset button visibility - show when zoom is not 100% (regardless of lock state)
    if (zoomResetBtn) {
        const fitZoom = calculateFitToScreenZoom();
        const currentZoomFactor = fitZoom > 0 ? zoomLevel / fitZoom : 1;
        if (Math.abs(currentZoomFactor - 1) > 0.01) {
            zoomResetBtn.classList.add('visible');
        } else {
            zoomResetBtn.classList.remove('visible');
        }
    }
}

// Update zoom percentage display
// Shows absolute zoom level where 100% = 1:1 pixel ratio with original image
function updateZoomPercentage() {
    if (zoomPercentageSpan) {
        const percentage = Math.round(zoomLevel * 100);
        zoomPercentageSpan.textContent = percentage + '%';
    }
}
updateZoomUI();

// Calculate fit-to-screen zoom level for current image
function calculateFitToScreenZoom() {
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;

    if (w === 0 || h === 0 || img.width === 0 || img.height === 0) return 1;

    // Reserve CANVAS_EDGE_PADDING on each side so the padding ring fits inside the
    // viewport without scrollbars at fit-to-screen.
    const usableW = Math.max(1, w - 2 * CANVAS_EDGE_PADDING);
    const usableH = Math.max(1, h - 2 * CANVAS_EDGE_PADDING);

    const scaleX = usableW / img.width;
    const scaleY = usableH / img.height;

    return Math.min(scaleX, scaleY) * ZOOM_FIT_RATIO;
}

// Calculate normalized view state (relative to image center)
// Uses zoomFactor (relative to fit-to-screen) instead of absolute zoomLevel
// Position is normalized in IMAGE coordinates (0-1 range, 0.5 = center of image)
function getNormalizedViewState() {
    const scrollX = canvasContainer.scrollLeft;
    const scrollY = canvasContainer.scrollTop;
    const viewportW = canvasContainer.clientWidth;
    const viewportH = canvasContainer.clientHeight;

    // Protect against divide-by-zero when image dimensions are 0
    if (img.width === 0 || img.height === 0 || zoomLevel === 0) {
        return { zoomFactor: 1, imageCenterX: 0.5, imageCenterY: 0.5 };
    }

    // Calculate zoom factor relative to fit-to-screen zoom
    const fitZoom = calculateFitToScreenZoom();
    const zoomFactor = zoomLevel / fitZoom;

    const imageW = img.width * zoomLevel;
    const imageH = img.height * zoomLevel;

    // For each dimension: if not scrollable (image fits in viewport), use 0.5 (centered)
    // Otherwise, calculate the actual position from scroll
    let imageCenterX, imageCenterY;

    if (imageW <= viewportW) {
        // Image fits horizontally, use center
        imageCenterX = 0.5;
    } else {
        // Calculate which point of the ORIGINAL image is at the viewport center.
        // Subtract CANVAS_EDGE_PADDING because the image starts +PAD inside the wrapper.
        const viewportCenterScreenX = scrollX + viewportW / 2;
        const viewportCenterImageX = (viewportCenterScreenX - CANVAS_EDGE_PADDING) / zoomLevel;
        imageCenterX = viewportCenterImageX / img.width;
    }

    if (imageH <= viewportH) {
        // Image fits vertically, use center
        imageCenterY = 0.5;
    } else {
        const viewportCenterScreenY = scrollY + viewportH / 2;
        const viewportCenterImageY = (viewportCenterScreenY - CANVAS_EDGE_PADDING) / zoomLevel;
        imageCenterY = viewportCenterImageY / img.height;
    }

    return { zoomFactor, imageCenterX, imageCenterY };
}

// Apply normalized view state to current image
// Converts zoomFactor back to absolute zoomLevel based on current image's fit-to-screen zoom
// Position is in image coordinates (0-1 range)
function applyNormalizedViewState(state) {
    if (!state) return;

    // Calculate zoomLevel from zoomFactor
    const fitZoom = calculateFitToScreenZoom();
    zoomLevel = fitZoom * state.zoomFactor;

    // Clamp zoomLevel to valid range
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel));

    // Snap to integer when in pixel rendering mode (must match wheel zoom behavior)
    if (zoomLevel >= PIXEL_RENDER_THRESHOLD) {
        zoomLevel = Math.round(zoomLevel);
    }

    updateCanvasTransform();

    const viewportW = canvasContainer.clientWidth;
    const viewportH = canvasContainer.clientHeight;

    // Convert image coordinates back to scroll position.
    // Image pixel sits at +CANVAS_EDGE_PADDING inside the wrapper, so add PAD.
    const imageX = state.imageCenterX * img.width;
    const imageY = state.imageCenterY * img.height;
    const scrollX = imageX * zoomLevel + CANVAS_EDGE_PADDING - viewportW / 2;
    const scrollY = imageY * zoomLevel + CANVAS_EDGE_PADDING - viewportH / 2;

    canvasContainer.scrollLeft = Math.max(0, scrollX);
    canvasContainer.scrollTop = Math.max(0, scrollY);
}

// Save current view state if lock view is enabled
// When zoomFactor <= 1 (fit to screen or zoomed out): always update normally
// When zoomFactor > 1 (zoomed in): only update scrollable dimensions to prevent position drift
function saveLockedViewState() {
    if (!lockViewEnabled) return;

    // Get the normalized state first (this calculates zoomFactor internally)
    const newState = getNormalizedViewState();
    const currentZoomFactor = newState.zoomFactor;

    const imageW = img.width * zoomLevel;
    const imageH = img.height * zoomLevel;
    const viewportW = canvasContainer.clientWidth;
    const viewportH = canvasContainer.clientHeight;

    const isScrollableX = imageW > viewportW;
    const isScrollableY = imageH > viewportH;

    // Determine if we should update the state
    let shouldUpdate = false;

    if (currentZoomFactor <= 1) {
        // Zoomed out: always update the full state
        shouldUpdate = true;
    } else if (isScrollableX || isScrollableY) {
        // Zoomed in and at least one dimension is scrollable
        // Merge with old state: only update scrollable dimensions
        if (lockedViewState) {
            if (!isScrollableX) {
                newState.imageCenterX = lockedViewState.imageCenterX;
            }
            if (!isScrollableY) {
                newState.imageCenterY = lockedViewState.imageCenterY;
            }
        }
        shouldUpdate = true;
    }
    // If image fits entirely in viewport AND zoomed in, don't update

    if (shouldUpdate) {
        lockedViewState = newState;
        const state = vscode.getState() || {};
        state.lockedViewState = lockedViewState;
        vscode.setState(state);
        updateZoomUI(); // Update reset button visibility
    }
}

// Zoom lock button click handler - toggle lock state
function toggleLockView() {
    lockViewEnabled = !lockViewEnabled;

    if (lockViewEnabled) {
        // Save current view state when enabling - always save (including fit-to-screen)
        lockedViewState = getNormalizedViewState();
    } else {
        // Clear locked state when disabling
        lockedViewState = null;
    }

    // Update UI
    updateZoomUI();

    // Persist to vscode state
    const state = vscode.getState() || {};
    state.lockViewEnabled = lockViewEnabled;
    state.lockedViewState = lockedViewState;
    vscode.setState(state);

    // Persist to globalState for long-term storage
    vscode.postMessage({
        command: 'saveGlobalSettings',
        key: 'lockViewEnabled',
        value: lockViewEnabled
    });
}

if (zoomLockBtn) {
    zoomLockBtn.addEventListener('click', toggleLockView);
}
if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', () => {
        // Reset zoom to fit screen (100%)
        fitImageToScreen();
        // If lock is enabled, update the locked state
        if (lockViewEnabled) {
            lockedViewState = getNormalizedViewState();
            const state = vscode.getState() || {};
            state.lockedViewState = lockedViewState;
            vscode.setState(state);
        }
        // Update UI
        updateZoomUI();
    });
}

// 图片加载处理函数
function handleImageLoad() {
    // Clear the persistent "image error" sticky if present.
    if (window.notifyBus) window.notifyBus.clearSticky('image.error');

    // Apply locked view state if enabled, otherwise fit to screen
    if (lockViewEnabled && lockedViewState) {
        applyNormalizedViewState(lockedViewState);
    } else {
        fitImageToScreen();
    }
    draw();
    renderShapeList();
    renderLabelsList();
    updateZoomUI(); // Update zoom percentage display
}

function handleImageError() {
    if (window.notifyBus) window.notifyBus.show('error', 'Error loading image', { sticky: true, key: 'image.error' });
}

// Initial image load with stale callback protection
const initialLoadId = ++currentImageLoadId;

img.onload = function () {
    if (initialLoadId !== currentImageLoadId) return;
    handleImageLoad();
};
img.onerror = function () {
    if (initialLoadId !== currentImageLoadId) return;
    handleImageError();
};
// Only load if we have a real image URL (empty = no image found yet, waiting for async scan)
if (imageUrl) {
    img.src = imageUrl;
}

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    img.onload = null;
    img.onerror = null;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
    }
});

// --- Dirty State Management ---

function markDirty() {
    if (!isDirty) {
        isDirty = true;
        vscode.postMessage({ command: 'dirty', value: true });
    }
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.add('dirty');
        saveBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-save"/></svg>';
    }
}

function markClean() {
    if (isDirty) {
        isDirty = false;
        vscode.postMessage({ command: 'dirty', value: false });
    }
    // 记录保存时的历史位置，用于判断undo/redo后是否恢复到保存状态
    savedHistoryIndex = historyIndex;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.remove('dirty');
        saveBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-save"/></svg>';
    }
}

// Mark clean at a specific history index (used when backend confirms save)
// Only clears dirty state if the user is still at the exact saved snapshot
function markCleanAtIndex(index) {
    savedHistoryIndex = index;
    if (historyIndex === savedHistoryIndex) {
        if (isDirty) {
            isDirty = false;
            vscode.postMessage({ command: 'dirty', value: false });
        }
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.remove('dirty');
            saveBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-save"/></svg>';
        }
    }
    // If historyIndex !== savedHistoryIndex, the user has made new edits
    // since the save was initiated, so we keep the dirty state
}

// --- Undo/Redo History Management ---

function saveHistory() {
    // 使用 structuredClone 进行深拷贝 (保留visible字段以支持实例级别的可见性撤销/重做)
    const snapshot = structuredClone(shapes);

    // 如果不在历史末尾，删除当前位置之后的所有历史
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
        // 如果savedHistoryIndex指向被删除的历史，使其失效
        if (savedHistoryIndex > historyIndex) {
            savedHistoryIndex = -1;
        }
    }

    // 添加新快照
    history.push(snapshot);

    // 限制历史记录数量
    if (history.length > MAX_HISTORY) {
        history.shift();
        // 调整savedHistoryIndex（因为删除了第一个元素）
        if (savedHistoryIndex >= 0) {
            savedHistoryIndex--;
        }
    } else {
        historyIndex++;
    }
}

function undo() {
    if (historyIndex > 0) {
        // Exit edit mode before swapping snapshot — stale shapeBeingEdited would crash
        if (isEditingShape) exitShapeEditMode(false);

        historyIndex--;
        shapes = structuredClone(history[historyIndex]);

        // Reapply label-level visibility overrides (not recorded in history)
        applyLabelVisibilityState();

        clearSelection();
        // 检查是否恢复到保存时的状态
        if (historyIndex === savedHistoryIndex) {
            markClean();
        } else {
            markDirty();
        }
        renderShapeList();
        renderLabelsList();
        draw();
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        // Exit edit mode before swapping snapshot — stale shapeBeingEdited would crash
        if (isEditingShape) exitShapeEditMode(false);

        historyIndex++;
        shapes = structuredClone(history[historyIndex]);

        // Reapply label-level visibility overrides (not recorded in history)
        applyLabelVisibilityState();

        clearSelection();
        // 检查是否恢复到保存时的状态
        if (historyIndex === savedHistoryIndex) {
            markClean();
        } else {
            markDirty();
        }
        renderShapeList();
        renderLabelsList();
        draw();
    }
}

// --- Zoom & Scroll ---

function fitImageToScreen() {
    // First pass: calculate and apply initial fit
    const initialViewportW = canvasContainer.clientWidth;
    const initialViewportH = canvasContainer.clientHeight;

    zoomLevel = calculateFitToScreenZoom();
    updateCanvasTransform();

    // Second pass: check if viewport size changed (due to scrollbar appearing/disappearing)
    // and recalculate if needed to get accurate fit-to-screen
    const newViewportW = canvasContainer.clientWidth;
    const newViewportH = canvasContainer.clientHeight;

    if (newViewportW !== initialViewportW || newViewportH !== initialViewportH) {
        zoomLevel = calculateFitToScreenZoom();
        updateCanvasTransform();
    }
}

function updateCanvasTransform() {
    // Canvas 保持原始图片尺寸 (resolution)
    canvas.width = img.width;
    canvas.height = img.height;

    // When zoomLevel >= PIXEL_RENDER_THRESHOLD it is already snapped to an integer,
    // so img.width * zoomLevel produces exact integer display dimensions.
    const displayWidth = img.width * zoomLevel;
    const displayHeight = img.height * zoomLevel;

    // Set display size via CSS
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    // SVG 也保持原始图片尺寸 (viewBox)
    svgOverlay.setAttribute('viewBox', `0 0 ${img.width} ${img.height}`);
    // Set SVG display size to match canvas
    svgOverlay.setAttribute('width', `${displayWidth}px`);
    svgOverlay.setAttribute('height', `${displayHeight}px`);
    svgOverlay.style.width = `${displayWidth}px`;
    svgOverlay.style.height = `${displayHeight}px`;

    // Remove transform from wrapper and set explicit inner size.
    // Wrapper has CSS padding = CANVAS_EDGE_PADDING on each side (box-sizing: content-box),
    // so its outer scroll size is automatically displayWidth + 2*PAD.
    canvasWrapper.style.transform = '';
    canvasWrapper.style.transformOrigin = '';
    canvasWrapper.style.width = `${displayWidth}px`;
    canvasWrapper.style.height = `${displayHeight}px`;

    updatePixelRendering();
    draw();
}

// --- Pixel-level Rendering (pixelated blocks, grid lines, pixel values) ---
// Called when zoomLevel changes. Manages three features:
// 1. image-rendering: pixelated on canvas (nearest-neighbor interpolation)
// 2. CSS pixel grid lines overlay
// 3. Pixel RGB values in SVG (handled in drawSVGAnnotations)
function updatePixelRendering() {
    // 1. Pixel-block rendering (nearest-neighbor)
    if (zoomLevel >= PIXEL_RENDER_THRESHOLD) {
        canvas.style.imageRendering = 'pixelated';
    } else {
        canvas.style.imageRendering = '';
    }

    // 2. Pixel grid lines via CSS background on overlay div
    if (pixelGridOverlay) {
        if (zoomLevel >= PIXEL_RENDER_THRESHOLD) {
            // zoomLevel is snapped to an integer when >= PIXEL_RENDER_THRESHOLD,
            // so each image pixel is exactly zoomLevel screen pixels.
            // This makes a uniform CSS grid perfectly aligned.
            const pixelSize = zoomLevel; // integer, exact match
            const gridColor = document.body.classList.contains('theme-light')
                ? 'rgba(0, 0, 0, 0.15)'
                : 'rgba(255, 255, 255, 0.15)';
            pixelGridOverlay.style.backgroundImage =
                `linear-gradient(to right, ${gridColor} 1px, transparent 1px),` +
                `linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`;
            pixelGridOverlay.style.backgroundSize = `${pixelSize}px ${pixelSize}px`;
            pixelGridOverlay.style.backgroundPosition = '0 0';
        } else {
            pixelGridOverlay.style.backgroundImage = 'none';
        }
    }
}

// Debounced resize handler for lock view state
let resizeSaveTimeout = null;
window.addEventListener('resize', () => {
    // When window resizes, save the current locked view state (debounced)
    // This ensures the relative zoom factor is recalculated based on the new window size
    if (resizeSaveTimeout) clearTimeout(resizeSaveTimeout);
    resizeSaveTimeout = setTimeout(() => {
        if (lockViewEnabled) {
            saveLockedViewState();
        }
        updateZoomUI(); // Update zoom percentage (it's relative to fit-to-screen)
    }, 200);
});

// Refresh pixel value labels when the canvas viewport is resized.
// This covers window resize, sidebar drag, and any layout change that
// alters canvasContainer dimensions, ensuring newly exposed pixels show values.
let viewportResizeRAF = null;
const canvasContainerObserver = new ResizeObserver(() => {
    if (zoomLevel >= PIXEL_VALUES_ZOOM) {
        if (viewportResizeRAF) cancelAnimationFrame(viewportResizeRAF);
        viewportResizeRAF = requestAnimationFrame(() => {
            drawSVGAnnotations();
            viewportResizeRAF = null;
        });
    }
});
canvasContainerObserver.observe(canvasContainer);

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'notify': {
            if (!window.notifyBus) break;
            const level = message.level || 'info';
            const opts = {};
            if (message.key) opts.key = message.key;
            if (message.sticky) opts.sticky = true;
            window.notifyBus.show(level, message.text || '', opts);
            break;
        }
        case 'requestSave':
            saveTriggeredByNavigation = true;
            save();
            break;
        case 'saveComplete': {
            // Mark clean at the exact history snapshot that was saved
            markCleanAtIndex(pendingSaveHistoryIndex);
            const isClean = (historyIndex === savedHistoryIndex);
            const wasNavigationSave = saveTriggeredByNavigation;
            pendingSaveHistoryIndex = -1;
            isSaving = false;
            saveTriggeredByNavigation = false;

            // Only navigate if:
            // 1. The save was triggered by a navigation request (not manual toolbar save)
            // 2. The webview is actually clean (user didn't edit during save)
            if (wasNavigationSave && isClean) {
                vscode.postMessage({ command: 'navigateAfterSave' });
            }
            break;
        }
        case 'saveFailed':
            // Keep dirty state - save failed on backend
            pendingSaveHistoryIndex = -1;
            isSaving = false;
            saveTriggeredByNavigation = false;
            break;
        case 'updateImage':
            handleImageUpdate(message);
            break;
        case 'vscodeThemeChanged':
            vscodeThemeKind = message.themeKind;
            if (currentTheme === 'auto') {
                applyTheme('auto');
            }
            break;
        case 'updateImageList':
            handleUpdateImageList(message);
            break;
        case 'onnxBrowseResult':
            if (message.field === 'modelDir' && onnxModelDirInput) {
                onnxModelDirInput.value = message.value;
            } else if (message.field === 'pythonPath' && onnxPythonPathInput) {
                onnxPythonPathInput.value = message.value;
            }
            break;
        case 'samBrowseResult': {
            const samModelDirInput = document.getElementById('samModelDir');
            const samPythonPathInput = document.getElementById('samPythonPath');
            if (message.field === 'modelDir' && samModelDirInput) {
                samModelDirInput.value = message.value;
            } else if (message.field === 'pythonPath' && samPythonPathInput) {
                samPythonPathInput.value = message.value;
            }
            break;
        }
        case 'gpuDetectResult': {
            // Populate BOTH ONNX and SAM GPU dropdowns (whichever modal is open)
            const gpuGroups = [
                { group: document.getElementById('samGpuIndexGroup'), select: document.getElementById('samGpuIndex') },
                { group: document.getElementById('onnxGpuIndexGroup'), select: document.getElementById('onnxGpuIndex') }
            ];
            for (const { group, select } of gpuGroups) {
                if (group && select && message.gpus && message.gpus.length > 1) {
                    select.innerHTML = '';
                    message.gpus.forEach((gpu, idx) => {
                        const opt = document.createElement('option');
                        opt.value = idx;
                        const match = gpu.match(/^GPU\s+(\d+):\s*(.+?)(?:\s*\(UUID.*)?$/);
                        opt.textContent = match ? `GPU ${match[1]}: ${match[2]}` : gpu;
                        select.appendChild(opt);
                    });
                    group.style.display = '';
                    // Restore saved GPU index if available
                    const pendingIdx = group.__pendingGpuIndex;
                    if (pendingIdx !== undefined && pendingIdx >= 0 && pendingIdx < message.gpus.length) {
                        select.value = pendingIdx;
                    }
                    delete group.__pendingGpuIndex;
                } else if (group) {
                    group.style.display = 'none';
                }
            }
            break;
        }
    }
});

// Handle incremental image update (without full HTML reload)
function handleImageUpdate(message) {
    // Force-invalidate the processed-image cache: a same-URL image may carry different
    // bytes after an external edit, so we cannot rely on the URL alone for invalidation.
    processedKey = '';

    // Exit shape edit mode if currently editing (without saving changes to the old image)
    if (isEditingShape) {
        exitShapeEditMode(false);
    }

    // Cancel any current drawing
    if (isDrawing) {
        isDrawing = false;
        currentPoints = [];
    }

    // Cancel any active eraser
    if (eraserActive || eraserMouseDownPos) {
        cancelEraser();
        eraserMouseDownPos = null;
        eraserMouseDownTime = 0;
        eraserIsDragging = false;
        eraserDragCurrent = null;
    }

    // Clear selection and box selection
    clearSelection();
    isBoxSelecting = false;
    boxSelectStart = null;
    boxSelectCurrent = null;
    editingShapeIndex = -1;
    isBatchRenaming = false;
    if (isMergePending) clearMergePendingState();
    hideLabelModal();

    // Reset brightness/contrast if not locked (independently)
    if (!brightnessLocked) {
        brightness = 100;
        if (brightnessSlider) brightnessSlider.value = brightness;
        if (brightnessValue) brightnessValue.textContent = brightness;
        updateBrightnessResetBtn();
        saveGlobalSettings('brightness', brightness);
    }
    if (!contrastLocked) {
        contrast = 100;
        if (contrastSlider) contrastSlider.value = contrast;
        if (contrastValue) contrastValue.textContent = contrast;
        updateContrastResetBtn();
        saveGlobalSettings('contrast', contrast);
    }
    if (!channelLocked) {
        selectedChannel = 'rgb';
        updateChannelRadios();
        saveGlobalSettings('selectedChannel', selectedChannel);
    }
    if (!claheLocked) {
        claheEnabled = false;
        claheClipLimit = 2.0;
        if (claheClipLimitSlider) claheClipLimitSlider.value = claheClipLimit;
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        updateClaheToggleUI();
        updateClaheResetBtn();
        saveGlobalSettings('claheEnabled', claheEnabled);
        saveGlobalSettings('claheClipLimit', claheClipLimit);
    }
    applyImageAdjust();

    // Increment load ID to invalidate any pending callbacks from previous loads
    currentImageLoadId++;
    const thisLoadId = currentImageLoadId;

    // Update global variables (these were injected via script tag initially)
    // Note: imageUrl, imageName, imagePath, currentImageRelativePath are const, 
    // so we need to work around this by using new variables
    const newImageUrl = message.imageUrl;
    const newImageName = message.imageName;
    const newImagePath = message.imagePath;
    const newCurrentImageRelativePath = message.currentImageRelativePath;

    // Store image metadata for info popup
    currentImageMetadata = message.imageMetadata || null;

    // Update filename display. The tip is supplied by data-tip-id="nav.fileName".
    const fileNameSpan = document.getElementById('fileName');
    if (fileNameSpan) {
        fileNameSpan.textContent = newCurrentImageRelativePath || newImageName;
    }

    // Update mutable absolute path for copy feature
    currentAbsoluteImagePath = newImagePath;

    // Load new shapes from existing data
    if (message.existingData) {
        shapes = (message.existingData.shapes || []).map(shape => {
            // Apply global visibility state
            const visible = labelVisibilityState.has(shape.label)
                ? labelVisibilityState.get(shape.label)
                : true;
            return {
                ...shape,
                visible: visible
            };
        });
    } else {
        shapes = [];
    }

    // Reset history for new image
    history = [];
    historyIndex = -1;
    saveHistory();

    // Mark as clean (new image)
    markClean();

    // Update image browser list highlight
    updateImageBrowserHighlight(newCurrentImageRelativePath);

    // If no image URL is provided (e.g., empty folder), clear the canvas and UI
    if (!newImageUrl) {
        img.src = '';
        shapes = [];
        currentPoints = [];
        isDrawing = false;
        clearSelection();
        editingShapeIndex = -1;
        if (window.notifyBus) window.notifyBus.show('warn', 'No images found');
        draw();
        renderShapeList();
        renderLabelsList();
        updateZoomUI();
        return;
    }

    // Load new image with stale callback protection
    img.onload = function () {
        // Check if this callback is for the current load request
        if (thisLoadId !== currentImageLoadId) return;

        // Clear the persistent "image error" sticky if a previous load failed.
        if (window.notifyBus) window.notifyBus.clearSticky('image.error');

        // Apply locked view state if enabled, otherwise fit to screen
        if (lockViewEnabled && lockedViewState) {
            applyNormalizedViewState(lockedViewState);
        } else {
            fitImageToScreen();
        }
        draw();
        renderShapeList();
        renderLabelsList();
        updateZoomUI(); // Update zoom percentage display
        updateImageInfoPopup(); // Refresh info popup with actual dimensions
    };
    img.onerror = function () {
        // Check if this callback is for the current load request
        if (thisLoadId !== currentImageLoadId) return;

        handleImageError();
    };
    img.src = newImageUrl;
}

// Track whether the initial scan has completed (to distinguish scanning from empty results)
let scanComplete = false;

// Handle refreshed image list from extension
function handleUpdateImageList(message) {
    scanComplete = message.hasOwnProperty('isScanFinished') ? !!message.isScanFinished : true;
    // Update the global workspaceImages array
    // Note: workspaceImages is defined in the HTML as a const, so we need to modify it in place
    if (typeof workspaceImages !== 'undefined' && Array.isArray(workspaceImages)) {
        workspaceImages.length = 0; // Clear existing
        message.workspaceImages.forEach(img => workspaceImages.push(img));
    }

    // Update the current image relative path
    if (message.currentImageRelativePath) {
        currentImageRelativePathMutable = message.currentImageRelativePath;
    }

    // Re-apply filter if search is active
    if (searchQuery) {
        filteredImages = workspaceImages.filter(img =>
            img.toLowerCase().includes(searchQuery)
        );
    } else {
        filteredImages = [];
    }

    // Update image count display
    updateImageCount();

    // Clear saved scroll state to prevent stale scroll position restoration after folder switch
    const state = vscode.getState() || {};
    state.savedScrollTop = undefined;
    state.skipNextScroll = false;
    vscode.setState(state);

    // Reset virtual scroll state and re-render the list
    virtualScrollState = {
        startIndex: 0,
        endIndex: 0,
        scrollTop: 0
    };
    renderImageBrowserList();
}

// Update image browser highlight for virtual scrolling
// We need to store the new path and re-render the visible items
let currentImageRelativePathMutable = currentImageRelativePath; // Mutable version for updates
let currentAbsoluteImagePath = imagePath; // Mutable version for copy feature

function updateImageBrowserHighlight(newRelativePath) {
    if (!imageBrowserList) return;

    // Update the mutable path for virtual scrolling to use
    currentImageRelativePathMutable = newRelativePath;

    // With virtual scrolling, we need to:
    // 1. Scroll to the new active item position
    // 2. Force re-render of visible items to update highlighting

    if (typeof workspaceImages !== 'undefined') {
        const newIndex = workspaceImages.indexOf(newRelativePath);
        if (newIndex !== -1) {
            const viewportTop = imageBrowserList.scrollTop;
            const viewportBottom = viewportTop + imageBrowserList.clientHeight;
            const itemTop = newIndex * VIRTUAL_ITEM_HEIGHT;
            const itemBottom = itemTop + VIRTUAL_ITEM_HEIGHT;

            // Only scroll if item is not visible, use minimal scroll (not centering)
            if (itemTop < viewportTop) {
                // Item is above viewport - scroll up to show it at top
                imageBrowserList.scrollTop = itemTop;
            } else if (itemBottom > viewportBottom) {
                // Item is below viewport - scroll down to show it at bottom
                imageBrowserList.scrollTop = itemBottom - imageBrowserList.clientHeight;
            }
            // If item is already visible, don't scroll at all
        }
    }

    // Update image count to reflect new current position
    updateImageCount();

    // Force re-render to update highlighting
    virtualScrollState.startIndex = -1; // Reset to force update
    virtualScrollState.endIndex = -1;
    updateVirtualScroll();
}


// --- Shortcuts ---

// Track Shift press for eraser/negative-point feedback (cursor + status bar).
document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !shiftPressed) {
        if (labelModal.style.display === 'flex') return;
        if (samConfigModal && samConfigModal.style.display === 'flex') return;
        if (colorPickerModal && colorPickerModal.style.display === 'flex') return;
        if (onnxInferModal && onnxInferModal.style.display === 'flex') return;
        const focusedTag = document.activeElement?.tagName;
        if (focusedTag === 'INPUT' || focusedTag === 'TEXTAREA' || focusedTag === 'SELECT') return;
        if (eraserActive) return;
        shiftPressed = true;
        updateShiftFeedback();
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        shiftPressed = false;
        updateShiftFeedback();
    }
});

window.addEventListener('blur', () => {
    if (shiftPressed) {
        shiftPressed = false;
        updateShiftFeedback();
    }
});

document.addEventListener('keydown', (e) => {
    // Ignore shortcuts if any modal is open (except Enter/Esc handled in input)
    if (labelModal.style.display === 'flex') return;
    if (onnxInferModal && onnxInferModal.style.display === 'flex') return;
    if (colorPickerModal && colorPickerModal.style.display === 'flex') return;
    if (samConfigModal && samConfigModal.style.display === 'flex') return;

    // Skip most shortcuts when an input/textarea/select is focused,
    // allowing text editing keys to work normally. Only Ctrl-prefixed
    // shortcuts (Ctrl+S, Ctrl+Z, Ctrl+A, Ctrl+F) are still processed.
    const focusedTag = document.activeElement?.tagName;
    if ((focusedTag === 'INPUT' || focusedTag === 'TEXTAREA' || focusedTag === 'SELECT')
        && !(e.ctrlKey || e.metaKey)) {
        return;
    }

    // Ctrl+F: Search
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (searchInputContainer && searchInput) {
            // Check if sidebar is collapsed
            if (imageBrowserSidebar && imageBrowserSidebar.classList.contains('collapsed')) {
                // Open sidebar
                imageBrowserSidebar.classList.remove('collapsed');
                imageBrowserExpanded = true;

                // Restore sidebar width if saved
                const state = vscode.getState() || {};
                if (state.leftSidebarWidth) {
                    imageBrowserSidebar.style.width = state.leftSidebarWidth + 'px';
                }

                // Update state
                state.imageBrowserExpanded = true;
                vscode.setState(state);

                // Show and focus search
                searchInputContainer.style.display = 'flex';
                searchInput.focus();
            } else {
                // Sidebar is open, toggle search box
                if (searchInputContainer.style.display === 'none') {
                    searchInputContainer.style.display = 'flex';
                    searchInput.focus();
                } else {
                    // Close search box and clear search
                    searchInputContainer.style.display = 'none';
                    searchInput.value = '';
                    filterImages('');
                }
            }
        }
    }

    // Ctrl+S: Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
    }

    // Ctrl+Z: Undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
    }

    // Ctrl+Shift+Z or Ctrl+Y: Redo
    if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') ||
        ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        redo();
    }

    // Ctrl+A: Select all instances
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selectAllShapes();
        renderShapeList();
        draw();
        return;
    }

    // Ctrl+G: Merge selected shapes
    if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        mergeSelectedShapes();
        return;
    }

    // Ctrl+R: Rename selected shape(s)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (selectedShapeIndices.size > 1) {
            showBatchRenameModal();
        } else if (selectedShapeIndex !== -1) {
            showLabelModal(selectedShapeIndex);
        }
        return;
    }

    // Ctrl+H: Toggle visibility of selected shape(s)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        toggleSelectedVisibility();
        return;
    }

    // A: Prev Image (only without Ctrl)
    if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey) {
        vscode.postMessage({ command: 'prev' });
    }

    // D: Next Image
    if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) {
        vscode.postMessage({ command: 'next' });
    }

    // Delete/Backspace: Delete selected shape(s)
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeIndices.size > 0) {
        if (selectedShapeIndices.size > 1) {
            deleteSelectedShapes();
        } else {
            deleteShape(selectedShapeIndex);
        }
    }

    // ESC: Cancel drawing or exit drag/edit mode
    if (e.key === 'Escape') {
        // Skip if an input/textarea/select element is focused (e.g. search box)
        // Let those controls handle their own Escape behavior without side-effects
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            return;
        }

        // First priority: hide context menu if visible
        if (shapeContextMenu && shapeContextMenu.style.display !== 'none') {
            hideShapeContextMenu();
            return;
        }

        // Cancel box selection
        if (isBoxSelecting) {
            isBoxSelecting = false;
            boxSelectStart = null;
            boxSelectCurrent = null;
            draw();
            return;
        }

        // Cancel eraser operation
        if (eraserActive || eraserMouseDownPos) {
            cancelEraser();
            eraserMouseDownPos = null;
            eraserMouseDownTime = 0;
            eraserIsDragging = false;
            eraserDragCurrent = null;
            return;
        }

        // Second priority: exit edit mode
        if (isEditingShape) {
            exitShapeEditMode(false); // Cancel and restore original position
            return;
        }

        // Third priority: cancel drawing
        if (isDrawing) {
            isDrawing = false;
            currentPoints = [];
            draw();
            return;
        }

        // Fourth priority: clear SAM prompts (ESC clears all points/box at once)
        if (currentMode === 'sam' && (samPrompts.length > 0 || samMaskContour || samBoxSecondClick)) {
            samClearState();
            return;
        }

        // Fifth priority: clear multi-selection
        if (selectedShapeIndices.size > 0) {
            clearSelection();
            renderShapeList();
            draw();
            return;
        }
    }

    // V: View Mode
    if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey) {
        setMode('view');
    }

    // O: Point Mode
    if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey) {
        setMode('point');
    }

    // L: Line Mode
    if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey) {
        setMode('line');
    }

    // P: Polygon Mode
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey) {
        setMode('polygon');
    }

    // R: Rectangle Mode
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        setMode('rectangle');
    }

    // I: SAM AI Mode
    if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey) {
        setMode('sam');
    }
});


// --- Color Generation ---
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + "00000".substring(0, 6 - c.length) + c;
}

function getColorsForLabel(label) {
    // 检查缓存
    if (colorCache.has(label)) {
        return colorCache.get(label);
    }

    // 首先检查是否有自定义颜色
    let baseColor;
    if (customColors.has(label)) {
        baseColor = customColors.get(label);
    } else {
        baseColor = stringToColor(label);
    }

    // 计算新颜色
    const r = parseInt(baseColor.slice(1, 3), 16);
    const g = parseInt(baseColor.slice(3, 5), 16);
    const b = parseInt(baseColor.slice(5, 7), 16);
    const colors = {
        stroke: `rgba(${r}, ${g}, ${b}, 1)`,
        fill: `rgba(${r}, ${g}, ${b}, ${fillOpacity})` // 使用全局fillOpacity
    };

    // 存入缓存
    colorCache.set(label, colors);
    return colors;
}

// 清除颜色缓存（当fillOpacity或自定义颜色改变时调用）
function invalidateColorCache() {
    colorCache.clear();
}

// --- Multi-Selection Helpers ---
function clearSelection() {
    selectedShapeIndex = -1;
    selectedShapeIndices.clear();
    hideShapeContextMenu();
}

function selectShape(index) {
    // Exit edit mode if selecting a different shape
    if (isEditingShape && shapeBeingEdited !== index) {
        exitShapeEditMode(true);
    }
    selectedShapeIndices.clear();
    selectedShapeIndex = index;
    if (index !== -1) {
        selectedShapeIndices.add(index);
    }
}

function toggleShapeSelection(index) {
    // Exit edit mode — multi-selection is incompatible with vertex editing
    if (isEditingShape) exitShapeEditMode(true);

    if (selectedShapeIndices.has(index)) {
        selectedShapeIndices.delete(index);
        if (selectedShapeIndex === index) {
            selectedShapeIndex = selectedShapeIndices.size > 0 ? [...selectedShapeIndices][selectedShapeIndices.size - 1] : -1;
        }
    } else {
        selectedShapeIndices.add(index);
        selectedShapeIndex = index;
    }
}

function selectShapeRange(fromIndex, toIndex) {
    // Exit edit mode — multi-selection is incompatible with vertex editing
    if (isEditingShape) exitShapeEditMode(true);

    // Replace selection with the contiguous range
    selectedShapeIndices.clear();
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    for (let i = start; i <= end; i++) {
        selectedShapeIndices.add(i);
    }
    selectedShapeIndex = toIndex;
}

function selectAllShapes() {
    // Exit edit mode — multi-selection is incompatible with vertex editing
    if (isEditingShape) exitShapeEditMode(true);
    selectedShapeIndices.clear();
    for (let i = 0; i < shapes.length; i++) {
        selectedShapeIndices.add(i);
    }
    selectedShapeIndex = shapes.length > 0 ? 0 : -1;
}

function isShapeSelected(index) {
    return selectedShapeIndices.has(index);
}

// Adjust selection indices when shapes are inserted after a given index
function adjustSelectionAfterInsert(afterIndex, count) {
    const newSet = new Set();
    for (const idx of selectedShapeIndices) {
        newSet.add(idx > afterIndex ? idx + count : idx);
    }
    selectedShapeIndices = newSet;
    if (selectedShapeIndex > afterIndex) {
        selectedShapeIndex += count;
    }
}

// Adjust selection indices when a shape is deleted
function adjustSelectionAfterDelete(deletedIndex) {
    selectedShapeIndices.delete(deletedIndex);
    const newSet = new Set();
    for (const idx of selectedShapeIndices) {
        newSet.add(idx > deletedIndex ? idx - 1 : idx);
    }
    selectedShapeIndices = newSet;
    if (selectedShapeIndex === deletedIndex) {
        selectedShapeIndex = selectedShapeIndices.size > 0 ? [...selectedShapeIndices][0] : -1;
    } else if (selectedShapeIndex > deletedIndex) {
        selectedShapeIndex--;
    }
}

// Delete all currently selected shapes (batch delete)
function deleteSelectedShapes() {
    if (selectedShapeIndices.size === 0) return;
    // Sort indices descending to splice from end first
    const indices = [...selectedShapeIndices].sort((a, b) => b - a);

    // Always exit edit mode before batch delete — the edited shape may be
    // deleted directly, or its index may shift when earlier shapes are removed.
    if (isEditingShape) {
        exitShapeEditMode(false);
    }

    for (const idx of indices) {
        shapes.splice(idx, 1);
    }
    clearSelection();
    markDirty();
    saveHistory();
    renderShapeList();
    renderLabelsList();
    draw();
}

// Get bounding box of a shape
function getShapeBoundingBox(shape) {
    let points = shape.points;
    if (shape.shape_type === 'rectangle') {
        points = getRectPoints(points);
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
}

// Find all shapes whose bounding box intersects with given rectangle
function findShapesInRect(rx1, ry1, rx2, ry2) {
    const selMinX = Math.min(rx1, rx2);
    const selMinY = Math.min(ry1, ry2);
    const selMaxX = Math.max(rx1, rx2);
    const selMaxY = Math.max(ry1, ry2);
    const result = [];
    for (let i = 0; i < shapes.length; i++) {
        if (shapes[i].visible === false) continue;
        const bb = getShapeBoundingBox(shapes[i]);
        // Check if bounding boxes intersect
        if (bb.maxX >= selMinX && bb.minX <= selMaxX && bb.maxY >= selMinY && bb.minY <= selMaxY) {
            result.push(i);
        }
    }
    return result;
}

// --- Canvas Interaction ---

// 使用canvasWrapper来监听鼠标事件，因为SVG覆盖在canvas上
canvasWrapper.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left click
        // If click is on the context menu, let it handle the click
        if (shapeContextMenu && shapeContextMenu.contains(e.target)) {
            return;
        }

        // If context menu is visible and click is outside it, hide it and don't process further
        if (shapeContextMenu && shapeContextMenu.style.display !== 'none') {
            hideShapeContextMenu();
            return;
        }

        const rect = canvas.getBoundingClientRect();
        // Mouse pos relative to canvas
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Convert to image coordinates
        const x = mx / zoomLevel;
        const y = my / zoomLevel;

        // --- Eraser Mode ---
        // Once eraser is active, handle clicks without requiring Shift
        if (eraserActive) {
            if (eraserMode === 'polygon') {
                const firstPoint = eraserPoints[0];
                const dx = x - firstPoint[0];
                const dy = y - firstPoint[1];
                // Check close distance (scaled)
                if (eraserPoints.length > 2 && (dx * dx + dy * dy) < (CLOSE_DISTANCE_THRESHOLD / (zoomLevel * zoomLevel))) {
                    finishEraser();
                } else {
                    eraserPoints.push(clampImageCoords(x, y));
                    draw();
                }
                return;
            }
            if (eraserMode === 'rectangle' && eraserRectSecondClick) {
                eraserPoints[1] = clampImageCoords(x, y);
                finishEraser();
                return;
            }
            return;
        }

        // Shift+click to START eraser (only needed for the first click).
        // In SAM mode, only allow eraser when no positive prompt is in progress —
        // otherwise Shift is reserved for adding a negative point.
        if (e.shiftKey
            && (currentMode !== 'sam' || !samHasPositivePrompt(samPrompts))
            && currentMode !== 'view'
            && !isDrawing) {
            eraserMouseDownTime = Date.now();
            eraserMouseDownPos = { x, y };
            eraserIsDragging = false;
            eraserDragCurrent = { x, y };
            // Don't set eraserActive yet - wait for mouseup to determine polygon vs rectangle
            return;
        }

        if (!isDrawing) {
            const now = Date.now();
            const dx = x - lastClickX;
            const dy = y - lastClickY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const timeDiff = now - lastClickTime;

            // 检测是否是在同一位置的连续点击
            const isSameLocation = distance < CLICK_THRESHOLD_DISTANCE && timeDiff < CLICK_THRESHOLD_TIME;

            // 获取点击位置的所有重叠实例
            const overlappingShapes = findAllShapesAt(x, y);

            if (overlappingShapes.length > 0) {
                let targetShape;
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: always target topmost shape (no cycling)
                    targetShape = overlappingShapes[0];
                    toggleShapeSelection(targetShape);
                } else if (isSameLocation && overlappingShapes.length > 1) {
                    // 如果在同一位置连续点击，且有多个重叠实例，则循环选择下一个
                    const currentIndex = overlappingShapes.indexOf(selectedShapeIndex);
                    if (currentIndex !== -1 && currentIndex < overlappingShapes.length - 1) {
                        targetShape = overlappingShapes[currentIndex + 1];
                    } else {
                        targetShape = overlappingShapes[0];
                    }
                    selectShape(targetShape);
                } else {
                    targetShape = overlappingShapes[0];
                    selectShape(targetShape);
                }

                // 更新点击位置和时间
                lastClickX = x;
                lastClickY = y;
                lastClickTime = now;

                renderShapeList();
                draw();
                return;
            } else {
                // Click on empty area
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click on empty: don't clear selection
                } else {
                    clearSelection();
                }
                renderShapeList();

                // 重置点击追踪
                lastClickTime = 0;
            }

            // View mode: start box selection on empty area (works with Ctrl for additive selection)
            if (currentMode === 'view') {
                isBoxSelecting = true;
                boxSelectStart = { x, y };
                boxSelectCurrent = { x, y };
            }

            // 只在polygon或rectangle或point或line模式下允许开始绘制
            if (currentMode === 'point') {
                // Point mode: single click creates a point and immediately finishes
                isDrawing = true;
                currentPoints = [clampImageCoords(x, y)];
                finishPolygon();
            } else if (currentMode === 'line') {
                isDrawing = true;
                currentPoints = [clampImageCoords(x, y)];
            } else if (currentMode === 'polygon') {
                isDrawing = true;
                currentPoints = [clampImageCoords(x, y)];
            } else if (currentMode === 'rectangle') {
                isDrawing = true;
                // Rectangle starts with one point, we'll expand it in mousemove
                currentPoints = [clampImageCoords(x, y)];
            }
            // SAM mode is handled separately below
        } else {
            if (currentMode === 'line') {
                // Line mode: check if double-clicking the last point
                if (currentPoints.length > 0) {
                    const lastPoint = currentPoints[currentPoints.length - 1];
                    const dx = x - lastPoint[0];
                    const dy = y - lastPoint[1];
                    const distanceToLast = Math.sqrt(dx * dx + dy * dy);

                    // Double-click detection on last point (within threshold distance and time)
                    const now = Date.now();
                    const timeDiff = now - lastClickTime;
                    const isDoubleClickOnLast = distanceToLast < CLICK_THRESHOLD_DISTANCE && timeDiff < CLICK_THRESHOLD_TIME;

                    if (isDoubleClickOnLast && currentPoints.length >= 2) {
                        // Double-click on last point - finish the line
                        finishPolygon();
                    } else {
                        // Add new point
                        currentPoints.push(clampImageCoords(x, y));
                        lastClickX = x;
                        lastClickY = y;
                        lastClickTime = now;
                    }
                }
            } else if (currentMode === 'polygon') {
                const firstPoint = currentPoints[0];
                const dx = x - firstPoint[0];
                const dy = y - firstPoint[1];

                // Check close distance (scaled)
                if (currentPoints.length > 2 && (dx * dx + dy * dy) < (CLOSE_DISTANCE_THRESHOLD / (zoomLevel * zoomLevel))) {
                    finishPolygon();
                } else {
                    currentPoints.push(clampImageCoords(x, y));
                }
            } else if (currentMode === 'rectangle') {
                // Second click to finish rectangle
                finishPolygon();
            }
        }
        draw();
    } else if (e.button === 2) { // Right click
        e.preventDefault(); // 阻止浏览器默认的上下文菜单

        // Eraser right-click: undo last point or cancel
        if (eraserActive) {
            if (eraserMode === 'polygon') {
                if (eraserPoints.length > 0) {
                    eraserPoints.pop();
                    if (eraserPoints.length === 0) {
                        cancelEraser();
                    } else {
                        draw();
                    }
                }
            } else {
                // Cancel rectangle eraser
                cancelEraser();
            }
            return;
        }

        if (currentMode === 'sam') {
            // Hide context menu if visible, then fall through to check for new shape target
            if (shapeContextMenu && shapeContextMenu.style.display !== 'none') {
                hideShapeContextMenu();
            }
            // Cancel box second-click mode
            if (samBoxSecondClick) {
                samBoxSecondClick = false;
                samDragStart = null;
                samDragCurrent = null;
                samIsDragging = false;
                samMouseDownTime = 0;
                draw();
                return;
            }
            // SAM mode right click: if not actively annotating, check for shape first
            if (samPrompts.length === 0 && !samMaskContour && !samPendingClick && !samClickTimer) {
                const rect = canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const x = mx / zoomLevel;
                const y = my / zoomLevel;

                const clickedShapeIndex = findShapeIndexAt(x, y);
                if (clickedShapeIndex !== -1) {
                    if (!isShapeSelected(clickedShapeIndex)) {
                        selectShape(clickedShapeIndex);
                    }
                    renderShapeList();
                    draw();
                    showShapeContextMenu(e.clientX, e.clientY, clickedShapeIndex);
                    return;
                }
            }
            // Actively annotating or not on a shape: undo last SAM prompt
            samUndoLastPrompt();
            return;
        }
        if (isDrawing) {
            if (currentMode === 'polygon' || currentMode === 'line') {
                if (currentPoints.length > 0) {
                    currentPoints.pop();
                    if (currentPoints.length === 0) {
                        isDrawing = false;
                    }
                    draw();
                }
            } else if (currentMode === 'rectangle') {
                // Cancel rectangle drawing
                isDrawing = false;
                currentPoints = [];
                draw();
            }
        } else {
            // Not drawing - check if right-clicked on a shape to show context menu (works in all modes)
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const x = mx / zoomLevel;
            const y = my / zoomLevel;

            const clickedShapeIndex = findShapeIndexAt(x, y);
            if (clickedShapeIndex !== -1) {
                // If right-clicked shape is not already selected, select it (preserving multi-select if applicable)
                if (!isShapeSelected(clickedShapeIndex)) {
                    selectShape(clickedShapeIndex);
                }
                renderShapeList();
                draw();
                showShapeContextMenu(e.clientX, e.clientY, clickedShapeIndex);
            } else {
                hideShapeContextMenu();
            }
        }
    }
});

canvasWrapper.addEventListener('mousemove', (e) => {
    // --- Eraser mousemove handling ---
    // Phase 1: During initial mousedown-hold (before mouseup determines mode)
    if (eraserMouseDownPos && !eraserActive) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / zoomLevel;
        const y = (e.clientY - rect.top) / zoomLevel;
        const dx = x - eraserMouseDownPos.x;
        const dy = y - eraserMouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > ERASER_DRAG_THRESHOLD) {
            eraserIsDragging = true;
        }
        eraserDragCurrent = { x, y };
        // Redraw to show rectangle preview during drag
        if (eraserIsDragging && !animationFrameId) {
            animationFrameId = requestAnimationFrame(() => {
                draw(e);
                animationFrameId = null;
            });
        }
        return; // Don't process other events during eraser mousedown-hold
    }
    // Phase 2: Eraser rectangle waiting for second click - show preview
    if (eraserActive && eraserMode === 'rectangle' && eraserRectSecondClick) {
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(() => {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) / zoomLevel;
                const y = (e.clientY - rect.top) / zoomLevel;
                eraserPoints[1] = clampImageCoords(x, y);
                draw(e);
                animationFrameId = null;
            });
        }
        return;
    }
    // Phase 3: Eraser polygon - redraw to show trailing line to mouse
    if (eraserActive && eraserMode === 'polygon') {
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(() => {
                draw(e);
                animationFrameId = null;
            });
        }
        return;
    }

    // Box selection drag (view mode)
    if (isBoxSelecting) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / zoomLevel;
        const y = (e.clientY - rect.top) / zoomLevel;
        boxSelectCurrent = { x, y };
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(() => {
                draw(e);
                animationFrameId = null;
            });
        }
        return;
    }

    if (isDrawing) {
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(() => {
                if (currentMode === 'rectangle' && currentPoints.length > 0) {
                    const rect = canvas.getBoundingClientRect();
                    const mx = e.clientX - rect.left;
                    const my = e.clientY - rect.top;
                    const x = mx / zoomLevel;
                    const y = my / zoomLevel;

                    const startPoint = currentPoints[0];
                    // Update currentPoints to be just the start and end points (2 points)
                    currentPoints = [startPoint, clampImageCoords(x, y)];
                }
                draw(e);
                animationFrameId = null;
            });
        }
    } else {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const x = mx / zoomLevel;
        const y = my / zoomLevel;

        // Skip cursor refresh while Shift feedback owns the cursor.
        if (shiftPressed) return;

        const hoveredIndex = findShapeIndexAt(x, y);
        const desiredCursor = hoveredIndex !== -1 ? 'pointer' :
            (currentMode === 'view' ? 'default' : 'crosshair');

        // 只在光标需要改变时更新样式
        if (currentCursor !== desiredCursor) {
            canvasWrapper.style.cursor = desiredCursor;
            currentCursor = desiredCursor;
        }
    }
});

// Mouseup handler for box selection completion (document-level so it fires
// even when the mouse is released outside the canvas wrapper)
document.addEventListener('mouseup', (e) => {
    if (isBoxSelecting) {
        isBoxSelecting = false;
        if (boxSelectStart && boxSelectCurrent) {
            const dx = boxSelectCurrent.x - boxSelectStart.x;
            const dy = boxSelectCurrent.y - boxSelectStart.y;
            // Only select if dragged enough (not a simple click)
            if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD_DISTANCE) {
                const found = findShapesInRect(boxSelectStart.x, boxSelectStart.y, boxSelectCurrent.x, boxSelectCurrent.y);
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+drag: add to existing selection
                    for (const idx of found) {
                        selectedShapeIndices.add(idx);
                    }
                    if (found.length > 0) {
                        selectedShapeIndex = found[0];
                    }
                } else {
                    clearSelection();
                    for (const idx of found) {
                        selectedShapeIndices.add(idx);
                    }
                    selectedShapeIndex = found.length > 0 ? found[0] : -1;
                }
                renderShapeList();
            }
        }
        boxSelectStart = null;
        boxSelectCurrent = null;
        draw();
    }
});

// Save locked view state on scroll (debounced) + update pixel values at max zoom
let scrollSaveTimeout = null;
let pixelValuesScrollTimeout = null;
canvasContainer.addEventListener('scroll', () => {
    if (lockViewEnabled) {
        if (scrollSaveTimeout) clearTimeout(scrollSaveTimeout);
        scrollSaveTimeout = setTimeout(() => {
            saveLockedViewState();
        }, 200); // Debounce to avoid too frequent saves
    }
    // Update pixel values on scroll when at max zoom (debounced)
    if (zoomLevel >= PIXEL_VALUES_ZOOM) {
        if (pixelValuesScrollTimeout) cancelAnimationFrame(pixelValuesScrollTimeout);
        pixelValuesScrollTimeout = requestAnimationFrame(() => {
            drawSVGAnnotations();
            pixelValuesScrollTimeout = null;
        });
    }
});

// 缩放事件绑定到canvasContainer以确保始终能响应
canvasContainer.addEventListener('wheel', (e) => {
    if (e.ctrlKey) { // Zoom on Ctrl+Wheel
        e.preventDefault();

        // 使用 requestAnimationFrame 节流，避免频繁重绘
        if (zoomAnimationFrameId) {
            return; // 如果已经有待处理的缩放，忽略此次事件
        }

        zoomAnimationFrameId = requestAnimationFrame(() => {
            // Get mouse position relative to container
            const rect = canvasContainer.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Get scroll position
            const scrollLeft = canvasContainer.scrollLeft;
            const scrollTop = canvasContainer.scrollTop;

            // Calculate mouse position in image coordinates before zoom.
            // Wrapper has CANVAS_EDGE_PADDING of empty space before the image starts,
            // so subtract PAD when converting wrapper-local position to image space.
            const imageX = (scrollLeft + mouseX - CANVAS_EDGE_PADDING) / zoomLevel;
            const imageY = (scrollTop + mouseY - CANVAS_EDGE_PADDING) / zoomLevel;

            // Apply zoom with linear scaling
            if (e.deltaY < 0) {
                // Zoom in
                zoomLevel *= ZOOM_FACTOR;
                if (zoomLevel > ZOOM_MAX) zoomLevel = ZOOM_MAX;
            } else {
                // Zoom out
                zoomLevel /= ZOOM_FACTOR;
                if (zoomLevel < ZOOM_MIN) zoomLevel = ZOOM_MIN;
            }

            // Snap to integer zoom when in pixel rendering mode.
            // This ensures every image pixel maps to exactly N×N screen pixels,
            // preventing non-uniform pixel sizes that cause grid misalignment.
            if (zoomLevel >= PIXEL_RENDER_THRESHOLD) {
                zoomLevel = Math.round(zoomLevel);
            }

            // Update canvas wrapper size (整体缩放)
            const displayWidth = img.width * zoomLevel;
            const displayHeight = img.height * zoomLevel;

            canvas.style.width = `${displayWidth}px`;
            canvas.style.height = `${displayHeight}px`;

            svgOverlay.setAttribute('width', `${displayWidth}px`);
            svgOverlay.setAttribute('height', `${displayHeight}px`);
            svgOverlay.style.width = `${displayWidth}px`;
            svgOverlay.style.height = `${displayHeight}px`;

            // Wrapper inner size = display size; CSS padding adds the edge ring on top.
            canvasWrapper.style.width = `${displayWidth}px`;
            canvasWrapper.style.height = `${displayHeight}px`;
            canvasWrapper.style.transform = '';

            // Calculate new scroll position to keep the same image point under the mouse.
            // Inverse of the read above: image pixel sits at +PAD inside the wrapper.
            const newScrollLeft = imageX * zoomLevel + CANVAS_EDGE_PADDING - mouseX;
            const newScrollTop = imageY * zoomLevel + CANVAS_EDGE_PADDING - mouseY;

            // Apply new scroll position
            canvasContainer.scrollLeft = newScrollLeft;
            canvasContainer.scrollTop = newScrollTop;

            // 更新像素渲染模式（pixelated + grid）
            updatePixelRendering();

            // 重绘SVG以更新线宽（保持视觉上的恒定粗细）
            drawSVGAnnotations();

            // Explicitly save locked view state after zoom
            // Cannot rely solely on scroll event because:
            // 1. If scroll position resets to 0 (image fits screen), scroll event may not fire
            // 2. This ensures zoomFactor is always updated after wheel zoom
            if (lockViewEnabled) {
                if (scrollSaveTimeout) clearTimeout(scrollSaveTimeout);
                scrollSaveTimeout = setTimeout(() => {
                    saveLockedViewState();
                }, 200);
            }


            // Update zoom percentage display
            updateZoomUI();

            zoomAnimationFrameId = null; // 重置标志
        });
    }
}, { passive: false });

// 禁用全局右键菜单（防止系统右键菜单出现）
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// --- Shape Context Menu Functions ---
function showShapeContextMenu(clientX, clientY, shapeIndex) {
    if (!shapeContextMenu) return;

    const multi = selectedShapeIndices.size > 1;

    // Hide "Edit" for multi-selection (only works on single shape)
    if (contextMenuEdit) {
        contextMenuEdit.style.display = multi ? 'none' : '';
    }
    // Update labels for multi-selection
    if (contextMenuRename) {
        contextMenuRename.textContent = multi ? `Rename (${selectedShapeIndices.size})` : 'Rename';
    }
    if (contextMenuMerge) {
        const eligibleForMerge = selectedShapeIndices.size >= 2
            && [...selectedShapeIndices].every(i => {
                const t = shapes[i] && shapes[i].shape_type;
                return t === 'polygon' || t === 'rectangle';
            });
        contextMenuMerge.style.display = eligibleForMerge ? '' : 'none';
        if (eligibleForMerge) {
            contextMenuMerge.textContent = `Merge (${selectedShapeIndices.size})`;
        }
    }
    if (contextMenuToggleVisible) {
        if (multi) {
            const anyVisible = [...selectedShapeIndices].some(idx => shapes[idx].visible !== false);
            contextMenuToggleVisible.textContent = anyVisible ? `Hide (${selectedShapeIndices.size})` : `Show (${selectedShapeIndices.size})`;
        } else {
            const shape = shapes[selectedShapeIndex];
            contextMenuToggleVisible.textContent = (shape && shape.visible === false) ? 'Show' : 'Hide';
        }
    }
    if (contextMenuDelete) {
        contextMenuDelete.textContent = multi ? `Delete (${selectedShapeIndices.size})` : 'Delete';
    }

    // Position the menu at mouse location relative to canvasWrapper
    const wrapperRect = canvasWrapper.getBoundingClientRect();
    const menuX = clientX - wrapperRect.left;
    const menuY = clientY - wrapperRect.top;

    shapeContextMenu.style.left = menuX + 'px';
    shapeContextMenu.style.top = menuY + 'px';
    shapeContextMenu.style.display = 'block';
}

function hideShapeContextMenu() {
    if (shapeContextMenu) {
        shapeContextMenu.style.display = 'none';
    }
}

// Context menu item click handler - enter edit mode
if (contextMenuEdit) {
    contextMenuEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        hideShapeContextMenu();
        if (selectedShapeIndex !== -1) {
            enterShapeEditMode(selectedShapeIndex);
        }
    });
}

// Context menu item click handler - rename (edit label)
if (contextMenuRename) {
    contextMenuRename.addEventListener('click', (e) => {
        e.stopPropagation();
        hideShapeContextMenu();
        if (selectedShapeIndices.size > 1) {
            showBatchRenameModal();
        } else if (selectedShapeIndex !== -1) {
            showLabelModal(selectedShapeIndex);
        }
    });
}

// Toggle visibility for the current selection (used by context menu and Ctrl+H).
function toggleSelectedVisibility() {
    if (selectedShapeIndices.size > 1) {
        // Deterministic: hide all if any visible, show all if all hidden
        const anyVisible = [...selectedShapeIndices].some(idx => shapes[idx].visible !== false);
        const newState = !anyVisible; // true = show, false = hide
        for (const idx of selectedShapeIndices) {
            shapes[idx].visible = newState;
        }
        renderShapeList();
        renderLabelsList();
        draw();
    } else if (selectedShapeIndex !== -1) {
        const shape = shapes[selectedShapeIndex];
        shape.visible = shape.visible === undefined ? false : !shape.visible;
        renderShapeList();
        renderLabelsList();
        draw();
    }
}

// Context menu item click handler - toggle visibility
if (contextMenuToggleVisible) {
    contextMenuToggleVisible.addEventListener('click', (e) => {
        e.stopPropagation();
        hideShapeContextMenu();
        toggleSelectedVisibility();
    });
}

// Context menu item click handler - merge
if (contextMenuMerge) {
    contextMenuMerge.addEventListener('click', (e) => {
        e.stopPropagation();
        hideShapeContextMenu();
        mergeSelectedShapes();
    });
}

// --- Merge selected shapes ---
let isMergePending = false;
let pendingMergeGroups = null;   // Array<Array<index>>, ascending min-index per group
let pendingMergeOutputs = null;  // Array<{ allRect: bool, points: ... }>
let pendingMergeLabels = null;   // Array<string|null>; null = use modal input

function setMergeStatus(text, color) {
    if (!window.notifyBus || !text) return;
    // Map the legacy (text, color) calls to severity. 'red' / 'orange' map to
    // error / warn, anything else (including missing color) is info.
    const level = color === 'red' ? 'error' : (color === 'orange' ? 'warn' : 'info');
    window.notifyBus.show(level, text);
}

// Look up the pure merge helpers either as hoisted globals (webview) or via
// the optional `window.mergeShapesHelpers` namespace. Returns null if any
// helper is missing.
function resolveMergeHelpers() {
    const ns = window.mergeShapesHelpers || (typeof mergeShapesHelpers !== 'undefined' ? mergeShapesHelpers : null);
    const fn = {
        shapeToOuterRing: (typeof shapeToOuterRing !== 'undefined') ? shapeToOuterRing : (ns && ns.shapeToOuterRing),
        buildOverlapGroups: (typeof buildOverlapGroups !== 'undefined') ? buildOverlapGroups : (ns && ns.buildOverlapGroups),
        computeAABBPoints: (typeof computeAABBPoints !== 'undefined') ? computeAABBPoints : (ns && ns.computeAABBPoints),
        unionOuterRing: (typeof unionOuterRing !== 'undefined') ? unionOuterRing : (ns && ns.unionOuterRing),
        resolveGroupLabel: (typeof resolveGroupLabel !== 'undefined') ? resolveGroupLabel : (ns && ns.resolveGroupLabel),
        buildMergedShape: (typeof buildMergedShape !== 'undefined') ? buildMergedShape : (ns && ns.buildMergedShape)
    };
    return Object.values(fn).every(f => typeof f === 'function') ? fn : null;
}

function mergeSelectedShapes() {
    if (selectedShapeIndices.size < 2) return;
    const indices = [...selectedShapeIndices];
    const allEligible = indices.every(i => {
        const t = shapes[i] && shapes[i].shape_type;
        return t === 'polygon' || t === 'rectangle';
    });
    if (!allEligible) {
        setMergeStatus('Merge supports polygon/rectangle only', 'orange');
        return;
    }
    const pc = window.polygonClipping || (typeof polygonClipping !== 'undefined' ? polygonClipping : null);
    if (!pc) {
        setMergeStatus('Polygon clipping unavailable', 'red');
        return;
    }
    const fn = resolveMergeHelpers();
    if (!fn) {
        setMergeStatus('Merge helpers missing', 'red');
        return;
    }

    const groups = fn.buildOverlapGroups(pc, shapes, indices);
    if (groups.length === 0) {
        setMergeStatus('No overlapping shapes to merge', 'orange');
        return;
    }

    // Output type is decided by the selection as a whole, not per group:
    // a mixed selection treats every rectangle as a polygon, so all merged
    // outputs become polygons.
    const selectionAllRect = indices.every(i => shapes[i].shape_type === 'rectangle');

    // Pre-compute geometry for each group.
    const valid = [];
    for (const group of groups) {
        const allRect = selectionAllRect;
        const rings = group.map(i => fn.shapeToOuterRing(shapes[i]));
        let out;
        if (allRect) {
            const aabb = fn.computeAABBPoints(rings);
            if (!aabb) continue;
            out = { allRect: true, points: aabb };
        } else {
            const outer = fn.unionOuterRing(pc, rings);
            if (!outer || outer.length < 3) continue;
            out = { allRect: false, points: outer };
        }
        valid.push({ group, out });
    }
    if (valid.length === 0) {
        setMergeStatus('Merge produced no valid geometry', 'orange');
        return;
    }

    // Resolve labels.
    const resolved = valid.map(({ group }) => fn.resolveGroupLabel(shapes, group));
    const anyPrompt = resolved.some(r => r.needsPrompt);

    if (!anyPrompt) {
        finalizeMerge(valid, resolved.map(r => r.label), fn);
        return;
    }

    // Open modal in merge-pending mode; mode label is the first prompted group's mode label.
    pendingMergeGroups = valid.map(v => v.group);
    pendingMergeOutputs = valid.map(v => v.out);
    pendingMergeLabels = resolved.map(r => r.needsPrompt ? null : r.label);
    isMergePending = true;
    const seedLabel = resolved.find(r => r.needsPrompt).modeLabel || '';
    showLabelModalForMerge(seedLabel);
}

function showLabelModalForMerge(seedLabel) {
    editingShapeIndex = -1;
    isBatchRenaming = false;
    labelModal.style.display = 'flex';
    labelInput.value = seedLabel;
    descriptionInput.value = '';
    labelInput.focus();
    labelInput.select();
    renderRecentLabels();
}

function finalizeMerge(valid, perGroupLabel, fnRefs) {
    const removeIdx = new Set();
    for (const v of valid) for (const i of v.group) removeIdx.add(i);

    // Build merged shapes; key on the smallest original index for stable ordering.
    const inserts = new Map();
    const insertedShapes = new Set();
    valid.forEach((v, i) => {
        const merged = fnRefs.buildMergedShape(
            shapes,
            v.group,
            perGroupLabel[i],
            { allRectangles: v.out.allRect, points: v.out.points }
        );
        inserts.set(v.group[0], merged);
        insertedShapes.add(merged);
    });

    const newShapes = [];
    for (let i = 0; i < shapes.length; i++) {
        if (inserts.has(i)) newShapes.push(inserts.get(i));
        else if (!removeIdx.has(i)) newShapes.push(shapes[i]);
    }
    shapes.length = 0;
    for (const s of newShapes) shapes.push(s);

    // Update selection to point at merged shapes only.
    selectedShapeIndices.clear();
    for (let i = 0; i < shapes.length; i++) {
        if (insertedShapes.has(shapes[i])) selectedShapeIndices.add(i);
    }
    selectedShapeIndex = selectedShapeIndices.size > 0
        ? [...selectedShapeIndices][selectedShapeIndices.size - 1]
        : -1;

    markDirty();
    saveHistory();
    renderShapeList();
    renderLabelsList();
    draw();
    setMergeStatus(`Merged into ${valid.length} instance${valid.length > 1 ? 's' : ''}`, 'limegreen');
}

function clearMergePendingState() {
    isMergePending = false;
    pendingMergeGroups = null;
    pendingMergeOutputs = null;
    pendingMergeLabels = null;
}

function commitMergePendingFromModal() {
    if (!isMergePending) return false;
    const chosen = labelInput.value.trim();
    if (!chosen) return false; // keep modal open; user must pick something
    const fn = resolveMergeHelpers();
    if (!fn) {
        setMergeStatus('Merge helpers missing', 'red');
        clearMergePendingState();
        hideLabelModal();
        return true;
    }
    const labels = pendingMergeLabels.map(l => l === null ? chosen : l);
    const valid = pendingMergeGroups.map((group, i) => ({
        group,
        out: pendingMergeOutputs[i]
    }));
    hideLabelModal();
    clearMergePendingState();
    finalizeMerge(valid, labels, fn);
    // Persist the chosen label as MRU (mirrors confirmLabel behavior).
    const existingIdx = recentLabels.indexOf(chosen);
    if (existingIdx !== -1) recentLabels.splice(existingIdx, 1);
    recentLabels.unshift(chosen);
    if (recentLabels.length > 10) recentLabels.pop();
    saveGlobalSettings('recentLabels', recentLabels);
    return true;
}

// Context menu item click handler - delete
if (contextMenuDelete) {
    contextMenuDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        hideShapeContextMenu();
        if (selectedShapeIndices.size > 1) {
            deleteSelectedShapes();
        } else if (selectedShapeIndex !== -1) {
            deleteShape(selectedShapeIndex);
        }
    });
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (shapeContextMenu && !shapeContextMenu.contains(e.target)) {
        hideShapeContextMenu();
    }
});

// --- Unified Edit Mode Functions ---
function enterShapeEditMode(shapeIndex) {
    isEditingShape = true;
    shapeBeingEdited = shapeIndex;
    selectShape(shapeIndex);
    originalEditPoints = JSON.parse(JSON.stringify(shapes[shapeIndex].points));
    draw();
}

function exitShapeEditMode(saveChanges = true) {
    if (!isEditingShape) return;

    if (!saveChanges && originalEditPoints && shapeBeingEdited !== -1) {
        // Restore original points
        shapes[shapeBeingEdited].points = originalEditPoints;
    }

    isEditingShape = false;
    shapeBeingEdited = -1;
    originalEditPoints = null;
    dragStartPoint = null;
    isDraggingVertex = false;
    isDraggingWholeShape = false;
    activeVertexIndex = -1;
    if (!shiftPressed) {
        canvasWrapper.style.cursor = currentMode === 'view' ? 'default' : 'crosshair';
    }
    draw();
}

// Find vertex at position (for edit mode)
function findVertexAt(shapeIndex, x, y) {
    const shape = shapes[shapeIndex];
    let points = shape.points;

    // For rectangles, use the actual corner points
    if (shape.shape_type === 'rectangle') {
        points = getRectPoints(shape.points);
    }

    const VERTEX_CLICK_RADIUS = 8 / zoomLevel;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const dx = x - p[0];
        const dy = y - p[1];
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= VERTEX_CLICK_RADIUS) {
            return i;
        }
    }
    return -1;
}

// Handle mouse events for unified edit mode on canvasWrapper
canvasWrapper.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only left click

    if (isEditingShape && shapeBeingEdited !== -1) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const x = mx / zoomLevel;
        const y = my / zoomLevel;

        // First check if clicked on a vertex
        const vertexIndex = findVertexAt(shapeBeingEdited, x, y);
        if (vertexIndex !== -1) {
            activeVertexIndex = vertexIndex;
            isDraggingVertex = true;
            dragStartPoint = { x, y };
            e.stopPropagation();
            e.preventDefault();
            return;
        }

        // Check if clicked on the shape itself (for whole shape dragging)
        const clickedIndex = findShapeIndexAt(x, y);
        if (clickedIndex === shapeBeingEdited) {
            isDraggingWholeShape = true;
            dragStartPoint = { x, y };
            // Don't overwrite the Shift feedback cursor; it'll be cleared on Shift-up.
            if (!shiftPressed) {
                canvasWrapper.style.cursor = 'move';
            }
            e.stopPropagation();
            e.preventDefault();
            return;
        }

        // Clicked outside the shape - exit edit mode without saving (like ESC)
        exitShapeEditMode(false);
        e.stopPropagation();
        e.preventDefault();
        return;
    }
}, true); // Use capture phase to intercept before other handlers

document.addEventListener('mousemove', (e) => {
    if (!isEditingShape || shapeBeingEdited === -1) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const x = mx / zoomLevel;
    const y = my / zoomLevel;

    if (isDraggingWholeShape && dragStartPoint) {
        const dx = x - dragStartPoint.x;
        const dy = y - dragStartPoint.y;

        // Move all points by the delta
        const shape = shapes[shapeBeingEdited];
        shape.points = originalEditPoints.map(p => clampImageCoords(p[0] + dx, p[1] + dy));

        draw();
    } else if (isDraggingVertex && activeVertexIndex !== -1) {
        const shape = shapes[shapeBeingEdited];

        // For rectangles, we need special handling since we store only 2 corner points
        if (shape.shape_type === 'rectangle') {
            // Rectangle is stored as [[x1,y1], [x2,y2]] representing opposite corners
            // The 4 visual vertices are: [0]topLeft, [1]topRight, [2]bottomRight, [3]bottomLeft
            // Map back to the 2-point representation
            if (activeVertexIndex === 0 || activeVertexIndex === 2) {
                // Moving a diagonal corner - straightforward
                if (activeVertexIndex === 0) {
                    shape.points[0] = clampImageCoords(x, y);
                } else {
                    shape.points[1] = clampImageCoords(x, y);
                }
            } else {
                // Moving non-diagonal corner - need to update both stored points.
                // Clamp the constructed pairs through clampImageCoords so any
                // pre-existing out-of-bounds stored coord is also brought inside.
                const [p1, p2] = shape.points;
                if (activeVertexIndex === 1) {
                    // Top-right: affects p1[1] and p2[0]
                    shape.points = [
                        clampImageCoords(p1[0], y),
                        clampImageCoords(x, p2[1])
                    ];
                } else {
                    // Bottom-left: affects p1[0] and p2[1]
                    shape.points = [
                        clampImageCoords(x, p1[1]),
                        clampImageCoords(p2[0], y)
                    ];
                }
            }
        } else {
            // For polygon/line/point, just update the vertex directly
            shape.points[activeVertexIndex] = clampImageCoords(x, y);
        }

        draw();
    } else if (isEditingShape && !shiftPressed) {
        // Update cursor based on what's under the mouse
        // (skip while Shift feedback owns the cursor)
        const vertexIndex = findVertexAt(shapeBeingEdited, x, y);
        if (vertexIndex !== -1) {
            canvasWrapper.style.cursor = 'move';
        } else {
            const onShape = findShapeIndexAt(x, y) === shapeBeingEdited;
            canvasWrapper.style.cursor = onShape ? 'move' : 'crosshair';
        }
    }
});

document.addEventListener('mouseup', (e) => {
    if (isDraggingWholeShape) {
        isDraggingWholeShape = false;
        dragStartPoint = null;
        // Don't overwrite the Shift feedback cursor; it'll be cleared on Shift-up.
        if (!shiftPressed) {
            canvasWrapper.style.cursor = 'default';
        }
        // Update originalEditPoints to current position for next drag
        if (shapeBeingEdited !== -1) {
            originalEditPoints = JSON.parse(JSON.stringify(shapes[shapeBeingEdited].points));
        }
        markDirty();
        saveHistory();
    }
    if (isDraggingVertex) {
        isDraggingVertex = false;
        activeVertexIndex = -1;
        // Update originalEditPoints to current position
        if (shapeBeingEdited !== -1) {
            originalEditPoints = JSON.parse(JSON.stringify(shapes[shapeBeingEdited].points));
        }
        markDirty();
        saveHistory();
    }

    // --- Eraser: determine polygon vs rectangle on mouseup ---
    if (eraserMouseDownPos && !eraserActive && e.button === 0) {
        const elapsed = Date.now() - eraserMouseDownTime;
        const isLongPress = elapsed >= ERASER_LONG_PRESS_MS;
        const isDrag = eraserIsDragging;
        const pos = eraserMouseDownPos;
        const dragPos = eraserDragCurrent || pos;

        if (isLongPress || isDrag) {
            // Rectangle eraser mode
            eraserActive = true;
            eraserMode = 'rectangle';
            eraserPoints = [[pos.x, pos.y], [dragPos.x, dragPos.y]]; // Start from drag position
            eraserRectSecondClick = true;
            eraserMouseDownPos = null;
            eraserMouseDownTime = 0;
            eraserIsDragging = false;
            eraserDragCurrent = null;
            draw();
        } else {
            // Polygon eraser mode - short click
            eraserActive = true;
            eraserMode = 'polygon';
            eraserPoints = [[pos.x, pos.y]];
            eraserMouseDownPos = null;
            eraserMouseDownTime = 0;
            eraserIsDragging = false;
            eraserDragCurrent = null;
            draw();
        }
    }
});

// --- Resizer Logic ---
let isResizing = false;

if (resizer) {
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const containerWidth = document.body.clientWidth;
    const newSidebarWidth = containerWidth - e.clientX;
    if (newSidebarWidth > 150 && newSidebarWidth < 600) {
        sidebar.style.width = newSidebarWidth + 'px';
    }
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizer.classList.remove('resizing');
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
        // Save right sidebar width
        if (sidebar) {
            const state = vscode.getState() || {};
            state.rightSidebarWidth = sidebar.offsetWidth;
            vscode.setState(state);
        }
    }
});


// 查找指定位置的所有形状（从上到下）
function findAllShapesAt(x, y) {
    const overlappingShapes = [];
    const POINT_CLICK_RADIUS = 10 / zoomLevel; // Click detection radius for points
    const LINE_CLICK_THRESHOLD = 5 / zoomLevel; // Distance threshold for line click detection

    // 从后往前遍历（从上到下的绘制顺序）
    for (let i = shapes.length - 1; i >= 0; i--) {
        // 跳过隐藏的形状
        if (shapes[i].visible === false) continue;

        const shape = shapes[i];
        let points = shape.points;

        if (shape.shape_type === 'point') {
            // Point shape: check if click is within radius
            if (points.length > 0) {
                const p = points[0];
                const dx = x - p[0];
                const dy = y - p[1];
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= POINT_CLICK_RADIUS) {
                    overlappingShapes.push(i);
                }
            }
        } else if (shape.shape_type === 'linestrip') {
            // Linestrip shape: check if click is near any line segment
            if (isPointNearLinestrip([x, y], points, LINE_CLICK_THRESHOLD)) {
                overlappingShapes.push(i);
            }
        } else {
            // Polygon or rectangle shape
            if (shape.shape_type === 'rectangle') {
                points = getRectPoints(points);
            }
            if (isPointInPolygon([x, y], points)) {
                overlappingShapes.push(i);
            }
        }
    }
    return overlappingShapes;
}

// 查找指定位置的第一个形状（为了保持向后兼容）
function findShapeIndexAt(x, y) {
    const overlapping = findAllShapesAt(x, y);
    return overlapping.length > 0 ? overlapping[0] : -1;
}

function isPointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];

        const intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Check if a point is near any segment of a linestrip
function isPointNearLinestrip(point, vs, threshold) {
    if (vs.length < 2) {
        // Single point - check distance to that point
        if (vs.length === 1) {
            const dx = point[0] - vs[0][0];
            const dy = point[1] - vs[0][1];
            return Math.sqrt(dx * dx + dy * dy) <= threshold;
        }
        return false;
    }

    const px = point[0], py = point[1];

    for (let i = 0; i < vs.length - 1; i++) {
        const x1 = vs[i][0], y1 = vs[i][1];
        const x2 = vs[i + 1][0], y2 = vs[i + 1][1];

        // Calculate distance from point to line segment
        const lineLen = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
        if (lineLen === 0) continue;

        // Project point onto line, clamped to segment
        const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (lineLen * lineLen)));
        const projX = x1 + t * (x2 - x1);
        const projY = y1 + t * (y2 - y1);

        const distance = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
        if (distance <= threshold) {
            return true;
        }
    }
    return false;
}

function finishPolygon() {
    isDrawing = false;
    showLabelModal();
}

// --- Eraser Logic ---

// Cancel any ongoing eraser operation
function cancelEraser() {
    eraserActive = false;
    eraserPoints = [];
    eraserMode = null;
    eraserMouseDownTime = 0;
    eraserMouseDownPos = null;
    eraserIsDragging = false;
    eraserDragCurrent = null;
    eraserRectSecondClick = false;
    draw();
}

// Finish eraser drawing and perform the erase operation
function finishEraser() {
    if (eraserPoints.length < 3 && eraserMode === 'polygon') {
        cancelEraser();
        return;
    }
    if (eraserMode === 'rectangle' && eraserPoints.length !== 2) {
        cancelEraser();
        return;
    }

    // Convert rectangle points to polygon (4 corners)
    let eraserPolygon;
    if (eraserMode === 'rectangle') {
        eraserPolygon = getRectPoints(eraserPoints);
    } else {
        eraserPolygon = eraserPoints.slice();
    }

    performErase(eraserPolygon);
    cancelEraser();
}

// Core erase operation: subtract the eraser polygon from all existing instances
function performErase(eraserPolygon) {
    if (eraserPolygon.length < 3) return;

    // Convert eraser polygon to polygon-clipping format: [[[x,y], [x,y], ...]]
    // polygon-clipping expects rings as arrays of [x,y] with first ring = outer boundary
    const clipRing = eraserPolygon.map(p => [p[0], p[1]]);
    // Close the ring (polygon-clipping requires it)
    if (clipRing[0][0] !== clipRing[clipRing.length - 1][0] ||
        clipRing[0][1] !== clipRing[clipRing.length - 1][1]) {
        clipRing.push([clipRing[0][0], clipRing[0][1]]);
    }
    const clipGeom = [clipRing];

    let modified = false;
    const shapesToRemove = [];

    for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i];

        if (shape.shape_type === 'point') {
            // Point: delete if inside eraser polygon
            if (shape.points.length > 0 && isPointInPolygon(shape.points[0], eraserPolygon)) {
                shapesToRemove.push(i);
                modified = true;
            }
        } else if (shape.shape_type === 'linestrip') {
            // Linestrip: truncate segments that fall inside the eraser polygon
            const newSegments = truncateLinestrip(shape.points, eraserPolygon);
            if (newSegments.length === 0) {
                // Entire linestrip was erased
                shapesToRemove.push(i);
                modified = true;
            } else if (newSegments.length === 1 && pointsArrayEqual(newSegments[0], shape.points)) {
                // Unchanged
            } else {
                // Replace with first segment, add additional segments as new shapes
                shape.points = newSegments[0];
                let inserted = 0;
                for (let j = 1; j < newSegments.length; j++) {
                    if (newSegments[j].length >= 2) {
                        shapes.splice(i + j, 0, {
                            label: shape.label,
                            points: newSegments[j],
                            group_id: shape.group_id,
                            shape_type: 'linestrip',
                            flags: { ...shape.flags },
                            visible: shape.visible,
                            description: shape.description
                        });
                        inserted++;
                    }
                }
                if (inserted > 0) {
                    adjustSelectionAfterInsert(i, inserted);
                }
                i += inserted; // Skip past inserted shapes
                modified = true;
            }
        } else if (shape.shape_type === 'rectangle') {
            // Rectangle: convert to polygon, compute difference
            const rectPoly = getRectPoints(shape.points);
            const originalArea = Math.abs(polygonArea(rectPoly));
            const result = computePolygonDifference(rectPoly, clipGeom);
            if (result.length === 0) {
                shapesToRemove.push(i);
                modified = true;
            } else {
                // Decompose each result polygon (including holes) into hole-free pieces
                const flatPolys = result.flatMap(poly => {
                    const rings = poly.map(ring => removeClosingPoint(ring));
                    return decomposePolygonWithHoles(rings);
                }).filter(pts => pts.length >= 3);

                if (flatPolys.length === 0) {
                    shapesToRemove.push(i);
                    modified = true;
                } else {
                    // Check if area changed (no-op detection)
                    const resultArea = flatPolys.reduce((sum, pts) => sum + Math.abs(polygonArea(pts)), 0);
                    if (Math.abs(resultArea - originalArea) < 1e-4) {
                        // No actual change - eraser didn't overlap
                    } else if (flatPolys.length === 1 && isAxisAlignedRect(flatPolys[0]) && flatPolys[0].length === 4) {
                        // Still a simple rectangle - keep as rectangle type
                        const bbox = getPolygonBBox(flatPolys[0]);
                        shape.points = [[bbox.minX, bbox.minY], [bbox.maxX, bbox.maxY]];
                        modified = true;
                    } else {
                        // Convert to polygon(s)
                        shape.shape_type = 'polygon';
                        shape.points = flatPolys[0];
                        let inserted = 0;
                        for (let j = 1; j < flatPolys.length; j++) {
                            shapes.splice(i + 1 + inserted, 0, {
                                label: shape.label,
                                points: flatPolys[j],
                                group_id: shape.group_id,
                                shape_type: 'polygon',
                                flags: { ...shape.flags },
                                visible: shape.visible,
                                description: shape.description
                            });
                            inserted++;
                        }
                        if (inserted > 0) {
                            adjustSelectionAfterInsert(i, inserted);
                        }
                        i += inserted;
                        modified = true;
                    }
                }
            }
        } else {
            // Polygon: compute difference directly
            const originalArea = Math.abs(polygonArea(shape.points));
            const result = computePolygonDifference(shape.points, clipGeom);
            if (result.length === 0) {
                shapesToRemove.push(i);
                modified = true;
            } else {
                // Decompose each result polygon (including holes) into hole-free pieces
                const flatPolys = result.flatMap(poly => {
                    const rings = poly.map(ring => removeClosingPoint(ring));
                    return decomposePolygonWithHoles(rings);
                }).filter(pts => pts.length >= 3);

                if (flatPolys.length === 0) {
                    shapesToRemove.push(i);
                    modified = true;
                } else {
                    // Check if area changed (no-op detection)
                    const resultArea = flatPolys.reduce((sum, pts) => sum + Math.abs(polygonArea(pts)), 0);
                    if (Math.abs(resultArea - originalArea) < 1e-4) {
                        // No actual change - eraser didn't overlap this shape
                    } else {
                        shape.points = flatPolys[0];
                        let inserted = 0;
                        for (let j = 1; j < flatPolys.length; j++) {
                            shapes.splice(i + 1 + inserted, 0, {
                                label: shape.label,
                                points: flatPolys[j],
                                group_id: shape.group_id,
                                shape_type: 'polygon',
                                flags: { ...shape.flags },
                                visible: shape.visible,
                                description: shape.description
                            });
                            inserted++;
                        }
                        if (inserted > 0) {
                            adjustSelectionAfterInsert(i, inserted);
                        }
                        i += inserted;
                        modified = true;
                    }
                }
            }
        }
    }

    // Remove shapes marked for deletion (iterate in reverse to keep indices valid)
    for (let i = shapesToRemove.length - 1; i >= 0; i--) {
        const idx = shapesToRemove[i];
        shapes.splice(idx, 1);
        adjustSelectionAfterDelete(idx);
    }

    if (modified) {
        markDirty();
        saveHistory();
        renderShapeList();
        renderLabelsList();
        draw();
    }
}

// Compute polygon difference using polygon-clipping library
// subject: array of [x,y] points (the polygon to subtract from)
// clipGeom: polygon-clipping format polygon [ring, ring, ...] (the area to subtract)
// Returns: MultiPolygon in polygon-clipping format, or empty array
function computePolygonDifference(subjectPoints, clipGeom) {
    // Convert subject to polygon-clipping format
    const subjectRing = subjectPoints.map(p => [p[0], p[1]]);
    // Close the ring
    if (subjectRing.length > 0 &&
        (subjectRing[0][0] !== subjectRing[subjectRing.length - 1][0] ||
            subjectRing[0][1] !== subjectRing[subjectRing.length - 1][1])) {
        subjectRing.push([subjectRing[0][0], subjectRing[0][1]]);
    }
    const subjectGeom = [subjectRing];

    try {
        // polygonClipping is loaded from polygon-clipping.umd.min.js
        const result = polygonClipping.difference(subjectGeom, clipGeom);
        return result;
    } catch (e) {
        console.error('Polygon clipping error:', e);
        return [subjectGeom]; // Return original on error
    }
}

// Get bounding box of a set of points
function getPolygonBBox(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
}

// Remove closing point from a polygon ring if present (LabelMe format doesn't close).
function removeClosingPoint(ring) {
    const pts = ring.slice();
    if (pts.length > 1 &&
        pts[0][0] === pts[pts.length - 1][0] &&
        pts[0][1] === pts[pts.length - 1][1]) {
        pts.pop();
    }
    return pts;
}

// Check if 4 points form an axis-aligned rectangle.
function isAxisAlignedRect(points) {
    if (points.length !== 4) return false;
    const xs = points.map(p => p[0]).sort((a, b) => a - b);
    const ys = points.map(p => p[1]).sort((a, b) => a - b);
    // Must have exactly 2 unique X values and 2 unique Y values
    const ux = [xs[0], xs[1], xs[2], xs[3]];
    const uy = [ys[0], ys[1], ys[2], ys[3]];
    return Math.abs(ux[0] - ux[1]) < 1e-6 && Math.abs(ux[2] - ux[3]) < 1e-6 &&
        Math.abs(uy[0] - uy[1]) < 1e-6 && Math.abs(uy[2] - uy[3]) < 1e-6;
}

// Compute signed area of a polygon (shoelace formula).
// Positive = counter-clockwise, negative = clockwise.
function polygonArea(pts) {
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    }
    return area / 2;
}

// Decompose a polygon-with-holes into multiple hole-free polygons.
// Uses polygon-clipping to recursively slice through holes with alternating vertical/horizontal cuts.
// polyRings: [outerRing, hole1, hole2, ...] where each ring is [[x,y], ...] (NOT closed)
// Returns an array of flat polygon point arrays (each [[x,y], ...]).
function decomposePolygonWithHoles(polyRings, depth) {
    if (polyRings.length <= 1) return [polyRings[0]];
    if (depth === undefined) depth = 0;

    // Safety: stop recursion after 8 levels — use iterative single-hole subtraction as fallback
    if (depth >= 8) {
        const pc = window.polygonClipping || (typeof polygonClipping !== 'undefined' ? polygonClipping : null);
        if (!pc) return [polyRings[0]];
        const closeRing = (ring) => {
            const r = ring.slice();
            if (r.length >= 2 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) {
                r.push(r[0].slice());
            }
            return r;
        };
        try {
            // Start with just the outer ring, subtract each hole one at a time
            let currentPieces = [[closeRing(polyRings[0])]]; // MultiPolygon with one polygon
            for (let h = 1; h < polyRings.length; h++) {
                const holeClosed = [closeRing(polyRings[h])];
                const newPieces = pc.difference(currentPieces, [holeClosed]);
                currentPieces = newPieces;
            }
            // Collect results — recursively decompose any pieces that still have holes
            const results = [];
            for (const poly of currentPieces) {
                if (poly.length <= 1) {
                    // No holes — safe to take the outer ring directly
                    const pts = removeClosingPoint(poly[0]);
                    if (pts.length >= 3) results.push(pts);
                } else {
                    // Still has holes — decompose recursively (reset depth since these are simpler pieces)
                    const innerRings = poly.map(r => removeClosingPoint(r));
                    const subResults = decomposePolygonWithHoles(innerRings, 0);
                    for (const sr of subResults) {
                        if (sr.length >= 3) results.push(sr);
                    }
                }
            }
            return results.length > 0 ? results : [polyRings[0]];
        } catch (e) {
            return [polyRings[0]];
        }
    }

    // Close rings for polygon-clipping (it expects closed rings)
    const closeRing = (ring) => {
        if (ring.length < 2) return ring.slice();
        const r = ring.slice();
        if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) {
            r.push(r[0].slice());
        }
        return r;
    };

    const closedRings = polyRings.map(r => closeRing(r));

    // Find the bounding box of the first hole to determine where to cut
    const hole = polyRings[1];
    let hMin0 = Infinity, hMax0 = -Infinity, hMin1 = Infinity, hMax1 = -Infinity;
    for (const p of hole) {
        if (p[0] < hMin0) hMin0 = p[0];
        if (p[0] > hMax0) hMax0 = p[0];
        if (p[1] < hMin1) hMin1 = p[1];
        if (p[1] > hMax1) hMax1 = p[1];
    }

    // Get the overall bounding box of the outer ring
    const outer = polyRings[0];
    let oMinX = Infinity, oMaxX = -Infinity, oMinY = Infinity, oMaxY = -Infinity;
    for (const p of outer) {
        if (p[0] < oMinX) oMinX = p[0];
        if (p[0] > oMaxX) oMaxX = p[0];
        if (p[1] < oMinY) oMinY = p[1];
        if (p[1] > oMaxY) oMaxY = p[1];
    }

    const margin = Math.max(oMaxY - oMinY, oMaxX - oMinX) + 10;

    // Alternate between vertical (even depth) and horizontal (odd depth) cuts
    const useVertical = (depth % 2 === 0);
    let cutVal;
    let halfA, halfB;

    if (useVertical) {
        cutVal = (hMin0 + hMax0) / 2;
        halfA = [[[oMinX - margin, oMinY - margin], [cutVal, oMinY - margin],
        [cutVal, oMaxY + margin], [oMinX - margin, oMaxY + margin],
        [oMinX - margin, oMinY - margin]]];
        halfB = [[[cutVal, oMinY - margin], [oMaxX + margin, oMinY - margin],
        [oMaxX + margin, oMaxY + margin], [cutVal, oMaxY + margin],
        [cutVal, oMinY - margin]]];
    } else {
        cutVal = (hMin1 + hMax1) / 2;
        halfA = [[[oMinX - margin, oMinY - margin], [oMaxX + margin, oMinY - margin],
        [oMaxX + margin, cutVal], [oMinX - margin, cutVal],
        [oMinX - margin, oMinY - margin]]];
        halfB = [[[oMinX - margin, cutVal], [oMaxX + margin, cutVal],
        [oMaxX + margin, oMaxY + margin], [oMinX - margin, oMaxY + margin],
        [oMinX - margin, cutVal]]];
    }

    const results = [];
    const pc = window.polygonClipping || (typeof polygonClipping !== 'undefined' ? polygonClipping : null);
    if (!pc) return [polyRings[0]];

    try {
        const piecesA = pc.intersection([closedRings], [halfA]);
        const piecesB = pc.intersection([closedRings], [halfB]);

        const processPieces = (pieces) => {
            for (const poly of pieces) {
                if (poly.length <= 1) {
                    // No holes - just add outer ring
                    const pts = removeClosingPoint(poly[0]);
                    if (pts.length >= 3) results.push(pts);
                } else {
                    // Still has holes - recurse with next cut direction
                    const innerRings = poly.map(r => removeClosingPoint(r));
                    const subResults = decomposePolygonWithHoles(innerRings, depth + 1);
                    for (const sr of subResults) {
                        if (sr.length >= 3) results.push(sr);
                    }
                }
            }
        };

        processPieces(piecesA);
        processPieces(piecesB);
    } catch (e) {
        results.push(polyRings[0]);
    }

    return results.length > 0 ? results : [polyRings[0]];
}


// Truncate a linestrip by removing segments inside the eraser polygon.
// Returns an array of linestrip segments (arrays of [x,y] points).
// Each segment represents a contiguous part of the original linestrip outside the eraser.
function truncateLinestrip(points, eraserPolygon) {
    if (points.length < 2) {
        // Single point - check if inside
        if (points.length === 1 && isPointInPolygon(points[0], eraserPolygon)) {
            return [];
        }
        return [points.slice()];
    }

    // For each segment of the linestrip:
    // 1. Find all intersection points with the eraser polygon boundary
    // 2. Split the segment at those intersection points
    // 3. Test each sub-segment's midpoint to determine if it's inside or outside
    // 4. Keep only outside sub-segments
    // This approach is robust against floating-point edge cases.

    const allSubSegments = []; // { start: [x,y], end: [x,y], inside: bool }

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        // Find all intersections with eraser polygon edges
        const rawIntersections = linePolygonIntersections(p1, p2, eraserPolygon);

        // De-duplicate intersections (a line through a polygon vertex hits two edges)
        const intersections = [];
        for (const ip of rawIntersections) {
            let isDup = false;
            for (const fp of intersections) {
                if (Math.abs(ip[0] - fp[0]) < 1e-6 && Math.abs(ip[1] - fp[1]) < 1e-6) {
                    isDup = true;
                    break;
                }
            }
            if (!isDup) intersections.push(ip);
        }

        // Build ordered split points: [p1, ...intersections, p2]
        const splitPts = [p1, ...intersections, p2];

        // For each sub-segment, test midpoint to classify as inside/outside
        for (let j = 0; j < splitPts.length - 1; j++) {
            const a = splitPts[j];
            const b = splitPts[j + 1];
            // Skip degenerate (zero-length) sub-segments
            const dx = a[0] - b[0], dy = a[1] - b[1];
            if (dx * dx + dy * dy < 1e-12) continue;
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const inside = isPointInPolygon(mid, eraserPolygon);
            allSubSegments.push({ start: a, end: b, inside });
        }
    }

    // Merge consecutive outside sub-segments into linestrips
    const result = [];
    let currentLinestrip = [];

    for (const seg of allSubSegments) {
        if (!seg.inside) {
            if (currentLinestrip.length === 0) {
                currentLinestrip.push(seg.start);
            }
            currentLinestrip.push(seg.end);
        } else {
            if (currentLinestrip.length >= 2) {
                result.push(currentLinestrip);
            }
            currentLinestrip = [];
        }
    }

    if (currentLinestrip.length >= 2) {
        result.push(currentLinestrip);
    }

    return result;
}

// Find intersection points of a line segment with the edges of a polygon.
// Returns array of [x,y] points sorted by distance from p1.
function linePolygonIntersections(p1, p2, polygon) {
    const intersections = [];
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        const ip = lineSegmentIntersection(p1, p2, polygon[i], polygon[j]);
        if (ip) {
            intersections.push(ip);
        }
    }
    // Sort by distance from p1
    intersections.sort((a, b) => {
        const da = (a[0] - p1[0]) ** 2 + (a[1] - p1[1]) ** 2;
        const db = (b[0] - p1[0]) ** 2 + (b[1] - p1[1]) ** 2;
        return da - db;
    });
    return intersections;
}

// Compute intersection point of two line segments (p1-p2 and p3-p4).
// Returns [x, y] or null if no intersection.
function lineSegmentIntersection(p1, p2, p3, p4) {
    const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
    const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return null; // Parallel

    const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / cross;
    const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / cross;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return [p1[0] + t * d1x, p1[1] + t * d1y];
    }
    return null;
}

// Compare two points arrays for equality
function pointsArrayEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    }
    return true;
}

// --- Modal Logic ---

function showBatchRenameModal() {
    isBatchRenaming = true;
    editingShapeIndex = -1;
    labelModal.style.display = 'flex';
    // Pre-fill with the label of the first selected shape
    const firstIdx = [...selectedShapeIndices][0];
    labelInput.value = firstIdx !== undefined ? shapes[firstIdx].label : '';
    descriptionInput.value = '';
    labelInput.focus();
    labelInput.select();
    renderRecentLabels();
}

function showLabelModal(editIndex = -1) {
    editingShapeIndex = editIndex;
    labelModal.style.display = 'flex';

    if (editIndex !== -1) {
        labelInput.value = shapes[editIndex].label;
        descriptionInput.value = shapes[editIndex].description || '';
    } else {
        labelInput.value = '';
        descriptionInput.value = '';
    }

    labelInput.focus();
    labelInput.select();
    renderRecentLabels();
}

function hideLabelModal() {
    labelModal.style.display = 'none';
    cancelShortcutSequence();
}

function renderRecentLabels() {
    recentLabelsDiv.innerHTML = '';

    // 收集当前图片中已有的label，按最近使用顺序排列
    // 通过遍历shapes倒序，第一个出现的label排最前
    const currentImageLabelsOrdered = [];
    for (let i = shapes.length - 1; i >= 0; i--) {
        const label = shapes[i].label;
        if (!currentImageLabelsOrdered.includes(label)) {
            currentImageLabelsOrdered.push(label);
        }
    }

    // 过滤历史标签，排除当前图片中已有的
    const historyLabelsFiltered = recentLabels.filter(label =>
        !currentImageLabelsOrdered.includes(label)
    ).slice(0, 10);

    // Shared 1-based counter across both sections so the Ctrl+D leader sequence
    // maps the next digit (1..9, then 0) to the first 10 chips in the order they
    // appear (Current Image first, then History).
    let chipIndex = 0;

    function buildChip(label, extraClass) {
        chipIndex += 1;
        const chip = document.createElement('div');
        chip.className = 'label-chip' + (extraClass ? ' ' + extraClass : '');
        chip.textContent = label;
        if (chipIndex <= 10) {
            // Visible badge: digits 1..9 then 0 for the 10th, matching the Ctrl+D leader's digit map.
            const badgeText = chipIndex === 10 ? '0' : String(chipIndex);
            chip.dataset.shortcutIndex = String(chipIndex);
            const badge = document.createElement('span');
            badge.className = 'chip-shortcut-badge';
            badge.textContent = badgeText;
            chip.appendChild(badge);
        }
        chip.onclick = () => {
            labelInput.value = label;
            // Highlight the selected chip (clear ALL sections to avoid cross-section dual highlight)
            recentLabelsDiv.querySelectorAll('.label-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            // Focus description field so user can optionally fill it before confirming
            descriptionInput.focus();
        };
        chip.ondblclick = () => {
            labelInput.value = label;
            confirmLabel();
        };
        return chip;
    }

    // 渲染当前图片标签区域（如果有的话）
    if (currentImageLabelsOrdered.length > 0) {
        const currentSection = document.createElement('div');
        currentSection.className = 'label-section current-labels';

        const currentTitle = document.createElement('div');
        currentTitle.className = 'label-section-title';
        currentTitle.textContent = 'Current Image';
        currentSection.appendChild(currentTitle);

        const currentChips = document.createElement('div');
        currentChips.className = 'label-chips';
        currentImageLabelsOrdered.forEach(label => {
            currentChips.appendChild(buildChip(label, 'current-image-label'));
        });
        currentSection.appendChild(currentChips);
        recentLabelsDiv.appendChild(currentSection);
    }

    // 渲染历史标签区域（如果有的话）
    if (historyLabelsFiltered.length > 0) {
        const historySection = document.createElement('div');
        historySection.className = 'label-section history-labels';

        const historyTitle = document.createElement('div');
        historyTitle.className = 'label-section-title';
        historyTitle.textContent = 'History';
        historySection.appendChild(historyTitle);

        const historyChips = document.createElement('div');
        historyChips.className = 'label-chips';
        historyLabelsFiltered.forEach(label => {
            historyChips.appendChild(buildChip(label, ''));
        });
        historySection.appendChild(historyChips);
        recentLabelsDiv.appendChild(historySection);
    }
}

function confirmLabel() {
    // Merge-pending mode: commit the merge using the chosen label.
    if (isMergePending) {
        if (commitMergePendingFromModal()) return;
        // commit returned false (empty label); fall through so user can re-enter.
        return;
    }

    const label = labelInput.value.trim();
    if (!label) return;

    // 更新历史标签列表（MRU顺序）
    const existingIndex = recentLabels.indexOf(label);
    if (existingIndex !== -1) {
        recentLabels.splice(existingIndex, 1);
    }
    recentLabels.unshift(label);
    if (recentLabels.length > 10) recentLabels.pop();

    // 持久化到全局状态（同时保存到vscodeState和extension globalState）
    saveGlobalSettings('recentLabels', recentLabels);

    const description = descriptionInput.value.trim();

    if (isBatchRenaming) {
        // Batch rename all selected shapes
        for (const idx of selectedShapeIndices) {
            shapes[idx].label = label;
            if (description) {
                shapes[idx].description = description;
            } else {
                delete shapes[idx].description;
            }
        }
        isBatchRenaming = false;
    } else if (editingShapeIndex !== -1) {
        // Editing existing shape
        shapes[editingShapeIndex].label = label;
        if (description) {
            shapes[editingShapeIndex].description = description;
        } else {
            delete shapes[editingShapeIndex].description;
        }
        editingShapeIndex = -1;
    } else {
        // Creating new shape - determine shape_type based on current mode
        let shapeType = 'polygon';
        if (currentMode === 'point') {
            shapeType = 'point';
        } else if (currentMode === 'line') {
            shapeType = 'linestrip';
        } else if (currentMode === 'rectangle') {
            shapeType = 'rectangle';
        } else if (currentMode === 'sam') {
            shapeType = 'polygon'; // SAM always produces polygon shapes
        }

        const newShape = {
            label: label,
            points: currentPoints,
            group_id: null,
            shape_type: shapeType,
            flags: {},
            visible: true
        };
        if (description) {
            newShape.description = description;
        }
        shapes.push(newShape);
        currentPoints = [];
    }

    hideLabelModal();
    // Clear saved SAM state after successful confirm
    if (typeof samSavedStateBeforeConfirm !== 'undefined') samSavedStateBeforeConfirm = null;
    markDirty();
    saveHistory(); // 保存历史记录以支持撤销/恢复
    renderShapeList();
    renderLabelsList();
    draw();
}

// Pick the chip with shortcutIndex N, write its label to the input, and confirm.
// Returns true if a chip with that index existed.
function pickLabelByShortcut(index) {
    const chip = recentLabelsDiv.querySelector(`.label-chip[data-shortcut-index="${index}"]`);
    if (!chip) return false;
    // chip.textContent includes the badge digit because the badge is a child <span>.
    // Read the label text from the first text node instead of textContent.
    let labelText = '';
    for (const node of chip.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            labelText += node.textContent;
        }
    }
    labelText = labelText.trim();
    if (!labelText) return false;
    labelInput.value = labelText;
    confirmLabel();
    return true;
}

// Ctrl+D leader sequence for label modal: press Ctrl+D to reveal chip badges,
// then press 0-9 to pick that chip (0 means chip 10). Any other key cancels
// the sequence without being consumed.
let awaitingShortcutDigit = false;

function cancelShortcutSequence() {
    if (!awaitingShortcutDigit) return;
    awaitingShortcutDigit = false;
    recentLabelsDiv.classList.remove('show-shortcuts');
}

document.addEventListener('keydown', (e) => {
    if (labelModal.style.display !== 'flex') {
        // Modal closed — make sure we don't carry stale state.
        if (awaitingShortcutDigit) cancelShortcutSequence();
        return;
    }

    if (awaitingShortcutDigit) {
        const isPureKey = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
        if (isPureKey && /^[0-9]$/.test(e.key)) {
            e.preventDefault();
            const index = e.key === '0' ? 10 : Number(e.key);
            cancelShortcutSequence();
            pickLabelByShortcut(index);
            return;
        }
        // Any other key cancels the sequence and falls through (key not consumed).
        cancelShortcutSequence();
    }

    // Leader: Ctrl+D (case-insensitive). No other modifiers allowed.
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        awaitingShortcutDigit = true;
        recentLabelsDiv.classList.add('show-shortcuts');
    }
});

modalOkBtn.onclick = confirmLabel;

// 取消标签输入的通用处理函数
function cancelLabelInput() {
    hideLabelModal();

    // If a merge was waiting on a label, abort it without mutating shapes.
    if (isMergePending) {
        clearMergePendingState();
        draw();
        return;
    }

    // If batch renaming, just cancel
    if (isBatchRenaming) {
        isBatchRenaming = false;
        draw();
        return;
    }

    // 如果是编辑已有形状的标签，则只取消编辑
    if (editingShapeIndex !== -1) {
        editingShapeIndex = -1;
        draw();
        return;
    }

    // 点模式：取消应当清除点（因为点模式是单击即完成，取消意味着放弃这个点）
    if (currentMode === 'point') {
        currentPoints = [];
        isDrawing = false;
        draw();
        return;
    }

    // 对于其他模式（polygon, line, rectangle），回到继续绘制状态（不删除任何点）
    // 因为完成标注的操作是"闭合多边形"或"确定矩形"，取消只是撤销这个完成操作
    if (currentMode === 'sam') {
        // SAM mode: restore prompts, mask, crop, sequence state, and embedding identity
        if (samSavedStateBeforeConfirm) {
            samPrompts = samSavedStateBeforeConfirm.prompts;
            samMaskContour = samSavedStateBeforeConfirm.maskContour;
            samCachedCrop = samSavedStateBeforeConfirm.cachedCrop;
            samIsFreshSequence = samSavedStateBeforeConfirm.isFreshSequence;
            samCurrentImagePath = samSavedStateBeforeConfirm.currentImagePath;
            samSavedStateBeforeConfirm = null;
        }
        currentPoints = [];
        draw();
        updateShiftFeedback();
        return;
    }

    if (currentPoints.length > 0) {
        isDrawing = true;
    }

    draw();
}

modalCancelBtn.onclick = cancelLabelInput;

// Wire all modal close (×) buttons — each routes to its modal's existing Cancel handler
document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-modal-close');
        const modal = document.getElementById(modalId);
        if (!modal) return;
        const cancelBtn = modal.querySelector('[id$="CancelBtn"]');
        if (cancelBtn) {
            cancelBtn.click();
        } else {
            modal.style.display = 'none';
        }
    });
});

// 在labelInput上监听Enter键
labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmLabel();
    }
});

// 在document级别监听ESC/Enter键，当任意modal显示时响应
// Enter不拦截焦点在BUTTON/TEXTAREA上的情况（让浏览器正常激活按钮/换行）
document.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement?.tagName;
    // Label modal
    if (labelModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelLabelInput();
        } else if (e.key === 'Enter' && activeTag !== 'TEXTAREA' && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            confirmLabel();
        }
        return;
    }
    // Color picker modal
    if (colorPickerModal && colorPickerModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideColorPicker();
        } else if (e.key === 'Enter' && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            confirmColorPicker();
        }
        return;
    }
    // ONNX infer modal
    if (onnxInferModal && onnxInferModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideOnnxInferModal();
        } else if (e.key === 'Enter' && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            submitOnnxInfer();
        }
        return;
    }
    // SAM config modal
    if (samConfigModal && samConfigModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideSamConfigModal();
        } else if (e.key === 'Enter' && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            submitSamConfig();
        }
        return;
    }
});

// --- Sidebar Logic ---
function renderShapeList() {
    // 使用 DocumentFragment 批量添加 DOM，减少重排
    const fragment = document.createDocumentFragment();
    const multiSelected = selectedShapeIndices.size > 1;

    shapes.forEach((shape, index) => {
        const li = document.createElement('li');

        // Label text
        const labelSpan = document.createElement('span');
        labelSpan.className = 'shape-label-text';
        labelSpan.textContent = shape.label;
        li.appendChild(labelSpan);

        // Description subtitle (if present)
        if (shape.description) {
            const descSpan = document.createElement('span');
            descSpan.className = 'shape-description';
            descSpan.textContent = shape.description;
            // Runtime data — use data-tip-text so the rich tooltip can show
            // the full description on hover when the row truncates.
            descSpan.setAttribute('data-tip-text', shape.description);
            li.appendChild(descSpan);
        }

        const colors = getColorsForLabel(shape.label);
        li.style.borderLeftColor = colors.stroke;

        if (isShapeSelected(index)) {
            li.classList.add('active');
        }

        li.onclick = (e) => {
            if (e.ctrlKey || e.metaKey) {
                // Ctrl+click: toggle selection
                toggleShapeSelection(index);
            } else if (e.shiftKey && selectedShapeIndex !== -1) {
                // Shift+click: range select
                selectShapeRange(selectedShapeIndex, index);
            } else {
                selectShape(index);
            }
            renderShapeList();
            draw();
        };

        const visibleBtn = document.createElement('span');
        visibleBtn.className = 'visible-btn';
        visibleBtn.innerHTML = shape.visible === false ? '&#128065;' : '&#128065;'; // Eye icon
        visibleBtn.setAttribute('data-tip-id', 'shape.toggleVisible');
        if (shape.visible === false) {
            visibleBtn.classList.add('hidden-shape');
            visibleBtn.style.opacity = '0.5';
        }
        visibleBtn.onclick = (e) => {
            e.stopPropagation();
            hideShapeContextMenu();
            // If this shape is part of multi-selection, set all to same state
            if (multiSelected && isShapeSelected(index)) {
                const anyVisible = [...selectedShapeIndices].some(idx => shapes[idx].visible !== false);
                const newState = !anyVisible;
                for (const idx of selectedShapeIndices) {
                    shapes[idx].visible = newState;
                }
            } else {
                shape.visible = shape.visible === undefined ? false : !shape.visible;
            }
            renderShapeList();
            renderLabelsList();
            draw();
        };

        const editBtn = document.createElement('span');
        editBtn.className = 'edit-btn';
        editBtn.innerHTML = '&#9998;'; // Pencil icon
        editBtn.setAttribute('data-tip-id', 'shape.editVertices');
        editBtn.onclick = (e) => {
            e.stopPropagation();
            hideShapeContextMenu();
            // If multi-selected, batch rename
            if (multiSelected && isShapeSelected(index)) {
                showBatchRenameModal();
            } else {
                showLabelModal(index);
            }
        };

        const delBtn = document.createElement('span');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '×';
        delBtn.setAttribute('data-tip-id', 'shape.delete');
        delBtn.onclick = (e) => {
            e.stopPropagation();
            hideShapeContextMenu();
            // If multi-selected, batch delete
            if (multiSelected && isShapeSelected(index)) {
                deleteSelectedShapes();
            } else {
                deleteShape(index);
            }
        };

        li.appendChild(visibleBtn);
        li.appendChild(editBtn);
        li.appendChild(delBtn);
        fragment.appendChild(li);
    });

    // Cancel any pending hover timer before detaching the rows it captured —
    // otherwise show() would later run getBoundingClientRect on a detached node
    // and place the tooltip at viewport (0, 0).
    if (window.tooltip) window.tooltip.hide();

    // 一次性更新 DOM
    shapeList.innerHTML = '';
    shapeList.appendChild(fragment);

    // Bind rich tooltips to the freshly-rendered per-row controls. attach()
    // is idempotent (skips already-bound nodes via WeakSet).
    if (window.tooltip && window.TIPS) window.tooltip.attach(shapeList, window.TIPS);

    // 更新 Instances 计数
    const instancesCountEl = document.getElementById('instancesCount');
    if (instancesCountEl) {
        const selCount = selectedShapeIndices.size;
        instancesCountEl.textContent = selCount > 1 ? `(${selCount}/${shapes.length})` : `(${shapes.length})`;
    }

    // 滚动选中项到可视区域
    scrollSelectedShapeIntoView();
}

// 滚动选中的形状到可视区域
function scrollSelectedShapeIntoView() {
    if (selectedShapeIndex === -1 || !shapeList) return;

    const selectedItem = shapeList.children[selectedShapeIndex];
    if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
    }
}

function deleteShape(index) {
    // Check if we are deleting the shape currently being edited
    if (isEditingShape) {
        if (shapeBeingEdited === index) {
            exitShapeEditMode(false); // Exit edit mode (points restoration doesn't matter as it will be deleted)
        } else if (shapeBeingEdited > index) {
            shapeBeingEdited--; // Shift index if a preceding shape is deleted
        }
    }

    shapes.splice(index, 1);
    adjustSelectionAfterDelete(index);
    markDirty();
    saveHistory(); // 保存历史记录以支持撤销/恢复
    renderShapeList();
    renderLabelsList(); // 更新Labels列表
    draw();
}

// --- Labels Management ---

// 获取所有唯一标签及其统计信息
function getLabelsStats() {
    const stats = new Map();
    shapes.forEach(shape => {
        const label = shape.label;
        if (!stats.has(label)) {
            stats.set(label, { count: 0, allHidden: true });
        }
        const stat = stats.get(label);
        stat.count++;
        if (shape.visible !== false) {
            stat.allHidden = false;
        }
    });
    return stats;
}

// 渲染Labels列表
function renderLabelsList() {
    if (!labelsList) return;

    const labelsStats = getLabelsStats();
    const fragment = document.createDocumentFragment();

    // 按标签名称排序
    const sortedLabels = Array.from(labelsStats.keys()).sort();

    sortedLabels.forEach(label => {
        const stat = labelsStats.get(label);
        const li = document.createElement('li');

        // 颜色指示器
        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'label-color-indicator';
        const colors = getColorsForLabel(label);
        colorIndicator.style.backgroundColor = colors.stroke;
        colorIndicator.setAttribute('data-tip-id', 'label.color');
        colorIndicator.onclick = (e) => {
            e.stopPropagation();
            showColorPicker(label);
        };

        // 标签名称
        const labelName = document.createElement('span');
        labelName.className = 'label-name';
        labelName.textContent = label;

        // 实例数量
        const labelCount = document.createElement('span');
        labelCount.className = 'label-count';
        labelCount.textContent = `(${stat.count})`;

        // 可见性切换按钮
        const visibilityBtn = document.createElement('span');
        visibilityBtn.className = 'label-visibility-btn';
        visibilityBtn.innerHTML = '&#128065;'; // Eye icon
        visibilityBtn.setAttribute('data-tip-id', 'label.toggleVisible');
        if (stat.allHidden) {
            visibilityBtn.classList.add('all-hidden');
        }
        visibilityBtn.onclick = (e) => {
            e.stopPropagation();
            toggleLabelVisibility(label);
        };

        // Reset按钮（只在有自定义颜色时显示）
        const resetBtn = document.createElement('span');
        resetBtn.className = 'label-reset-btn';
        resetBtn.innerHTML = '&#8634;'; // Circular arrow icon
        resetBtn.setAttribute('data-tip-id', 'label.colorReset');
        if (customColors.has(label)) {
            resetBtn.classList.add('visible');
        }
        resetBtn.onclick = (e) => {
            e.stopPropagation();
            resetLabelColor(label);
        };

        li.appendChild(colorIndicator);
        li.appendChild(labelName);
        li.appendChild(labelCount);
        li.appendChild(visibilityBtn);
        li.appendChild(resetBtn);
        fragment.appendChild(li);
    });

    // Cancel pending hover timer (see renderShapeList for rationale).
    if (window.tooltip) window.tooltip.hide();

    labelsList.innerHTML = '';
    labelsList.appendChild(fragment);

    // Bind rich tooltips to the freshly-rendered per-row controls.
    if (window.tooltip && window.TIPS) window.tooltip.attach(labelsList, window.TIPS);

    // 更新 Labels 计数
    const labelsCountEl = document.getElementById('labelsCount');
    if (labelsCountEl) {
        labelsCountEl.textContent = `(${sortedLabels.length})`;
    }
}

// Reapply label-level visibility state onto current shapes
// Called after undo/redo to ensure label-level toggles (which are not in history) stay consistent
function applyLabelVisibilityState() {
    shapes.forEach(shape => {
        if (labelVisibilityState.has(shape.label)) {
            shape.visible = labelVisibilityState.get(shape.label);
        }
    });
}

// 切换指定标签的所有实例的可见性
function toggleLabelVisibility(label) {
    const labelsStats = getLabelsStats();
    const stat = labelsStats.get(label);

    // 如果全部隐藏，则显示；否则隐藏
    const newVisibility = stat.allHidden;

    shapes.forEach(shape => {
        if (shape.label === label) {
            shape.visible = newVisibility;
        }
    });

    // 保存到全局状态
    labelVisibilityState.set(label, newVisibility);

    // 保存到vscode state
    saveState();

    renderLabelsList();
    renderShapeList();
    draw();
}

// 显示颜色选择器
function showColorPicker(label) {
    currentEditingLabel = label;

    // 渲染调色板
    const palette = colorPickerModal.querySelector('.color-palette');
    palette.innerHTML = '';

    // 使用 DocumentFragment 批量添加 DOM
    const fragment = document.createDocumentFragment();
    PRESET_COLORS.forEach(color => {
        const colorOption = document.createElement('div');
        colorOption.className = 'color-option';
        colorOption.style.backgroundColor = color;
        colorOption.dataset.color = color;
        fragment.appendChild(colorOption);
    });
    palette.appendChild(fragment);

    // 移除旧的事件处理器（如果存在）。两个 handler 都要清理，
    // 否则每次打开 color picker 都会累积一个匿名 dblclick 监听器。
    if (paletteClickHandler) {
        palette.removeEventListener('click', paletteClickHandler);
    }
    if (paletteDblClickHandler) {
        palette.removeEventListener('dblclick', paletteDblClickHandler);
    }

    // 使用事件委托处理颜色选择（单击选中，双击确认）
    paletteClickHandler = (e) => {
        const target = e.target;
        if (target.classList.contains('color-option')) {
            palette.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            target.classList.add('selected');
            customColorInput.value = target.dataset.color;
        }
    };
    paletteDblClickHandler = (e) => {
        const target = e.target;
        if (target.classList.contains('color-option')) {
            customColorInput.value = target.dataset.color;
            confirmColorPicker();
        }
    };
    palette.addEventListener('click', paletteClickHandler);
    palette.addEventListener('dblclick', paletteDblClickHandler);

    // 设置当前颜色 - 转换为#XXXXXX格式
    const currentColors = getColorsForLabel(label);
    // 如果有自定义颜色，直接使用；否则从rgba转换为hex
    if (customColors.has(label)) {
        customColorInput.value = customColors.get(label);
    } else {
        // 将rgba格式转换为#XXXXXX格式
        const rgbaMatch = currentColors.stroke.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbaMatch) {
            const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, '0');
            const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, '0');
            const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, '0');
            customColorInput.value = `#${r}${g}${b}`.toUpperCase();
        } else {
            customColorInput.value = '#000000';
        }
    }

    // 显示模态框
    colorPickerModal.style.display = 'flex';
    customColorInput.focus();
}

// 隐藏颜色选择器
function hideColorPicker() {
    colorPickerModal.style.display = 'none';
    currentEditingLabel = null;
}

function saveGlobalSettings(key, value) {
    // Save to vscodeState immediately (synchronous, survives HTML regeneration)
    const state = vscode.getState() || {};
    state[key] = value;
    vscode.setState(state);

    // Also send to extension for persistent storage across sessions
    vscode.postMessage({
        command: 'saveGlobalSettings',
        key: key,
        value: value
    });
}

// Unified state saving (keep for session-specific state like mode/visibility)
function saveState() {
    const state = vscode.getState() || {};
    state.labelVisibility = Object.fromEntries(labelVisibilityState);
    state.currentMode = currentMode;
    vscode.setState(state);
}

// 确认颜色选择
function confirmColorPicker() {
    if (!currentEditingLabel) return;

    let color = customColorInput.value.trim();

    // 验证颜色格式 - 只接受#XXXXXX格式
    if (!color.startsWith('#') || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        if (window.notifyBus) window.notifyBus.show('error', 'Invalid color format. Please use #RRGGBB format (e.g., #FF5733).');
        return;
    }

    // 保存自定义颜色
    customColors.set(currentEditingLabel, color.toUpperCase());

    // Save to global settings
    saveGlobalSettings('customColors', Object.fromEntries(customColors));

    // 清除颜色缓存以强制重新计算
    colorCache.delete(currentEditingLabel);

    hideColorPicker();
    renderLabelsList();
    renderShapeList();
    draw();
}

// 重置单个标签的颜色
function resetLabelColor(label) {
    customColors.delete(label);

    // Save to global settings
    saveGlobalSettings('customColors', Object.fromEntries(customColors));

    colorCache.delete(label);
    renderLabelsList();
    renderShapeList();
    draw();
}

// --- Sidebar Dropdown Toggle ---

// Generic toggle for sidebar dropdowns — opening one closes the other
function toggleSidebarDropdown(dropdown, otherDropdown) {
    if (!dropdown) return;
    const isVisible = dropdown.style.display !== 'none';
    const newState = isVisible ? 'none' : 'block';
    dropdown.style.display = newState;

    // Close the other dropdown
    if (otherDropdown && newState === 'block') {
        otherDropdown.style.display = 'none';
    }

    // Save state to vscodeState
    const state = vscode.getState() || {};
    state.settingsMenuExpanded = settingsMenuDropdown ? settingsMenuDropdown.style.display !== 'none' : false;
    vscode.setState(state);
}
// --- Theme Functions ---

// Apply theme to DOM
function applyTheme(theme) {
    document.body.classList.remove('theme-light', 'theme-dark');

    let effectiveTheme;
    if (theme === 'auto') {
        // vscodeThemeKind: 1=Light, 2=Dark, 3=HighContrast (dark), 4=HighContrastLight
        const isLight = vscodeThemeKind === 1 || vscodeThemeKind === 4;
        effectiveTheme = isLight ? 'light' : 'dark';
    } else {
        effectiveTheme = theme;
    }

    document.body.classList.add(`theme-${effectiveTheme}`);
    updateThemeButtonsUI();

    // Refresh pixel grid overlay color to match the new theme
    updatePixelRendering();
}

// Set theme and save preference
function setTheme(theme) {
    currentTheme = theme;
    applyTheme(theme);
    saveGlobalSettings('theme', theme);
}

// Update theme button UI to show active state
function updateThemeButtonsUI() {
    if (themeLightBtn && themeDarkBtn && themeAutoBtn) {
        themeLightBtn.classList.remove('active');
        themeDarkBtn.classList.remove('active');
        themeAutoBtn.classList.remove('active');

        if (currentTheme === 'light') {
            themeLightBtn.classList.add('active');
        } else if (currentTheme === 'dark') {
            themeDarkBtn.classList.add('active');
        } else {
            themeAutoBtn.classList.add('active');
        }
    }
}

// Initialize theme on page load
applyTheme(currentTheme);


// --- Mode Switching ---

// 设置交互模式
function setMode(mode) {
    // 如果正在绘制，取消绘制（切换任何模式时都应取消）
    if (isDrawing) {
        isDrawing = false;
        currentPoints = [];
        draw();
    }

    // Cancel box selection
    if (isBoxSelecting) {
        isBoxSelecting = false;
        boxSelectStart = null;
        boxSelectCurrent = null;
    }

    // Cancel any active eraser
    if (eraserActive || eraserMouseDownPos) {
        cancelEraser();
        eraserMouseDownPos = null;
        eraserMouseDownTime = 0;
        eraserIsDragging = false;
        eraserDragCurrent = null;
    }

    // 如果在编辑模式，退出并保存更改
    if (isEditingShape) {
        exitShapeEditMode(true);
    }

    // 隐藏上下文菜单
    hideShapeContextMenu();

    // Clear SAM state when leaving SAM mode
    if (currentMode === 'sam' && mode !== 'sam') {
        samClearState();
    }

    // If entering SAM mode, check service availability
    if (mode === 'sam') {
        samCheckAndEnterMode();
        return; // samCheckAndEnterMode will call the rest of setMode internally
    }

    currentMode = mode;

    // 保存到vscode state
    saveState();

    // 更新按钮状态
    updateModeButtons();
}

function updateModeButtons() {
    if (viewModeBtn && pointModeBtn && lineModeBtn && polygonModeBtn && rectangleModeBtn) {
        viewModeBtn.classList.remove('active');
        pointModeBtn.classList.remove('active');
        lineModeBtn.classList.remove('active');
        polygonModeBtn.classList.remove('active');
        rectangleModeBtn.classList.remove('active');
        if (samModeBtn) samModeBtn.classList.remove('active');

        if (currentMode === 'view') {
            viewModeBtn.classList.add('active');
        } else if (currentMode === 'point') {
            pointModeBtn.classList.add('active');
        } else if (currentMode === 'line') {
            lineModeBtn.classList.add('active');
        } else if (currentMode === 'polygon') {
            polygonModeBtn.classList.add('active');
        } else if (currentMode === 'rectangle') {
            rectangleModeBtn.classList.add('active');
        } else if (currentMode === 'sam') {
            if (samModeBtn) samModeBtn.classList.add('active');
        }
    }
}


// --- Drawing Logic ---
function draw(mouseEvent) {
    // Canvas只绘制图片
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const needsProcessing = selectedChannel !== 'rgb' || claheEnabled;
    const source = needsProcessing ? getProcessedCanvas() : null;
    if (source) {
        ctx.drawImage(source, 0, 0, img.width, img.height);
    } else {
        ctx.drawImage(img, 0, 0, img.width, img.height);
    }

    // SVG绘制标注
    drawSVGAnnotations(mouseEvent);
}

function drawSVGAnnotations(mouseEvent) {
    // 清除SVG内容
    svgOverlay.innerHTML = '';

    // 绘制已完成的形状
    shapes.forEach((shape, index) => {
        if (shape.visible === false) return; // Skip hidden shapes

        const isSelected = isShapeSelected(index);
        const colors = getColorsForLabel(shape.label);

        let strokeColor = colors.stroke;
        let fillColor = colors.fill;

        if (isSelected) {
            strokeColor = 'rgba(255, 255, 0, 1)';
            // Use global fillOpacity but ensure at least 0.1 visibility for selection
            const selectionOpacity = Math.max(0.1, fillOpacity);
            fillColor = `rgba(255, 255, 0, ${selectionOpacity})`;
        }

        let points = shape.points;
        if (shape.shape_type === 'rectangle') {
            points = getRectPoints(points);
        }

        drawSVGShape(shape.shape_type, points, strokeColor, fillColor, false, index);
    });

    // Draw SAM overlay (prompts and mask)
    if (currentMode === 'sam') {
        drawSAMOverlay();
    }

    // 绘制正在创建的形状
    if (isDrawing) {
        let points = currentPoints;
        let shapeType = currentMode;
        if (currentMode === 'rectangle' && points.length === 2) {
            points = getRectPoints(points);
        }
        drawSVGShape(shapeType, points, 'rgba(0, 200, 0, 0.8)', 'rgba(0, 200, 0, 0.1)', true, -1);

        // 绘制到鼠标位置的临时线（在polygon或line模式下）
        if (mouseEvent && (currentMode === 'polygon' || currentMode === 'line') && currentPoints.length > 0) {
            const rect = canvas.getBoundingClientRect();
            const rawMx = (mouseEvent.clientX - rect.left) / zoomLevel;
            const rawMy = (mouseEvent.clientY - rect.top) / zoomLevel;
            const [mx, my] = clampImageCoords(rawMx, rawMy);
            const lastPoint = currentPoints[currentPoints.length - 1];

            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', lastPoint[0]);
            line.setAttribute('y1', lastPoint[1]);
            line.setAttribute('x2', mx);
            line.setAttribute('y2', my);
            line.setAttribute('stroke', 'rgba(0, 200, 0, 0.8)');
            line.setAttribute('stroke-width', 2 / zoomLevel); // 根据缩放调整线宽
            line.style.pointerEvents = 'none';
            svgOverlay.appendChild(line);
        }
    }

    // --- Draw Eraser preview ---
    if (eraserActive && eraserPoints.length > 0) {
        const sw = borderWidth / zoomLevel;

        if (eraserMode === 'polygon') {
            // Draw eraser polygon preview
            if (eraserPoints.length >= 2) {
                const polyline = document.createElementNS(SVG_NS, 'polyline');
                const pointsStr = eraserPoints.map(p => `${p[0]},${p[1]}`).join(' ');
                polyline.setAttribute('points', pointsStr);
                polyline.setAttribute('fill', 'rgba(255, 60, 60, 0.15)');
                polyline.setAttribute('stroke', 'rgba(255, 60, 60, 0.9)');
                polyline.setAttribute('stroke-width', sw * 1.5);
                polyline.setAttribute('stroke-dasharray', `${6 / zoomLevel} ${3 / zoomLevel}`);
                polyline.style.pointerEvents = 'none';
                svgOverlay.appendChild(polyline);
            }

            // Draw vertices
            eraserPoints.forEach(p => {
                const circle = document.createElementNS(SVG_NS, 'circle');
                circle.setAttribute('cx', p[0]);
                circle.setAttribute('cy', p[1]);
                circle.setAttribute('r', 4 / zoomLevel);
                circle.setAttribute('fill', 'rgba(255, 60, 60, 0.8)');
                circle.setAttribute('stroke', 'white');
                circle.setAttribute('stroke-width', sw * 0.5);
                circle.style.pointerEvents = 'none';
                svgOverlay.appendChild(circle);
            });

            // Draw trailing line to mouse
            if (mouseEvent && eraserPoints.length > 0) {
                const rect = canvas.getBoundingClientRect();
                const rawMx = (mouseEvent.clientX - rect.left) / zoomLevel;
                const rawMy = (mouseEvent.clientY - rect.top) / zoomLevel;
                const [mx, my] = clampImageCoords(rawMx, rawMy);
                const lastPoint = eraserPoints[eraserPoints.length - 1];

                const line = document.createElementNS(SVG_NS, 'line');
                line.setAttribute('x1', lastPoint[0]);
                line.setAttribute('y1', lastPoint[1]);
                line.setAttribute('x2', mx);
                line.setAttribute('y2', my);
                line.setAttribute('stroke', 'rgba(255, 60, 60, 0.8)');
                line.setAttribute('stroke-width', sw);
                line.setAttribute('stroke-dasharray', `${4 / zoomLevel} ${2 / zoomLevel}`);
                line.style.pointerEvents = 'none';
                svgOverlay.appendChild(line);

                // Also draw closing line (from mouse back to first point) if enough points
                if (eraserPoints.length > 1) {
                    const firstPoint = eraserPoints[0];
                    const closeLine = document.createElementNS(SVG_NS, 'line');
                    closeLine.setAttribute('x1', mx);
                    closeLine.setAttribute('y1', my);
                    closeLine.setAttribute('x2', firstPoint[0]);
                    closeLine.setAttribute('y2', firstPoint[1]);
                    closeLine.setAttribute('stroke', 'rgba(255, 60, 60, 0.4)');
                    closeLine.setAttribute('stroke-width', sw * 0.5);
                    closeLine.setAttribute('stroke-dasharray', `${4 / zoomLevel} ${2 / zoomLevel}`);
                    closeLine.style.pointerEvents = 'none';
                    svgOverlay.appendChild(closeLine);
                }
            }
        } else if (eraserMode === 'rectangle' && eraserPoints.length === 2) {
            // Draw eraser rectangle preview
            const [p1, p2] = eraserPoints;
            const x1 = Math.min(p1[0], p2[0]);
            const y1 = Math.min(p1[1], p2[1]);
            const w = Math.abs(p2[0] - p1[0]);
            const h = Math.abs(p2[1] - p1[1]);

            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', x1);
            rect.setAttribute('y', y1);
            rect.setAttribute('width', w);
            rect.setAttribute('height', h);
            rect.setAttribute('fill', 'rgba(255, 60, 60, 0.15)');
            rect.setAttribute('stroke', 'rgba(255, 60, 60, 0.9)');
            rect.setAttribute('stroke-width', sw * 1.5);
            rect.setAttribute('stroke-dasharray', `${6 / zoomLevel} ${3 / zoomLevel}`);
            rect.style.pointerEvents = 'none';
            svgOverlay.appendChild(rect);
        }
    }

    // --- Draw Eraser rectangle preview during initial drag (before mouseup) ---
    if (!eraserActive && eraserMouseDownPos && eraserIsDragging && eraserDragCurrent) {
        const sw = borderWidth / zoomLevel;
        const p1 = eraserMouseDownPos;
        const p2 = eraserDragCurrent;
        const x1 = Math.min(p1.x, p2.x);
        const y1 = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x1);
        rect.setAttribute('y', y1);
        rect.setAttribute('width', w);
        rect.setAttribute('height', h);
        rect.setAttribute('fill', 'rgba(255, 60, 60, 0.15)');
        rect.setAttribute('stroke', 'rgba(255, 60, 60, 0.9)');
        rect.setAttribute('stroke-width', sw * 1.5);
        rect.setAttribute('stroke-dasharray', `${6 / zoomLevel} ${3 / zoomLevel}`);
        rect.style.pointerEvents = 'none';
        svgOverlay.appendChild(rect);
    }

    // --- Draw box selection rectangle ---
    if (isBoxSelecting && boxSelectStart && boxSelectCurrent) {
        const sw = 1 / zoomLevel;
        const bx1 = Math.min(boxSelectStart.x, boxSelectCurrent.x);
        const by1 = Math.min(boxSelectStart.y, boxSelectCurrent.y);
        const bw = Math.abs(boxSelectCurrent.x - boxSelectStart.x);
        const bh = Math.abs(boxSelectCurrent.y - boxSelectStart.y);

        const selRect = document.createElementNS(SVG_NS, 'rect');
        selRect.setAttribute('x', bx1);
        selRect.setAttribute('y', by1);
        selRect.setAttribute('width', bw);
        selRect.setAttribute('height', bh);
        selRect.setAttribute('fill', 'rgba(0, 122, 204, 0.15)');
        selRect.setAttribute('stroke', 'rgba(0, 122, 204, 0.8)');
        selRect.setAttribute('stroke-width', sw);
        selRect.setAttribute('stroke-dasharray', `${4 / zoomLevel} ${2 / zoomLevel}`);
        selRect.style.pointerEvents = 'none';
        svgOverlay.appendChild(selRect);
    }

    // Draw pixel RGB values when at maximum zoom (4000%)
    if (zoomLevel >= PIXEL_VALUES_ZOOM && img.width > 0 && img.height > 0) {
        drawPixelValues();
    }
}

// Draw pixel RGB value labels on the SVG overlay
// Only renders values for pixels visible in the current viewport
function drawPixelValues() {
    // Calculate visible pixel range from scroll position and viewport size
    const scrollX = canvasContainer.scrollLeft;
    const scrollY = canvasContainer.scrollTop;
    const viewportW = canvasContainer.clientWidth;
    const viewportH = canvasContainer.clientHeight;

    // Convert viewport bounds to image pixel coordinates
    const startCol = Math.max(0, Math.floor(scrollX / zoomLevel));
    const startRow = Math.max(0, Math.floor(scrollY / zoomLevel));
    const endCol = Math.min(img.width, Math.ceil((scrollX + viewportW) / zoomLevel));
    const endRow = Math.min(img.height, Math.ceil((scrollY + viewportH) / zoomLevel));

    // Guard: skip if viewport collapsed to zero size (avoids getImageData IndexSizeError)
    if (endCol <= startCol || endRow <= startRow) return;

    // Get pixel data from canvas
    const pixelData = ctx.getImageData(startCol, startRow, endCol - startCol, endRow - startRow);
    const data = pixelData.data;

    // Create a group for pixel values
    const pvGroup = document.createElementNS(SVG_NS, 'g');
    pvGroup.setAttribute('class', 'pixel-values-group');

    // Font size in image coordinates (will be scaled by SVG viewBox)
    // At zoomLevel=40, 1 image pixel = 40 screen pixels
    // We want text to be about 9-10 screen pixels tall
    const fontSize = 10 / zoomLevel;

    for (let row = startRow; row < endRow; row++) {
        for (let col = startCol; col < endCol; col++) {
            const i = ((row - startRow) * (endCol - startCol) + (col - startCol)) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Determine text color based on pixel luminance for contrast
            const luminance = (r * 299 + g * 587 + b * 114) / 1000;
            const textColor = luminance > 128 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)';

            // Always display raw pixel values as R,G,B
            const label = `${r},${g},${b}`;

            const text = document.createElementNS(SVG_NS, 'text');
            text.setAttribute('x', col + 0.5); // Center in pixel
            text.setAttribute('y', row + 0.5);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('fill', textColor);
            text.setAttribute('font-size', fontSize);
            text.setAttribute('font-family', 'monospace');
            text.setAttribute('pointer-events', 'none');
            text.textContent = label;

            pvGroup.appendChild(text);
        }
    }

    svgOverlay.appendChild(pvGroup);
}

function drawSVGShape(shapeType, points, strokeColor, fillColor, showVertices = false, shapeIndex = -1) {
    if (points.length === 0) return;

    const group = document.createElementNS(SVG_NS, 'g');

    // 根据zoomLevel调整线宽，使视觉上保持恒定粗细
    const adjustedStrokeWidth = borderWidth / zoomLevel;
    const adjustedPointRadius = 3 / zoomLevel;
    const largePointRadius = 6 / zoomLevel; // Larger radius for point annotations

    // Handle point shape type - draw a circle
    if (shapeType === 'point') {
        if (points.length > 0) {
            const p = points[0];
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', p[0]);
            circle.setAttribute('cy', p[1]);
            circle.setAttribute('r', largePointRadius);
            circle.setAttribute('stroke', strokeColor);
            circle.setAttribute('stroke-width', adjustedStrokeWidth);
            circle.setAttribute('fill', fillColor);

            if (shapeIndex !== -1) {
                circle.style.cursor = 'pointer';
                circle.style.pointerEvents = 'auto';
                circle.dataset.shapeIndex = shapeIndex;
            }

            group.appendChild(circle);
        }
    } else {
        // 创建多边形或折线
        let pathElement;
        const isLinestrip = shapeType === 'linestrip' || shapeType === 'line';
        const isCompleted = shapeIndex !== -1;

        if (isLinestrip) {
            // Linestrip uses polyline (open path, no closure)
            pathElement = document.createElementNS(SVG_NS, 'polyline');
            const pointsStr = points.map(p => `${p[0]},${p[1]}`).join(' ');
            pathElement.setAttribute('points', pointsStr);
            pathElement.setAttribute('fill', 'none'); // Linestrip has no fill
        } else if (!isDrawing || isCompleted || shapeType === 'rectangle') {
            // 完成的形状使用polygon
            pathElement = document.createElementNS(SVG_NS, 'polygon');
            const pointsStr = points.map(p => `${p[0]},${p[1]}`).join(' ');
            pathElement.setAttribute('points', pointsStr);
            pathElement.setAttribute('fill', isCompleted ? fillColor : 'none');
        } else {
            // 正在绘制的形状使用polyline
            pathElement = document.createElementNS(SVG_NS, 'polyline');
            const pointsStr = points.map(p => `${p[0]},${p[1]}`).join(' ');
            pathElement.setAttribute('points', pointsStr);
            pathElement.setAttribute('fill', 'none');
        }

        pathElement.setAttribute('stroke', strokeColor);
        pathElement.setAttribute('stroke-width', adjustedStrokeWidth);

        // 为完成的形状添加data属性用于事件委托
        if (shapeIndex !== -1) {
            pathElement.style.cursor = 'pointer';
            pathElement.style.pointerEvents = 'auto';
            pathElement.dataset.shapeIndex = shapeIndex;
        }

        group.appendChild(pathElement);
    }

    // 绘制顶点（仅在绘制过程中显示，或对于linestrip始终显示小点，或在编辑模式下显示可拖动的顶点）
    const isInEditMode = isEditingShape && shapeIndex === shapeBeingEdited;

    if (showVertices || (shapeType === 'linestrip' && shapeIndex !== -1) || isInEditMode) {
        const vertexRadius = isInEditMode ? (6 / zoomLevel) : adjustedPointRadius;

        points.forEach((p, index) => {
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', p[0]);
            circle.setAttribute('cy', p[1]);
            circle.setAttribute('r', vertexRadius);
            circle.setAttribute('fill', isInEditMode ? '#FFD700' : strokeColor);
            circle.setAttribute('stroke', isInEditMode ? '#FFA500' : 'none');
            circle.setAttribute('stroke-width', isInEditMode ? (2 / zoomLevel) : 0);

            if (isInEditMode) {
                circle.style.cursor = 'move';
                circle.style.pointerEvents = 'auto';
                circle.classList.add('vertex-handle');
                circle.dataset.vertexIndex = index;
                circle.dataset.shapeIndex = shapeIndex;
            } else {
                circle.style.pointerEvents = 'none';
            }

            group.appendChild(circle);
        });
    }

    svgOverlay.appendChild(group);
}

// SVG事件委托 - 只绑定一次，避免内存泄漏
svgOverlay.addEventListener('click', (e) => {
    const target = e.target;
    if (target.dataset && target.dataset.shapeIndex !== undefined) {
        e.stopPropagation();
        const idx = parseInt(target.dataset.shapeIndex);
        if (e.ctrlKey || e.metaKey) {
            toggleShapeSelection(idx);
        } else {
            selectShape(idx);
        }
        renderShapeList();
        draw();
    }
});

function getRectPoints(points) {
    if (points.length !== 2) return points;
    const [p1, p2] = points;
    return [
        p1,
        [p2[0], p1[1]],
        p2,
        [p1[0], p2[1]]
    ];
}

function save() {
    if (!isDirty) return;
    if (isSaving) return; // Block concurrent saves

    // Capture the history position being saved, so saveComplete only marks
    // this exact snapshot as clean (not any edits made while save was in flight)
    pendingSaveHistoryIndex = historyIndex;
    isSaving = true;

    // 过滤掉visible字段,不保存到JSON中
    const shapesToSave = shapes.map(shape => {
        const { visible, ...shapeWithoutVisible } = shape;
        // Strip empty/undefined description so it doesn't appear in JSON
        if (!shapeWithoutVisible.description) {
            delete shapeWithoutVisible.description;
        }
        return shapeWithoutVisible;
    });

    vscode.postMessage({
        command: 'save',
        data: {
            shapes: shapesToSave,
            imageHeight: img.height,
            imageWidth: img.width
        }
    });
    // markClean() is called when backend confirms save via 'saveComplete' message
}

if (saveBtn) {
    saveBtn.addEventListener('click', save);
}

// --- Tools Menu ---
const toolsMenuBtn = document.getElementById('toolsMenuBtn');
const toolsMenuDropdown = document.getElementById('toolsMenuDropdown');
const exportSvgMenuItem = document.getElementById('exportSvgMenuItem');

function exportSvg() {
    // Close the menu
    if (toolsMenuDropdown) toolsMenuDropdown.style.display = 'none';

    // Guard: image must be fully loaded so dimensions are available
    if (!img.width || !img.height) {
        if (window.notifyBus) window.notifyBus.show('warn', 'Cannot export SVG: image has not finished loading yet. Please wait and try again.');
        return;
    }

    // Filter out visible field, same as save
    const shapesToExport = shapes.map(shape => {
        const { visible, ...shapeWithoutVisible } = shape;
        if (!shapeWithoutVisible.description) {
            delete shapeWithoutVisible.description;
        }
        return shapeWithoutVisible;
    });

    vscode.postMessage({
        command: 'exportSvg',
        data: {
            shapes: shapesToExport,
            imageHeight: img.height,
            imageWidth: img.width
        }
    });
}

if (exportSvgMenuItem) {
    exportSvgMenuItem.addEventListener('click', exportSvg);
}

// --- ONNX Batch Inference ---
const onnxBatchInferMenuItem = document.getElementById('onnxBatchInferMenuItem');
const onnxInferModal = document.getElementById('onnxInferModal');
const onnxModelDirInput = document.getElementById('onnxModelDir');
const onnxPythonPathInput = document.getElementById('onnxPythonPath');
const onnxModelDirBrowse = document.getElementById('onnxModelDirBrowse');
const onnxPythonPathBrowse = document.getElementById('onnxPythonPathBrowse');
const onnxImageCountSpan = document.getElementById('onnxImageCount');
const onnxInferOkBtn = document.getElementById('onnxInferOkBtn');
const onnxInferCancelBtn = document.getElementById('onnxInferCancelBtn');

function updateOnnxImageCount() {
    if (!onnxImageCountSpan) return;
    const scope = document.querySelector('input[name="onnxScope"]:checked')?.value || 'all';
    if (scope === 'current') {
        onnxImageCountSpan.textContent = '1';
    } else {
        onnxImageCountSpan.textContent = (typeof workspaceImages !== 'undefined' ? workspaceImages.length : 0).toString();
    }
}

function showOnnxInferModal() {
    // Close the tools menu
    if (toolsMenuDropdown) toolsMenuDropdown.style.display = 'none';

    // Restore saved settings from globalState (persisted across sessions)
    const gs = (typeof initialGlobalSettings !== 'undefined') ? initialGlobalSettings : {};
    // vscodeState overrides for within-session changes
    const savedState = vscode.getState() || {};

    if (onnxModelDirInput) {
        onnxModelDirInput.value = savedState.onnxModelDir ?? gs.onnxModelDir ?? '';
    }
    if (onnxPythonPathInput) {
        onnxPythonPathInput.value = savedState.onnxPythonPath ?? gs.onnxPythonPath ?? '';
    }

    // Restore radio selections
    const restoreRadio = (name, savedValue) => {
        if (!savedValue) return;
        const radio = document.querySelector(`input[name="${name}"][value="${savedValue}"]`);
        if (radio) radio.checked = true;
    };
    restoreRadio('onnxDevice', savedState.onnxDevice ?? gs.onnxDevice);
    restoreRadio('onnxColor', savedState.onnxColor ?? gs.onnxColor);
    restoreRadio('onnxScope', savedState.onnxScope ?? gs.onnxScope);
    restoreRadio('onnxMode', savedState.onnxMode ?? gs.onnxMode);

    // Update image count based on scope
    updateOnnxImageCount();

    // Trigger GPU detection if GPU is selected
    const onnxGpuGroup = document.getElementById('onnxGpuIndexGroup');
    const onnxSelectedDevice = document.querySelector('input[name="onnxDevice"]:checked')?.value || 'cpu';
    // Store pending GPU index to restore after detection result arrives
    const pendingOnnxGpuIndex = savedState.onnxGpuIndex ?? gs.onnxGpuIndex ?? -1;
    if (onnxSelectedDevice === 'gpu') {
        document.getElementById('onnxGpuIndexGroup').__pendingGpuIndex = pendingOnnxGpuIndex;
        vscode.postMessage({ command: 'detectGpuCount' });
    } else if (onnxGpuGroup) {
        onnxGpuGroup.style.display = 'none';
    }

    // Show modal
    if (onnxInferModal) onnxInferModal.style.display = 'flex';
    if (onnxModelDirInput && !onnxModelDirInput.value) onnxModelDirInput.focus();
}

function hideOnnxInferModal() {
    if (onnxInferModal) onnxInferModal.style.display = 'none';
}

function saveOnnxSettings(settings) {
    // Save to vscode webview state (within session, survives HTML regeneration)
    const state = vscode.getState() || {};
    Object.assign(state, settings);
    vscode.setState(state);

    // Save each setting to globalState (persists across sessions/restarts)
    for (const [key, value] of Object.entries(settings)) {
        vscode.postMessage({ command: 'saveGlobalSettings', key: key, value: value });
    }
}

function submitOnnxInfer() {
    const modelDir = onnxModelDirInput ? onnxModelDirInput.value.trim() : '';
    const pythonPath = onnxPythonPathInput ? onnxPythonPathInput.value.trim() : '';
    const device = document.querySelector('input[name="onnxDevice"]:checked')?.value || 'cpu';
    const colorFormat = document.querySelector('input[name="onnxColor"]:checked')?.value || 'rgb';
    const scope = document.querySelector('input[name="onnxScope"]:checked')?.value || 'all';
    const mode = document.querySelector('input[name="onnxMode"]:checked')?.value || 'skip';
    const onnxGpuSelect = document.getElementById('onnxGpuIndex');
    const onnxGpuGroup = document.getElementById('onnxGpuIndexGroup');
    // Use dropdown value if populated, otherwise fall back to saved/persisted index
    const savedState = vscode.getState() || {};
    const gpuIndex = (device === 'gpu')
        ? (onnxGpuGroup && onnxGpuGroup.style.display !== 'none' && onnxGpuSelect
            ? parseInt(onnxGpuSelect.value)
            : (savedState.onnxGpuIndex ?? (typeof initialGlobalSettings !== 'undefined' ? initialGlobalSettings.onnxGpuIndex : undefined) ?? 0))
        : undefined;

    if (!modelDir) {
        if (onnxModelDirInput) onnxModelDirInput.focus();
        return;
    }

    // Persist all settings
    saveOnnxSettings({
        onnxModelDir: modelDir,
        onnxPythonPath: pythonPath,
        onnxDevice: device,
        onnxColor: colorFormat,
        onnxScope: scope,
        onnxMode: mode,
        onnxGpuIndex: gpuIndex ?? -1
    });

    // Send to extension backend
    vscode.postMessage({
        command: 'onnxBatchInfer',
        config: {
            modelDir: modelDir,
            pythonPath: pythonPath,
            device: device,
            colorFormat: colorFormat,
            scope: scope,
            mode: mode,
            gpuIndex: gpuIndex
        }
    });

    hideOnnxInferModal();
}

if (onnxBatchInferMenuItem) {
    onnxBatchInferMenuItem.addEventListener('click', showOnnxInferModal);
}
if (onnxInferOkBtn) {
    onnxInferOkBtn.addEventListener('click', submitOnnxInfer);
}
if (onnxInferCancelBtn) {
    onnxInferCancelBtn.addEventListener('click', hideOnnxInferModal);
}
// Browse buttons
if (onnxModelDirBrowse) {
    onnxModelDirBrowse.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseOnnxModelDir',
            currentValue: onnxModelDirInput ? onnxModelDirInput.value.trim() : ''
        });
    });
}
if (onnxPythonPathBrowse) {
    onnxPythonPathBrowse.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseOnnxPythonPath',
            currentValue: onnxPythonPathInput ? onnxPythonPathInput.value.trim() : ''
        });
    });
}
// Scope radio change updates image count
document.querySelectorAll('input[name="onnxScope"]').forEach(radio => {
    radio.addEventListener('change', updateOnnxImageCount);
});
// Device radio change: toggle GPU index dropdown
document.querySelectorAll('input[name="onnxDevice"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const onnxGpuGroup = document.getElementById('onnxGpuIndexGroup');
        if (e.target.value === 'gpu') {
            vscode.postMessage({ command: 'detectGpuCount' });
        } else if (onnxGpuGroup) {
            onnxGpuGroup.style.display = 'none';
        }
    });
});
// Allow Enter key to submit in model dir input
if (onnxModelDirInput) {
    onnxModelDirInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitOnnxInfer();
        if (e.key === 'Escape') hideOnnxInferModal();
    });
}
// Close ONNX modal on Escape or click-outside
if (onnxInferModal) {
    onnxInferModal.addEventListener('click', (e) => {
        if (e.target === onnxInferModal) hideOnnxInferModal();
    });
}

// Close sidebar dropdowns when clicking outside.
// Listens on `mousedown` (fires before any inner click handlers can mutate the DOM
// — e.g., a lock toggle re-rendering its <svg> would otherwise detach e.target,
// making contains() falsely return "outside"). composedPath() is also passed as a
// belt-and-braces fallback in case the path is required.
document.addEventListener('mousedown', (e) => {
    const helpers = (typeof window !== 'undefined') ? window.LabelEditorHelpers : null;
    const dismiss = helpers ? helpers.shouldDismissPopover : null;
    if (!dismiss) return;
    const path = (typeof e.composedPath === 'function') ? e.composedPath() : null;
    // Settings dropdown
    if (settingsMenuDropdown && settingsMenuDropdown.style.display !== 'none') {
        if (dismiss(e.target, settingsMenuDropdown, settingsMenuBtn, path)) {
            settingsMenuDropdown.style.display = 'none';
            const state = vscode.getState() || {};
            state.settingsMenuExpanded = false;
            vscode.setState(state);
        }
    }
    // Tools dropdown
    if (toolsMenuDropdown && toolsMenuDropdown.style.display !== 'none') {
        if (dismiss(e.target, toolsMenuDropdown, toolsMenuBtn, path)) {
            toolsMenuDropdown.style.display = 'none';
        }
    }
});

// --- Labels Management Event Listeners ---

// Color picker OK button
if (colorOkBtn) {
    colorOkBtn.onclick = confirmColorPicker;
}

// Color picker Cancel button
if (colorCancelBtn) {
    colorCancelBtn.onclick = hideColorPicker;
}

// Color picker input - Enter to confirm
if (customColorInput) {
    customColorInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmColorPicker();
        if (e.key === 'Escape') hideColorPicker();
    });
}

// --- Settings/Tools Dropdown Event Listeners ---

// Settings button
if (settingsMenuBtn) {
    settingsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebarDropdown(settingsMenuDropdown, toolsMenuDropdown);
    });
}

// Tools button
if (toolsMenuBtn) {
    toolsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebarDropdown(toolsMenuDropdown, settingsMenuDropdown);
    });
}

// Border Width slider
if (borderWidthSlider) {
    borderWidthSlider.oninput = (e) => {
        borderWidth = parseFloat(e.target.value);
        borderWidthValue.textContent = borderWidth;
        updateBorderWidthResetBtn();
        draw();
    };
    borderWidthSlider.onchange = (e) => saveGlobalSettings('borderWidth', borderWidth);
}

// Fill Opacity slider
if (fillOpacitySlider) {
    fillOpacitySlider.oninput = (e) => {
        fillOpacity = parseInt(e.target.value) / 100;
        fillOpacityValue.textContent = Math.round(fillOpacity * 100);
        updateFillOpacityResetBtn();
        invalidateColorCache();
        draw();
    };
    fillOpacitySlider.onchange = (e) => saveGlobalSettings('fillOpacity', fillOpacity);
}

// Border Width reset button
if (borderWidthResetBtn) {
    borderWidthResetBtn.onclick = () => {
        borderWidth = 2;
        if (borderWidthSlider) borderWidthSlider.value = borderWidth;
        if (borderWidthValue) borderWidthValue.textContent = borderWidth;
        updateBorderWidthResetBtn();
        saveGlobalSettings('borderWidth', borderWidth);
        draw();
    };
}

// Fill Opacity reset button
if (fillOpacityResetBtn) {
    fillOpacityResetBtn.onclick = () => {
        fillOpacity = 0.3;
        if (fillOpacitySlider) fillOpacitySlider.value = fillOpacity * 100;
        if (fillOpacityValue) fillOpacityValue.textContent = Math.round(fillOpacity * 100);
        updateFillOpacityResetBtn();
        invalidateColorCache();
        saveGlobalSettings('fillOpacity', fillOpacity);
        draw();
    };
}

// Update reset button visibility
function updateBorderWidthResetBtn() {
    if (borderWidthResetBtn) {
        if (borderWidth !== 2) {
            borderWidthResetBtn.classList.add('visible');
        } else {
            borderWidthResetBtn.classList.remove('visible');
        }
    }
}

function updateFillOpacityResetBtn() {
    if (fillOpacityResetBtn) {
        if (Math.abs(fillOpacity - 0.3) > 0.001) {
            fillOpacityResetBtn.classList.add('visible');
        } else {
            fillOpacityResetBtn.classList.remove('visible');
        }
    }
}

// --- Image Adjust (Brightness / Contrast) ---
function applyImageAdjust() {
    const filterValue = (brightness === 100 && contrast === 100)
        ? ''
        : `brightness(${brightness / 100}) contrast(${contrast / 100})`;
    canvas.style.filter = filterValue;
}

// Render channel-selected and/or CLAHE-processed image into the cached offscreen canvas.
// Returns the cached canvas, or null if the source image is not ready.
// CLAHE runs in YCbCr space on the Y plane only, so colors are preserved.
function getProcessedCanvas() {
    if (!img.src || !img.complete || !img.width || !img.height) return null;

    const w = img.width;
    const h = img.height;
    const key = img.src + '|' + selectedChannel + '|' + claheEnabled + '|' + claheClipLimit + '|' + w + 'x' + h;
    if (processedCanvas && key === processedKey) return processedCanvas;

    if (!processedCanvas) {
        processedCanvas = document.createElement('canvas');
    }
    if (processedCanvas.width !== w || processedCanvas.height !== h) {
        processedCanvas.width = w;
        processedCanvas.height = h;
    }
    const pCtx = processedCanvas.getContext('2d');
    pCtx.drawImage(img, 0, 0, w, h);
    const imageData = pCtx.getImageData(0, 0, w, h);
    const data = imageData.data;

    if (selectedChannel !== 'rgb') {
        const offset = selectedChannel === 'r' ? 0 : selectedChannel === 'g' ? 1 : 2;
        for (let i = 0; i < data.length; i += 4) {
            const v = data[i + offset];
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
        }
    }

    if (claheEnabled) {
        applyClaheYCbCr(data, w, h, claheClipLimit);
    }

    pCtx.putImageData(imageData, 0, 0);
    processedKey = key;
    return processedCanvas;
}

// CLAHE in YCbCr (Rec.601). Equalizes Y; Cb/Cr pass through. In-place on `data` (RGBA).
function applyClaheYCbCr(data, width, height, clipLimit) {
    const n = width * height;
    const y = new Uint8Array(n);
    const cb = new Uint8Array(n);
    const cr = new Uint8Array(n);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        y[p]  = Math.round( 0.299 * r + 0.587 * g + 0.114 * b);
        cb[p] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5      * b);
        cr[p] = Math.round(128 + 0.5      * r - 0.418688 * g - 0.081312 * b);
    }

    claheOnPlane(y, width, height, clipLimit);

    for (let p = 0, i = 0; p < n; p++, i += 4) {
        const Y  = y[p];
        const Cb = cb[p] - 128;
        const Cr = cr[p] - 128;
        const r = Y + 1.402 * Cr;
        const g = Y - 0.344136 * Cb - 0.714136 * Cr;
        const b = Y + 1.772 * Cb;
        data[i]     = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    }
}

// CLAHE on a single 8-bit plane. 8x8 tile grid sized adaptively to the plane.
// Float clip threshold avoids the floor-to-zero collapse seen with small tiles.
function claheOnPlane(plane, width, height, clipLimit) {
    const tilesX = 8;
    const tilesY = 8;
    const tileW = Math.ceil(width / tilesX);
    const tileH = Math.ceil(height / tilesY);

    const cdfs = new Array(tilesX * tilesY);

    for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
            const startX = tx * tileW;
            const startY = ty * tileH;
            const endX = Math.min(startX + tileW, width);
            const endY = Math.min(startY + tileH, height);
            const tilePixels = (endX - startX) * (endY - startY);

            const hist = new Uint32Array(256);
            for (let py = startY; py < endY; py++) {
                const row = py * width;
                for (let px = startX; px < endX; px++) {
                    hist[plane[row + px]]++;
                }
            }

            // Clip in floating point. Storing back into the integer hist would truncate
            // sub-1.0 thresholds and re-introduce the floor-to-zero collapse on small tiles.
            const clippedHist = new Float64Array(256);
            const clipThreshold = clipLimit * tilePixels / 256;
            let excess = 0;
            for (let i = 0; i < 256; i++) {
                if (hist[i] > clipThreshold) {
                    excess += hist[i] - clipThreshold;
                    clippedHist[i] = clipThreshold;
                } else {
                    clippedHist[i] = hist[i];
                }
            }
            const redistribution = excess / 256;

            const cdf = new Uint8Array(256);
            let acc = 0;
            const scale = 255 / tilePixels;
            for (let i = 0; i < 256; i++) {
                acc += clippedHist[i] + redistribution;
                let v = Math.round(acc * scale);
                if (v > 255) v = 255;
                cdf[i] = v;
            }
            cdfs[ty * tilesX + tx] = cdf;
        }
    }

    // Bilinear interpolation between the 4 surrounding tile CDFs.
    // fx/fy are the pixel position in tile-center coordinates, clamped to the valid range
    // so that edge / corner pixels collapse to a single CDF without reaching across the boundary.
    for (let py = 0; py < height; py++) {
        const row = py * width;
        const rawFy = (py + 0.5) / tileH - 0.5;
        const fy = rawFy < 0 ? 0 : rawFy > tilesY - 1 ? tilesY - 1 : rawFy;
        const ty1 = Math.floor(fy);
        const ty2 = ty1 + 1 > tilesY - 1 ? tilesY - 1 : ty1 + 1;
        const dy = fy - ty1;

        for (let px = 0; px < width; px++) {
            const rawFx = (px + 0.5) / tileW - 0.5;
            const fx = rawFx < 0 ? 0 : rawFx > tilesX - 1 ? tilesX - 1 : rawFx;
            const tx1 = Math.floor(fx);
            const tx2 = tx1 + 1 > tilesX - 1 ? tilesX - 1 : tx1 + 1;
            const dx = fx - tx1;

            const v = plane[row + px];
            const v11 = cdfs[ty1 * tilesX + tx1][v];
            const v12 = cdfs[ty1 * tilesX + tx2][v];
            const v21 = cdfs[ty2 * tilesX + tx1][v];
            const v22 = cdfs[ty2 * tilesX + tx2][v];

            const top = v11 * (1 - dx) + v12 * dx;
            const bot = v21 * (1 - dx) + v22 * dx;
            plane[row + px] = Math.round(top * (1 - dy) + bot * dy);
        }
    }
}

function updateBrightnessResetBtn() {
    if (brightnessResetBtn) {
        brightnessResetBtn.classList.toggle('visible', brightness !== 100);
    }
}

function updateContrastResetBtn() {
    if (contrastResetBtn) {
        contrastResetBtn.classList.toggle('visible', contrast !== 100);
    }
}

// Lock-button updaters: swap the SVG icon and toggle the .locked class.
// LOCK_OPEN_SVG / LOCK_CLOSED_SVG are hoisted near updateZoomUI so all five
// lock buttons share the same icon source.

function updateBrightnessLockUI() {
    if (brightnessLockBtn) {
        brightnessLockBtn.innerHTML = brightnessLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        brightnessLockBtn.classList.toggle('locked', brightnessLocked);
    }
}

function updateContrastLockUI() {
    if (contrastLockBtn) {
        contrastLockBtn.innerHTML = contrastLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        contrastLockBtn.classList.toggle('locked', contrastLocked);
    }
}

function updateChannelLockUI() {
    if (channelLockBtn) {
        channelLockBtn.innerHTML = channelLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        channelLockBtn.classList.toggle('locked', channelLocked);
    }
}

function updateClaheLockUI() {
    if (claheLockBtn) {
        claheLockBtn.innerHTML = claheLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        claheLockBtn.classList.toggle('locked', claheLocked);
    }
}

function updateClaheResetBtn() {
    if (claheResetBtn) {
        claheResetBtn.classList.toggle('visible', claheEnabled || claheClipLimit !== 2.0);
    }
}

if (brightnessSlider) {
    brightnessSlider.oninput = (e) => {
        brightness = parseInt(e.target.value);
        brightnessValue.textContent = brightness;
        updateBrightnessResetBtn();
        applyImageAdjust();
    };
    brightnessSlider.onchange = () => saveGlobalSettings('brightness', brightness);
}

if (contrastSlider) {
    contrastSlider.oninput = (e) => {
        contrast = parseInt(e.target.value);
        contrastValue.textContent = contrast;
        updateContrastResetBtn();
        applyImageAdjust();
    };
    contrastSlider.onchange = () => saveGlobalSettings('contrast', contrast);
}

// Channel radio event handler
channelRadios.forEach(r => {
    r.addEventListener('change', () => {
        if (r.checked) {
            selectedChannel = r.value;
            draw();
            saveGlobalSettings('selectedChannel', selectedChannel);
        }
    });
});

// CLAHE clip limit slider — only adjusts the value; does not toggle enabled state.
if (claheClipLimitSlider) {
    claheClipLimitSlider.oninput = (e) => {
        claheClipLimit = parseFloat(e.target.value);
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        updateClaheResetBtn();
        draw();
    };
    claheClipLimitSlider.onchange = () => saveGlobalSettings('claheClipLimit', claheClipLimit);
}

// CLAHE toggle button
if (claheToggleBtn) {
    claheToggleBtn.onclick = () => {
        claheEnabled = !claheEnabled;
        updateClaheToggleUI();
        updateClaheResetBtn();
        draw();
        saveGlobalSettings('claheEnabled', claheEnabled);
    };
}

// CLAHE reset button — clears enabled state and restores default clip limit.
if (claheResetBtn) {
    claheResetBtn.onclick = () => {
        claheEnabled = false;
        claheClipLimit = 2.0;
        if (claheClipLimitSlider) claheClipLimitSlider.value = claheClipLimit;
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        updateClaheToggleUI();
        updateClaheResetBtn();
        draw();
        saveGlobalSettings('claheEnabled', claheEnabled);
        saveGlobalSettings('claheClipLimit', claheClipLimit);
    };
}

// CLAHE lock button
if (claheLockBtn) {
    claheLockBtn.onclick = () => {
        claheLocked = !claheLocked;
        updateClaheLockUI();
        saveGlobalSettings('claheLocked', claheLocked);
    };
}

if (brightnessResetBtn) {
    brightnessResetBtn.onclick = () => {
        brightness = 100;
        if (brightnessSlider) brightnessSlider.value = brightness;
        if (brightnessValue) brightnessValue.textContent = brightness;
        updateBrightnessResetBtn();
        applyImageAdjust();
        saveGlobalSettings('brightness', brightness);
    };
}

if (contrastResetBtn) {
    contrastResetBtn.onclick = () => {
        contrast = 100;
        if (contrastSlider) contrastSlider.value = contrast;
        if (contrastValue) contrastValue.textContent = contrast;
        updateContrastResetBtn();
        applyImageAdjust();
        saveGlobalSettings('contrast', contrast);
    };
}

if (brightnessLockBtn) {
    brightnessLockBtn.addEventListener('click', () => {
        brightnessLocked = !brightnessLocked;
        updateBrightnessLockUI();
        saveGlobalSettings('brightnessLocked', brightnessLocked);
    });
}

if (contrastLockBtn) {
    contrastLockBtn.addEventListener('click', () => {
        contrastLocked = !contrastLocked;
        updateContrastLockUI();
        saveGlobalSettings('contrastLocked', contrastLocked);
    });
}

// Initialize channel and CLAHE lock buttons
const channelLockBtn = document.getElementById('channelLockBtn');

if (channelLockBtn) {
    channelLockBtn.addEventListener('click', () => {
        channelLocked = !channelLocked;
        updateChannelLockUI();
        saveGlobalSettings('channelLocked', channelLocked);
    });
}

// Initialize image adjust UI
updateBrightnessLockUI();
updateContrastLockUI();
updateChannelLockUI();
updateClaheLockUI();
updateBrightnessResetBtn();
updateContrastResetBtn();
updateClaheResetBtn();
applyImageAdjust();

// Initialize reset button visibility
updateBorderWidthResetBtn();
updateFillOpacityResetBtn();

// --- Theme Button Event Listeners ---

if (themeLightBtn) {
    themeLightBtn.onclick = () => setTheme('light');
}

if (themeDarkBtn) {
    themeDarkBtn.onclick = () => setTheme('dark');
}

if (themeAutoBtn) {
    themeAutoBtn.onclick = () => setTheme('auto');
}

// --- Navigation Buttons Event Listeners ---

// Previous Image button
if (prevImageBtn) {
    prevImageBtn.onclick = () => {
        vscode.postMessage({ command: 'prev' });
    };
}

// Next Image button
if (nextImageBtn) {
    nextImageBtn.onclick = () => {
        vscode.postMessage({ command: 'next' });
    };
}

// Filename click to copy absolute path
const fileNameSpan = document.getElementById('fileName');
if (fileNameSpan) {
    fileNameSpan.onclick = () => {
        if (currentAbsoluteImagePath) {
            navigator.clipboard.writeText(currentAbsoluteImagePath).then(() => {
                const originalText = fileNameSpan.textContent;
                fileNameSpan.textContent = originalText + ' ✓';
                setTimeout(() => { fileNameSpan.textContent = originalText; }, 1000);
            }).catch(err => console.error('Failed to copy path:', err));
        }
    };
    // Right-click to copy filename only
    fileNameSpan.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (currentAbsoluteImagePath) {
            const baseName = currentAbsoluteImagePath.split(/[\\/]/).pop() || currentAbsoluteImagePath;
            navigator.clipboard.writeText(baseName).then(() => {
                const originalText = fileNameSpan.textContent;
                fileNameSpan.textContent = originalText + ' ✓';
                setTimeout(() => { fileNameSpan.textContent = originalText; }, 1000);
            }).catch(err => console.error('Failed to copy filename:', err));
        }
    });
}

// --- Image Info Popup ---

function formatFileSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

function updateImageInfoPopup() {
    const popup = document.getElementById('imageInfoPopup');
    if (!popup || popup.classList.contains('hidden')) return;
    renderImageInfoContent(popup);
}

function renderImageInfoContent(popup) {
    const rows = [];
    // Dimensions from loaded image
    if (img && img.width > 0 && img.height > 0) {
        rows.push({ label: 'Dimensions', value: `${img.width} \u00d7 ${img.height}` });
    }
    // File size from extension metadata
    if (currentImageMetadata) {
        if (currentImageMetadata.fileSize) {
            rows.push({ label: 'File Size', value: formatFileSize(currentImageMetadata.fileSize) });
        }
        if (currentImageMetadata.dpiX) {
            const dpi = currentImageMetadata.dpiX === currentImageMetadata.dpiY
                ? `${currentImageMetadata.dpiX}`
                : `${currentImageMetadata.dpiX} \u00d7 ${currentImageMetadata.dpiY}`;
            rows.push({ label: 'DPI', value: dpi });
        }
        if (currentImageMetadata.bitDepth) {
            rows.push({ label: 'Bit Depth', value: `${currentImageMetadata.bitDepth}` });
        }
    }

    popup.textContent = '';
    if (rows.length === 0) {
        const span = document.createElement('span');
        span.style.opacity = '0.5';
        span.textContent = 'No info available';
        popup.appendChild(span);
        return;
    }

    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'info-row';
        const label = document.createElement('span');
        label.className = 'info-label';
        label.textContent = r.label;
        const value = document.createElement('span');
        value.className = 'info-value';
        value.textContent = r.value;
        row.appendChild(label);
        row.appendChild(value);
        popup.appendChild(row);
    });
}

const imageInfoBtn = document.getElementById('imageInfoBtn');
const imageInfoPopup = document.getElementById('imageInfoPopup');

if (imageInfoBtn && imageInfoPopup) {
    imageInfoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = imageInfoPopup.classList.contains('hidden');
        if (isHidden) {
            renderImageInfoContent(imageInfoPopup);
            imageInfoPopup.classList.remove('hidden');
        } else {
            imageInfoPopup.classList.add('hidden');
        }
    });

    // Close popup when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!imageInfoPopup.classList.contains('hidden') &&
            !imageInfoPopup.contains(e.target) &&
            e.target !== imageInfoBtn) {
            imageInfoPopup.classList.add('hidden');
        }
    });
}

// --- Mode Toggle Event Listeners ---

// View Mode button
if (viewModeBtn) {
    viewModeBtn.onclick = () => setMode('view');
}

// Point Mode button
if (pointModeBtn) {
    pointModeBtn.onclick = () => setMode('point');
}

// Line Mode button
if (lineModeBtn) {
    lineModeBtn.onclick = () => setMode('line');
}

// Polygon Mode button
if (polygonModeBtn) {
    polygonModeBtn.onclick = () => setMode('polygon');
}

// Rectangle Mode button
if (rectangleModeBtn) {
    rectangleModeBtn.onclick = () => setMode('rectangle');
}

// --- Image Browser Sidebar ---

// Sidebar state variable
let imageBrowserExpanded = false;

// Restore sidebar state from vscode state
if (vscodeState && vscodeState.imageBrowserExpanded !== undefined) {
    imageBrowserExpanded = vscodeState.imageBrowserExpanded;
    if (imageBrowserExpanded && imageBrowserSidebar) {
        imageBrowserSidebar.classList.remove('collapsed');
    }
}

// Toggle image browser sidebar
if (imageBrowserToggleBtn && imageBrowserSidebar) {
    imageBrowserToggleBtn.onclick = () => {
        imageBrowserExpanded = !imageBrowserExpanded;
        const state = vscode.getState() || {};
        if (imageBrowserExpanded) {
            imageBrowserSidebar.classList.remove('collapsed');
            // Restore saved width if available
            if (state.leftSidebarWidth) {
                imageBrowserSidebar.style.width = state.leftSidebarWidth + 'px';
            }
        } else {
            imageBrowserSidebar.classList.add('collapsed');
            // Clear inline width to ensure CSS collapsed class takes effect
            imageBrowserSidebar.style.width = '';
        }
        // Save state
        state.imageBrowserExpanded = imageBrowserExpanded;
        vscode.setState(state);
    };
}

// Refresh Images button
if (refreshImagesBtn) {
    refreshImagesBtn.onclick = () => {
        vscode.postMessage({ command: 'refreshImages' });
    };
}

// Search Images button - toggle search input visibility
if (searchImagesBtn && searchInputContainer && searchInput) {
    searchImagesBtn.onclick = () => {
        if (searchInputContainer.style.display === 'none') {
            searchInputContainer.style.display = 'flex';
            searchInput.focus();
        } else {
            // Hide and clear search
            searchInputContainer.style.display = 'none';
            searchInput.value = '';
            if (searchCloseBtn) searchCloseBtn.classList.remove('visible');
            filterImages('');
        }
    };
}

// Search input - filter images on input
let searchDebounceTimer = null;
if (searchInput) {
    searchInput.oninput = () => {
        // Toggle inline clear button visibility
        if (searchCloseBtn) {
            searchCloseBtn.classList.toggle('visible', searchInput.value.length > 0);
        }
        // Debounce input to avoid excessive filtering
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(() => {
            filterImages(searchInput.value);
        }, 150);
    };

    // Also handle Enter key to immediately apply filter
    searchInput.onkeydown = (e) => {
        if (e.key === 'Escape') {
            // Hide search on Escape
            searchInputContainer.style.display = 'none';
            searchInput.value = '';
            if (searchCloseBtn) searchCloseBtn.classList.remove('visible');
            filterImages('');
        }
    };
}

// Inline clear button — clears text but keeps the search field open (macOS pattern)
if (searchCloseBtn && searchInputContainer && searchInput) {
    searchCloseBtn.onclick = () => {
        searchInput.value = '';
        searchCloseBtn.classList.remove('visible');
        filterImages('');
        searchInput.focus();
    };
}

// Render image browser list with virtual scrolling
// Virtual scrolling constants
const VIRTUAL_ITEM_HEIGHT = 24; // Approximate height of each item in pixels
const VIRTUAL_BUFFER_SIZE = 10; // Extra items to render above/below viewport

// Virtual scrolling state
let virtualScrollState = {
    startIndex: 0,
    endIndex: 0,
    scrollTop: 0
};

// Search state
let searchQuery = '';
let filteredImages = []; // Filtered image list when search is active

// Get the effective image list (filtered or full)
function getEffectiveImageList() {
    if (searchQuery && filteredImages.length >= 0) {
        return filteredImages;
    }
    return typeof workspaceImages !== 'undefined' ? workspaceImages : [];
}

// Update image count display with current position: (current/total) or (current/filtered/total)
function updateImageCount() {
    const imageCountEl = document.getElementById('imageCount');
    if (!imageCountEl) return;

    const effectiveImages = getEffectiveImageList();
    const total = typeof workspaceImages !== 'undefined' ? workspaceImages.length : 0;
    const currentIndex = effectiveImages.indexOf(currentImageRelativePathMutable);

    if (currentIndex === -1) {
        // Position unknown — show count only
        imageCountEl.textContent = searchQuery
            ? `(${effectiveImages.length}/${total})`
            : `(${total})`;
    } else {
        const currentPos = currentIndex + 1;
        imageCountEl.textContent = searchQuery
            ? `(${currentPos}/${effectiveImages.length}/${total})`
            : `(${currentPos}/${total})`;
    }
}

// Filter images based on search query
function filterImages(query) {
    searchQuery = query.toLowerCase().trim();
    if (!searchQuery) {
        filteredImages = [];
    } else {
        filteredImages = workspaceImages.filter(img =>
            img.toLowerCase().includes(searchQuery)
        );
    }

    // Save search state
    const state = vscode.getState() || {};
    state.searchQuery = searchQuery;
    vscode.setState(state);

    // Update image count display
    updateImageCount();
    // Reset virtual scroll state and re-render
    virtualScrollState = {
        startIndex: -1,
        endIndex: -1,
        scrollTop: 0
    };
    renderImageBrowserList();
}

// Restore search state if available
if (vscodeState && vscodeState.searchQuery) {
    const savedQuery = vscodeState.searchQuery;
    if (searchInput && searchInputContainer) {
        searchInput.value = savedQuery;
        searchInputContainer.style.display = 'flex';
        // Show inline clear (×) since the restored value is non-empty
        if (searchCloseBtn && savedQuery.length > 0) {
            searchCloseBtn.classList.add('visible');
        }
        // Apply filter immediately (without saving state again initially)
        searchQuery = savedQuery.toLowerCase().trim();
        filteredImages = workspaceImages.filter(img =>
            img.toLowerCase().includes(searchQuery)
        );

        // Update count immediately
        updateImageCount();
    }
} else {
    // If no search query, ensure UI is reset (though it should be hidden by default in HTML)
    if (searchInput) searchInput.value = '';
    if (searchInputContainer) searchInputContainer.style.display = 'none';
}

function renderImageBrowserList() {
    if (!imageBrowserList || typeof workspaceImages === 'undefined') return;

    // Clear existing content
    imageBrowserList.innerHTML = '';

    // Use effective image list (filtered or full)
    const effectiveImages = getEffectiveImageList();

    // Show scanning state if list is empty, no search is active, and scan hasn't completed yet
    if (effectiveImages.length === 0 && !searchQuery && !scanComplete) {
        // Just update the count area — no extra UI elements needed
        const imageCountEl = document.getElementById('imageCount');
        if (imageCountEl) {
            imageCountEl.textContent = '(scanning...)';
        }
        return;
    }

    // Create virtual scroll container structure
    // We need a container that maintains the full scroll height
    const totalHeight = effectiveImages.length * VIRTUAL_ITEM_HEIGHT;

    // Create a spacer element to maintain scroll height
    const spacer = document.createElement('div');
    spacer.className = 'virtual-scroll-spacer';
    spacer.style.height = `${totalHeight}px`;
    spacer.style.position = 'relative';
    imageBrowserList.appendChild(spacer);

    // Initial render
    updateVirtualScroll();

    // Scroll to active item on first render
    const currentState = vscode.getState() || {};
    if (currentState.skipNextScroll && currentState.savedScrollTop !== undefined) {
        imageBrowserList.scrollTop = currentState.savedScrollTop;
        currentState.skipNextScroll = false;
        currentState.savedScrollTop = undefined;
        vscode.setState(currentState);
    } else if (imageBrowserExpanded) {
        scrollToActiveItem();
    }
}

function updateVirtualScroll() {
    if (!imageBrowserList || typeof workspaceImages === 'undefined') return;

    const spacer = imageBrowserList.querySelector('.virtual-scroll-spacer');
    if (!spacer) return;

    // Use effective image list (filtered or full)
    const effectiveImages = getEffectiveImageList();

    const scrollTop = imageBrowserList.scrollTop;
    const viewportHeight = imageBrowserList.clientHeight;

    // Calculate visible range
    const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ITEM_HEIGHT) - VIRTUAL_BUFFER_SIZE);
    const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ITEM_HEIGHT);
    const endIndex = Math.min(effectiveImages.length, startIndex + visibleCount + VIRTUAL_BUFFER_SIZE * 2);

    // Check if we need to re-render (only if range changed significantly)
    if (startIndex === virtualScrollState.startIndex &&
        endIndex === virtualScrollState.endIndex) {
        return; // No need to update
    }

    virtualScrollState.startIndex = startIndex;
    virtualScrollState.endIndex = endIndex;
    virtualScrollState.scrollTop = scrollTop;

    // Hide any pending tooltip first: we're about to detach the row that
    // owns the queued hover timer, and show() on a detached node measures
    // a zero-rect and lands the tip at viewport (0, 0).
    if (window.tooltip) window.tooltip.hide();

    // Clear existing items (but keep spacer)
    const existingItems = spacer.querySelectorAll('.image-browser-item');
    existingItems.forEach(item => item.remove());

    // Create fragment for new items
    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
        const imagePath = effectiveImages[i];
        const li = document.createElement('li');
        li.className = 'image-browser-item';
        li.style.position = 'absolute';
        li.style.top = `${i * VIRTUAL_ITEM_HEIGHT}px`;
        li.style.left = '0';
        li.style.right = '0';
        li.style.height = `${VIRTUAL_ITEM_HEIGHT}px`;
        li.style.boxSizing = 'border-box';

        // Highlight current image (use mutable path for updates)
        if (imagePath === currentImageRelativePathMutable) {
            li.classList.add('active');
        }

        // Use relative path as display name. Path itself is the most useful
        // hover content when the row truncates, so route through the rich
        // tooltip via data-tip-text rather than a native title bubble.
        li.textContent = imagePath;
        li.setAttribute('data-tip-text', imagePath);

        // Store data attribute for click handling
        li.dataset.imagePath = imagePath;
        li.dataset.index = i;

        li.onclick = () => {
            // Save scroll position
            const state = vscode.getState() || {};
            state.savedScrollTop = imageBrowserList.scrollTop;
            state.skipNextScroll = true;
            vscode.setState(state);

            vscode.postMessage({
                command: 'navigateToImage',
                imagePath: imagePath
            });
        };

        fragment.appendChild(li);
    }

    spacer.appendChild(fragment);

    // Bind rich tooltips to the freshly-rendered virtual rows. attach() is
    // idempotent so it tolerates being called every scroll tick.
    if (window.tooltip && window.TIPS) window.tooltip.attach(spacer, window.TIPS);
}

// Scroll handler for virtual scrolling (throttled)
let virtualScrollRAF = null;
if (imageBrowserList) {
    imageBrowserList.addEventListener('scroll', () => {
        if (virtualScrollRAF) return;
        virtualScrollRAF = requestAnimationFrame(() => {
            updateVirtualScroll();
            virtualScrollRAF = null;
        });
    });
}

// Scroll to active item helper
function scrollToActiveItem() {
    if (!imageBrowserList || typeof workspaceImages === 'undefined') return;

    const currentIndex = workspaceImages.indexOf(currentImageRelativePathMutable);
    if (currentIndex !== -1) {
        const targetScrollTop = currentIndex * VIRTUAL_ITEM_HEIGHT - imageBrowserList.clientHeight / 2 + VIRTUAL_ITEM_HEIGHT / 2;
        imageBrowserList.scrollTop = Math.max(0, targetScrollTop);
    }
}

// Image browser resizer logic
let isResizingImageBrowser = false;

if (imageBrowserResizer && imageBrowserSidebar) {
    imageBrowserResizer.addEventListener('mousedown', (e) => {
        isResizingImageBrowser = true;
        imageBrowserResizer.classList.add('resizing');
        imageBrowserSidebar.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizingImageBrowser) return;
    const newWidth = e.clientX;
    if (newWidth > 150 && newWidth < 500 && imageBrowserSidebar) {
        imageBrowserSidebar.style.width = newWidth + 'px';
    }
});

document.addEventListener('mouseup', () => {
    if (isResizingImageBrowser) {
        isResizingImageBrowser = false;
        if (imageBrowserResizer) {
            imageBrowserResizer.classList.remove('resizing');
        }
        if (imageBrowserSidebar) {
            imageBrowserSidebar.classList.remove('resizing');
            // Save left sidebar width
            const state = vscode.getState() || {};
            state.leftSidebarWidth = imageBrowserSidebar.offsetWidth;
            vscode.setState(state);
        }
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
    }
});

// Initialize image browser list
renderImageBrowserList();

// Signal the extension that the webview is fully initialized and ready to receive messages.
// This is critical: postMessage from the extension can be lost if sent before
// the webview's JavaScript has finished loading and set up its message listener.
vscode.postMessage({ command: 'webviewReady' });

// Restore saved sidebar widths
(function restoreSidebarWidths() {
    const state = vscode.getState() || {};
    if (state.rightSidebarWidth && sidebar) {
        sidebar.style.width = state.rightSidebarWidth + 'px';
    }
    if (state.leftSidebarWidth && imageBrowserSidebar && !imageBrowserSidebar.classList.contains('collapsed')) {
        imageBrowserSidebar.style.width = state.leftSidebarWidth + 'px';
    }
})();

// --- Sidebar Section Resizer Logic ---
// Allows adjustable height ratio between Labels and Instances sections

const sidebarSectionResizer = document.getElementById('sidebarSectionResizer');
const sidebarLabelsSection = document.getElementById('sidebarLabelsSection');
const sidebarInstancesSection = document.getElementById('sidebarInstancesSection');
let isResizingSidebarSection = false;
let sidebarContentHeight = 0;

// Restore saved section ratio
(function restoreSidebarSectionRatio() {
    const state = vscode.getState() || {};
    if (state.labelsSectionRatio !== undefined && sidebarLabelsSection && sidebarInstancesSection) {
        const ratio = state.labelsSectionRatio;
        sidebarLabelsSection.style.flex = `${ratio} 1 0`;
        sidebarInstancesSection.style.flex = `${1 - ratio} 1 0`;
    }
})();

if (sidebarSectionResizer && sidebarLabelsSection && sidebarInstancesSection) {
    sidebarSectionResizer.addEventListener('mousedown', (e) => {
        isResizingSidebarSection = true;
        sidebarSectionResizer.classList.add('resizing');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        // Calculate available height for resizing
        const sidebarContent = sidebarLabelsSection.parentElement;
        if (sidebarContent) {
            sidebarContentHeight = sidebarContent.clientHeight - sidebarSectionResizer.offsetHeight;
        }

        e.preventDefault();
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizingSidebarSection) return;
    if (!sidebarLabelsSection || !sidebarInstancesSection) return;

    const sidebarContent = sidebarLabelsSection.parentElement;
    if (!sidebarContent) return;

    // Get the position relative to the sidebar content
    const rect = sidebarContent.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;

    // Calculate ratio (clamped between 0.1 and 0.9)
    const minHeight = 60; // Minimum section height in pixels
    const maxLabelsHeight = sidebarContentHeight - minHeight;
    const labelsHeight = Math.max(minHeight, Math.min(maxLabelsHeight, relativeY));
    const ratio = labelsHeight / sidebarContentHeight;

    // Apply the new heights using flex
    sidebarLabelsSection.style.flex = `${ratio} 1 0`;
    sidebarInstancesSection.style.flex = `${1 - ratio} 1 0`;
});

document.addEventListener('mouseup', () => {
    if (isResizingSidebarSection) {
        isResizingSidebarSection = false;
        if (sidebarSectionResizer) {
            sidebarSectionResizer.classList.remove('resizing');
        }
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';

        // Save the current ratio to state
        if (sidebarLabelsSection && sidebarInstancesSection) {
            const sidebarContent = sidebarLabelsSection.parentElement;
            if (sidebarContent) {
                const labelsHeight = sidebarLabelsSection.offsetHeight;
                const totalHeight = sidebarContent.clientHeight - sidebarSectionResizer.offsetHeight;
                const ratio = labelsHeight / totalHeight;

                const state = vscode.getState() || {};
                state.labelsSectionRatio = ratio;
                vscode.setState(state);
            }
        }
    }
});

// ============================================================================
// SAM AI Annotation Mode
// ============================================================================

// --- SAM Config Modal ---
const samConfigModal = document.getElementById('samConfigModal');
const samConfigOkBtn = document.getElementById('samConfigOkBtn');
const samConfigCancelBtn = document.getElementById('samConfigCancelBtn');
const samModelDirBrowseBtn = document.getElementById('samModelDirBrowse');
const samPythonPathBrowseBtn = document.getElementById('samPythonPathBrowse');

function showSamConfigModal() {
    const gs = (typeof initialGlobalSettings !== 'undefined') ? initialGlobalSettings : {};
    const savedState = vscode.getState() || {};

    const modelDirInput = document.getElementById('samModelDir');
    const pythonPathInput = document.getElementById('samPythonPath');
    const portInput = document.getElementById('samPort');

    if (modelDirInput) modelDirInput.value = savedState.samModelDir ?? gs.samModelDir ?? '';
    if (pythonPathInput) pythonPathInput.value = savedState.samPythonPath ?? gs.samPythonPath ?? '';
    if (portInput) portInput.value = savedState.samPort ?? gs.samPort ?? 8765;

    const restoreRadio = (name, savedValue) => {
        if (!savedValue) return;
        const radio = document.querySelector(`input[name="${name}"][value="${savedValue}"]`);
        if (radio) radio.checked = true;
    };
    restoreRadio('samDevice', savedState.samDevice ?? gs.samDevice);
    restoreRadio('samEncodeMode', savedState.samEncodeMode ?? gs.samEncodeMode ?? 'full');

    // Trigger GPU detection if GPU is selected
    const gpuGroup = document.getElementById('samGpuIndexGroup');
    const selectedDevice = document.querySelector('input[name="samDevice"]:checked')?.value || 'cpu';
    // Store pending GPU index to restore after detection result arrives
    const pendingSamGpuIndex = savedState.samGpuIndex ?? gs.samGpuIndex ?? -1;
    if (selectedDevice === 'gpu') {
        const samGpuGroup = document.getElementById('samGpuIndexGroup');
        if (samGpuGroup) samGpuGroup.__pendingGpuIndex = pendingSamGpuIndex;
        vscode.postMessage({ command: 'detectGpuCount' });
    } else if (gpuGroup) {
        gpuGroup.style.display = 'none';
    }

    if (samConfigModal) samConfigModal.style.display = 'flex';
    if (modelDirInput && !modelDirInput.value) modelDirInput.focus();
}

function hideSamConfigModal() {
    if (samConfigModal) samConfigModal.style.display = 'none';
}

function submitSamConfig() {
    const modelDir = document.getElementById('samModelDir')?.value.trim() || '';
    const pythonPath = document.getElementById('samPythonPath')?.value.trim() || '';
    const device = document.querySelector('input[name="samDevice"]:checked')?.value || 'cpu';
    const port = parseInt(document.getElementById('samPort')?.value) || 8765;
    const encodeMode = document.querySelector('input[name="samEncodeMode"]:checked')?.value || 'full';
    const gpuSelect = document.getElementById('samGpuIndex');
    const gpuGroup = document.getElementById('samGpuIndexGroup');
    // Use dropdown value if populated, otherwise fall back to saved/persisted index
    const samSavedState = vscode.getState() || {};
    const gpuIndex = (device === 'gpu')
        ? (gpuGroup && gpuGroup.style.display !== 'none' && gpuSelect
            ? parseInt(gpuSelect.value)
            : (samSavedState.samGpuIndex ?? (typeof initialGlobalSettings !== 'undefined' ? initialGlobalSettings.samGpuIndex : undefined) ?? 0))
        : undefined;

    if (!modelDir) {
        const input = document.getElementById('samModelDir');
        if (input) input.focus();
        return;
    }

    // Persist settings
    const settings = { samModelDir: modelDir, samPythonPath: pythonPath, samDevice: device, samPort: port, samEncodeMode: encodeMode, samGpuIndex: gpuIndex ?? -1 };
    const state = vscode.getState() || {};
    Object.assign(state, settings);
    vscode.setState(state);
    for (const [key, value] of Object.entries(settings)) {
        vscode.postMessage({ command: 'saveGlobalSettings', key, value });
    }

    samServicePort = port;
    samEncodeMode = encodeMode;

    // Send to extension to start service
    vscode.postMessage({
        command: 'samStartService',
        config: { modelDir, pythonPath, device, port, gpuIndex }
    });

    hideSamConfigModal();

    // Now enter SAM mode
    currentMode = 'sam';
    saveState();
    updateModeButtons();
    draw();

    // Wait briefly for service to start, then mark running
    setTimeout(() => {
        samPingService().then(ok => {
            samServiceRunning = ok;
        });
    }, 3000);
}

if (samConfigOkBtn) samConfigOkBtn.addEventListener('click', submitSamConfig);
if (samConfigCancelBtn) samConfigCancelBtn.addEventListener('click', hideSamConfigModal);
if (samModelDirBrowseBtn) {
    samModelDirBrowseBtn.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseSamModelDir',
            currentValue: document.getElementById('samModelDir')?.value.trim() || ''
        });
    });
}
if (samPythonPathBrowseBtn) {
    samPythonPathBrowseBtn.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseSamPythonPath',
            currentValue: document.getElementById('samPythonPath')?.value.trim() || ''
        });
    });
}
if (samConfigModal) {
    samConfigModal.addEventListener('click', (e) => {
        if (e.target === samConfigModal) hideSamConfigModal();
    });
}
// Device radio change: toggle GPU index dropdown
document.querySelectorAll('input[name="samDevice"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const gpuGroup = document.getElementById('samGpuIndexGroup');
        if (e.target.value === 'gpu') {
            vscode.postMessage({ command: 'detectGpuCount' });
        } else if (gpuGroup) {
            gpuGroup.style.display = 'none';
        }
    });
});
// Enter/Escape in SAM config modal
const samModelDirInput_ = document.getElementById('samModelDir');
if (samModelDirInput_) {
    samModelDirInput_.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitSamConfig();
        if (e.key === 'Escape') hideSamConfigModal();
    });
}

// --- SAM Service Communication ---

async function samPingService() {
    try {
        const resp = await fetch(`http://127.0.0.1:${samServicePort}/ping`, { signal: AbortSignal.timeout(100) });
        const data = await resp.json();
        return data.ok === true;
    } catch {
        return false;
    }
}

let samEncodePromise = null; // Serialization chain for encode requests

// Calculate the current visible viewport region in original image coordinates
function samGetVisibleCrop() {
    const scrollX = canvasContainer.scrollLeft;
    const scrollY = canvasContainer.scrollTop;
    const viewportW = canvasContainer.clientWidth;
    const viewportH = canvasContainer.clientHeight;

    const imageW = img.width * zoomLevel;
    const imageH = img.height * zoomLevel;

    // If image fits in viewport (no scroll needed), return null (use full image)
    if (imageW <= viewportW && imageH <= viewportH) {
        return null;
    }

    // Calculate crop in original image coordinates
    // Store both integer bounds (for backend raster extraction) and true floating origin
    // (for accurate prompt/contour coordinate translation)
    const originX = scrollX / zoomLevel;
    const originY = scrollY / zoomLevel;

    let x = Math.floor(originX);
    let y = Math.floor(originY);
    let right = Math.ceil((scrollX + viewportW) / zoomLevel);
    let bottom = Math.ceil((scrollY + viewportH) / zoomLevel);

    // Clamp to image bounds
    x = Math.max(0, Math.min(x, img.width - 1));
    y = Math.max(0, Math.min(y, img.height - 1));
    right = Math.min(right, img.width);
    bottom = Math.min(bottom, img.height);

    let w = right - x;
    let h = bottom - y;

    return { x, y, w, h, originX, originY };
}

// Check if a point (in original image coords) falls within a crop region
function samPointInCrop(px, py, crop) {
    if (!crop) return true; // No crop = full image, always in range
    return px >= crop.originX && px <= crop.originX + crop.w &&
        py >= crop.originY && py <= crop.originY + crop.h;
}

async function samEncode(imagePath, crop) {
    // If an encode is already in flight, wait for it to finish, then re-check
    if (samEncodePromise) {
        await samEncodePromise;
        // After previous encode settled, check if cache matches
        if (samCurrentImagePath === imagePath &&
            JSON.stringify(samCachedCrop) === JSON.stringify(crop)) return;
    }

    const doEncode = async () => {
        samIsEncoding = true;
        window.notifyBus.show('info', 'SAM Encoding…', { sticky: true, key: 'sam.status' });
        try {
            const payload = { image_path: imagePath };
            if (crop) payload.crop = crop;

            const resp = await fetch(`http://127.0.0.1:${samServicePort}/encode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.ok) {
                samCurrentImagePath = imagePath;
                samCachedCrop = crop || null;
                const modeLabel = crop ? 'Local' : 'Full';
                window.notifyBus.show('success', `SAM Ready [${modeLabel}] (${data.time_ms || 0}ms)`, { sticky: true, key: 'sam.status' });
            } else {
                window.notifyBus.show('error', 'SAM Encode Error');
                window.notifyBus.clearSticky('sam.status');
            }
        } catch (err) {
            window.notifyBus.show('error', 'SAM Service Error');
            window.notifyBus.clearSticky('sam.status');
        } finally {
            samIsEncoding = false;
            samEncodePromise = null;
        }
    };

    samEncodePromise = doEncode();
    await samEncodePromise;
}

async function samDecode() {
    if (samPrompts.length === 0) return;

    // Capture version BEFORE any async work to detect state changes during encode
    const preEncodeVersion = samDecodeVersion;

    // Determine encode parameters based on mode
    const requestPath = currentAbsoluteImagePath || imagePath;
    let requestCrop = null;
    if (samEncodeMode === 'local') {
        requestCrop = samGetVisibleCrop(); // null if no scrollbars (falls back to full)
    }

    // Lazy encode: ensure current image is encoded before first decode
    // In local mode, also re-encode when:
    //   1. This is a fresh sequence AND the current viewport crop differs from cached
    //   2. Any prompt falls outside the existing cached crop (user scrolled away)
    let needEncode = (samCurrentImagePath !== requestPath);
    if (!needEncode && samEncodeMode === 'local') {
        const cropMismatched = JSON.stringify(requestCrop) !== JSON.stringify(samCachedCrop);

        if (samIsFreshSequence && cropMismatched) {
            // Fresh sequence: safe to adopt current viewport as new crop
            needEncode = true;
        } else {
            // Sequence in progress: stick to the existing cached crop to avoid orphaning old prompts.
            // Only re-encode if a prompt actually falls outside that cached region.
            for (const prompt of samPrompts) {
                if (prompt.type === 'point') {
                    if (!samPointInCrop(prompt.data[0], prompt.data[1], samCachedCrop)) {
                        needEncode = true;
                        break;
                    }
                } else if (prompt.type === 'rectangle') {
                    if (!samPointInCrop(prompt.data[0], prompt.data[1], samCachedCrop) ||
                        !samPointInCrop(prompt.data[2], prompt.data[3], samCachedCrop)) {
                        needEncode = true;
                        break;
                    }
                }
            }

            // If re-encoding is needed because prompts were outside, clear older prompts.
            if (needEncode) {
                samPrompts = [samPrompts[samPrompts.length - 1]]; // Keep only the latest prompt
                samMaskContour = null;
                samIsFreshSequence = true; // We are essentially starting over
                // Prompts mutated — refresh Shift feedback in case the routing
                // role flipped (e.g. trimmed away the only positive prompt).
                updateShiftFeedback();
            }
        }
    }

    if (needEncode) {
        await samEncode(requestPath, requestCrop);
        // After encode success/fail, reset fresh flag (it will be true again on clear/confirm)
        samIsFreshSequence = false;
        // After encode, revalidate: has the state been cleared or image changed?
        if (preEncodeVersion !== samDecodeVersion) return;
        const activePath = currentAbsoluteImagePath || imagePath;
        if (activePath !== requestPath) return;
        if (samCurrentImagePath !== requestPath) return;
    }

    // Translate prompt coordinates using floating origin if crop is active
    let decodedPrompts = samPrompts;
    if (samCachedCrop) {
        decodedPrompts = samPrompts.map(p => {
            if (p.type === 'point') {
                return { ...p, data: [p.data[0] - samCachedCrop.originX, p.data[1] - samCachedCrop.originY] };
            } else if (p.type === 'rectangle') {
                return {
                    ...p, data: [
                        p.data[0] - samCachedCrop.originX, p.data[1] - samCachedCrop.originY,
                        p.data[2] - samCachedCrop.originX, p.data[3] - samCachedCrop.originY
                    ]
                };
            }
            return p;
        });
    }

    // Capture version at request time to detect stale responses
    const requestVersion = ++samDecodeVersion;
    samIsDecoding = true;
    try {
        const resp = await fetch(`http://127.0.0.1:${samServicePort}/decode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompts: decodedPrompts })
        });
        const data = await resp.json();
        // Only apply if this is still the latest request
        if (requestVersion !== samDecodeVersion) return;
        if (data.ok) {
            // Translate contour coordinates back to full-image space using floating origin
            if (samCachedCrop && data.contour) {
                samMaskContour = data.contour.map(p => [p[0] + samCachedCrop.originX, p[1] + samCachedCrop.originY]);
            } else {
                samMaskContour = data.contour;
            }
            const modeLabel = samCachedCrop ? 'Local' : 'Full';
            window.notifyBus.show('success', `SAM Decoded [${modeLabel}] (${data.time_ms || 0}ms)`, { sticky: true, key: 'sam.status' });
            draw();
            // Note: don't call updateShiftFeedback here — samDecode doesn't
            // mutate samPrompts, so feedback content is unchanged. Calling it
            // would only clobber the decode status message during Shift hold.
        }
    } catch (err) {
        if (requestVersion !== samDecodeVersion) return;
        window.notifyBus.show('error', 'SAM Decode Error');
    } finally {
        samIsDecoding = false;
    }
}

// --- SAM Mode Logic ---

function samClearState() {
    samDecodeVersion++;  // Invalidate any in-flight decode
    samPrompts = [];
    samMaskContour = null;
    samIsDragging = false;
    samDragStart = null;
    samDragCurrent = null;
    samBoxSecondClick = false;
    samMouseDownTime = 0;
    samCachedCrop = null;
    samCurrentImagePath = null;
    samIsFreshSequence = true;
    if (window.notifyBus) window.notifyBus.clearSticky('sam.status');
    draw();
    updateShiftFeedback();
}

async function samCheckAndEnterMode() {
    // Restore port and encode mode from saved state
    const savedState = vscode.getState() || {};
    const gs = (typeof initialGlobalSettings !== 'undefined') ? initialGlobalSettings : {};
    samServicePort = savedState.samPort ?? gs.samPort ?? 8765;
    samEncodeMode = savedState.samEncodeMode ?? gs.samEncodeMode ?? 'full';

    // Try to ping the service
    const ok = await samPingService();
    if (ok) {
        samServiceRunning = true;
        currentMode = 'sam';
        saveState();
        updateModeButtons();
        draw();
    } else {
        // Show config modal
        showSamConfigModal();
    }
}

function updateShiftFeedback() {
    if (!shiftPressed || currentMode === 'view') {
        if (window.notifyBus) window.notifyBus.clearSticky('shift.feedback');
        // Cursor reset: clear inline style and let the existing mousemove logic re-derive
        currentCursor = null;
        canvasWrapper.style.cursor = '';
        return;
    }

    // Positional signature: computeShiftFeedback(currentMode, prompts, eraserCursor) → { text, color, cursor }
    const { text, color, cursor } = computeShiftFeedback(currentMode, samPrompts, ERASER_CURSOR_DATA_URI);

    canvasWrapper.style.cursor = cursor;
    currentCursor = cursor;

    // Map the legacy hex colors to severity. #ff4444 is the negative-point hint
    // (treat as warn — informational caution, not an error), #ff8800 the eraser
    // hint. Anything else falls back to info.
    const level = color === '#ff4444' ? 'warn' : (color === '#ff8800' ? 'warn' : 'info');
    if (window.notifyBus) window.notifyBus.show(level, text, { sticky: true, key: 'shift.feedback' });
}

function samUndoLastPrompt() {
    if (samPrompts.length > 0) {
        samPrompts.pop();
        samPrompts = cleanupOrphanNegatives(samPrompts);
        if (samPrompts.length === 0) {
            samDecodeVersion++;  // Invalidate any in-flight decode
            samMaskContour = null;
            samCachedCrop = null;
            samCurrentImagePath = null;
            samIsFreshSequence = true;
            draw();
        } else {
            samDecode();
        }
    }
    updateShiftFeedback();
}

let samSavedStateBeforeConfirm = null; // For restoring on modal cancel

function samConfirmAnnotation() {
    if (!samMaskContour || samMaskContour.length < 3) return;

    // Save SAM state so we can restore if user cancels the label modal
    samSavedStateBeforeConfirm = {
        prompts: JSON.parse(JSON.stringify(samPrompts)),
        maskContour: JSON.parse(JSON.stringify(samMaskContour)),
        cachedCrop: samCachedCrop ? JSON.parse(JSON.stringify(samCachedCrop)) : null,
        isFreshSequence: samIsFreshSequence,
        currentImagePath: samCurrentImagePath
    };

    // Convert mask contour to polygon points
    currentPoints = samMaskContour.map(p => [p[0], p[1]]);
    currentMode = 'sam'; // Stay in SAM mode

    // Clear SAM prompt state but keep service running
    samPrompts = [];
    samMaskContour = null;
    samIsDragging = false;
    samDragStart = null;
    samDragCurrent = null;
    samCachedCrop = null;
    samCurrentImagePath = null;
    samIsFreshSequence = true;

    // Show label modal (same as finishPolygon)
    isDrawing = false;
    updateShiftFeedback();
    showLabelModal();
}

// --- SAM Mouse Events ---

let samClickTimer = null; // Timer to debounce single-click vs double-click
let samPendingClick = null; // Pending click data

// SAM mousedown handler (integrate into existing canvasWrapper mousedown)
canvasWrapper.addEventListener('mousedown', (e) => {
    if (currentMode !== 'sam' || e.button !== 0) return;

    // Skip if event was already consumed by another capture-phase handler (e.g. edit mode exit)
    if (e.defaultPrevented) return;

    // Defer to the main handler when the eraser owns the click stream
    // (eraser mid-draw, or shift+empty starting a new eraser).
    if (samShouldDeferToMainHandler({
        shiftKey: e.shiftKey,
        eraserActive,
        samBoxSecondClick,
        prompts: samPrompts
    })) {
        return;
    }

    // If click is on the context menu itself, let it handle the click
    if (shapeContextMenu && shapeContextMenu.contains(e.target)) {
        return;
    }

    // If context menu is visible and click is outside it, hide it and consume the event
    // so it doesn't start a SAM annotation
    if (shapeContextMenu && shapeContextMenu.style.display !== 'none') {
        hideShapeContextMenu();
        e.stopPropagation();
        e.preventDefault();
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomLevel;
    const y = (e.clientY - rect.top) / zoomLevel;

    // If waiting for second click to complete box, finalize the box
    if (samBoxSecondClick) {
        if (!samDragStart) {
            // Guard: samDragStart was cleared (e.g. by image navigation)
            samBoxSecondClick = false;
            samIsDragging = false;
            return;
        }
        // Clamp both corners to image bounds — the cursor may have ended up in the padding ring.
        const [cx, cy] = clampImageCoords(x, y);
        const [csx, csy] = clampImageCoords(samDragStart.x, samDragStart.y);
        const x1 = Math.min(csx, cx);
        const y1 = Math.min(csy, cy);
        const x2 = Math.max(csx, cx);
        const y2 = Math.max(csy, cy);

        samPrompts = mergeBoxIntoPrompts(samPrompts, { type: 'rectangle', data: [x1, y1, x2, y2] });
        samBoxSecondClick = false;
        samDragStart = null;
        samDragCurrent = null;
        samIsDragging = false;
        draw();
        updateShiftFeedback();
        samDecode();
        e.stopPropagation();
        e.preventDefault();
        return;
    }

    // If SAM is idle (no prompts, no mask, no pending click), check if clicking
    // on an existing shape. If so, let the main mousedown handler select it.
    if (samPrompts.length === 0 && !samMaskContour && !samPendingClick && !samClickTimer) {
        const overlappingShapes = findAllShapesAt(x, y);
        if (overlappingShapes.length > 0) {
            return; // Don't stopPropagation — main handler will select the shape
        }
    }

    // Clear any existing shape selection since we're starting SAM interaction
    if (selectedShapeIndices.size > 0) {
        clearSelection();
        renderShapeList();
        draw();
    }

    // Record drag start and time for long-press detection
    samIsDragging = false;
    samDragStart = { x, y };
    samDragCurrent = { x, y };
    samMouseDownTime = Date.now();

    e.stopPropagation();
    e.preventDefault();
}, true); // Use capture phase to run before main mousedown handler

canvasWrapper.addEventListener('mousemove', (e) => {
    if (currentMode !== 'sam' || !samDragStart) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomLevel;
    const y = (e.clientY - rect.top) / zoomLevel;

    // Box mode waiting for second click: update preview
    if (samBoxSecondClick) {
        samDragCurrent = { x, y };
        draw();
        return;
    }

    // Initial drag detection
    const dx = x - samDragStart.x;
    const dy = y - samDragStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > SAM_DRAG_THRESHOLD) {
        samIsDragging = true;
        samDragCurrent = { x, y };
        // Draw drag rectangle preview
        draw();
    }
});

canvasWrapper.addEventListener('mouseup', (e) => {
    if (currentMode !== 'sam' || e.button !== 0 || !samDragStart) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomLevel;
    const y = (e.clientY - rect.top) / zoomLevel;

    const elapsed = Date.now() - samMouseDownTime;
    const isLongPress = elapsed >= SAM_LONG_PRESS_MS;

    if (samIsDragging || isLongPress) {
        // Long press or drag: enter box mode, wait for second click
        samBoxSecondClick = true;
        samDragCurrent = { x, y };
        samIsDragging = true; // Ensure drag preview shows
        draw();
    } else {
        // Click (not drag): defer to distinguish from double-click
        const shiftKey = e.shiftKey;
        samDragStart = null;
        samDragCurrent = null;

        // Cancel any pending click timer
        if (samClickTimer) {
            clearTimeout(samClickTimer);
            samClickTimer = null;
        }

        // Store pending click; process after 200ms if no dblclick fires
        samPendingClick = { x, y, shiftKey };
        samClickTimer = setTimeout(() => {
            if (samPendingClick) {
                const label = samPendingClick.shiftKey ? 0 : 1;
                const [spx, spy] = clampImageCoords(samPendingClick.x, samPendingClick.y);
                samPrompts.push({ type: 'point', data: [spx, spy], label: label });
                samPendingClick = null;
                draw();
                updateShiftFeedback();
                samDecode();
            }
            samClickTimer = null;
        }, 200);
    }

    e.stopPropagation();
    e.preventDefault();
});

// SAM double-click to confirm
canvasWrapper.addEventListener('dblclick', (e) => {
    if (currentMode !== 'sam' || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Cancel pending single-click timer to prevent adding unwanted point
    if (samClickTimer) {
        clearTimeout(samClickTimer);
        samClickTimer = null;
        samPendingClick = null;
    }

    samConfirmAnnotation();
});

// SAM mode button click
if (samModeBtn) {
    samModeBtn.addEventListener('click', () => setMode('sam'));
}

// When image changes, clear SAM prompts (encoder cache will be refreshed on next interaction)
const originalHandleImageUpdate = handleImageUpdate;
window._samOnImageUpdate = function () {
    if (currentMode === 'sam') {
        samDecodeVersion++;  // Invalidate any in-flight decode
        samPrompts = [];
        samMaskContour = null;
        samIsDragging = false;
        samDragStart = null;
        samDragCurrent = null;
        samBoxSecondClick = false;
        samMouseDownTime = 0;
        samCachedCrop = null;
        // Clear samCurrentImagePath so lazy encode triggers on next interaction
        samCurrentImagePath = null;
        updateShiftFeedback();
    }
};
// Patch handleImageUpdate
const _origHandleImageUpdate = handleImageUpdate;
handleImageUpdate = function (message) {
    _origHandleImageUpdate(message);
    if (window._samOnImageUpdate) window._samOnImageUpdate();
};

// --- SAM SVG Drawing ---

function drawSAMOverlay() {
    const sw = borderWidth / zoomLevel; // Scale-independent stroke width

    // Draw mask contour
    if (samMaskContour && samMaskContour.length >= 3) {
        const polygon = document.createElementNS(SVG_NS, 'polygon');
        const pointsStr = samMaskContour.map(p => `${p[0]},${p[1]}`).join(' ');
        polygon.setAttribute('points', pointsStr);
        polygon.setAttribute('fill', 'rgba(30, 144, 255, 0.35)');
        polygon.setAttribute('stroke', 'rgba(30, 144, 255, 0.9)');
        polygon.setAttribute('stroke-width', sw * 1.5);
        polygon.style.pointerEvents = 'none';
        svgOverlay.appendChild(polygon);
    }

    // Draw prompts
    samPrompts.forEach(prompt => {
        if (prompt.type === 'point') {
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', prompt.data[0]);
            circle.setAttribute('cy', prompt.data[1]);
            circle.setAttribute('r', 6 / zoomLevel);
            if (prompt.label === 1) {
                // Positive: green
                circle.setAttribute('fill', 'rgba(0, 255, 0, 0.8)');
                circle.setAttribute('stroke', 'white');
            } else {
                // Negative: red
                circle.setAttribute('fill', 'rgba(255, 0, 0, 0.8)');
                circle.setAttribute('stroke', 'white');
            }
            circle.setAttribute('stroke-width', sw * 0.5);
            circle.style.pointerEvents = 'none';
            svgOverlay.appendChild(circle);
        } else if (prompt.type === 'rectangle') {
            const [x1, y1, x2, y2] = prompt.data;
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', x1);
            rect.setAttribute('y', y1);
            rect.setAttribute('width', x2 - x1);
            rect.setAttribute('height', y2 - y1);
            rect.setAttribute('fill', 'rgba(0, 200, 0, 0.1)');
            rect.setAttribute('stroke', 'rgba(0, 200, 0, 0.8)');
            rect.setAttribute('stroke-width', sw);
            rect.setAttribute('stroke-dasharray', `${4 / zoomLevel}`);
            rect.style.pointerEvents = 'none';
            svgOverlay.appendChild(rect);
        }
    });

    // Draw drag-in-progress rectangle
    if (samIsDragging && samDragStart && samDragCurrent) {
        const x1 = Math.min(samDragStart.x, samDragCurrent.x);
        const y1 = Math.min(samDragStart.y, samDragCurrent.y);
        const x2 = Math.max(samDragStart.x, samDragCurrent.x);
        const y2 = Math.max(samDragStart.y, samDragCurrent.y);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x1);
        rect.setAttribute('y', y1);
        rect.setAttribute('width', x2 - x1);
        rect.setAttribute('height', y2 - y1);
        rect.setAttribute('fill', 'rgba(0, 200, 0, 0.1)');
        rect.setAttribute('stroke', 'rgba(0, 200, 0, 0.8)');
        rect.setAttribute('stroke-width', sw);
        rect.setAttribute('stroke-dasharray', `${4 / zoomLevel}`);
        rect.style.pointerEvents = 'none';
        svgOverlay.appendChild(rect);
    }

    // Draw encoded region indicator in local mode
    if (samCachedCrop && samEncodeMode === 'local') {
        const cropRect = document.createElementNS(SVG_NS, 'rect');
        cropRect.setAttribute('x', samCachedCrop.x);
        cropRect.setAttribute('y', samCachedCrop.y);
        cropRect.setAttribute('width', samCachedCrop.w);
        cropRect.setAttribute('height', samCachedCrop.h);
        cropRect.setAttribute('fill', 'none');
        cropRect.setAttribute('stroke', 'rgba(255, 200, 0, 0.5)');
        cropRect.setAttribute('stroke-width', sw);
        cropRect.setAttribute('stroke-dasharray', `${6 / zoomLevel} ${3 / zoomLevel}`);
        cropRect.style.pointerEvents = 'none';
        svgOverlay.appendChild(cropRect);
    }

    // Status indicator
    if (samIsEncoding) {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', 10 / zoomLevel);
        text.setAttribute('y', 30 / zoomLevel);
        text.setAttribute('font-size', `${16 / zoomLevel}px`);
        text.setAttribute('fill', 'orange');
        text.textContent = 'Encoding...';
        text.style.pointerEvents = 'none';
        svgOverlay.appendChild(text);
    }
}
