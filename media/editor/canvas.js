// LabelEditor webview — Canvas mouse interaction, box selection, shape context menu, merge.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

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

            // (Same-location detection for selection cycling was replaced by the
            // candidate-set cycle group in resolveOverlapSelection.)

            // 获取点击位置的所有重叠实例
            const overlappingShapes = allowSelectByClick(currentMode, drawClickThrough)
                ? findAllShapesAt(x, y)
                : [];

            if (overlappingShapes.length > 0) {
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: toggle the smallest (most specific) shape; no cycling
                    toggleShapeSelection(overlappingShapes[0]);
                    overlapCycleState = { members: [], pos: -1 };
                    hideCycleBadge();
                } else {
                    // Smallest-first selection; repeat clicks on the same stack cycle down
                    const prevSelected = selectedShapeIndex;
                    const sameSpot = Math.hypot(x - lastClickX, y - lastClickY) < CLICK_THRESHOLD_DISTANCE / zoomLevel &&
                        (now - lastClickTime) < CLICK_THRESHOLD_TIME;
                    const r = resolveOverlapSelection({
                        ordered: overlappingShapes,
                        prevMembers: overlapCycleState.members,
                        prevPos: overlapCycleState.pos,
                        currentSelectedIndex: selectedShapeIndex,
                    });
                    selectShape(r.targetIndex);
                    overlapCycleState = { members: r.members, pos: r.pos };
                    updateCycleBadge(e.clientX, e.clientY, r.pos, r.members.length);
                    // View mode: selecting a shape shows its vertex handles right
                    // away. Other tool modes: a second click on the same single
                    // shape (manual double-click — the browser's dblclick is
                    // unreliable because draw() replaces the SVG target between
                    // clicks) enters edit mode, e.g. to adjust a just-drawn box.
                    if (currentMode === 'view') {
                        enterShapeEditMode(r.targetIndex);
                    } else if (sameSpot && overlappingShapes.length === 1 && r.targetIndex === prevSelected) {
                        enterShapeEditMode(r.targetIndex);
                    }
                }

                // 更新点击位置和时间。时间戳在重绘完成后记录：处理器自身的
                // 渲染耗时不应侵占双击判定的 500ms 窗口（慢机器/大图时尤其明显）
                lastClickX = x;
                lastClickY = y;

                renderShapeList();
                draw();
                lastClickTime = Date.now();
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
            } else if (currentMode === 'circle') {
                isDrawing = true;
                // Circle: first click = center, second click = a point on the circumference.
                // We store the live edge point as points[1] (initially equal to center) and
                // refresh it in mousemove until the user clicks again.
                const center = clampImageCoords(x, y);
                currentPoints = [center, center];
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
                    const isDoubleClickOnLast = distanceToLast < CLICK_THRESHOLD_DISTANCE / zoomLevel && timeDiff < CLICK_THRESHOLD_TIME;

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
            } else if (currentMode === 'circle') {
                // Second click sets the edge point and finalises the circle.
                // Clamp the edge to image bounds so the recorded shape never
                // contains coordinates outside [0, w]×[0, h] — matches the
                // rectangle/polygon convention. Whole-shape drag has a
                // separate code path that preserves radius near the boundary.
                if (currentPoints.length >= 1) {
                    currentPoints[1] = clampImageCoords(x, y);
                }
                const r = getCircleRadius(currentPoints);
                if (r < 0.5) {
                    // Reject degenerate circles; keep the center so the user can re-click
                    // a real edge point instead of starting over.
                    if (window.notifyBus) {
                        const msg = (window.i18n && window.i18n.t)
                            ? window.i18n.t('status.circleTooSmall')
                            : 'Circle too small';
                        window.notifyBus.show('warn', msg);
                    }
                } else {
                    finishPolygon();
                }
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
            } else if (currentMode === 'circle') {
                // Cancel circle drawing
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
    // --- Update crosshair guide position (rendered in drawSVGAnnotations) ---
    if (crosshairEnabled) {
        const chRect = canvas.getBoundingClientRect();
        crosshairPos = {
            x: (e.clientX - chRect.left) / zoomLevel,
            y: (e.clientY - chRect.top) / zoomLevel
        };
        if (!isDrawing && !isBoxSelecting && !eraserActive && !eraserMouseDownPos &&
            DRAWING_MODES.includes(currentMode) && crosshairRafId === null) {
            crosshairRafId = requestAnimationFrame(() => {
                crosshairRafId = null;
                draw();
            });
        }
    }

    // --- Eraser mousemove handling ---
    // Phase 1: During initial mousedown-hold (before mouseup determines mode)
    if (eraserMouseDownPos && !eraserActive) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / zoomLevel;
        const y = (e.clientY - rect.top) / zoomLevel;
        const dx = x - eraserMouseDownPos.x;
        const dy = y - eraserMouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > ERASER_DRAG_THRESHOLD / zoomLevel) {
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
                } else if (currentMode === 'circle' && currentPoints.length >= 1) {
                    const rect = canvas.getBoundingClientRect();
                    const mx = e.clientX - rect.left;
                    const my = e.clientY - rect.top;
                    const x = mx / zoomLevel;
                    const y = my / zoomLevel;
                    // Keep the center fixed; the live edge point clamps to
                    // image bounds so the second-click capture below matches
                    // the rubber-band preview.
                    currentPoints = [currentPoints[0], clampImageCoords(x, y)];
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

        const hoveredIndex = allowSelectByClick(currentMode, drawClickThrough) ? findShapeIndexAt(x, y) : -1;
        const desiredCursor = hoveredIndex !== -1 ? 'pointer' :
            (currentMode === 'view' ? 'default' : 'crosshair');

        // 只在光标需要改变时更新样式
        if (currentCursor !== desiredCursor) {
            canvasWrapper.style.cursor = desiredCursor;
            currentCursor = desiredCursor;
        }

        // Hover preview: redraw only when the would-be-selected shape changes.
        if (hoveredIndex !== hoveredShapeIndex) {
            hoveredShapeIndex = hoveredIndex;
            draw();
        }
    }
});

canvasWrapper.addEventListener('mouseleave', () => {
    if (crosshairPos) {
        crosshairPos = null;
        if (DRAWING_MODES.includes(currentMode)) draw();
    }
    if (hoveredShapeIndex !== -1) {
        hoveredShapeIndex = -1;
        draw();
    }
    hideCycleBadge();
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
            if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD_DISTANCE / zoomLevel) {
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
    // Update labels for multi-selection. Strings route through i18n so the
    // context menu stays localised when the user changes language mid-session.
    const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
    if (contextMenuRename) {
        contextMenuRename.textContent = multi
            ? tt('context.renameCount', { count: selectedShapeIndices.size })
            : tt('context.rename');
    }
    if (contextMenuMerge) {
        const eligibleForMerge = selectedShapeIndices.size >= 2
            && [...selectedShapeIndices].every(i => {
                const t = shapes[i] && shapes[i].shape_type;
                return t === 'polygon' || t === 'rectangle';
            });
        contextMenuMerge.style.display = eligibleForMerge ? '' : 'none';
        if (eligibleForMerge) {
            contextMenuMerge.textContent = tt('context.mergeCount', { count: selectedShapeIndices.size });
        }
    }
    if (contextMenuToggleVisible) {
        if (multi) {
            const anyVisible = [...selectedShapeIndices].some(idx => shapes[idx].visible !== false);
            contextMenuToggleVisible.textContent = anyVisible
                ? tt('context.hideCount', { count: selectedShapeIndices.size })
                : tt('context.showCount', { count: selectedShapeIndices.size });
        } else {
            const shape = shapes[selectedShapeIndex];
            contextMenuToggleVisible.textContent = (shape && shape.visible === false) ? tt('context.show') : tt('context.hide');
        }
    }
    if (contextMenuDelete) {
        contextMenuDelete.textContent = multi
            ? tt('context.deleteCount', { count: selectedShapeIndices.size })
            : tt('context.delete');
    }

    // Position at the cursor, then keep the whole menu inside the visible canvas
    // viewport: flip left/up near the right/bottom edges and clamp so it never
    // renders off-screen. The menu is absolute within #canvasWrapper, which can be
    // larger than — and scrolled within — the .canvas-container viewport, so we
    // clamp in client coords against that viewport and convert back to wrapper space.
    shapeContextMenu.style.visibility = 'hidden';
    shapeContextMenu.style.display = 'block';
    const menuW = shapeContextMenu.offsetWidth;
    const menuH = shapeContextMenu.offsetHeight;
    const wrapperRect = canvasWrapper.getBoundingClientRect();
    const view = canvasContainer
        ? canvasContainer.getBoundingClientRect()
        : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const M = 4; // keep a small gap from the viewport edge
    let clientLeft = (clientX + menuW > view.right) ? clientX - menuW : clientX;
    clientLeft = Math.max(view.left + M, Math.min(clientLeft, view.right - menuW - M));
    let clientTop = (clientY + menuH > view.bottom) ? clientY - menuH : clientY;
    clientTop = Math.max(view.top + M, Math.min(clientTop, view.bottom - menuH - M));
    shapeContextMenu.style.left = (clientLeft - wrapperRect.left) + 'px';
    shapeContextMenu.style.top = (clientTop - wrapperRect.top) + 'px';
    shapeContextMenu.style.visibility = '';
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
    const ns = window.mergeShapesHelpers || null;
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
    const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
    if (!allEligible) {
        setMergeStatus(tt('status.mergePolyRectOnly'), 'orange');
        return;
    }
    const pc = window.polygonClipping || (typeof polygonClipping !== 'undefined' ? polygonClipping : null);
    if (!pc) {
        setMergeStatus(tt('status.mergeUnavailable'), 'red');
        return;
    }
    const fn = resolveMergeHelpers();
    if (!fn) {
        setMergeStatus(tt('status.mergeUnavailable'), 'red');
        return;
    }

    const groups = fn.buildOverlapGroups(pc, shapes, indices);
    if (groups.length === 0) {
        setMergeStatus(tt('status.mergeNoOverlap'), 'orange');
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
        setMergeStatus(tt('status.mergeNoGeometry'), 'orange');
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
        setMergeStatus(tt('status.mergeUnavailable'), 'red');
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
