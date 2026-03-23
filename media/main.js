const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const svgOverlay = document.getElementById('svgOverlay');
const canvasWrapper = document.getElementById('canvasWrapper');
const saveBtn = document.getElementById('saveBtn');
const statusSpan = document.getElementById('status');
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
let editingShapeIndex = -1;
let recentLabels = initialGlobalSettings.recentLabels || [];

// Dirty State
let isDirty = false;

// Current interaction mode ('view', 'point', 'line', 'polygon', or 'rectangle')
let currentMode = 'view'; // 默认为view模式

// Zoom & Pan variables
let zoomLevel = 1;
let zoomAnimationFrameId = null; // 缩放节流

// 常量定义
const ZOOM_FIT_RATIO = 0.98;      // 适应屏幕时的缩放比例
const ZOOM_MAX = 20;               // 最大缩放倍数
const ZOOM_MIN = 0.1;              // 最小缩放倍数
const ZOOM_FACTOR = 1.1;           // 滚轮缩放因子
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
const contextMenuToggleVisible = document.getElementById('contextMenuToggleVisible');
const contextMenuDelete = document.getElementById('contextMenuDelete');


// Labels可见性管理 - 全局状态（会话级别，切换图片保留，关闭插件重置）
let labelVisibilityState = new Map(); // 存储每个label的可见性状态 (true=visible, false=hidden)

// 高级选项 - 全局渲染设置（会话级别，切换图片保留，关闭插件重置）
let borderWidth = 2; // 边界粗细，默认2px
let fillOpacity = 0.3; // 填充透明度，默认30%

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

// 初始化UI显示值
if (borderWidthSlider && borderWidthValue) {
    borderWidthSlider.value = borderWidth;
    borderWidthValue.textContent = borderWidth;
}
if (fillOpacitySlider && fillOpacityValue) {
    fillOpacitySlider.value = fillOpacity * 100;
    fillOpacityValue.textContent = Math.round(fillOpacity * 100);
}

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

// Update zoom UI state (lock button icon and reset button visibility)
function updateZoomUI() {
    // Update lock button icon and state
    if (zoomLockBtn) {
        if (lockViewEnabled) {
            zoomLockBtn.textContent = '🔒';
            zoomLockBtn.classList.add('locked');
            zoomLockBtn.title = 'Locked: Keeping zoom and position when switching images. Click to unlock.';
        } else {
            zoomLockBtn.textContent = '🔓';
            zoomLockBtn.classList.remove('locked');
            zoomLockBtn.title = 'Unlocked: Fit to screen on each image. Click to lock current view.';
        }
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

    const scaleX = w / img.width;
    const scaleY = h / img.height;

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
        // Calculate which point of the ORIGINAL image is at the viewport center
        const viewportCenterScreenX = scrollX + viewportW / 2;
        const viewportCenterImageX = viewportCenterScreenX / zoomLevel;
        imageCenterX = viewportCenterImageX / img.width;
    }

    if (imageH <= viewportH) {
        // Image fits vertically, use center
        imageCenterY = 0.5;
    } else {
        const viewportCenterScreenY = scrollY + viewportH / 2;
        const viewportCenterImageY = viewportCenterScreenY / zoomLevel;
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

    updateCanvasTransform();

    const viewportW = canvasContainer.clientWidth;
    const viewportH = canvasContainer.clientHeight;

    // Convert image coordinates back to scroll position
    const imageX = state.imageCenterX * img.width;
    const imageY = state.imageCenterY * img.height;
    const scrollX = imageX * zoomLevel - viewportW / 2;
    const scrollY = imageY * zoomLevel - viewportH / 2;

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
    // Clear any previous error status
    statusSpan.textContent = "";
    statusSpan.style.color = "";

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
    statusSpan.textContent = "Error loading image";
    statusSpan.style.color = "red";
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
img.src = imageUrl;

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
        saveBtn.textContent = '💾*';
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
        saveBtn.textContent = '💾';
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
            saveBtn.textContent = '💾';
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
        historyIndex--;
        shapes = structuredClone(history[historyIndex]);

        // Reapply label-level visibility overrides (not recorded in history)
        applyLabelVisibilityState();

        selectedShapeIndex = -1;
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
        historyIndex++;
        shapes = structuredClone(history[historyIndex]);

        // Reapply label-level visibility overrides (not recorded in history)
        applyLabelVisibilityState();

        selectedShapeIndex = -1;
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

    // Remove transform from wrapper and set explicit size
    canvasWrapper.style.transform = '';
    canvasWrapper.style.transformOrigin = '';
    canvasWrapper.style.width = `${displayWidth}px`;
    canvasWrapper.style.height = `${displayHeight}px`;

    draw();
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

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
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
    }
});

// Handle incremental image update (without full HTML reload)
function handleImageUpdate(message) {
    // Exit shape edit mode if currently editing (without saving changes to the old image)
    if (isEditingShape) {
        exitShapeEditMode(false);
    }

    // Cancel any current drawing
    if (isDrawing) {
        isDrawing = false;
        currentPoints = [];
    }

    // Clear selection
    selectedShapeIndex = -1;
    editingShapeIndex = -1;

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

    // Update filename display
    const fileNameSpan = document.getElementById('fileName');
    if (fileNameSpan) {
        fileNameSpan.textContent = newCurrentImageRelativePath || newImageName;
        fileNameSpan.title = 'Click to copy absolute path: ' + newImagePath;
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

    // Load new image with stale callback protection
    img.onload = function () {
        // Check if this callback is for the current load request
        if (thisLoadId !== currentImageLoadId) return;

        // Clear any previous error status
        statusSpan.textContent = "";
        statusSpan.style.color = "";

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
    };
    img.onerror = function () {
        // Check if this callback is for the current load request
        if (thisLoadId !== currentImageLoadId) return;

        handleImageError();
    };
    img.src = newImageUrl;
}

// Handle refreshed image list from extension
function handleUpdateImageList(message) {
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
    const imageCountEl = document.getElementById('imageCount');
    if (imageCountEl) {
        if (searchQuery) {
            imageCountEl.textContent = `(${filteredImages.length}/${workspaceImages.length})`;
        } else {
            imageCountEl.textContent = `(${workspaceImages.length})`;
        }
    }

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

    // Force re-render to update highlighting
    virtualScrollState.startIndex = -1; // Reset to force update
    virtualScrollState.endIndex = -1;
    updateVirtualScroll();
}


// --- Shortcuts ---

document.addEventListener('keydown', (e) => {
    // Ignore shortcuts if modal is open (except Enter/Esc handled in input)
    if (labelModal.style.display === 'flex') return;

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

    // A: Prev Image
    if (e.key === 'a' || e.key === 'A') {
        vscode.postMessage({ command: 'prev' });
    }

    // D: Next Image
    if (e.key === 'd' || e.key === 'D') {
        vscode.postMessage({ command: 'next' });
    }

    // Delete/Backspace: Delete selected shape
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeIndex !== -1) {
        deleteShape(selectedShapeIndex);
    }

    // ESC: Cancel drawing or exit drag/edit mode
    if (e.key === 'Escape') {
        // First priority: hide context menu if visible
        if (shapeContextMenu && shapeContextMenu.style.display !== 'none') {
            hideShapeContextMenu();
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
        }
    }

    // V: View Mode
    if (e.key === 'v' || e.key === 'V') {
        setMode('view');
    }

    // O: Point Mode
    if (e.key === 'o' || e.key === 'O') {
        setMode('point');
    }

    // L: Line Mode
    if (e.key === 'l' || e.key === 'L') {
        setMode('line');
    }

    // P: Polygon Mode
    if (e.key === 'p' || e.key === 'P') {
        setMode('polygon');
    }

    // R: Rectangle Mode
    if (e.key === 'r' || e.key === 'R') {
        setMode('rectangle');
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
                if (isSameLocation && overlappingShapes.length > 1) {
                    // 如果在同一位置连续点击，且有多个重叠实例，则循环选择下一个
                    const currentIndex = overlappingShapes.indexOf(selectedShapeIndex);
                    if (currentIndex !== -1 && currentIndex < overlappingShapes.length - 1) {
                        // 选择下一个重叠的实例
                        selectedShapeIndex = overlappingShapes[currentIndex + 1];
                    } else {
                        // 循环回到第一个
                        selectedShapeIndex = overlappingShapes[0];
                    }
                } else {
                    // 首次点击或不同位置，选择最上层的实例
                    selectedShapeIndex = overlappingShapes[0];
                }

                // 更新点击位置和时间
                lastClickX = x;
                lastClickY = y;
                lastClickTime = now;

                renderShapeList();
                draw();
                return;
            } else {
                selectedShapeIndex = -1;
                renderShapeList();

                // 重置点击追踪
                lastClickTime = 0;
            }

            // 只在polygon或rectangle或point或line模式下允许开始绘制
            if (currentMode === 'point') {
                // Point mode: single click creates a point and immediately finishes
                isDrawing = true;
                currentPoints = [[x, y]];
                finishPolygon();
            } else if (currentMode === 'line') {
                isDrawing = true;
                currentPoints = [[x, y]];
            } else if (currentMode === 'polygon') {
                isDrawing = true;
                currentPoints = [[x, y]];
            } else if (currentMode === 'rectangle') {
                isDrawing = true;
                // Rectangle starts with one point, we'll expand it in mousemove
                currentPoints = [[x, y]];
            }
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
                        currentPoints.push([x, y]);
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
                    currentPoints.push([x, y]);
                }
            } else if (currentMode === 'rectangle') {
                // Second click to finish rectangle
                finishPolygon();
            }
        }
        draw();
    } else if (e.button === 2) { // Right click
        e.preventDefault(); // 阻止浏览器默认的上下文菜单
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
                // Select the shape and show context menu
                selectedShapeIndex = clickedShapeIndex;
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
                    currentPoints = [startPoint, [x, y]];
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

// Save locked view state on scroll (debounced)
let scrollSaveTimeout = null;
canvasContainer.addEventListener('scroll', () => {
    if (lockViewEnabled) {
        if (scrollSaveTimeout) clearTimeout(scrollSaveTimeout);
        scrollSaveTimeout = setTimeout(() => {
            saveLockedViewState();
        }, 200); // Debounce to avoid too frequent saves
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

            // Calculate mouse position in image coordinates before zoom
            const imageX = (scrollLeft + mouseX) / zoomLevel;
            const imageY = (scrollTop + mouseY) / zoomLevel;

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

            // Update canvas wrapper size (整体缩放)
            const displayWidth = img.width * zoomLevel;
            const displayHeight = img.height * zoomLevel;

            canvas.style.width = `${displayWidth}px`;
            canvas.style.height = `${displayHeight}px`;

            svgOverlay.setAttribute('width', `${displayWidth}px`);
            svgOverlay.setAttribute('height', `${displayHeight}px`);
            svgOverlay.style.width = `${displayWidth}px`;
            svgOverlay.style.height = `${displayHeight}px`;

            canvasWrapper.style.width = `${displayWidth}px`;
            canvasWrapper.style.height = `${displayHeight}px`;
            canvasWrapper.style.transform = '';

            // Calculate new scroll position to keep the same image point under the mouse
            const newScrollLeft = imageX * zoomLevel - mouseX;
            const newScrollTop = imageY * zoomLevel - mouseY;

            // Apply new scroll position
            canvasContainer.scrollLeft = newScrollLeft;
            canvasContainer.scrollTop = newScrollTop;

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
        if (selectedShapeIndex !== -1) {
            showLabelModal(selectedShapeIndex);
        }
    });
}

// Context menu item click handler - toggle visibility
if (contextMenuToggleVisible) {
    contextMenuToggleVisible.addEventListener('click', (e) => {
        e.stopPropagation();
        hideShapeContextMenu();
        if (selectedShapeIndex !== -1) {
            const shape = shapes[selectedShapeIndex];
            shape.visible = shape.visible === undefined ? false : !shape.visible;
            renderShapeList();
            draw();
        }
    });
}

// Context menu item click handler - delete
if (contextMenuDelete) {
    contextMenuDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        hideShapeContextMenu();
        if (selectedShapeIndex !== -1) {
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
    selectedShapeIndex = shapeIndex;
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
    canvasWrapper.style.cursor = currentMode === 'view' ? 'default' : 'crosshair';
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
            canvasWrapper.style.cursor = 'move';
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
        shape.points = originalEditPoints.map(p => [p[0] + dx, p[1] + dy]);

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
                    shape.points[0] = [x, y];
                } else {
                    shape.points[1] = [x, y];
                }
            } else {
                // Moving non-diagonal corner - need to update both stored points
                const [p1, p2] = shape.points;
                if (activeVertexIndex === 1) {
                    // Top-right: affects p1[1] and p2[0]
                    shape.points = [[p1[0], y], [x, p2[1]]];
                } else {
                    // Bottom-left: affects p1[0] and p2[1]
                    shape.points = [[x, p1[1]], [p2[0], y]];
                }
            }
        } else {
            // For polygon/line/point, just update the vertex directly
            shape.points[activeVertexIndex] = [x, y];
        }

        draw();
    } else if (isEditingShape) {
        // Update cursor based on what's under the mouse
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
        canvasWrapper.style.cursor = 'default';
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

// --- Modal Logic ---

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
            const chip = document.createElement('div');
            chip.className = 'label-chip current-image-label';
            chip.textContent = label;
            chip.onclick = () => {
                labelInput.value = label;
                // Highlight the selected chip
                currentChips.querySelectorAll('.label-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
                // Focus description field so user can optionally fill it before confirming
                descriptionInput.focus();
            };
            currentChips.appendChild(chip);
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
            const chip = document.createElement('div');
            chip.className = 'label-chip';
            chip.textContent = label;
            chip.onclick = () => {
                labelInput.value = label;
                // Highlight the selected chip
                historyChips.querySelectorAll('.label-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
                // Focus description field so user can optionally fill it before confirming
                descriptionInput.focus();
            };
            historyChips.appendChild(chip);
        });
        historySection.appendChild(historyChips);
        recentLabelsDiv.appendChild(historySection);
    }
}

function confirmLabel() {
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

    if (editingShapeIndex !== -1) {
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
    markDirty();
    saveHistory(); // 保存历史记录以支持撤销/恢复
    renderShapeList();
    renderLabelsList();
    draw();
}

modalOkBtn.onclick = confirmLabel;

// 取消标签输入的通用处理函数
function cancelLabelInput() {
    hideLabelModal();

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
    if (currentPoints.length > 0) {
        isDrawing = true;
    }

    draw();
}

modalCancelBtn.onclick = cancelLabelInput;

// 在labelInput上监听Enter键
labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmLabel();
    }
});

// 在document级别监听ESC键，当modal显示时响应
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && labelModal.style.display === 'flex') {
        e.preventDefault();
        e.stopPropagation();
        cancelLabelInput();
    }
});

// --- Sidebar Logic ---
function renderShapeList() {
    // 使用 DocumentFragment 批量添加 DOM，减少重排
    const fragment = document.createDocumentFragment();

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
            descSpan.title = shape.description;
            li.appendChild(descSpan);
        }

        const colors = getColorsForLabel(shape.label);
        li.style.borderLeftColor = colors.stroke;

        if (index === selectedShapeIndex) {
            li.classList.add('active');
        }

        li.onclick = () => {
            selectedShapeIndex = index;
            renderShapeList();
            draw();
        };

        const visibleBtn = document.createElement('span');
        visibleBtn.className = 'visible-btn';
        visibleBtn.innerHTML = shape.visible === false ? '&#128065;' : '&#128065;'; // Eye icon
        if (shape.visible === false) {
            visibleBtn.classList.add('hidden-shape');
            visibleBtn.style.opacity = '0.5';
        }
        visibleBtn.onclick = (e) => {
            e.stopPropagation();
            shape.visible = shape.visible === undefined ? false : !shape.visible;
            // 可见性切换不记录到历史和dirty状态,只作用于当前显示
            renderShapeList();
            draw();
        };

        const editBtn = document.createElement('span');
        editBtn.className = 'edit-btn';
        editBtn.innerHTML = '&#9998;'; // Pencil icon
        editBtn.onclick = (e) => {
            e.stopPropagation();
            showLabelModal(index);
        };

        const delBtn = document.createElement('span');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '×';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteShape(index);
        };

        li.appendChild(visibleBtn);
        li.appendChild(editBtn);
        li.appendChild(delBtn);
        fragment.appendChild(li);
    });

    // 一次性更新 DOM
    shapeList.innerHTML = '';
    shapeList.appendChild(fragment);

    // 更新 Instances 计数
    const instancesCountEl = document.getElementById('instancesCount');
    if (instancesCountEl) {
        instancesCountEl.textContent = `(${shapes.length})`;
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
    if (selectedShapeIndex === index) {
        selectedShapeIndex = -1;
    } else if (selectedShapeIndex > index) {
        selectedShapeIndex--;
    }
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
        colorIndicator.title = 'Click to change color';
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
        if (stat.allHidden) {
            visibilityBtn.classList.add('all-hidden');
        }
        visibilityBtn.title = stat.allHidden ? 'Show all' : 'Hide all';
        visibilityBtn.onclick = (e) => {
            e.stopPropagation();
            toggleLabelVisibility(label);
        };

        // Reset按钮（只在有自定义颜色时显示）
        const resetBtn = document.createElement('span');
        resetBtn.className = 'label-reset-btn';
        resetBtn.innerHTML = '&#8634;'; // Circular arrow icon
        resetBtn.title = 'Reset color';
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

    labelsList.innerHTML = '';
    labelsList.appendChild(fragment);

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

    // 移除旧的事件处理器（如果存在）
    if (paletteClickHandler) {
        palette.removeEventListener('click', paletteClickHandler);
    }

    // 使用事件委托处理颜色选择
    paletteClickHandler = (e) => {
        const target = e.target;
        if (target.classList.contains('color-option')) {
            palette.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            target.classList.add('selected');
            customColorInput.value = target.dataset.color;
        }
    };
    palette.addEventListener('click', paletteClickHandler);

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
        vscode.postMessage({ command: 'alert', text: 'Invalid color format. Please use #RRGGBB format (e.g., #FF5733).' });
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

    // 如果在编辑模式，退出并保存更改
    if (isEditingShape) {
        exitShapeEditMode(true);
    }

    // 隐藏上下文菜单
    hideShapeContextMenu();

    currentMode = mode;

    // 保存到vscode state
    saveState();

    // 更新按钮状态
    if (viewModeBtn && pointModeBtn && lineModeBtn && polygonModeBtn && rectangleModeBtn) {
        viewModeBtn.classList.remove('active');
        pointModeBtn.classList.remove('active');
        lineModeBtn.classList.remove('active');
        polygonModeBtn.classList.remove('active');
        rectangleModeBtn.classList.remove('active');

        if (mode === 'view') {
            viewModeBtn.classList.add('active');
        } else if (mode === 'point') {
            pointModeBtn.classList.add('active');
        } else if (mode === 'line') {
            lineModeBtn.classList.add('active');
        } else if (mode === 'polygon') {
            polygonModeBtn.classList.add('active');
        } else if (mode === 'rectangle') {
            rectangleModeBtn.classList.add('active');
        }
    }
}


// --- Drawing Logic ---
function draw(mouseEvent) {
    // Canvas只绘制图片
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, img.width, img.height);

    // SVG绘制标注
    drawSVGAnnotations(mouseEvent);
}

function drawSVGAnnotations(mouseEvent) {
    // 清除SVG内容
    svgOverlay.innerHTML = '';

    // 绘制已完成的形状
    shapes.forEach((shape, index) => {
        if (shape.visible === false) return; // Skip hidden shapes

        const isSelected = index === selectedShapeIndex;
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
            const mx = (mouseEvent.clientX - rect.left) / zoomLevel;
            const my = (mouseEvent.clientY - rect.top) / zoomLevel;
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
        selectedShapeIndex = parseInt(target.dataset.shapeIndex);
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
        vscode.postMessage({ command: 'alert', text: 'Cannot export SVG: image has not finished loading yet. Please wait and try again.' });
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

// Close sidebar dropdowns when clicking outside
document.addEventListener('click', (e) => {
    // Settings dropdown
    if (settingsMenuDropdown && settingsMenuDropdown.style.display !== 'none') {
        if (!settingsMenuDropdown.contains(e.target) && e.target !== settingsMenuBtn) {
            settingsMenuDropdown.style.display = 'none';
            const state = vscode.getState() || {};
            state.settingsMenuExpanded = false;
            vscode.setState(state);
        }
    }
    // Tools dropdown
    if (toolsMenuDropdown && toolsMenuDropdown.style.display !== 'none') {
        if (!toolsMenuDropdown.contains(e.target) && e.target !== toolsMenuBtn) {
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
                // Visual feedback - append checkmark
                const originalText = fileNameSpan.textContent;
                fileNameSpan.textContent = originalText + ' ✓';
                setTimeout(() => {
                    fileNameSpan.textContent = originalText;
                }, 1000);
            }).catch(err => {
                console.error('Failed to copy path:', err);
            });
        }
    };
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
            filterImages('');
        }
    };
}

// Search input - filter images on input
let searchDebounceTimer = null;
if (searchInput) {
    searchInput.oninput = () => {
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
            filterImages('');
        }
    };
}

// Search close button - hide search input and clear filter
if (searchCloseBtn && searchInputContainer && searchInput) {
    searchCloseBtn.onclick = () => {
        searchInputContainer.style.display = 'none';
        searchInput.value = '';
        filterImages('');
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
    const imageCountEl = document.getElementById('imageCount');
    if (imageCountEl) {
        const effectiveImages = getEffectiveImageList();
        if (searchQuery) {
            imageCountEl.textContent = `(${effectiveImages.length}/${workspaceImages.length})`;
        } else {
            imageCountEl.textContent = `(${workspaceImages.length})`;
        }
    }
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
        // Apply filter immediately (without saving state again initially)
        searchQuery = savedQuery.toLowerCase().trim();
        filteredImages = workspaceImages.filter(img =>
            img.toLowerCase().includes(searchQuery)
        );

        // Update count immediately
        const imageCountEl = document.getElementById('imageCount');
        if (imageCountEl) {
            const effectiveImages = getEffectiveImageList();
            imageCountEl.textContent = `(${effectiveImages.length}/${workspaceImages.length})`;
        }
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

        // Use relative path as display name
        li.textContent = imagePath;
        li.title = imagePath;

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
