const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const svgOverlay = document.getElementById('svgOverlay');
const canvasWrapper = document.getElementById('canvasWrapper');
const saveBtn = document.getElementById('saveBtn');
const statusSpan = document.getElementById('status');
const shapeList = document.getElementById('shapeList');
const labelModal = document.getElementById('labelModal');
const labelInput = document.getElementById('labelInput');
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
const polygonModeBtn = document.getElementById('polygonModeBtn');
const rectangleModeBtn = document.getElementById('rectangleModeBtn');


// Labels management elements
const labelsList = document.getElementById('labelsList');
const colorPickerModal = document.getElementById('colorPickerModal');
const customColorInput = document.getElementById('customColorInput');
const colorOkBtn = document.getElementById('colorOkBtn');
const colorCancelBtn = document.getElementById('colorCancelBtn');

// Advanced Options elements
const advancedOptionsBtn = document.getElementById('advancedOptionsBtn');
const advancedOptionsDropdown = document.getElementById('advancedOptionsDropdown');
const borderWidthSlider = document.getElementById('borderWidthSlider');
const borderWidthValue = document.getElementById('borderWidthValue');
const fillOpacitySlider = document.getElementById('fillOpacitySlider');
const fillOpacityValue = document.getElementById('fillOpacityValue');
const resetAdvancedBtn = document.getElementById('resetAdvancedBtn');


let img = new Image();
let shapes = [];
let currentPoints = [];
let isDrawing = false;
let selectedShapeIndex = -1;
let editingShapeIndex = -1;
let recentLabels = ["object", "person", "car", "background"];

// Dirty State
let isDirty = false;

// Current interaction mode ('view' or 'polygon')
let currentMode = 'view'; // 默认为view模式

// Zoom & Pan variables
let zoomLevel = 1;
let zoomAnimationFrameId = null; // 缩放节流

// Undo/Redo History (实例级别 - 只记录shapes的变化)
let history = []; // 历史记录栈
let historyIndex = -1; // 当前历史位置
const MAX_HISTORY = 50; // 最大历史记录数

// 性能优化变量
let animationFrameId = null; // requestAnimationFrame节流
const colorCache = new Map(); // 颜色计算缓存

// Labels管理 - 全局颜色自定义（会话级别，切换图片保留，关闭插件重置）
let customColors = new Map(); // 存储用户自定义的标签颜色
let currentEditingLabel = null; // 当前正在编辑颜色的标签

// 预设调色板（3行 x 8列 = 24个颜色）
const PRESET_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
    '#52C41A', '#FA8C16', '#EB2F96', '#722ED1',
    '#13C2C2', '#52C41A', '#FAAD14', '#F5222D',
    '#FA541C', '#FADB14', '#A0D911', '#52C41A',
    '#13C2C2', '#1890FF', '#2F54EB', '#722ED1'
];


// 从vscode state恢复customColors
const vscodeState = vscode.getState();
if (vscodeState && vscodeState.customColors) {
    customColors = new Map(Object.entries(vscodeState.customColors));
}

// Labels可见性管理 - 全局状态（会话级别，切换图片保留，关闭插件重置）
let labelVisibilityState = new Map(); // 存储每个label的可见性状态 (true=visible, false=hidden)

// 从vscode state恢复labelVisibilityState
if (vscodeState && vscodeState.labelVisibility) {
    labelVisibilityState = new Map(Object.entries(vscodeState.labelVisibility).map(([k, v]) => [k, v === 'true' || v === true]));
}

// 高级选项 - 全局渲染设置（会话级别，切换图片保留，关闭插件重置）
let borderWidth = 2; // 边界粗细，默认2px
let fillOpacity = 0.3; // 填充透明度，默认30%

// 从vscode state恢复高级选项设置
if (vscodeState && vscodeState.borderWidth !== undefined) {
    borderWidth = vscodeState.borderWidth;
}
if (vscodeState && vscodeState.fillOpacity !== undefined) {
    fillOpacity = vscodeState.fillOpacity;
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

// 从vscode state恢复currentMode
if (vscodeState && vscodeState.currentMode) {
    currentMode = vscodeState.currentMode;
}

// 初始化模式按钮UI
if (viewModeBtn && polygonModeBtn && rectangleModeBtn) {
    viewModeBtn.classList.remove('active');
    polygonModeBtn.classList.remove('active');
    rectangleModeBtn.classList.remove('active');

    if (currentMode === 'view') {
        viewModeBtn.classList.add('active');
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
    markClean();
}

// 初始化历史记录
saveHistory();

img.onload = () => {
    fitImageToScreen();
    draw();
    renderShapeList();
    renderLabelsList();
};

img.onerror = () => {
    statusSpan.textContent = "Error loading image";
    statusSpan.style.color = "red";
};

img.src = imageUrl;

// --- Dirty State Management ---

function markDirty() {
    if (!isDirty) {
        isDirty = true;
        vscode.postMessage({ command: 'dirty', value: true });
    }
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.add('dirty');
        saveBtn.textContent = 'Save (Ctrl+S) *';
    }
}

function markClean() {
    if (isDirty) {
        isDirty = false;
        vscode.postMessage({ command: 'dirty', value: false });
    }
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.remove('dirty');
        saveBtn.textContent = 'Save (Ctrl+S)';
    }
}

// --- Undo/Redo History Management ---

function saveHistory() {
    // 使用 structuredClone 进行深拷贝,并过滤掉visible字段
    const shapesWithoutVisible = shapes.map(shape => {
        const { visible, ...shapeWithoutVisible } = shape;
        return shapeWithoutVisible;
    });
    const snapshot = structuredClone(shapesWithoutVisible);

    // 如果不在历史末尾，删除当前位置之后的所有历史
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }

    // 添加新快照
    history.push(snapshot);

    // 限制历史记录数量
    if (history.length > MAX_HISTORY) {
        history.shift();
    } else {
        historyIndex++;
    }
}

function undo() {
    if (historyIndex > 0) {
        // 保存当前的visible状态
        const visibleStates = new Map(shapes.map((shape, index) => [index, shape.visible]));

        historyIndex--;
        shapes = structuredClone(history[historyIndex]);

        // 恢复visible状态
        shapes.forEach((shape, index) => {
            shape.visible = visibleStates.get(index) !== false; // 默认为true
        });

        selectedShapeIndex = -1;
        markDirty();
        renderShapeList();
        renderLabelsList();
        draw();
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        // 保存当前的visible状态
        const visibleStates = new Map(shapes.map((shape, index) => [index, shape.visible]));

        historyIndex++;
        shapes = structuredClone(history[historyIndex]);

        // 恢复visible状态
        shapes.forEach((shape, index) => {
            shape.visible = visibleStates.get(index) !== false; // 默认为true
        });

        selectedShapeIndex = -1;
        markDirty();
        renderShapeList();
        renderLabelsList();
        draw();
    }
}

// --- Zoom & Scroll ---

function fitImageToScreen() {
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;

    if (w === 0 || h === 0 || img.width === 0 || img.height === 0) return;

    const scaleX = w / img.width;
    const scaleY = h / img.height;

    zoomLevel = Math.min(scaleX, scaleY) * 0.98; // 98% fit

    updateCanvasTransform();
}

function updateCanvasTransform() {
    // Canvas 保持原始图片尺寸
    canvas.width = img.width;
    canvas.height = img.height;
    
    // SVG 也保持原始图片尺寸
    svgOverlay.setAttribute('width', img.width);
    svgOverlay.setAttribute('height', img.height);
    svgOverlay.setAttribute('viewBox', `0 0 ${img.width} ${img.height}`);
    
    // 使用wrapper的CSS transform进行整体缩放
    canvasWrapper.style.transform = `scale(${zoomLevel})`;
    canvasWrapper.style.transformOrigin = '0 0';
    
    draw();
}

window.addEventListener('resize', () => {
    // Optional: re-fit on resize? Or just keep zoom?
});

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'requestSave':
            save();
            break;
    }
});

// --- Shortcuts ---

document.addEventListener('keydown', (e) => {
    // Ignore shortcuts if modal is open (except Enter/Esc handled in input)
    if (labelModal.style.display === 'flex') return;

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

    // ESC: Cancel drawing
    if (e.key === 'Escape') {
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

// --- Canvas Interaction ---

// 使用canvasWrapper来监听鼠标事件，因为SVG覆盖在canvas上
canvasWrapper.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left click
        const rect = canvas.getBoundingClientRect();
        // Mouse pos relative to canvas
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Convert to image coordinates
        const x = mx / zoomLevel;
        const y = my / zoomLevel;

        if (!isDrawing) {
            const clickedShapeIndex = findShapeIndexAt(x, y);
            if (clickedShapeIndex !== -1) {
                selectedShapeIndex = clickedShapeIndex;
                renderShapeList();
                draw();
                return;
            } else {
                selectedShapeIndex = -1;
                renderShapeList();
            }

            // 只在polygon或rectangle模式下允许开始绘制
            if (currentMode === 'polygon') {
                isDrawing = true;
                currentPoints = [[x, y]];
            } else if (currentMode === 'rectangle') {
                isDrawing = true;
                // Rectangle starts with one point, we'll expand it in mousemove
                currentPoints = [[x, y]];
            }
        } else {
            if (currentMode === 'polygon') {
                const firstPoint = currentPoints[0];
                const dx = x - firstPoint[0];
                const dy = y - firstPoint[1];

                // Check close distance (scaled)
                if (currentPoints.length > 2 && (dx * dx + dy * dy) < (100 / (zoomLevel * zoomLevel))) {
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
            if (currentMode === 'polygon') {
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
        if (hoveredIndex !== -1) {
            canvasWrapper.style.cursor = 'pointer';
        } else {
            // View mode uses default cursor, others use crosshair
            canvasWrapper.style.cursor = currentMode === 'view' ? 'default' : 'crosshair';
        }
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
            const zoomFactor = 1.1; // 每次滚轮缩放10%

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
                zoomLevel *= zoomFactor;
                // Limit maximum zoom to 10x (1000%)
                if (zoomLevel > 10) zoomLevel = 10;
            } else {
                // Zoom out
                zoomLevel /= zoomFactor;
                // Minimum zoom limit
                if (zoomLevel < 0.1) zoomLevel = 0.1;
            }

            // Update canvas wrapper transform (整体缩放)
            canvasWrapper.style.transform = `scale(${zoomLevel})`;

            // Calculate new scroll position to keep the same image point under the mouse
            const newScrollLeft = imageX * zoomLevel - mouseX;
            const newScrollTop = imageY * zoomLevel - mouseY;

            // Apply new scroll position
            canvasContainer.scrollLeft = newScrollLeft;
            canvasContainer.scrollTop = newScrollTop;

            // 重绘SVG以更新线宽（保持视觉上的恒定粗细）
            drawSVGAnnotations();

            zoomAnimationFrameId = null; // 重置标志
        });
    }
}, { passive: false });

// 禁用canvasWrapper上的右键菜单 (except in View Mode)
canvasWrapper.addEventListener('contextmenu', (e) => {
    if (currentMode !== 'view') {
        e.preventDefault();
    }
});

// --- Resizer Logic ---
let isResizing = false;

if (resizer) {
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
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
    }
});


function findShapeIndexAt(x, y) {
    for (let i = shapes.length - 1; i >= 0; i--) {
        let points = shapes[i].points;
        if (shapes[i].shape_type === 'rectangle') {
            points = getRectPoints(points);
        }
        if (isPointInPolygon([x, y], points)) {
            return i;
        }
    }
    return -1;
}

function isPointInPolygon(point, vs) {
    var x = point[0], y = point[1];
    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        var xi = vs[i][0], yi = vs[i][1];
        var xj = vs[j][0], yj = vs[j][1];

        var intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
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
    } else {
        labelInput.value = '';
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
    recentLabels.forEach(label => {
        const chip = document.createElement('div');
        chip.className = 'label-chip';
        chip.textContent = label;
        chip.onclick = () => {
            labelInput.value = label;
            confirmLabel();
        };
        recentLabelsDiv.appendChild(chip);
    });
}

function confirmLabel() {
    const label = labelInput.value.trim();
    if (!label) return;

    if (!recentLabels.includes(label)) {
        recentLabels.unshift(label);
        if (recentLabels.length > 10) recentLabels.pop();
    }

    if (editingShapeIndex !== -1) {
        // Editing existing shape
        shapes[editingShapeIndex].label = label;
        editingShapeIndex = -1;
    } else {
        // Creating new shape
        shapes.push({
            label: label,
            points: currentPoints,
            group_id: null,
            shape_type: currentMode === 'rectangle' ? "rectangle" : "polygon",
            flags: {},
            visible: true
        });
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
modalCancelBtn.onclick = () => {
    hideLabelModal();
    editingShapeIndex = -1;
    currentPoints = [];
    draw();
};

labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmLabel();
    if (e.key === 'Escape') {
        hideLabelModal();
        editingShapeIndex = -1;
        currentPoints = [];
        draw();
    }
});

// --- Sidebar Logic ---
function renderShapeList() {
    // 使用 DocumentFragment 批量添加 DOM，减少重排
    const fragment = document.createDocumentFragment();

    shapes.forEach((shape, index) => {
        const li = document.createElement('li');
        li.textContent = shape.label;

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
}

function deleteShape(index) {
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

    PRESET_COLORS.forEach(color => {
        const colorOption = document.createElement('div');
        colorOption.className = 'color-option';
        colorOption.style.backgroundColor = color;
        colorOption.onclick = () => {
            document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            colorOption.classList.add('selected');
            customColorInput.value = color;
        };
        palette.appendChild(colorOption);
    });

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

// Unified state saving
function saveState() {
    const customColorsObj = Object.fromEntries(customColors);
    const labelVisibilityObj = Object.fromEntries(labelVisibilityState);
    vscode.setState({
        customColors: customColorsObj,
        labelVisibility: labelVisibilityObj,
        borderWidth: borderWidth,
        fillOpacity: fillOpacity,
        currentMode: currentMode
    });
}

// 确认颜色选择
function confirmColorPicker() {
    if (!currentEditingLabel) return;

    let color = customColorInput.value.trim();

    // 验证颜色格式 - 只接受#XXXXXX格式
    if (!color.startsWith('#')) {
        alert('Invalid color format. Please use #RRGGBB format (e.g., #FF5733).');
        return;
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
        alert('Invalid color format. Please use #RRGGBB format (e.g., #FF5733).');
        return;
    }

    // 保存自定义颜色
    customColors.set(currentEditingLabel, color.toUpperCase());

    // 保存到vscode state以实现持久化
    saveState();

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

    // 保存到vscode state
    saveState();

    colorCache.delete(label);
    renderLabelsList();
    renderShapeList();
    draw();
}

// --- Advanced Options ---

// 切换高级选项下拉菜单
function toggleAdvancedOptions() {
    if (advancedOptionsDropdown) {
        const isVisible = advancedOptionsDropdown.style.display !== 'none';
        advancedOptionsDropdown.style.display = isVisible ? 'none' : 'block';
    }
}

// 更新边界宽度
function updateBorderWidth(value) {
    borderWidth = parseFloat(value);
    if (borderWidthValue) {
        borderWidthValue.textContent = borderWidth;
    }
    // saveState(); // Removed: Don't save on every pixel of drag
    draw();
}

// 更新填充透明度
function updateFillOpacity(value) {
    fillOpacity = parseFloat(value) / 100;
    if (fillOpacityValue) {
        fillOpacityValue.textContent = Math.round(fillOpacity * 100);
    }
    // 清除颜色缓存以使新透明度生效
    colorCache.clear();
    // saveState(); // Removed: Don't save on every pixel of drag
    draw();
}

// 重置高级选项到默认值
function resetAdvancedOptions() {
    borderWidth = 2;
    fillOpacity = 0.3;

    if (borderWidthSlider && borderWidthValue) {
        borderWidthSlider.value = borderWidth;
        borderWidthValue.textContent = borderWidth;
    }
    if (fillOpacitySlider && fillOpacityValue) {
        fillOpacitySlider.value = fillOpacity * 100;
        fillOpacityValue.textContent = Math.round(fillOpacity * 100);
    }

    saveState();
    draw();
}



// --- Mode Switching ---

// 设置交互模式
function setMode(mode) {
    currentMode = mode;

    // 保存到vscode state
    saveState();

    // 更新按钮状态
    if (viewModeBtn && polygonModeBtn && rectangleModeBtn) {
        viewModeBtn.classList.remove('active');
        polygonModeBtn.classList.remove('active');
        rectangleModeBtn.classList.remove('active');

        if (mode === 'view') {
            viewModeBtn.classList.add('active');
            // 如果正在绘制，取消绘制
            if (isDrawing) {
                isDrawing = false;
                currentPoints = [];
                draw();
            }
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
            fillColor = 'rgba(255, 255, 0, 0.4)';
        }

        let points = shape.points;
        if (shape.shape_type === 'rectangle') {
            points = getRectPoints(points);
        }

        drawSVGPolygon(points, strokeColor, fillColor, false, index);
    });

    // 绘制正在创建的形状
    if (isDrawing) {
        let points = currentPoints;
        if (currentMode === 'rectangle' && points.length === 2) {
            points = getRectPoints(points);
        }
        drawSVGPolygon(points, 'rgba(0, 200, 0, 0.8)', 'rgba(0, 200, 0, 0.1)', true, -1);

        // 绘制到鼠标位置的临时线（只在polygon模式下）
        if (mouseEvent && currentMode === 'polygon' && currentPoints.length > 0) {
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

function drawSVGPolygon(points, strokeColor, fillColor, showVertices = false, shapeIndex = -1) {
    if (points.length === 0) return;

    const group = document.createElementNS(SVG_NS, 'g');
    
    // 根据zoomLevel调整线宽，使视觉上保持恒定粗细
    const adjustedStrokeWidth = borderWidth / zoomLevel;
    const adjustedPointRadius = 3 / zoomLevel;
    
    // 创建多边形或折线
    let pathElement;
    if (!isDrawing || shapeIndex !== -1 || currentMode === 'rectangle') {
        // 完成的形状使用polygon
        pathElement = document.createElementNS(SVG_NS, 'polygon');
        const pointsStr = points.map(p => `${p[0]},${p[1]}`).join(' ');
        pathElement.setAttribute('points', pointsStr);
    } else {
        // 正在绘制的形状使用polyline
        pathElement = document.createElementNS(SVG_NS, 'polyline');
        const pointsStr = points.map(p => `${p[0]},${p[1]}`).join(' ');
        pathElement.setAttribute('points', pointsStr);
    }
    
    pathElement.setAttribute('stroke', strokeColor);
    pathElement.setAttribute('stroke-width', adjustedStrokeWidth);
    pathElement.setAttribute('fill', (!isDrawing || shapeIndex !== -1) ? fillColor : 'none');
    
    // 为完成的形状添加data属性用于事件委托
    if (shapeIndex !== -1) {
        pathElement.style.cursor = 'pointer';
        pathElement.style.pointerEvents = 'auto';
        pathElement.dataset.shapeIndex = shapeIndex;
    }
    
    group.appendChild(pathElement);
    
    // 绘制顶点（仅在绘制过程中显示）
    if (showVertices) {
        points.forEach(p => {
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', p[0]);
            circle.setAttribute('cy', p[1]);
            circle.setAttribute('r', adjustedPointRadius);
            circle.setAttribute('fill', strokeColor);
            circle.style.pointerEvents = 'none';
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

    // 过滤掉visible字段,不保存到JSON中
    const shapesToSave = shapes.map(shape => {
        const { visible, ...shapeWithoutVisible } = shape;
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
    markClean();
}

if (saveBtn) {
    saveBtn.addEventListener('click', save);
}

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

// --- Advanced Options Event Listeners ---

// Advanced Options button
if (advancedOptionsBtn) {
    advancedOptionsBtn.onclick = toggleAdvancedOptions;
}

// Border Width slider
if (borderWidthSlider) {
    borderWidthSlider.oninput = (e) => updateBorderWidth(e.target.value);
    borderWidthSlider.onchange = (e) => saveState(); // Save only on release
}

// Fill Opacity slider
if (fillOpacitySlider) {
    fillOpacitySlider.oninput = (e) => updateFillOpacity(e.target.value);
    fillOpacitySlider.onchange = (e) => saveState(); // Save only on release
}

// Reset Advanced Options button
if (resetAdvancedBtn) {
    resetAdvancedBtn.onclick = resetAdvancedOptions;
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

// --- Mode Toggle Event Listeners ---

// View Mode button
if (viewModeBtn) {
    viewModeBtn.onclick = () => setMode('view');
}

// Polygon Mode button
if (polygonModeBtn) {
    polygonModeBtn.onclick = () => setMode('polygon');
}

// Rectangle Mode button
if (rectangleModeBtn) {
    rectangleModeBtn.onclick = () => setMode('rectangle');
}

