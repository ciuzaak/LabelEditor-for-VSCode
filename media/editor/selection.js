// LabelEditor webview — Label colors, multi-selection helpers, shape geometry lookups.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

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
    // Clearing selection invalidates any in-progress overlap cycle (covers
    // empty-area clicks, deletes, and undo/redo in one place).
    overlapCycleState = { members: [], pos: -1 };
    hideCycleBadge();
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

// Select a shape and show its vertex handles (view mode only — in drawing
// modes auto-entering edit mode would intercept the next draw click)
function selectShapeAndEdit(index) {
    if (index !== -1 && currentMode === 'view') {
        enterShapeEditMode(index);
    } else {
        selectShape(index);
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

// Select every shape carrying `label` (clicking a row in the Labels list).
// additive mirrors Ctrl/Cmd-click on the Instances list: union/toggle the
// label's group against the current selection instead of replacing it.
function selectShapesByLabel(label, additive) {
    // Multi-selection is incompatible with vertex editing (same as the other helpers).
    if (isEditingShape) exitShapeEditMode(true);

    const indices = window.LabelSelectionHelpers.computeLabelSelection(
        shapes, label, [...selectedShapeIndices], additive
    );
    selectedShapeIndices.clear();
    indices.forEach(i => selectedShapeIndices.add(i));

    // Anchor on the label's first instance so the Instances list scrolls to it;
    // fall back to any remaining selection, else clear.
    const firstOfLabel = shapes.findIndex(s => s && s.label === label);
    if (selectedShapeIndices.has(firstOfLabel)) {
        selectedShapeIndex = firstOfLabel;
    } else {
        selectedShapeIndex = indices.length > 0 ? indices[0] : -1;
    }
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
    hoveredShapeIndex = -1; // hovered index is stale once shapes are spliced
    markDirty();
    saveHistory();
    renderShapeList();
    renderLabelsList();
    draw();
}

// --- Circle helpers ---
function getCircleRadius(points) {
    if (!points || points.length < 2) return 0;
    return Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
}

function polygonizeCircle(cx, cy, r, segments) {
    const n = segments || 32;
    const ring = [];
    for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        ring.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return ring;
}

// Get bounding box of a shape
function getShapeBoundingBox(shape) {
    let points = shape.points;
    if (shape.shape_type === 'rectangle') {
        points = getRectPoints(points);
    } else if (shape.shape_type === 'circle' && points.length >= 2) {
        const cx = points[0][0], cy = points[0][1];
        const r = getCircleRadius(points);
        return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
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
