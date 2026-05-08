import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Test runs from out-test/test/, so resolve to <repo-root>/media/samPromptHelpers.js
const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'samPromptHelpers.js'));
const {
    samHasPositivePrompt,
    mergeBoxIntoPrompts,
    cleanupOrphanNegatives,
    samShouldDeferToMainHandler,
    shouldRefreshShiftSnapshot,
    shouldRestoreShiftStatus,
    computeShiftFeedback
} = helpers;

describe('samHasPositivePrompt', () => {
    it('returns false for empty array', () => {
        assert.equal(samHasPositivePrompt([]), false);
    });
    it('returns false when only negative points exist', () => {
        assert.equal(samHasPositivePrompt([
            { type: 'point', data: [10, 10], label: 0 }
        ]), false);
    });
    it('returns true for a single positive point', () => {
        assert.equal(samHasPositivePrompt([
            { type: 'point', data: [10, 10], label: 1 }
        ]), true);
    });
    it('returns true for a single rectangle', () => {
        assert.equal(samHasPositivePrompt([
            { type: 'rectangle', data: [0, 0, 10, 10] }
        ]), true);
    });
    it('returns true when mix contains at least one positive prompt', () => {
        assert.equal(samHasPositivePrompt([
            { type: 'point', data: [1, 1], label: 0 },
            { type: 'rectangle', data: [0, 0, 5, 5] }
        ]), true);
    });
});

describe('mergeBoxIntoPrompts', () => {
    const newBox = { type: 'rectangle', data: [0, 0, 10, 10] };

    it('appends box when prompts are empty', () => {
        assert.deepEqual(mergeBoxIntoPrompts([], newBox), [newBox]);
    });
    it('preserves a positive point and appends box', () => {
        const point = { type: 'point', data: [3, 3], label: 1 };
        assert.deepEqual(mergeBoxIntoPrompts([point], newBox), [point, newBox]);
    });
    it('replaces an existing rectangle and keeps points', () => {
        const oldBox = { type: 'rectangle', data: [50, 50, 60, 60] };
        const point = { type: 'point', data: [3, 3], label: 1 };
        const neg = { type: 'point', data: [4, 4], label: 0 };
        assert.deepEqual(
            mergeBoxIntoPrompts([point, oldBox, neg], newBox),
            [point, neg, newBox]
        );
    });
});

describe('cleanupOrphanNegatives', () => {
    it('returns empty array when no positive remains', () => {
        const prompts = [
            { type: 'point', data: [1, 1], label: 0 },
            { type: 'point', data: [2, 2], label: 0 }
        ];
        assert.deepEqual(cleanupOrphanNegatives(prompts), []);
    });
    it('returns the input unchanged when at least one positive exists', () => {
        const prompts = [
            { type: 'point', data: [1, 1], label: 1 },
            { type: 'point', data: [2, 2], label: 0 }
        ];
        assert.deepEqual(cleanupOrphanNegatives(prompts), prompts);
    });
    it('returns empty array for empty input (idempotent)', () => {
        assert.deepEqual(cleanupOrphanNegatives([]), []);
    });
});

describe('samShouldDeferToMainHandler', () => {
    const positivePoint = { type: 'point', data: [1, 1], label: 1 };
    const negativePoint = { type: 'point', data: [2, 2], label: 0 };
    const box = { type: 'rectangle', data: [0, 0, 10, 10] };

    it('defers when eraser is active, regardless of shift state', () => {
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: false, eraserActive: true, samBoxSecondClick: false, prompts: []
        }), true);
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: true, eraserActive: true, samBoxSecondClick: false, prompts: [positivePoint]
        }), true);
    });

    it('defers when shift held with no positive prompt (start eraser)', () => {
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: true, eraserActive: false, samBoxSecondClick: false, prompts: []
        }), true);
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: true, eraserActive: false, samBoxSecondClick: false, prompts: [negativePoint]
        }), true);
    });

    it('does not defer when shift held with a positive prompt (negative-point routing)', () => {
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: true, eraserActive: false, samBoxSecondClick: false, prompts: [positivePoint]
        }), false);
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: true, eraserActive: false, samBoxSecondClick: false, prompts: [box]
        }), false);
    });

    it('does not defer during box second-click finalization, even with shift', () => {
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: true, eraserActive: false, samBoxSecondClick: true, prompts: []
        }), false);
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: true, eraserActive: false, samBoxSecondClick: true, prompts: [positivePoint]
        }), false);
    });

    it('does not defer for plain SAM clicks (no shift, no eraser)', () => {
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: false, eraserActive: false, samBoxSecondClick: false, prompts: []
        }), false);
        assert.equal(samShouldDeferToMainHandler({
            shiftKey: false, eraserActive: false, samBoxSecondClick: false, prompts: [positivePoint]
        }), false);
    });
});

describe('shouldRefreshShiftSnapshot', () => {
    it('refreshes when no prior feedback was written (initial shift-down)', () => {
        assert.equal(shouldRefreshShiftSnapshot('', null), true);
        assert.equal(shouldRefreshShiftSnapshot('SAM Ready [Full] (12ms)', null), true);
    });

    it('does not refresh when status still shows our last feedback text', () => {
        assert.equal(shouldRefreshShiftSnapshot('SAM: Eraser mode', 'SAM: Eraser mode'), false);
        assert.equal(shouldRefreshShiftSnapshot('SAM: Negative point', 'SAM: Negative point'), false);
    });

    it('refreshes when an external write replaced our feedback during shift-hold', () => {
        // samDecode just wrote new status while Shift is still held; on the
        // next updateShiftFeedback the snapshot must capture the new text.
        assert.equal(shouldRefreshShiftSnapshot('SAM Decoded [Full] (45ms)', 'SAM: Negative point'), true);
    });
});

describe('shouldRestoreShiftStatus', () => {
    it('does not restore if no feedback was ever written', () => {
        assert.equal(shouldRestoreShiftStatus(null, ''), false);
        assert.equal(shouldRestoreShiftStatus(null, 'SAM Ready [Full] (12ms)'), false);
    });

    it('restores when statusSpan still contains our feedback text', () => {
        assert.equal(shouldRestoreShiftStatus('SAM: Eraser mode', 'SAM: Eraser mode'), true);
        assert.equal(shouldRestoreShiftStatus('SAM: Negative point', 'SAM: Negative point'), true);
    });

    it('does not restore when external code has overwritten the bar', () => {
        // samEncode wrote new status during Shift hold; on Shift-up we must
        // leave that text alone, not restore stale pre-Shift snapshot.
        assert.equal(shouldRestoreShiftStatus('SAM: Negative point', 'SAM Encode Error'), false);
    });
});

describe('computeShiftFeedback', () => {
    const positivePoint = { type: 'point', data: [1, 1], label: 1 };
    const negativePoint = { type: 'point', data: [2, 2], label: 0 };
    const box = { type: 'rectangle', data: [0, 0, 10, 10] };
    const ERASER_CURSOR = 'url("data:eraser") 3 17, crosshair';

    it('returns negative-point descriptor in SAM mode with a positive prompt', () => {
        assert.deepEqual(computeShiftFeedback('sam', [positivePoint], ERASER_CURSOR), {
            text: 'SAM: Negative point',
            color: '#ff4444',
            cursor: 'crosshair'
        });
        assert.deepEqual(computeShiftFeedback('sam', [box, negativePoint], ERASER_CURSOR), {
            text: 'SAM: Negative point',
            color: '#ff4444',
            cursor: 'crosshair'
        });
    });

    it('returns SAM-eraser descriptor in SAM mode with no positive prompt', () => {
        assert.deepEqual(computeShiftFeedback('sam', [], ERASER_CURSOR), {
            text: 'SAM: Eraser mode',
            color: '#ff8800',
            cursor: ERASER_CURSOR
        });
        // A lone negative point shouldn't flip routing to negative-point —
        // by spec, undo-orphan-cleanup keeps this state out of normal flow,
        // but the function must still classify it as no-positive.
        assert.deepEqual(computeShiftFeedback('sam', [negativePoint], ERASER_CURSOR), {
            text: 'SAM: Eraser mode',
            color: '#ff8800',
            cursor: ERASER_CURSOR
        });
    });

    it('returns plain-eraser descriptor outside SAM mode', () => {
        assert.deepEqual(computeShiftFeedback('polygon', [], ERASER_CURSOR), {
            text: 'Eraser mode',
            color: '#ff8800',
            cursor: ERASER_CURSOR
        });
        assert.deepEqual(computeShiftFeedback('rectangle', [positivePoint], ERASER_CURSOR), {
            text: 'Eraser mode',
            color: '#ff8800',
            cursor: ERASER_CURSOR
        });
    });
});
