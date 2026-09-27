// LabelEditor webview — Eraser tool and polygon clipping.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- Eraser Logic ---

// Cancel any ongoing eraser operation
function cancelEraser() {
    eraserActive = false;
    eraserPoints = [];
    eraserMode = null;
    eraserMouseDownTime = 0;
    eraserMouseDownPos = null;
    eraserIsDragging = false;
    eraserDragCurrent = null;
    eraserRectSecondClick = false;
    draw();
}

// Finish eraser drawing and perform the erase operation
function finishEraser() {
    if (eraserPoints.length < 3 && eraserMode === 'polygon') {
        cancelEraser();
        return;
    }
    if (eraserMode === 'rectangle' && eraserPoints.length !== 2) {
        cancelEraser();
        return;
    }

    // Convert rectangle points to polygon (4 corners)
    let eraserPolygon;
    if (eraserMode === 'rectangle') {
        eraserPolygon = getRectPoints(eraserPoints);
    } else {
        eraserPolygon = eraserPoints.slice();
    }

    performErase(eraserPolygon);
    cancelEraser();
}

// Core erase operation: subtract the eraser polygon from all existing instances
function performErase(eraserPolygon) {
    if (eraserPolygon.length < 3) return;

    // Convert eraser polygon to polygon-clipping format: [[[x,y], [x,y], ...]]
    // polygon-clipping expects rings as arrays of [x,y] with first ring = outer boundary
    const clipRing = eraserPolygon.map(p => [p[0], p[1]]);
    // Close the ring (polygon-clipping requires it)
    if (clipRing[0][0] !== clipRing[clipRing.length - 1][0] ||
        clipRing[0][1] !== clipRing[clipRing.length - 1][1]) {
        clipRing.push([clipRing[0][0], clipRing[0][1]]);
    }
    const clipGeom = [clipRing];

    let modified = false;
    const shapesToRemove = [];

    for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i];

        // Hidden shapes are out of play, as for click and box selection —
        // hiding a class is how the user protects it while erasing others.
        if (shape.visible === false) continue;

        if (shape.shape_type === 'point') {
            // Point: delete if inside eraser polygon
            if (shape.points.length > 0 && isPointInPolygon(shape.points[0], eraserPolygon)) {
                shapesToRemove.push(i);
                modified = true;
            }
        } else if (shape.shape_type === 'linestrip') {
            // Linestrip: truncate segments that fall inside the eraser polygon
            const newSegments = truncateLinestrip(shape.points, eraserPolygon);
            if (newSegments.length === 0) {
                // Entire linestrip was erased
                shapesToRemove.push(i);
                modified = true;
            } else if (newSegments.length === 1 && pointsArrayEqual(newSegments[0], shape.points)) {
                // Unchanged
            } else {
                // Replace with first segment, add additional segments as new shapes
                shape.points = newSegments[0];
                let inserted = 0;
                for (let j = 1; j < newSegments.length; j++) {
                    if (newSegments[j].length >= 2) {
                        shapes.splice(i + j, 0, {
                            label: shape.label,
                            points: newSegments[j],
                            group_id: shape.group_id,
                            shape_type: 'linestrip',
                            flags: { ...shape.flags },
                            visible: shape.visible,
                            description: shape.description
                        });
                        inserted++;
                    }
                }
                if (inserted > 0) {
                    adjustSelectionAfterInsert(i, inserted);
                }
                i += inserted; // Skip past inserted shapes
                modified = true;
            }
        } else if (shape.shape_type === 'rectangle') {
            // Rectangle: convert to polygon, compute difference
            const rectPoly = getRectPoints(shape.points);
            const originalArea = Math.abs(signedPolygonArea(rectPoly));
            const result = computePolygonDifference(rectPoly, clipGeom);
            if (result.length === 0) {
                shapesToRemove.push(i);
                modified = true;
            } else {
                // Decompose each result polygon (including holes) into hole-free pieces
                const flatPolys = result.flatMap(poly => {
                    const rings = poly.map(ring => removeClosingPoint(ring));
                    return decomposePolygonWithHoles(rings);
                }).filter(pts => pts.length >= 3);

                if (flatPolys.length === 0) {
                    shapesToRemove.push(i);
                    modified = true;
                } else {
                    // Check if area changed (no-op detection)
                    const resultArea = flatPolys.reduce((sum, pts) => sum + Math.abs(signedPolygonArea(pts)), 0);
                    if (Math.abs(resultArea - originalArea) < 1e-4) {
                        // No actual change - eraser didn't overlap
                    } else if (flatPolys.length === 1 && isAxisAlignedRect(flatPolys[0]) && flatPolys[0].length === 4) {
                        // Still a simple rectangle - keep as rectangle type
                        const bbox = getPolygonBBox(flatPolys[0]);
                        shape.points = [[bbox.minX, bbox.minY], [bbox.maxX, bbox.maxY]];
                        modified = true;
                    } else {
                        // Convert to polygon(s)
                        shape.shape_type = 'polygon';
                        shape.points = flatPolys[0];
                        let inserted = 0;
                        for (let j = 1; j < flatPolys.length; j++) {
                            shapes.splice(i + 1 + inserted, 0, {
                                label: shape.label,
                                points: flatPolys[j],
                                group_id: shape.group_id,
                                shape_type: 'polygon',
                                flags: { ...shape.flags },
                                visible: shape.visible,
                                description: shape.description
                            });
                            inserted++;
                        }
                        if (inserted > 0) {
                            adjustSelectionAfterInsert(i, inserted);
                        }
                        i += inserted;
                        modified = true;
                    }
                }
            }
        } else if (shape.shape_type === 'circle') {
            // Circle: polygonize to a 32-segment ring, then apply the same
            // difference + decomposition flow as polygon. The shape decays to
            // a polygon (or multiple polygons) whenever the eraser changes its area.
            const circlePoly = polygonizeCircle(shape.points[0][0], shape.points[0][1], getCircleRadius(shape.points), 32);
            const originalArea = Math.abs(signedPolygonArea(circlePoly));
            const result = computePolygonDifference(circlePoly, clipGeom);
            if (result.length === 0) {
                shapesToRemove.push(i);
                modified = true;
            } else {
                const flatPolys = result.flatMap(poly => {
                    const rings = poly.map(ring => removeClosingPoint(ring));
                    return decomposePolygonWithHoles(rings);
                }).filter(pts => pts.length >= 3);

                if (flatPolys.length === 0) {
                    shapesToRemove.push(i);
                    modified = true;
                } else {
                    const resultArea = flatPolys.reduce((sum, pts) => sum + Math.abs(signedPolygonArea(pts)), 0);
                    if (Math.abs(resultArea - originalArea) < 1e-4) {
                        // No actual overlap with the circle.
                    } else {
                        shape.shape_type = 'polygon';
                        shape.points = flatPolys[0];
                        let inserted = 0;
                        for (let j = 1; j < flatPolys.length; j++) {
                            shapes.splice(i + 1 + inserted, 0, {
                                label: shape.label,
                                points: flatPolys[j],
                                group_id: shape.group_id,
                                shape_type: 'polygon',
                                flags: { ...shape.flags },
                                visible: shape.visible,
                                description: shape.description
                            });
                            inserted++;
                        }
                        if (inserted > 0) {
                            adjustSelectionAfterInsert(i, inserted);
                        }
                        i += inserted;
                        modified = true;
                    }
                }
            }
        } else {
            // Polygon: compute difference directly
            const originalArea = Math.abs(signedPolygonArea(shape.points));
            const result = computePolygonDifference(shape.points, clipGeom);
            if (result.length === 0) {
                shapesToRemove.push(i);
                modified = true;
            } else {
                // Decompose each result polygon (including holes) into hole-free pieces
                const flatPolys = result.flatMap(poly => {
                    const rings = poly.map(ring => removeClosingPoint(ring));
                    return decomposePolygonWithHoles(rings);
                }).filter(pts => pts.length >= 3);

                if (flatPolys.length === 0) {
                    shapesToRemove.push(i);
                    modified = true;
                } else {
                    // Check if area changed (no-op detection)
                    const resultArea = flatPolys.reduce((sum, pts) => sum + Math.abs(signedPolygonArea(pts)), 0);
                    if (Math.abs(resultArea - originalArea) < 1e-4) {
                        // No actual change - eraser didn't overlap this shape
                    } else {
                        shape.points = flatPolys[0];
                        let inserted = 0;
                        for (let j = 1; j < flatPolys.length; j++) {
                            shapes.splice(i + 1 + inserted, 0, {
                                label: shape.label,
                                points: flatPolys[j],
                                group_id: shape.group_id,
                                shape_type: 'polygon',
                                flags: { ...shape.flags },
                                visible: shape.visible,
                                description: shape.description
                            });
                            inserted++;
                        }
                        if (inserted > 0) {
                            adjustSelectionAfterInsert(i, inserted);
                        }
                        i += inserted;
                        modified = true;
                    }
                }
            }
        }
    }

    // Remove shapes marked for deletion (iterate in reverse to keep indices valid)
    for (let i = shapesToRemove.length - 1; i >= 0; i--) {
        const idx = shapesToRemove[i];
        shapes.splice(idx, 1);
        adjustSelectionAfterDelete(idx);
    }

    if (modified) {
        markDirty();
        saveHistory();
        renderShapeList();
        renderLabelsList();
        draw();
    }
}

// Compute polygon difference using polygon-clipping library
// subject: array of [x,y] points (the polygon to subtract from)
// clipGeom: polygon-clipping format polygon [ring, ring, ...] (the area to subtract)
// Returns: MultiPolygon in polygon-clipping format, or empty array
function computePolygonDifference(subjectPoints, clipGeom) {
    // Convert subject to polygon-clipping format
    const subjectRing = subjectPoints.map(p => [p[0], p[1]]);
    // Close the ring
    if (subjectRing.length > 0 &&
        (subjectRing[0][0] !== subjectRing[subjectRing.length - 1][0] ||
            subjectRing[0][1] !== subjectRing[subjectRing.length - 1][1])) {
        subjectRing.push([subjectRing[0][0], subjectRing[0][1]]);
    }
    const subjectGeom = [subjectRing];

    try {
        // polygonClipping is loaded from polygon-clipping.umd.min.js
        const result = polygonClipping.difference(subjectGeom, clipGeom);
        return result;
    } catch (e) {
        console.error('Polygon clipping error:', e);
        return [subjectGeom]; // Return original on error
    }
}

// Get bounding box of a set of points
function getPolygonBBox(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
}

// Remove closing point from a polygon ring if present (LabelMe format doesn't close).
function removeClosingPoint(ring) {
    const pts = ring.slice();
    if (pts.length > 1 &&
        pts[0][0] === pts[pts.length - 1][0] &&
        pts[0][1] === pts[pts.length - 1][1]) {
        pts.pop();
    }
    return pts;
}

// Check if 4 points form an axis-aligned rectangle.
function isAxisAlignedRect(points) {
    if (points.length !== 4) return false;
    const xs = points.map(p => p[0]).sort((a, b) => a - b);
    const ys = points.map(p => p[1]).sort((a, b) => a - b);
    // Must have exactly 2 unique X values and 2 unique Y values
    const ux = [xs[0], xs[1], xs[2], xs[3]];
    const uy = [ys[0], ys[1], ys[2], ys[3]];
    return Math.abs(ux[0] - ux[1]) < 1e-6 && Math.abs(ux[2] - ux[3]) < 1e-6 &&
        Math.abs(uy[0] - uy[1]) < 1e-6 && Math.abs(uy[2] - uy[3]) < 1e-6;
}

// Compute signed area of a polygon (shoelace formula).
// Positive = counter-clockwise, negative = clockwise.
// (Named distinctly from shapeHelpers.js's absolute-value polygonArea: all
// webview scripts share one global scope, and a same-named declaration here
// used to replace that one, making overlap-click ordering area-sign dependent.)
function signedPolygonArea(pts) {
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    }
    return area / 2;
}

// Decompose a polygon-with-holes into multiple hole-free polygons.
// Uses polygon-clipping to recursively slice through holes with alternating vertical/horizontal cuts.
// polyRings: [outerRing, hole1, hole2, ...] where each ring is [[x,y], ...] (NOT closed)
// Returns an array of flat polygon point arrays (each [[x,y], ...]).
function decomposePolygonWithHoles(polyRings, depth) {
    if (polyRings.length <= 1) return [polyRings[0]];
    if (depth === undefined) depth = 0;

    // Safety: stop recursion after 8 levels — use iterative single-hole subtraction as fallback
    if (depth >= 8) {
        const pc = window.polygonClipping || (typeof polygonClipping !== 'undefined' ? polygonClipping : null);
        if (!pc) return [polyRings[0]];
        const closeRing = (ring) => {
            const r = ring.slice();
            if (r.length >= 2 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) {
                r.push(r[0].slice());
            }
            return r;
        };
        try {
            // Start with just the outer ring, subtract each hole one at a time
            let currentPieces = [[closeRing(polyRings[0])]]; // MultiPolygon with one polygon
            for (let h = 1; h < polyRings.length; h++) {
                const holeClosed = [closeRing(polyRings[h])];
                const newPieces = pc.difference(currentPieces, [holeClosed]);
                currentPieces = newPieces;
            }
            // Collect results — recursively decompose any pieces that still have holes
            const results = [];
            for (const poly of currentPieces) {
                if (poly.length <= 1) {
                    // No holes — safe to take the outer ring directly
                    const pts = removeClosingPoint(poly[0]);
                    if (pts.length >= 3) results.push(pts);
                } else {
                    // Still has holes — decompose recursively (reset depth since these are simpler pieces)
                    const innerRings = poly.map(r => removeClosingPoint(r));
                    const subResults = decomposePolygonWithHoles(innerRings, 0);
                    for (const sr of subResults) {
                        if (sr.length >= 3) results.push(sr);
                    }
                }
            }
            return results.length > 0 ? results : [polyRings[0]];
        } catch (e) {
            return [polyRings[0]];
        }
    }

    // Close rings for polygon-clipping (it expects closed rings)
    const closeRing = (ring) => {
        if (ring.length < 2) return ring.slice();
        const r = ring.slice();
        if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) {
            r.push(r[0].slice());
        }
        return r;
    };

    const closedRings = polyRings.map(r => closeRing(r));

    // Find the bounding box of the first hole to determine where to cut
    const hole = polyRings[1];
    let hMin0 = Infinity, hMax0 = -Infinity, hMin1 = Infinity, hMax1 = -Infinity;
    for (const p of hole) {
        if (p[0] < hMin0) hMin0 = p[0];
        if (p[0] > hMax0) hMax0 = p[0];
        if (p[1] < hMin1) hMin1 = p[1];
        if (p[1] > hMax1) hMax1 = p[1];
    }

    // Get the overall bounding box of the outer ring
    const outer = polyRings[0];
    let oMinX = Infinity, oMaxX = -Infinity, oMinY = Infinity, oMaxY = -Infinity;
    for (const p of outer) {
        if (p[0] < oMinX) oMinX = p[0];
        if (p[0] > oMaxX) oMaxX = p[0];
        if (p[1] < oMinY) oMinY = p[1];
        if (p[1] > oMaxY) oMaxY = p[1];
    }

    const margin = Math.max(oMaxY - oMinY, oMaxX - oMinX) + 10;

    // Alternate between vertical (even depth) and horizontal (odd depth) cuts
    const useVertical = (depth % 2 === 0);
    let cutVal;
    let halfA, halfB;

    if (useVertical) {
        cutVal = (hMin0 + hMax0) / 2;
        halfA = [[[oMinX - margin, oMinY - margin], [cutVal, oMinY - margin],
        [cutVal, oMaxY + margin], [oMinX - margin, oMaxY + margin],
        [oMinX - margin, oMinY - margin]]];
        halfB = [[[cutVal, oMinY - margin], [oMaxX + margin, oMinY - margin],
        [oMaxX + margin, oMaxY + margin], [cutVal, oMaxY + margin],
        [cutVal, oMinY - margin]]];
    } else {
        cutVal = (hMin1 + hMax1) / 2;
        halfA = [[[oMinX - margin, oMinY - margin], [oMaxX + margin, oMinY - margin],
        [oMaxX + margin, cutVal], [oMinX - margin, cutVal],
        [oMinX - margin, oMinY - margin]]];
        halfB = [[[oMinX - margin, cutVal], [oMaxX + margin, cutVal],
        [oMaxX + margin, oMaxY + margin], [oMinX - margin, oMaxY + margin],
        [oMinX - margin, cutVal]]];
    }

    const results = [];
    const pc = window.polygonClipping || (typeof polygonClipping !== 'undefined' ? polygonClipping : null);
    if (!pc) return [polyRings[0]];

    try {
        const piecesA = pc.intersection([closedRings], [halfA]);
        const piecesB = pc.intersection([closedRings], [halfB]);

        const processPieces = (pieces) => {
            for (const poly of pieces) {
                if (poly.length <= 1) {
                    // No holes - just add outer ring
                    const pts = removeClosingPoint(poly[0]);
                    if (pts.length >= 3) results.push(pts);
                } else {
                    // Still has holes - recurse with next cut direction
                    const innerRings = poly.map(r => removeClosingPoint(r));
                    const subResults = decomposePolygonWithHoles(innerRings, depth + 1);
                    for (const sr of subResults) {
                        if (sr.length >= 3) results.push(sr);
                    }
                }
            }
        };

        processPieces(piecesA);
        processPieces(piecesB);
    } catch (e) {
        results.push(polyRings[0]);
    }

    return results.length > 0 ? results : [polyRings[0]];
}


// Truncate a linestrip by removing segments inside the eraser polygon.
// Returns an array of linestrip segments (arrays of [x,y] points).
// Each segment represents a contiguous part of the original linestrip outside the eraser.
function truncateLinestrip(points, eraserPolygon) {
    if (points.length < 2) {
        // Single point - check if inside
        if (points.length === 1 && isPointInPolygon(points[0], eraserPolygon)) {
            return [];
        }
        return [points.slice()];
    }

    // For each segment of the linestrip:
    // 1. Find all intersection points with the eraser polygon boundary
    // 2. Split the segment at those intersection points
    // 3. Test each sub-segment's midpoint to determine if it's inside or outside
    // 4. Keep only outside sub-segments
    // This approach is robust against floating-point edge cases.

    const allSubSegments = []; // { start: [x,y], end: [x,y], inside: bool }

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        // Find all intersections with eraser polygon edges
        const rawIntersections = linePolygonIntersections(p1, p2, eraserPolygon);

        // De-duplicate intersections (a line through a polygon vertex hits two edges)
        const intersections = [];
        for (const ip of rawIntersections) {
            let isDup = false;
            for (const fp of intersections) {
                if (Math.abs(ip[0] - fp[0]) < 1e-6 && Math.abs(ip[1] - fp[1]) < 1e-6) {
                    isDup = true;
                    break;
                }
            }
            if (!isDup) intersections.push(ip);
        }

        // Build ordered split points: [p1, ...intersections, p2]
        const splitPts = [p1, ...intersections, p2];

        // For each sub-segment, test midpoint to classify as inside/outside
        for (let j = 0; j < splitPts.length - 1; j++) {
            const a = splitPts[j];
            const b = splitPts[j + 1];
            // Skip degenerate (zero-length) sub-segments
            const dx = a[0] - b[0], dy = a[1] - b[1];
            if (dx * dx + dy * dy < 1e-12) continue;
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const inside = isPointInPolygon(mid, eraserPolygon);
            allSubSegments.push({ start: a, end: b, inside });
        }
    }

    // Merge consecutive outside sub-segments into linestrips
    const result = [];
    let currentLinestrip = [];

    for (const seg of allSubSegments) {
        if (!seg.inside) {
            if (currentLinestrip.length === 0) {
                currentLinestrip.push(seg.start);
            }
            currentLinestrip.push(seg.end);
        } else {
            if (currentLinestrip.length >= 2) {
                result.push(currentLinestrip);
            }
            currentLinestrip = [];
        }
    }

    if (currentLinestrip.length >= 2) {
        result.push(currentLinestrip);
    }

    return result;
}

// Find intersection points of a line segment with the edges of a polygon.
// Returns array of [x,y] points sorted by distance from p1.
function linePolygonIntersections(p1, p2, polygon) {
    const intersections = [];
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        const ip = lineSegmentIntersection(p1, p2, polygon[i], polygon[j]);
        if (ip) {
            intersections.push(ip);
        }
    }
    // Sort by distance from p1
    intersections.sort((a, b) => {
        const da = (a[0] - p1[0]) ** 2 + (a[1] - p1[1]) ** 2;
        const db = (b[0] - p1[0]) ** 2 + (b[1] - p1[1]) ** 2;
        return da - db;
    });
    return intersections;
}

// Compute intersection point of two line segments (p1-p2 and p3-p4).
// Returns [x, y] or null if no intersection.
function lineSegmentIntersection(p1, p2, p3, p4) {
    const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
    const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return null; // Parallel

    const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / cross;
    const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / cross;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return [p1[0] + t * d1x, p1[1] + t * d1y];
    }
    return null;
}

// Compare two points arrays for equality
function pointsArrayEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    }
    return true;
}
