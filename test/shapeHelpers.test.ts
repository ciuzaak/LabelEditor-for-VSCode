import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Test runs from out-test/test/, so resolve to <repo-root>/media/shapeHelpers.js
const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'shapeHelpers.js'));
const { allowSelectByClick, contourToBBoxRect, labelAnchorFromPoints, shapeArea, sortOverlapCandidates, resolveOverlapSelection, carryOverVisibility } = helpers;

describe('allowSelectByClick', () => {
    it('always allows selection in view mode, regardless of the guard', () => {
        assert.equal(allowSelectByClick('view', false), true);
        assert.equal(allowSelectByClick('view', true), true);
    });
    it('allows selection in drawing modes when the guard is off', () => {
        for (const m of ['point', 'line', 'polygon', 'rectangle', 'circle', 'sam']) {
            assert.equal(allowSelectByClick(m, false), true);
        }
    });
    it('blocks selection in drawing modes when the guard is on', () => {
        for (const m of ['point', 'line', 'polygon', 'rectangle', 'circle', 'sam']) {
            assert.equal(allowSelectByClick(m, true), false);
        }
    });
});

describe('contourToBBoxRect', () => {
    it('returns the 2-point axis-aligned bbox of a contour', () => {
        assert.deepEqual(
            contourToBBoxRect([[10, 20], [30, 5], [25, 40], [8, 12]]),
            [[8, 5], [30, 40]]
        );
    });
    it('returns null for missing / empty / non-array input', () => {
        assert.equal(contourToBBoxRect(null), null);
        assert.equal(contourToBBoxRect(undefined), null);
        assert.equal(contourToBBoxRect([]), null);
        assert.equal(contourToBBoxRect('nope' as any), null);
    });
    it('skips malformed / non-finite points and uses the rest', () => {
        assert.deepEqual(
            contourToBBoxRect([[1, 1], ['x', 2] as any, [3], [NaN, 9], [4, 6]]),
            [[1, 1], [4, 6]]
        );
    });
    it('returns null when no point is usable', () => {
        assert.equal(contourToBBoxRect([[NaN, NaN], [3]]), null);
    });
});

describe('labelAnchorFromPoints', () => {
    it('returns the top-left (min x, min y) corner', () => {
        assert.deepEqual(
            labelAnchorFromPoints([[10, 20], [30, 5], [25, 40]]),
            { x: 10, y: 5 }
        );
    });
    it('returns null for missing / empty input', () => {
        assert.equal(labelAnchorFromPoints(null), null);
        assert.equal(labelAnchorFromPoints([]), null);
    });
    it('ignores malformed points', () => {
        assert.deepEqual(
            labelAnchorFromPoints([[5, 5], [2] as any, [3, 9]]),
            { x: 3, y: 5 }
        );
    });
    it('returns null when no point is usable', () => {
        assert.equal(labelAnchorFromPoints([[NaN, NaN], [3]]), null);
    });
});

describe('shapeArea', () => {
    it('returns 0 for point and linestrip (proximity targets, always most specific)', () => {
        assert.equal(shapeArea({ shape_type: 'point', points: [[5, 5]] }), 0);
        assert.equal(shapeArea({ shape_type: 'linestrip', points: [[0, 0], [10, 0]] }), 0);
    });
    it('returns w*h for a rectangle regardless of corner order', () => {
        assert.equal(shapeArea({ shape_type: 'rectangle', points: [[0, 0], [4, 3]] }), 12);
        assert.equal(shapeArea({ shape_type: 'rectangle', points: [[4, 3], [0, 0]] }), 12);
    });
    it('returns pi*r^2 for a circle ([center, edge])', () => {
        const a = shapeArea({ shape_type: 'circle', points: [[0, 0], [2, 0]] });
        assert.ok(Math.abs(a - Math.PI * 4) < 1e-9);
    });
    it('returns the shoelace area for a polygon', () => {
        assert.equal(shapeArea({ shape_type: 'polygon', points: [[0, 0], [4, 0], [4, 3], [0, 3]] }), 12);
    });
});

describe('sortOverlapCandidates', () => {
    it('orders smallest-area first, points/lines ahead of filled shapes', () => {
        const shapes = [
            { shape_type: 'polygon', points: [[0, 0], [10, 0], [10, 10], [0, 10]] }, // idx0 area 100
            { shape_type: 'rectangle', points: [[0, 0], [2, 2]] },                    // idx1 area 4
            { shape_type: 'point', points: [[1, 1]] },                                // idx2 area 0
        ];
        assert.deepEqual(sortOverlapCandidates([0, 1, 2], shapes), [2, 1, 0]);
    });
    it('keeps the input order (topmost-first) among equal areas', () => {
        const eq = [
            { shape_type: 'rectangle', points: [[0, 0], [2, 2]] }, // idx0 area 4
            { shape_type: 'rectangle', points: [[0, 0], [2, 2]] }, // idx1 area 4
        ];
        assert.deepEqual(sortOverlapCandidates([1, 0], eq), [1, 0]);
    });
    it('does not mutate the input array', () => {
        const input = [0, 1];
        sortOverlapCandidates(input, [
            { shape_type: 'rectangle', points: [[0, 0], [9, 9]] },
            { shape_type: 'rectangle', points: [[0, 0], [1, 1]] },
        ]);
        assert.deepEqual(input, [0, 1]);
    });
});

describe('resolveOverlapSelection', () => {
    it('selects the smallest (pos 0) on a fresh stack', () => {
        const r = resolveOverlapSelection({ ordered: [2, 1, 0], prevMembers: [], prevPos: -1, currentSelectedIndex: -1 });
        assert.deepEqual(r, { targetIndex: 2, members: [2, 1, 0], pos: 0 });
    });
    it('advances one step when re-clicking the same stack on our own target', () => {
        const r = resolveOverlapSelection({ ordered: [2, 1, 0], prevMembers: [2, 1, 0], prevPos: 0, currentSelectedIndex: 2 });
        assert.deepEqual(r, { targetIndex: 1, members: [2, 1, 0], pos: 1 });
    });
    it('wraps back to the smallest after the last member', () => {
        const r = resolveOverlapSelection({ ordered: [2, 1, 0], prevMembers: [2, 1, 0], prevPos: 2, currentSelectedIndex: 0 });
        assert.deepEqual(r, { targetIndex: 2, members: [2, 1, 0], pos: 0 });
    });
    it('resets to smallest when selection changed elsewhere (selection mismatch)', () => {
        const r = resolveOverlapSelection({ ordered: [2, 1, 0], prevMembers: [2, 1, 0], prevPos: 0, currentSelectedIndex: 5 });
        assert.deepEqual(r, { targetIndex: 2, members: [2, 1, 0], pos: 0 });
    });
    it('resets to smallest when the candidate set differs from last click', () => {
        const r = resolveOverlapSelection({ ordered: [3, 1], prevMembers: [2, 1, 0], prevPos: 0, currentSelectedIndex: 2 });
        assert.deepEqual(r, { targetIndex: 3, members: [3, 1], pos: 0 });
    });
    it('returns no target for an empty candidate list', () => {
        const r = resolveOverlapSelection({ ordered: [], prevMembers: [], prevPos: -1, currentSelectedIndex: -1 });
        assert.deepEqual(r, { targetIndex: -1, members: [], pos: -1 });
    });
});

describe('carryOverVisibility', () => {
    const rect = (label: string, x: number, visible?: boolean) =>
        ({ label, shape_type: 'rectangle', points: [[x, 0], [x + 10, 10]], ...(visible === undefined ? {} : { visible }) });
    const never = () => { throw new Error('fallback should not be used'); };

    it('keeps the current visibility when undo restores an older snapshot of the same shapes', () => {
        // User hid B after the last edit; undoing that edit must not unhide it.
        const current = [rect('a', 0, true), rect('b', 20, false)];
        const snapshot = [rect('a', 0, true), rect('b', 20, true)];
        const out = carryOverVisibility(current, snapshot, never);
        assert.deepEqual(out.map((s: any) => s.visible), [true, false]);
    });

    it('matches by content when the undo adds or removes shapes', () => {
        // Undoing a delete of 'mid' brings it back; the others keep their state.
        const current = [rect('a', 0, false), rect('c', 40, true)];
        const snapshot = [rect('a', 0, true), rect('mid', 20, true), rect('c', 40, true)];
        const out = carryOverVisibility(current, snapshot, (s: any) => s.label !== 'mid');
        assert.deepEqual(out.map((s: any) => s.visible), [false, false, true]);
    });

    it('falls back to the same index when a shape was moved (points differ, count equal)', () => {
        const current = [rect('a', 5, false), rect('b', 20, true)];
        const snapshot = [rect('a', 0, true), rect('b', 20, true)];
        const out = carryOverVisibility(current, snapshot, never);
        assert.deepEqual(out.map((s: any) => s.visible), [false, true]);
    });

    it('treats a missing visible flag as visible and does not mutate its inputs', () => {
        const current = [rect('a', 0)];
        const snapshot = [rect('a', 0, false)];
        const out = carryOverVisibility(current, snapshot, never);
        assert.equal(out[0].visible, true);
        assert.equal(snapshot[0].visible, false);
        assert.notEqual(out[0], snapshot[0]);
    });

    it('pairs identical duplicates in order', () => {
        const current = [rect('a', 0, false), rect('a', 0, true)];
        const snapshot = [rect('a', 0), rect('a', 0), rect('z', 99)];
        const out = carryOverVisibility(current, snapshot, () => true);
        assert.deepEqual(out.map((s: any) => s.visible), [false, true, true]);
    });
});
