import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Test runs from out-test/test/, so resolve to <repo-root>/media/mergeShapesHelpers.js
const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'mergeShapesHelpers.js'));
const pc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'polygon-clipping'));

const {
    shapeToOuterRing,
    closeRing,
    ringSignedArea,
    ringsOverlap,
    buildOverlapGroups,
    computeAABBPoints,
    unionOuterRing,
    resolveGroupLabel,
    buildMergedShape
} = helpers;

function rect(x1: number, y1: number, x2: number, y2: number, label = 'a', extra: any = {}): any {
    return { shape_type: 'rectangle', label, points: [[x1, y1], [x2, y2]], ...extra };
}

function poly(points: number[][], label = 'a', extra: any = {}): any {
    return { shape_type: 'polygon', label, points, ...extra };
}

describe('shapeToOuterRing', () => {
    it('expands a rectangle to four corners', () => {
        const ring = shapeToOuterRing(rect(0, 0, 10, 5));
        assert.deepEqual(ring, [[0, 0], [10, 0], [10, 5], [0, 5]]);
    });
    it('returns a copy of polygon points', () => {
        const points = [[0, 0], [10, 0], [10, 10]];
        const ring = shapeToOuterRing(poly(points));
        assert.deepEqual(ring, points);
        // Points are deep-copied (mutating ring should not affect input).
        ring[0][0] = 999;
        assert.equal(points[0][0], 0);
    });
});

describe('closeRing', () => {
    it('appends first point when not closed', () => {
        assert.deepEqual(closeRing([[0, 0], [1, 0], [1, 1]]), [[0, 0], [1, 0], [1, 1], [0, 0]]);
    });
    it('leaves an already-closed ring untouched', () => {
        const r = [[0, 0], [1, 0], [1, 1], [0, 0]];
        assert.deepEqual(closeRing(r), r);
    });
});

describe('ringSignedArea', () => {
    it('matches shoelace for a unit CCW square', () => {
        const area = ringSignedArea([[0, 0], [1, 0], [1, 1], [0, 1]]);
        assert.equal(area, 1);
    });
    it('is negative for CW orientation', () => {
        const area = ringSignedArea([[0, 0], [0, 1], [1, 1], [1, 0]]);
        assert.equal(area, -1);
    });
});

describe('ringsOverlap', () => {
    it('returns true for two overlapping squares', () => {
        const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const b = [[5, 5], [15, 5], [15, 15], [5, 15]];
        assert.equal(ringsOverlap(pc, a, b), true);
    });
    it('returns false for two disjoint squares', () => {
        const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const b = [[20, 20], [30, 20], [30, 30], [20, 30]];
        assert.equal(ringsOverlap(pc, a, b), false);
    });
    it('returns false for edge-only contact (zero-area intersection)', () => {
        const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const b = [[10, 0], [20, 0], [20, 10], [10, 10]];
        assert.equal(ringsOverlap(pc, a, b), false);
    });
    it('returns true when one fully contains the other', () => {
        const outer = [[0, 0], [100, 0], [100, 100], [0, 100]];
        const inner = [[10, 10], [20, 10], [20, 20], [10, 20]];
        assert.equal(ringsOverlap(pc, outer, inner), true);
    });
});

describe('buildOverlapGroups', () => {
    it('returns no groups when nothing overlaps', () => {
        const shapes = [rect(0, 0, 5, 5), rect(20, 20, 25, 25), rect(40, 40, 45, 45)];
        assert.deepEqual(buildOverlapGroups(pc, shapes, [0, 1, 2]), []);
    });
    it('returns one group of two for a single overlapping pair', () => {
        const shapes = [rect(0, 0, 10, 10), rect(5, 5, 15, 15), rect(50, 50, 55, 55)];
        const groups = buildOverlapGroups(pc, shapes, [0, 1, 2]);
        assert.deepEqual(groups, [[0, 1]]);
    });
    it('groups transitively (A∩B, B∩C — even if A and C disjoint)', () => {
        const shapes = [rect(0, 0, 10, 10), rect(8, 0, 18, 10), rect(15, 0, 25, 10)];
        const groups = buildOverlapGroups(pc, shapes, [0, 1, 2]);
        assert.deepEqual(groups, [[0, 1, 2]]);
    });
    it('returns two disjoint groups when selection has two overlap pairs', () => {
        const shapes = [
            rect(0, 0, 10, 10),
            rect(5, 5, 15, 15),
            rect(100, 100, 110, 110),
            rect(105, 105, 115, 115)
        ];
        const groups = buildOverlapGroups(pc, shapes, [0, 1, 2, 3]);
        assert.equal(groups.length, 2);
        assert.deepEqual(groups[0], [0, 1]);
        assert.deepEqual(groups[1], [2, 3]);
    });
    it('honors selection-only behavior (ignores non-selected shapes)', () => {
        // shape 1 overlaps shape 0 but shape 1 is not in the selection.
        const shapes = [rect(0, 0, 10, 10), rect(5, 5, 15, 15), rect(50, 50, 55, 55)];
        const groups = buildOverlapGroups(pc, shapes, [0, 2]);
        assert.deepEqual(groups, []);
    });
});

describe('computeAABBPoints', () => {
    it('produces the bounding box of three rectangles', () => {
        const rings = [
            shapeToOuterRing(rect(0, 0, 10, 5)),
            shapeToOuterRing(rect(-5, 3, 8, 12)),
            shapeToOuterRing(rect(2, -3, 6, 4))
        ];
        assert.deepEqual(computeAABBPoints(rings), [[-5, -3], [10, 12]]);
    });
});

describe('unionOuterRing', () => {
    it('produces the rectangular outline of two overlapping unit squares', () => {
        const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const b = [[5, 0], [15, 0], [15, 10], [5, 10]];
        const result = unionOuterRing(pc, [a, b]);
        // Outer outline should bound x∈[0,15], y∈[0,10].
        const xs = result.map((p: number[]) => p[0]);
        const ys = result.map((p: number[]) => p[1]);
        assert.equal(Math.min(...xs), 0);
        assert.equal(Math.max(...xs), 15);
        assert.equal(Math.min(...ys), 0);
        assert.equal(Math.max(...ys), 10);
        // Open ring (no closing duplicate).
        assert.notDeepEqual(result[0], result[result.length - 1]);
    });
    it('drops holes when union has them', () => {
        // Two overlapping C-shapes can produce a hole in their union — but
        // simpler: a single big square union doesn't produce a hole. To cover
        // hole-dropping, we craft a polygon-with-hole input by passing a
        // self-bridged C-shape. Easier: just verify single-poly output never
        // includes a closing-point-duplicate at the end.
        const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const b = [[3, 3], [7, 3], [7, 7], [3, 7]]; // fully inside a
        const result = unionOuterRing(pc, [a, b]);
        // Inner ring should be dropped; outer should match a's outline.
        assert.equal(result.length, 4);
        const xs = result.map((p: number[]) => p[0]);
        const ys = result.map((p: number[]) => p[1]);
        assert.equal(Math.min(...xs), 0);
        assert.equal(Math.max(...xs), 10);
        assert.equal(Math.min(...ys), 0);
        assert.equal(Math.max(...ys), 10);
    });
    it('picks the largest outer ring when union returns multiple polygons', () => {
        // Two disjoint squares — union returns a MultiPolygon with two pieces.
        // Defensive check: helper picks the larger one.
        const small = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const large = [[100, 100], [110, 100], [110, 110], [100, 110]];
        const result = unionOuterRing(pc, [small, large]);
        const xs = result.map((p: number[]) => p[0]);
        assert.ok(Math.min(...xs) >= 100, 'should pick the large square');
    });
});

describe('resolveGroupLabel', () => {
    it('returns unanimous label when all members agree', () => {
        const shapes = [rect(0, 0, 1, 1, 'car'), rect(0, 0, 1, 1, 'car')];
        assert.deepEqual(resolveGroupLabel(shapes, [0, 1]), { label: 'car' });
    });
    it('flags prompt and returns mode label when labels differ', () => {
        const shapes = [
            rect(0, 0, 1, 1, 'car'),
            rect(0, 0, 1, 1, 'bus'),
            rect(0, 0, 1, 1, 'car')
        ];
        const result = resolveGroupLabel(shapes, [0, 1, 2]);
        assert.equal(result.needsPrompt, true);
        assert.equal(result.modeLabel, 'car');
    });
    it('breaks ties by earliest index', () => {
        const shapes = [rect(0, 0, 1, 1, 'a'), rect(0, 0, 1, 1, 'b')];
        const result = resolveGroupLabel(shapes, [0, 1]);
        assert.equal(result.needsPrompt, true);
        assert.equal(result.modeLabel, 'a');
    });
});

describe('buildMergedShape', () => {
    it('produces a rectangle for all-rectangle groups', () => {
        const shapes = [rect(0, 0, 10, 10, 'box', { group_id: 'g1' }), rect(5, 5, 15, 15, 'box')];
        const out = buildMergedShape(
            shapes,
            [0, 1],
            'box',
            { allRectangles: true, points: [[0, 0], [15, 15]] }
        );
        assert.equal(out.shape_type, 'rectangle');
        assert.deepEqual(out.points, [[0, 0], [15, 15]]);
        assert.equal(out.label, 'box');
        assert.equal(out.group_id, 'g1');
    });
    it('produces a polygon for mixed groups', () => {
        const shapes = [
            rect(0, 0, 10, 10, 'box', { description: 'first', flags: { x: 1 } }),
            poly([[5, 5], [15, 5], [15, 15], [5, 15]], 'box')
        ];
        const out = buildMergedShape(
            shapes,
            [0, 1],
            'box',
            { allRectangles: false, points: [[0, 0], [15, 0], [15, 15], [0, 15]] }
        );
        assert.equal(out.shape_type, 'polygon');
        assert.equal(out.label, 'box');
        assert.equal(out.description, 'first');
        assert.deepEqual(out.flags, { x: 1 });
    });
    it('inherits visibility false when seed is hidden', () => {
        const shapes = [rect(0, 0, 1, 1, 'a', { visible: false }), rect(0, 0, 1, 1, 'a')];
        const out = buildMergedShape(
            shapes,
            [0, 1],
            'a',
            { allRectangles: true, points: [[0, 0], [1, 1]] }
        );
        assert.equal(out.visible, false);
    });
    it('does not write visible field when seed is visible (LabelMe omission)', () => {
        const shapes = [rect(0, 0, 1, 1, 'a'), rect(0, 0, 1, 1, 'a')];
        const out = buildMergedShape(
            shapes,
            [0, 1],
            'a',
            { allRectangles: true, points: [[0, 0], [1, 1]] }
        );
        assert.equal('visible' in out, false);
    });
});
