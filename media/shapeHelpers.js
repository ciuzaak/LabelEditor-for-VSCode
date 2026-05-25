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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { allowSelectByClick, contourToBBoxRect, labelAnchorFromPoints };
}
