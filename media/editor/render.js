// LabelEditor webview — Theme, mode switching, and drawing (canvas image layer + SVG overlay).
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

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
    // YOLO datasets only support view/sam/polygon/rectangle.
    if (window.annotationFormat === 'yolo' && (mode === 'point' || mode === 'line' || mode === 'circle')) {
        return;
    }
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

    // Overlap cycling, its badge, and the hover preview don't carry across a
    // mode switch — reset them so nothing stale lingers in the new mode.
    overlapCycleState = { members: [], pos: -1 };
    hideCycleBadge();
    hoveredShapeIndex = -1;

    // Clear SAM state when leaving SAM mode
    if (currentMode === 'sam' && mode !== 'sam') {
        samClearState();
    }

    // If entering SAM mode, check service availability
    if (mode === 'sam') {
        // Paint the just-cleared hover/badge state synchronously: this path
        // returns early and samCheckAndEnterMode only redraws asynchronously on
        // success (and not at all when the service check fails).
        draw();
        samCheckAndEnterMode();
        return; // samCheckAndEnterMode will call the rest of setMode internally
    }

    currentMode = mode;

    // 保存到vscode state
    saveState();

    // 更新按钮状态
    updateModeButtons();

    // Re-render so shape interactivity (pointer-events) reflects the new mode
    draw();
}

function updateModeButtons() {
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
}


// --- Drawing Logic ---
function draw(mouseEvent) {
    if (imageLoadPending) return; // img.onload redraws
    // Canvas只绘制图片
    const needsProcessing = selectedChannel !== 'rgb' || claheEnabled;
    const source = needsProcessing ? getProcessedCanvas() : null;
    const key = (source ? 'p:' + processedKey : 'i:' + img.src)
        + `|${img.width}x${img.height}|${canvas.width}x${canvas.height}`;
    if (key !== imageLayerKey) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source || img, 0, 0, img.width, img.height);
        imageLayerKey = key;
    }

    // SVG绘制标注
    drawSVGAnnotations(mouseEvent);
}

// Completed shapes are rendered into svgShapesLayer, one <g> per shape, reused
// across frames while nothing that affects its markup changes. Rebuilding
// every shape's DOM on every mouse move was the dominant redraw cost with many
// shapes. Everything after the layer in svgOverlay (drawing/eraser/box-select
// previews, SAM overlay, pixel values) is transient and rebuilt each frame.
// Geometry identity for the render cache: points arrays are treated as
// immutable (every edit assigns a new array — keep it that way), so the
// array's identity stands in for its contents without serialising every
// shape's coordinates each frame.
const pointsRenderIds = new WeakMap();
let nextPointsRenderId = 1;
function pointsRenderId(points) {
    let id = pointsRenderIds.get(points);
    if (id === undefined) {
        id = nextPointsRenderId++;
        pointsRenderIds.set(points, id);
    }
    return id;
}

function shapeRenderSignature(shape, index, strokeColor, fillColor, strokeDash, labelColor) {
    return [
        index, shape.shape_type, pointsRenderId(shape.points),
        strokeColor, fillColor, strokeDash, zoomLevel, borderWidth,
        allowSelectByClick(currentMode, drawClickThrough),
        isEditingShape && index === shapeBeingEdited,
        showShapeLabels && shape.label ? shape.label + '|' + labelColor : ''
    ].join('\u0001');
}

// Make svgShapesLayer's children exactly `nodes`, touching only what changed.
// `reused` = how many of them were taken from the cache.
function reconcileShapeNodes(nodes, reused) {
    const layer = svgShapesLayer;
    if (reused === 0) {
        // Everything changed (zoom, new image, undo): swap the lot in one go.
        const frag = document.createDocumentFragment();
        for (const node of nodes) frag.appendChild(node);
        layer.textContent = '';
        layer.appendChild(frag);
        return;
    }
    const keep = new Set(nodes);
    for (let i = 0; i < nodes.length; i++) {
        const current = layer.childNodes[i];
        if (current === nodes[i]) continue;
        if (current && !keep.has(current)) layer.replaceChild(nodes[i], current);
        else layer.insertBefore(nodes[i], current || null);
    }
    while (layer.childNodes.length > nodes.length) layer.removeChild(layer.lastChild);
}

function drawSVGAnnotations(mouseEvent) {
    if (imageLoadPending) return; // img.onload redraws
    // 清除上一帧的临时内容（保留已缓存的形状层）
    if (svgOverlay.firstChild !== svgShapesLayer) {
        svgOverlay.textContent = '';
        svgOverlay.appendChild(svgShapesLayer);
    }
    while (svgOverlay.lastChild !== svgShapesLayer) svgOverlay.removeChild(svgOverlay.lastChild);

    // 绘制已完成的形状
    const nextCache = new Map();
    const nodes = [];
    let reused = 0;
    shapes.forEach((shape, index) => {
        if (shape.visible === false) return; // Skip hidden shapes

        const isSelected = isShapeSelected(index);
        const isHovered = !isDrawing && index === hoveredShapeIndex && !isSelected;
        const colors = getColorsForLabel(shape.label);

        let strokeColor = colors.stroke;
        let fillColor = colors.fill;
        let strokeDash = null;

        if (isSelected) {
            strokeColor = 'rgba(255, 255, 0, 1)';
            // Use global fillOpacity but ensure at least 0.1 visibility for selection
            const selectionOpacity = Math.max(0.1, fillOpacity);
            fillColor = `rgba(255, 255, 0, ${selectionOpacity})`;
        } else if (isHovered) {
            // Hover preview: white dashed outline over the normal fill — distinct
            // from the solid-yellow selection state.
            strokeColor = 'rgba(255, 255, 255, 0.95)';
            strokeDash = `${6 / zoomLevel},${4 / zoomLevel}`;
        }

        const signature = shapeRenderSignature(shape, index, strokeColor, fillColor, strokeDash, colors.stroke);
        let node = shapeNodeCache.get(signature);
        if (node && !nextCache.has(signature)) {
            reused++;
        } else {
            let points = shape.points;
            if (shape.shape_type === 'rectangle') {
                points = getRectPoints(points);
            }
            node = document.createElementNS(SVG_NS, 'g');
            drawSVGShape(shape.shape_type, points, strokeColor, fillColor, false, index, strokeDash, node);
            if (showShapeLabels && shape.label) {
                drawShapeLabel(shape, points, colors.stroke, node);
            }
        }
        nextCache.set(signature, node);
        nodes.push(node);
    });
    reconcileShapeNodes(nodes, reused);
    shapeNodeCache = nextCache;

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

    // --- Draw dashed crosshair guide in drawing modes (color adapts to image brightness) ---
    if (crosshairEnabled && crosshairPos && DRAWING_MODES.includes(currentMode) && img.width > 0 && img.height > 0) {
        const dash = `${6 / zoomLevel} ${4 / zoomLevel}`;
        const ccx = Math.min(img.width - 1, Math.max(0, Math.round(crosshairPos.x)));
        const ccy = Math.min(img.height - 1, Math.max(0, Math.round(crosshairPos.y)));
        const lineColor = getCrosshairColor(ccx, ccy);
        for (const [x1, y1, x2, y2] of [[0, ccy, img.width, ccy], [ccx, 0, ccx, img.height]]) {
            const lineEl = document.createElementNS(SVG_NS, 'line');
            lineEl.setAttribute('x1', x1); lineEl.setAttribute('y1', y1);
            lineEl.setAttribute('x2', x2); lineEl.setAttribute('y2', y2);
            lineEl.setAttribute('stroke', lineColor);
            lineEl.setAttribute('stroke-width', 1.5 / zoomLevel);
            lineEl.setAttribute('stroke-dasharray', dash);
            lineEl.style.pointerEvents = 'none';
            svgOverlay.appendChild(lineEl);
        }
    }
}

// Sample luminance along the crosshair row/column and pick a high-contrast
// line color. Emulates the CSS brightness/contrast filter applied to the
// canvas element, since getImageData reads unfiltered pixels.
// Results are cached per 16px cursor bucket, and invalidated whenever the
// image or the channel/CLAHE/brightness/contrast state changes.
const CROSSHAIR_BUCKET = 16; // image px quantization for the luminance cache
let crosshairColorCache = null;

function getCrosshairColor(cx, cy) {
    const sig = `${Math.round(cx / CROSSHAIR_BUCKET)}_${Math.round(cy / CROSSHAIR_BUCKET)}_` +
        `${currentImageLoadId}_${img.width}x${img.height}_` +
        `${brightness}_${contrast}_${selectedChannel}_${claheEnabled}`;
    if (crosshairColorCache && crosshairColorCache.sig === sig) {
        return crosshairColorCache.color;
    }

    let lum = 0.5;
    try {
        const row = ctx.getImageData(0, cy, img.width, 1).data;
        const col = ctx.getImageData(cx, 0, 1, img.height).data;
        let sum = 0, n = 0;
        for (let i = 0; i < row.length; i += 16) { // sample every 4th pixel
            sum += 0.299 * row[i] + 0.587 * row[i + 1] + 0.114 * row[i + 2];
            n++;
        }
        for (let i = 0; i < col.length; i += 16) {
            sum += 0.299 * col[i] + 0.587 * col[i + 1] + 0.114 * col[i + 2];
            n++;
        }
        if (n > 0) lum = (sum / n) / 255;
    } catch (e) { /* tainted canvas or read failure: use mid gray */ }
    lum = Math.min(1, Math.max(0, ((lum - 0.5) * (contrast / 100) + 0.5) * (brightness / 100)));
    const color = lum > 0.5 ? 'rgba(0, 110, 40, 0.95)' : 'rgba(0, 255, 120, 0.95)';
    crosshairColorCache = { sig, color };
    return color;
}

// Label text metrics at a 12px screen size, measured once per label with a
// canvas context. Measuring the SVG <text> with getBBox() instead forced a
// synchronous layout for every label on every frame (seconds per redraw with
// a thousand labelled shapes).
function measureLabel(label) {
    let m = labelMetricsCache.get(label);
    if (!m) {
        if (!labelMeasureCtx) {
            labelMeasureCtx = document.createElement('canvas').getContext('2d');
            labelMeasureCtx.font = `${LABEL_FONT_PX}px sans-serif`;
        }
        const tm = labelMeasureCtx.measureText(label);
        m = {
            width: tm.width,
            ascent: tm.fontBoundingBoxAscent ?? LABEL_FONT_PX * 0.8,
            descent: tm.fontBoundingBoxDescent ?? LABEL_FONT_PX * 0.2
        };
        labelMetricsCache.set(label, m);
    }
    return m;
}

// Draw an instance's class name as a small colored pill at its top-left.
// `points` is already rect-expanded by the caller; `color` is the shape's stroke.
function drawShapeLabel(shape, points, color, parent = svgOverlay) {
    const label = shape && shape.label;
    if (!label) return;
    const anchor = labelAnchorFromPoints(points);
    if (!anchor) return;

    const fontSize = LABEL_FONT_PX / zoomLevel;
    const padX = 4 / zoomLevel;
    const padY = 2 / zoomLevel;

    // Text box in image units: baseline at (anchor.y - padY), font ascent above.
    const metrics = measureLabel(label);
    const boxW = metrics.width / zoomLevel;
    const boxH = (metrics.ascent + metrics.descent) / zoomLevel;
    const textX = anchor.x + padX;
    const baselineY = anchor.y - padY;
    const boxY = baselineY - metrics.ascent / zoomLevel;

    // Keep the label inside the image: if the pill would overflow the top or
    // left edge (shapes touching y=0 / x=0), shift the text + pill back in by
    // the overflow so it stays visible instead of rendering outside the viewBox.
    const pillX = textX - padX;
    const pillY = boxY - padY;
    const dx = pillX < 0 ? -pillX : 0;
    const dy = pillY < 0 ? -pillY : 0;

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', pillX + dx);
    rect.setAttribute('y', pillY + dy);
    rect.setAttribute('width', boxW + padX * 2);
    rect.setAttribute('height', boxH + padY * 2);
    rect.setAttribute('rx', 2 / zoomLevel);
    rect.setAttribute('fill', color);
    rect.style.pointerEvents = 'none';
    parent.appendChild(rect); // pill behind the text

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', textX + dx);
    text.setAttribute('y', baselineY + dy);
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-size', fontSize);
    text.setAttribute('font-family', 'sans-serif');
    text.setAttribute('dominant-baseline', 'alphabetic');
    text.style.pointerEvents = 'none';
    text.textContent = label;
    parent.appendChild(text);
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

function drawSVGShape(shapeType, points, strokeColor, fillColor, showVertices = false, shapeIndex = -1, strokeDashArray = null, parent = svgOverlay) {
    if (points.length === 0) return;

    const group = document.createElementNS(SVG_NS, 'g');

    // When click-through is on in a drawing mode, completed shapes must not
    // capture pointer events — otherwise hovering shows a pointer cursor and
    // the svgOverlay click-delegation would still select/highlight them.
    const shapeSelectable = allowSelectByClick(currentMode, drawClickThrough);

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
            if (strokeDashArray) circle.setAttribute('stroke-dasharray', strokeDashArray);
            circle.setAttribute('fill', fillColor);

            if (shapeIndex !== -1) {
                circle.style.cursor = shapeSelectable ? 'pointer' : 'crosshair';
                circle.style.pointerEvents = shapeSelectable ? 'auto' : 'none';
                circle.dataset.shapeIndex = shapeIndex;
            }

            group.appendChild(circle);
        }
    } else if (shapeType === 'circle') {
        if (points.length >= 2) {
            const isCompleted = shapeIndex !== -1;
            const cx = points[0][0];
            const cy = points[0][1];
            const r = getCircleRadius(points);
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', r);
            circle.setAttribute('stroke', strokeColor);
            circle.setAttribute('stroke-width', adjustedStrokeWidth);
            if (strokeDashArray) circle.setAttribute('stroke-dasharray', strokeDashArray);
            circle.setAttribute('fill', isCompleted ? fillColor : 'none');

            if (isCompleted) {
                circle.style.cursor = shapeSelectable ? 'pointer' : 'crosshair';
                circle.style.pointerEvents = shapeSelectable ? 'auto' : 'none';
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
        if (strokeDashArray) pathElement.setAttribute('stroke-dasharray', strokeDashArray);

        // 为完成的形状添加data属性用于事件委托
        if (shapeIndex !== -1) {
            pathElement.style.cursor = shapeSelectable ? 'pointer' : 'crosshair';
            pathElement.style.pointerEvents = shapeSelectable ? 'auto' : 'none';
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

    parent.appendChild(group);
}

// Shape selection is handled entirely by the canvasWrapper 'mousedown' handler
// (coordinate-based hit-test → smallest-first ordering + click-to-cycle + badge).
// A legacy svgOverlay 'click' delegation used to live here; it selected the
// topmost dataset.shapeIndex directly, bypassing and overriding that logic, so it
// was removed. Vertex editing is coordinate-based (findVertexAt) and edit mode is
// entered via the context menu, so neither depended on this handler.

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
            // Lets the extension reject a save that raced with navigation.
            imagePath: currentAbsoluteImagePath,
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
