// LabelEditor webview — DOM references, editor state, and restoring persisted settings at startup.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

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
const circleModeBtn = document.getElementById('circleModeBtn');
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
const advancedSearchBtn = document.getElementById('advancedSearchBtn');
const advancedSearchModal = document.getElementById('advancedSearchModal');
const advSearchConditions = document.getElementById('advSearchConditions');
const advSearchAddName = document.getElementById('advSearchAddName');
const advSearchAddNameRegex = document.getElementById('advSearchAddNameRegex');
const advSearchAddClass = document.getElementById('advSearchAddClass');
const advSearchIndexStatus = document.getElementById('advSearchIndexStatus');
const advSearchRunBtn = document.getElementById('advSearchRunBtn');
const advSearchResetBtn = document.getElementById('advSearchResetBtn');
const advSearchCancelBtn = document.getElementById('advSearchCancelBtn');
const advSearchBanner = document.getElementById('advSearchBanner');
const advSearchBannerText = document.getElementById('advSearchBannerText');
const advSearchBannerClear = document.getElementById('advSearchBannerClear');

// Theme elements
const themeLightBtn = document.getElementById('themeLightBtn');
const themeDarkBtn = document.getElementById('themeDarkBtn');
const themeAutoBtn = document.getElementById('themeAutoBtn');

// YOLO datasets only support view / sam / polygon / rectangle modes.
// Hide the point/line/circle mode buttons (the variables are declared above).
// The description field is also hidden: a YOLO .txt has no place to store it.
if (window.annotationFormat === 'yolo') {
    [pointModeBtn, lineModeBtn, circleModeBtn].forEach(b => { if (b) b.style.display = 'none'; });
    if (descriptionInput) descriptionInput.style.display = 'none';
}

let img = new Image();

let shapes = [];
let currentPoints = [];
let isDrawing = false;
let selectedShapeIndex = -1;
let selectedShapeIndices = new Set(); // Multi-selection set
let hoveredShapeIndex = -1;                       // index of the would-be-selected shape under the cursor (-1 = none)
let overlapCycleState = { members: [], pos: -1 }; // current click-to-cycle stack + position within it
let isBatchRenaming = false; // Whether label modal is renaming multiple shapes
// Description shown when the batch-rename modal opened (the shared one, or ''
// when the selection's descriptions differ). Descriptions are only rewritten
// if the user changes the field, so renaming never wipes them by accident.
let batchRenameInitialDescription = '';
// Box selection state (view mode drag-to-select)
let isBoxSelecting = false;
let boxSelectStart = null;   // {x, y} in image coords
let boxSelectCurrent = null; // {x, y} in image coords
let editingShapeIndex = -1;
let recentLabels = initialGlobalSettings.recentLabels || [];
let managedLabels = initialGlobalSettings.managedLabels || []; // user-added preset labels (may have 0 instances)
let activeLabel = null; // default category for new shapes (★ row in the Labels panel)

// --- Crosshair guide state (drawing modes) ---
let crosshairPos = null;   // {x, y} image coords while the mouse is over the canvas
let crosshairRafId = null; // rAF throttle for crosshair hover redraws
let crosshairEnabled = initialGlobalSettings.crosshairEnabled !== false; // More Settings toggle
const DRAWING_MODES = ['point', 'line', 'polygon', 'rectangle', 'circle'];

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
let samOutputFormat = 'polygon'; // 'polygon' | 'rectangle' — SAM result shape type
let samEncodeAdjusted = false;    // When true, encode the brightness/contrast/CLAHE/channel-adjusted view instead of the original file
let samCachedCrop = null;         // { x, y, w, h } — crop region of the currently cached encoding (null = full image)
let samCachedAdjustSig = null;    // Signature of the adjustment state used for the current cached encoding (null when raw original was encoded)
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
const ERASER_DRAG_THRESHOLD = 5;   // Drag threshold (screen px; divide by zoomLevel when comparing image coords)

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
// scheduleDraw(): coalesce redraws from high-frequency input (mice can report
// 500+ moves/s) into one per animation frame, drawn with the latest event.
let scheduledDrawFrame = null;
let scheduledDrawEvent = null;
function scheduleDraw(e) {
    scheduledDrawEvent = e;
    if (scheduledDrawFrame !== null) return;
    scheduledDrawFrame = requestAnimationFrame(() => {
        scheduledDrawFrame = null;
        const ev = scheduledDrawEvent;
        scheduledDrawEvent = null;
        draw(ev);
    });
}
const colorCache = new Map(); // 颜色计算缓存

// Image load request ID to prevent stale callbacks
let currentImageLoadId = 0;
// True between switching img.src and the new image loading. The element keeps
// the previous picture until then, so drawing would overlay the new image's
// shapes on the old image at the old zoom.
let imageLoadPending = false;

// What the canvas currently shows. The canvas only holds the image (shapes
// live in the SVG overlay, brightness/contrast is a CSS filter), so it needs
// repainting only when the image, its channel/CLAHE processing or the canvas
// size changes — not on every mouse move.
let imageLayerKey = '';

// Completed-shape SVG layer and its per-shape node cache (see drawSVGAnnotations).
const svgShapesLayer = document.createElementNS(SVG_NS, 'g');
let shapeNodeCache = new Map(); // signature -> <g>, from the previous frame

// Label text metrics cache (see measureLabel).
const LABEL_FONT_PX = 12;
const labelMetricsCache = new Map();
let labelMeasureCtx = null;

// Image metadata for info popup (initialImageMetadata is injected via HTML script tag)
let currentImageMetadata = (typeof initialImageMetadata !== 'undefined') ? initialImageMetadata : null;

// 点击位置追踪 - 用于支持点击叠加实例时的循环选择
let lastClickTime = 0;
let lastClickX = 0;
let lastClickY = 0;
const CLICK_THRESHOLD_TIME = 500; // 500ms内视为同一位置的连续点击
const CLICK_THRESHOLD_DISTANCE = 5; // 5 screen px内视为同一位置（图像坐标比较时需除以 zoomLevel）
// True when an Enter keydown only confirms an IME composition (Chinese input
// selecting a candidate) — text inputs must not treat it as submit.
function isImeEnter(e) {
    return e.key === 'Enter' && (e.isComposing || e.keyCode === 229);
}

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
let drawClickThrough = false; // when true, clicks in non-view modes start drawing over existing instances
let showShapeLabels = false;  // when true, draw each instance's class name on the canvas
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
// YOLO mode can't restore a now-hidden mode (point/line/circle) — fall back to view.
if (window.annotationFormat === 'yolo' && ['point', 'line', 'circle'].includes(currentMode)) {
    currentMode = 'view';
}

// Boot i18n locale from persisted settings before any DOM text is read by
// users. applyI18n() is called at the end of init so every static label is
// translated in one pass; subsequent setLocale calls re-run it.
if (window.i18n && initialGlobalSettings.locale) {
    try { window.i18n.setLocale(initialGlobalSettings.locale); } catch (_) { /* fallback to default */ }
}

function applyI18n() {
    if (!window.i18n) return;
    const nodes = document.querySelectorAll('[data-i18n]');
    for (const n of nodes) {
        const key = n.getAttribute('data-i18n');
        if (!key) continue;
        const text = window.i18n.t(key);
        // Only replace text content — never the inner markup. Elements whose
        // children include icons should use a <span data-i18n> wrapping just
        // the textual portion.
        if (n.children.length === 0) {
            n.textContent = text;
        }
    }
    // Placeholder translations on form inputs.
    const phNodes = document.querySelectorAll('[data-i18n-placeholder]');
    for (const n of phNodes) {
        const key = n.getAttribute('data-i18n-placeholder');
        if (!key) continue;
        const text = window.i18n.t(key);
        if (text) n.setAttribute('placeholder', text);
    }
    // Accessible names of icon-only controls.
    for (const n of document.querySelectorAll('[data-i18n-aria-label]')) {
        const text = window.i18n.t(n.getAttribute('data-i18n-aria-label'));
        if (text) n.setAttribute('aria-label', text);
    }
    if (window.tooltip && window.tooltip.refreshAccessibleNames) window.tooltip.refreshAccessibleNames();
}

// Boot the keyboard-binding table. Persisted overrides from initialGlobalSettings
// are merged with the frozen defaults so a stale/partial map still works after
// new actions are added in a release. window.currentBindings is the single
// source of truth consulted by the dispatcher AND the settings UI.
let currentBindings = (window.keybindings && window.keybindings.mergeWithDefaults)
    ? window.keybindings.mergeWithDefaults(initialGlobalSettings.keyboardBindings)
    : {};
window.currentBindings = currentBindings;

// True while the settings panel is waiting on the next keypress to record a
// new binding. The main keydown dispatcher bails when this is set so the user
// can press already-bound combos without triggering them.
let keybindingsCapture = null; // { actionId, rowEl } or null

// 从vscode state恢复lockViewEnabled (先从vscode state，再从globalSettings)
if (vscodeState && vscodeState.lockViewEnabled !== undefined) {
    lockViewEnabled = vscodeState.lockViewEnabled;
} else if (initialGlobalSettings.lockViewEnabled !== undefined) {
    lockViewEnabled = initialGlobalSettings.lockViewEnabled;
}
if (vscodeState && vscodeState.drawClickThrough !== undefined) {
    drawClickThrough = vscodeState.drawClickThrough;
} else if (initialGlobalSettings.drawClickThrough !== undefined) {
    drawClickThrough = initialGlobalSettings.drawClickThrough;
}
if (vscodeState && vscodeState.showShapeLabels !== undefined) {
    showShapeLabels = vscodeState.showShapeLabels;
} else if (initialGlobalSettings.showShapeLabels !== undefined) {
    showShapeLabels = initialGlobalSettings.showShapeLabels;
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
if (vscodeState && vscodeState.samOutputFormat) {
    samOutputFormat = vscodeState.samOutputFormat;
} else if (initialGlobalSettings.samOutputFormat) {
    samOutputFormat = initialGlobalSettings.samOutputFormat;
}
if (vscodeState && vscodeState.samEncodeAdjusted !== undefined) {
    samEncodeAdjusted = !!vscodeState.samEncodeAdjusted;
} else if (initialGlobalSettings.samEncodeAdjusted !== undefined) {
    samEncodeAdjusted = !!initialGlobalSettings.samEncodeAdjusted;
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
        const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
        claheToggleBtn.textContent = claheEnabled ? tt('toggle.on') : tt('toggle.off');
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
    if (settingsMenuBtn) positionSidebarDropdownArrow(settingsMenuDropdown, settingsMenuBtn);
}
// 初始化模式按钮UI
if (viewModeBtn && pointModeBtn && lineModeBtn && polygonModeBtn && rectangleModeBtn) {
    viewModeBtn.classList.remove('active');
    pointModeBtn.classList.remove('active');
    lineModeBtn.classList.remove('active');
    polygonModeBtn.classList.remove('active');
    rectangleModeBtn.classList.remove('active');
    if (circleModeBtn) circleModeBtn.classList.remove('active');
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
    } else if (currentMode === 'circle') {
        if (circleModeBtn) circleModeBtn.classList.add('active');
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
