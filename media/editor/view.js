// LabelEditor webview — Zoom and view state, dirty tracking, undo/redo history, pixel-level rendering.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

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
    if (window.notifyBus) {
        const msg = (window.i18n && window.i18n.t) ? window.i18n.t('status.imageLoadError') : 'Error loading image';
        window.notifyBus.show('error', msg, { sticky: true, key: 'image.error' });
    }
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
        // Same for a save still in flight: its snapshot slot is about to be reused.
        if (pendingSaveHistoryIndex > historyIndex) {
            pendingSaveHistoryIndex = -1;
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
        // Keep an in-flight save's index pointing at the same snapshot, or
        // saveComplete would mark a newer, unsaved snapshot clean.
        if (pendingSaveHistoryIndex >= 0) {
            pendingSaveHistoryIndex--;
        }
    } else {
        historyIndex++;
    }
}

// Visibility is view state (never saved, never its own undo step), so an
// undo/redo keeps what the user currently sees instead of rolling it back to
// whatever the snapshot captured. Shapes with no current counterpart (e.g. one
// an undo brings back) follow their label's visibility toggle, if any.
function restoreHistorySnapshot(snapshot) {
    return carryOverVisibility(shapes, structuredClone(snapshot), shape =>
        labelVisibilityState.has(shape.label)
            ? labelVisibilityState.get(shape.label)
            : shape.visible !== false);
}

function undo() {
    if (historyIndex > 0) {
        // Exit edit mode before swapping snapshot — stale shapeBeingEdited would crash
        if (isEditingShape) exitShapeEditMode(false);

        historyIndex--;
        shapes = restoreHistorySnapshot(history[historyIndex]);

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
        shapes = restoreHistorySnapshot(history[historyIndex]);

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
    // Canvas 保持原始图片尺寸 (resolution). Assigning width/height clears the
    // canvas even when the value is unchanged, so only do it on a real change.
    if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
        imageLayerKey = '';
    }

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
