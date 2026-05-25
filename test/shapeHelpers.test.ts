import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Test runs from out-test/test/, so resolve to <repo-root>/media/shapeHelpers.js
const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'shapeHelpers.js'));
const { allowSelectByClick, contourToBBoxRect, labelAnchorFromPoints } = helpers;

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
