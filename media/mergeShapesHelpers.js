// Pure helpers for merging polygon/rectangle annotations.
// Loaded as a <script> in the webview AND required from Node tests.
//
// All polygon-clipping calls accept the library as the first argument so tests
// can inject `require('polygon-clipping')` without a webview global.

function getRectPointsLocal(points) {
    if (!Array.isArray(points) || points.length !== 2) return points;
    var p1 = points[0];
    var p2 = points[1];
    return [
        [p1[0], p1[1]],
        [p2[0], p1[1]],
        [p2[0], p2[1]],
        [p1[0], p2[1]]
    ];
}

function shapeToOuterRing(shape) {
    if (shape.shape_type === 'rectangle') {
        return getRectPointsLocal(shape.points).map(function (p) { return [p[0], p[1]]; });
    }
    return shape.points.map(function (p) { return [p[0], p[1]]; });
}

function closeRing(ring) {
    if (ring.length < 2) return ring.slice();
    var first = ring[0];
    var last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring.slice();
    var closed = ring.slice();
    closed.push([first[0], first[1]]);
    return closed;
}

function ringSignedArea(ring) {
    var sum = 0;
    var n = ring.length;
    if (n < 3) return 0;
    // Shoelace: don't double-count a closing point if present.
    var end = (ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) ? n - 1 : n;
    for (var i = 0; i < end; i++) {
        var a = ring[i];
        var b = ring[(i + 1) % end];
        sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum / 2;
}

function ringsOverlap(pc, ringA, ringB) {
    if (!pc || !ringA || !ringB) return false;
    try {
        var result = pc.intersection([closeRing(ringA)], [closeRing(ringB)]);
        if (!Array.isArray(result) || result.length === 0) return false;
        // result is MultiPolygon: array of Polygon (each Polygon = array of rings)
        for (var i = 0; i < result.length; i++) {
            var poly = result[i];
            if (Array.isArray(poly) && poly.length > 0 && Array.isArray(poly[0]) && poly[0].length >= 3) {
                return true;
            }
        }
        return false;
    } catch (err) {
        return false;
    }
}

function buildOverlapGroups(pc, shapes, indices) {
    var n = indices.length;
    if (n < 2) return [];

    // Pre-compute rings once.
    var rings = indices.map(function (idx) { return shapeToOuterRing(shapes[idx]); });

    // DSU.
    var parent = [];
    for (var i = 0; i < n; i++) parent.push(i);
    function find(x) {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }
    function union(a, b) {
        var ra = find(a);
        var rb = find(b);
        if (ra !== rb) parent[ra] = rb;
    }

    for (var a = 0; a < n; a++) {
        for (var b = a + 1; b < n; b++) {
            if (ringsOverlap(pc, rings[a], rings[b])) union(a, b);
        }
    }

    // Bucket by root.
    var buckets = {};
    for (var k = 0; k < n; k++) {
        var r = find(k);
        if (!buckets[r]) buckets[r] = [];
        buckets[r].push(indices[k]);
    }

    var groups = [];
    Object.keys(buckets).forEach(function (key) {
        var g = buckets[key];
        if (g.length >= 2) {
            g.sort(function (x, y) { return x - y; });
            groups.push(g);
        }
    });
    groups.sort(function (g1, g2) { return g1[0] - g2[0]; });
    return groups;
}

function computeAABBPoints(rings) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < rings.length; i++) {
        var r = rings[i];
        for (var j = 0; j < r.length; j++) {
            var x = r[j][0], y = r[j][1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
    return [[minX, minY], [maxX, maxY]];
}

function unionOuterRing(pc, rings) {
    if (!pc || !Array.isArray(rings) || rings.length === 0) return null;
    try {
        var polys = rings.map(function (r) { return [closeRing(r)]; });
        var args = polys.slice(1);
        var unioned = polys.length === 1 ? polys[0] : pc.union.apply(pc, [polys[0]].concat(args));
        // unioned is a MultiPolygon (array of Polygon).
        if (!Array.isArray(unioned) || unioned.length === 0) return null;
        var best = null;
        var bestArea = -1;
        for (var i = 0; i < unioned.length; i++) {
            var poly = unioned[i];
            if (!Array.isArray(poly) || poly.length === 0) continue;
            var outer = poly[0];
            if (!Array.isArray(outer) || outer.length < 4) continue; // closed ring needs >=4 entries (3 unique + closing)
            var area = Math.abs(ringSignedArea(outer));
            if (area > bestArea) {
                bestArea = area;
                best = outer;
            }
        }
        if (!best) return null;
        // Drop closing point.
        var open = best.slice();
        if (open.length > 1) {
            var f = open[0];
            var l = open[open.length - 1];
            if (f[0] === l[0] && f[1] === l[1]) open.pop();
        }
        if (open.length < 3) return null;
        return open.map(function (p) { return [p[0], p[1]]; });
    } catch (err) {
        return null;
    }
}

function resolveGroupLabel(shapes, group) {
    if (!group || group.length === 0) return { label: '' };
    var first = shapes[group[0]].label;
    var allSame = true;
    for (var i = 1; i < group.length; i++) {
        if (shapes[group[i]].label !== first) { allSame = false; break; }
    }
    if (allSame) return { label: first };

    // Mode label: count occurrences; tie → earliest by index.
    var counts = {};
    var firstSeen = {};
    for (var k = 0; k < group.length; k++) {
        var lbl = shapes[group[k]].label;
        counts[lbl] = (counts[lbl] || 0) + 1;
        if (!(lbl in firstSeen)) firstSeen[lbl] = group[k];
    }
    var modeLabel = null;
    var modeCount = -1;
    Object.keys(counts).forEach(function (lbl) {
        var c = counts[lbl];
        if (c > modeCount || (c === modeCount && firstSeen[lbl] < firstSeen[modeLabel])) {
            modeCount = c;
            modeLabel = lbl;
        }
    });
    return { needsPrompt: true, modeLabel: modeLabel };
}

function buildMergedShape(shapes, group, label, options) {
    var seed = shapes[group[0]];
    var allRect = !!(options && options.allRectangles);
    var points = (options && options.points) ? options.points : null;
    var merged = {
        label: label,
        points: points,
        shape_type: allRect ? 'rectangle' : 'polygon',
        group_id: seed.group_id !== undefined ? seed.group_id : null,
        flags: seed.flags ? JSON.parse(JSON.stringify(seed.flags)) : {}
    };
    if (seed.description) merged.description = seed.description;
    if (seed.visible === false) merged.visible = false;
    return merged;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getRectPointsLocal: getRectPointsLocal,
        shapeToOuterRing: shapeToOuterRing,
        closeRing: closeRing,
        ringSignedArea: ringSignedArea,
        ringsOverlap: ringsOverlap,
        buildOverlapGroups: buildOverlapGroups,
        computeAABBPoints: computeAABBPoints,
        unionOuterRing: unionOuterRing,
        resolveGroupLabel: resolveGroupLabel,
        buildMergedShape: buildMergedShape
    };
}
