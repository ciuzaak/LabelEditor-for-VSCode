import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'labelSelectionHelpers.js'));
const { computeLabelSelection } = helpers;

// Fixture: 3 cats, 1 dog, 1 tree.
const shapes = [
    { label: 'cat' },   // 0
    { label: 'dog' },   // 1
    { label: 'cat' },   // 2
    { label: 'tree' },  // 3
    { label: 'cat' },   // 4
];

describe('computeLabelSelection — plain click (replace)', () => {
    it('returns every index of the label, ascending', () => {
        assert.deepEqual(computeLabelSelection(shapes, 'cat', [], false), [0, 2, 4]);
    });

    it('ignores the current selection entirely', () => {
        assert.deepEqual(computeLabelSelection(shapes, 'dog', [0, 2, 4], false), [1]);
    });

    it('returns [] for a label with no instances', () => {
        assert.deepEqual(computeLabelSelection(shapes, 'fish', [2], false), []);
    });
});

describe('computeLabelSelection — Ctrl click (additive toggle)', () => {
    it('adds the label group to the current selection, preserving others', () => {
        assert.deepEqual(computeLabelSelection(shapes, 'cat', [1], true), [0, 1, 2, 4]);
    });

    it('removes the whole group when all its instances are already selected', () => {
        // 'cat' fully selected (0,2,4) plus an unrelated 'tree' (3) → only the group is dropped.
        assert.deepEqual(computeLabelSelection(shapes, 'cat', [0, 2, 3, 4], true), [3]);
    });

    it('adds the missing instances when the group is only partially selected', () => {
        // Only one cat (0) selected → not "all", so the rest are added rather than removed.
        assert.deepEqual(computeLabelSelection(shapes, 'cat', [0, 1], true), [0, 1, 2, 4]);
    });

    it('toggles a single-instance label off when it is the only selection', () => {
        assert.deepEqual(computeLabelSelection(shapes, 'dog', [1], true), []);
    });

    it('drops stale out-of-range indices from the current selection', () => {
        assert.deepEqual(computeLabelSelection(shapes, 'tree', [99, 1], true), [1, 3]);
    });
});

describe('computeLabelSelection — defensive inputs', () => {
    it('treats a non-array shapes argument as empty', () => {
        assert.deepEqual(computeLabelSelection(undefined as any, 'cat', [], false), []);
    });
});
