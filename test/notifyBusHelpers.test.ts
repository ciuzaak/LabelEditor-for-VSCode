import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'notifyBusHelpers.js'));
const {
    LEVEL_RANK,
    DEFAULT_DURATIONS,
    canPreempt,
    selectStickyToRestore,
    classifyForRestore
} = helpers;

describe('LEVEL_RANK', () => {
    it('orders info < success < warn < error', () => {
        assert.ok(LEVEL_RANK.info < LEVEL_RANK.success);
        assert.ok(LEVEL_RANK.success < LEVEL_RANK.warn);
        assert.ok(LEVEL_RANK.warn < LEVEL_RANK.error);
    });
});

describe('canPreempt', () => {
    it('allows same severity to overwrite immediately', () => {
        assert.equal(canPreempt({ level: 'info' }, { level: 'info', shownAtMs: 0, minMs: 3000 }, 100), true);
    });
    it('allows higher severity to overwrite immediately', () => {
        assert.equal(canPreempt({ level: 'error' }, { level: 'warn', shownAtMs: 0, minMs: 5000 }, 1000), true);
    });
    it('blocks lower severity before minMs has elapsed', () => {
        assert.equal(canPreempt({ level: 'info' }, { level: 'error', shownAtMs: 0, minMs: 8000 }, 1000), false);
    });
    it('allows lower severity after minMs has elapsed', () => {
        assert.equal(canPreempt({ level: 'info' }, { level: 'error', shownAtMs: 0, minMs: 8000 }, 9000), true);
    });
    it('treats a higher-rank sticky transient like a normal one for preemption', () => {
        assert.equal(canPreempt({ level: 'success' }, { level: 'warn', shownAtMs: 0, minMs: 5000, sticky: false }, 1000), false);
        assert.equal(canPreempt({ level: 'success' }, { level: 'info', shownAtMs: 0, minMs: 3000, sticky: true }, 0), true);
    });
});

describe('selectStickyToRestore', () => {
    it('returns null when no sticky channels exist', () => {
        assert.equal(selectStickyToRestore({}), null);
    });
    it('returns the most recently set sticky channel', () => {
        const stickies = {
            'sam.status': { level: 'success', text: 'SAM Ready', updatedAtMs: 100 },
            'shift.feedback': { level: 'info', text: 'Shift: extend', updatedAtMs: 200 }
        };
        const got = selectStickyToRestore(stickies);
        assert.equal(got.text, 'Shift: extend');
    });
});

describe('classifyForRestore', () => {
    it('chooses transient text when transient present', () => {
        const sticky = { level: 'success', text: 'SAM Ready' };
        const transient = { level: 'error', text: 'oops' };
        assert.deepEqual(classifyForRestore(sticky, transient), { level: 'error', text: 'oops' });
    });
    it('chooses sticky text when transient empty', () => {
        const sticky = { level: 'success', text: 'SAM Ready' };
        assert.deepEqual(classifyForRestore(sticky, null), { level: 'success', text: 'SAM Ready' });
    });
    it('chooses empty payload when neither transient nor sticky present', () => {
        assert.deepEqual(classifyForRestore(null, null), { level: 'info', text: '' });
    });
});

describe('DEFAULT_DURATIONS', () => {
    it('uses 3000/3000/5000/8000 for info/success/warn/error', () => {
        assert.equal(DEFAULT_DURATIONS.info, 3000);
        assert.equal(DEFAULT_DURATIONS.success, 3000);
        assert.equal(DEFAULT_DURATIONS.warn, 5000);
        assert.equal(DEFAULT_DURATIONS.error, 8000);
    });
});
