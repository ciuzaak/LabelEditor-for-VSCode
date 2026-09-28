// LabelEditor webview — Vertex / whole-shape edit mode, sidebar resizer, overlap-cycle badge.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

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
        // Mid-draw or erasing — editing must not intercept; save and exit, and
        // let the main handler process this click normally
        if (isDrawing || eraserActive || eraserMouseDownPos) {
            exitShapeEditMode(true);
            return;
        }

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
            // Repeated click at the same spot over stacked shapes: exit edit
            // mode and let the main handler cycle through overlapping shapes
            const overlaps = findAllShapesAt(x, y);
            const distToLast = Math.hypot(x - lastClickX, y - lastClickY);
            const isCycling = !e.ctrlKey && !e.metaKey && overlaps.length > 1 &&
                distToLast < CLICK_THRESHOLD_DISTANCE / zoomLevel &&
                (Date.now() - lastClickTime) < CLICK_THRESHOLD_TIME;
            if (isCycling) {
                exitShapeEditMode(true);
                return;
            }

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

        // Clicked elsewhere — keep the edits and fall through (no stopPropagation)
        // so the main handler selects the clicked shape / clears selection /
        // starts box selection as usual, without needing a second click
        exitShapeEditMode(true);
    }
}, true); // Use capture phase to intercept before other handlers

// Double-click a shape to enter vertex edit mode (every tool mode — e.g.
// right after drawing a box). Manual mousedown detection covers the normal
// case; this listener is the jitter-tolerant fallback when the browser does
// fire dblclick.
canvasWrapper.addEventListener('dblclick', (e) => {
    if (e.button !== 0) return;
    if (currentMode === 'sam' || isDrawing || eraserActive || eraserMouseDownPos) return;
    if (labelModal && labelModal.style.display === 'flex') return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomLevel;
    const y = (e.clientY - rect.top) / zoomLevel;
    let idx = findShapeIndexAt(x, y);
    if (idx === -1) {
        const m = 10 / zoomLevel;
        for (const [dx, dy] of [[m, 0], [-m, 0], [0, m], [0, -m], [m, m], [-m, -m], [m, -m], [-m, m]]) {
            idx = findShapeIndexAt(x + dx, y + dy);
            if (idx !== -1) break;
        }
    }
    if (idx !== -1) {
        enterShapeEditMode(idx);
        renderShapeList();
        draw();
    }
});

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

        // Move all points by the delta. Both the center and the edge get
        // clamped to image bounds — matches rectangle/polygon's drag
        // behaviour (corners snap to the edge when the cursor leaves the
        // image). This sacrifices a tiny bit of radius preservation when the
        // circle is dragged into a corner, but the alternative — writing
        // out-of-bounds edge points to the JSON — has worse downstream
        // consequences for export, eraser, and round-trip tests.
        const shape = shapes[shapeBeingEdited];
        shape.points = originalEditPoints.map(p => clampImageCoords(p[0] + dx, p[1] + dy));

        scheduleDraw(e);
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
                    shape.points = [clampImageCoords(x, y), shape.points[1]];
                } else {
                    shape.points = [shape.points[0], clampImageCoords(x, y)];
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
        } else if (shape.shape_type === 'circle') {
            // Circle: center vertex (index 0) translates both points; edge vertex (index 1)
            // only repositions the edge so the radius follows the cursor.
            if (activeVertexIndex === 0) {
                const newCx = clampImageCoords(x, y);
                const oldCx = originalEditPoints[0];
                const dx = newCx[0] - oldCx[0];
                const dy = newCx[1] - oldCx[1];
                // Clamp the translated edge as well so a center drag near the
                // boundary doesn't push the recorded edge outside the image.
                const newEdge = clampImageCoords(originalEditPoints[1][0] + dx, originalEditPoints[1][1] + dy);
                shape.points = [newCx, newEdge];
            } else {
                // Clamp the dragged edge to image bounds so a vertex edit can
                // never push the recorded edge point outside [0,w]×[0,h].
                shape.points = [shape.points[0], clampImageCoords(x, y)];
            }
        } else {
            // For polygon/line/point, replace the dragged vertex. (A new array
            // rather than an in-place write: the render cache identifies a
            // shape's geometry by its points array — see pointsRenderId.)
            const moved = clampImageCoords(x, y);
            shape.points = shape.points.map((p, i) => i === activeVertexIndex ? moved : p);
        }

        scheduleDraw(e);
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

// End of a whole-shape or vertex drag: record it as an edit only if the
// points actually changed — a click without moving must not mark the file
// dirty or add a no-op undo step.
function commitShapeEditDrag() {
    if (shapeBeingEdited === -1) return;
    const current = shapes[shapeBeingEdited].points;
    if (originalEditPoints && pointsArrayEqual(current, originalEditPoints)) return;
    // Update originalEditPoints to current position for the next drag
    originalEditPoints = JSON.parse(JSON.stringify(current));
    markDirty();
    saveHistory();
}

document.addEventListener('mouseup', (e) => {
    if (isDraggingWholeShape) {
        isDraggingWholeShape = false;
        dragStartPoint = null;
        // Don't overwrite the Shift feedback cursor; it'll be cleared on Shift-up.
        if (!shiftPressed) {
            canvasWrapper.style.cursor = 'default';
        }
        commitShapeEditDrag();
    }
    if (isDraggingVertex) {
        isDraggingVertex = false;
        activeVertexIndex = -1;
        commitShapeEditDrag();
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
        } else if (shape.shape_type === 'circle') {
            // Circle: filled-disc hit-test (click anywhere inside)
            if (points.length >= 2) {
                const r = getCircleRadius(points);
                const dx = x - points[0][0];
                const dy = y - points[0][1];
                if (dx * dx + dy * dy <= r * r) {
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
    return sortOverlapCandidates(overlappingShapes, shapes);
}

// 查找指定位置的第一个形状（为了保持向后兼容）
function findShapeIndexAt(x, y) {
    const overlapping = findAllShapesAt(x, y);
    return overlapping.length > 0 ? overlapping[0] : -1;
}

// --- Overlap cycle badge: a small "pos / total" hint shown near the cursor
// while cycling through a stack of overlapping instances (total > 1). It is
// position:fixed on <body> so the canvas zoom transform doesn't scale it. ---
let cycleBadgeEl = null;
let cycleBadgeTimer = null;

function getCycleBadge() {
    if (!cycleBadgeEl) {
        cycleBadgeEl = document.createElement('div');
        cycleBadgeEl.id = 'overlapCycleBadge';
        cycleBadgeEl.style.display = 'none';
        document.body.appendChild(cycleBadgeEl);
    }
    return cycleBadgeEl;
}

function updateCycleBadge(clientX, clientY, pos, total) {
    if (total <= 1) { hideCycleBadge(); return; }
    const badge = getCycleBadge();
    badge.textContent = `${pos + 1} / ${total}`;
    badge.style.left = Math.min(clientX + 14, window.innerWidth - 48) + 'px';
    badge.style.top = Math.min(clientY + 14, window.innerHeight - 28) + 'px';
    badge.style.display = 'block';
    if (cycleBadgeTimer) clearTimeout(cycleBadgeTimer);
    cycleBadgeTimer = setTimeout(hideCycleBadge, 1500);
}

function hideCycleBadge() {
    if (cycleBadgeTimer) { clearTimeout(cycleBadgeTimer); cycleBadgeTimer = null; }
    if (cycleBadgeEl) cycleBadgeEl.style.display = 'none';
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
    if (activeLabel && window.annotationFormat !== 'yolo') {
        // Default label exists: create the shape immediately without the modal
        labelInput.value = activeLabel;
        descriptionInput.value = '';
        confirmLabel();
    } else {
        showLabelModal();
    }
}
