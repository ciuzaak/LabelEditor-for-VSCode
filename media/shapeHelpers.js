// Pure helpers for canvas shape interaction, SAM output shaping, and class
// label placement. Loaded as a <script> in the webview AND required from Node
// tests. No DOM access here.

// Feature 1: whether a left-click should be allowed to SELECT an existing
// instance. `drawClickThrough` true means clicks "pass through" existing
// instances to start drawing, so selection is suppressed. View mode is always
// selectable; other (drawing) modes are selectable only when drawClickThrough
// is false.
function allowSelectByClick(currentMode, drawClickThrough) {
    return currentMode === 'view' || !drawClickThrough;
}

// Feature 2: reduce a SAM mask contour (array of [x, y]) to an axis-aligned
// rectangle in the 2-point format [[minX, minY], [maxX, maxY]]. Returns null
// when the contour is missing or has no usable points.
function contourToBBoxRect(contour) {
    if (!Array.isArray(contour) || contour.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;
    for (const p of contour) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = p[0], y = p[1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
    }
    if (count === 0) return null;
    return [[minX, minY], [maxX, maxY]];
}

// Feature 3: top-left anchor (image coords) for an instance's class label,
// computed from already-expanded polygon points (the caller pre-expands
// rectangles to 4 corners). Returns { x, y } or null when no point is usable.
function labelAnchorFromPoints(points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    let minX = Infinity, minY = Infinity;
    let found = false;
    for (const p of points) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = p[0], y = p[1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        found = true;
    }
    if (!found) return null;
    return { x: minX, y: minY };
}

// Overlapping-instance selection ------------------------------------------

// Polygon area via the shoelace formula (absolute value). 0 for degenerate
// input (< 3 points).
function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let sum = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
    }
    return Math.abs(sum) / 2;
}

// Area of a shape in image coordinates (zoom-independent). Points and
// linestrips have no fill and are the hardest to click, so they get area 0
// and always sort ahead of filled shapes.
function shapeArea(shape) {
    if (!shape) return Infinity;
    const pts = shape.points || [];
    switch (shape.shape_type) {
        case 'point':
        case 'linestrip':
        case 'line':
            return 0;
        case 'circle': {
            if (pts.length < 2) return 0;
            const r = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
            return Math.PI * r * r;
        }
        case 'rectangle': {
            if (pts.length < 2) return 0;
            return Math.abs(pts[1][0] - pts[0][0]) * Math.abs(pts[1][1] - pts[0][1]);
        }
        default:
            return polygonArea(pts);
    }
}

// Stable ascending-by-area sort of candidate indices. An explicit tie-break
// on original position keeps topmost-first (the input is reverse draw order)
// without relying on Array.sort stability.
function sortOverlapCandidates(indices, shapes) {
    return indices
        .map((idx, ord) => ({ idx, ord, area: shapeArea(shapes[idx]) }))
        .sort((a, b) => (a.area - b.area) || (a.ord - b.ord))
        .map(e => e.idx);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { allowSelectByClick, contourToBBoxRect, labelAnchorFromPoints, shapeArea, sortOverlapCandidates };
}
