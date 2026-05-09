import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Test runs from out-test/test/, so resolve to <repo-root>/media/popoverDismiss.js
const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'popoverDismiss.js'));
const { shouldDismissPopover } = helpers;

describe('shouldDismissPopover', () => {
    it('dismisses when click target is outside both popover and trigger', () => {
        const target = { id: 'elsewhere' };
        const popover = { contains: (el: any) => el === popover };
        const trigger = { contains: (el: any) => el === trigger };
        assert.equal(shouldDismissPopover(target, popover, trigger), true);
    });

    it('does not dismiss when click target is inside the popover', () => {
        const inside = {};
        const popover = { contains: (el: any) => el === inside };
        const trigger = { contains: () => false };
        assert.equal(shouldDismissPopover(inside, popover, trigger), false);
    });

    it('does not dismiss when click target is inside the trigger', () => {
        const trigger = { contains: () => true };
        const popover = { contains: () => false };
        assert.equal(shouldDismissPopover({}, popover, trigger), false);
    });

    it('returns false when popover is null (already closed)', () => {
        assert.equal(shouldDismissPopover({}, null, {}), false);
    });

    it('uses composedPath when supplied — survives DOM mutation by inner click handlers', () => {
        // Simulates: user clicks an inner button whose handler then re-renders, detaching
        // the original target. contains() now returns false (target gone), but composedPath
        // captured the path at dispatch and still includes the popover.
        const detachedTarget = {};
        const popover = { contains: (_el: any) => false };  // detached: not in DOM anymore
        const trigger = { contains: () => false };
        const path = [detachedTarget, popover, { tagName: 'BODY' }];
        assert.equal(shouldDismissPopover(detachedTarget, popover, trigger, path), false);
    });

    it('composedPath outside popover and trigger → dismiss', () => {
        const target = {};
        const popover = { contains: () => false };
        const trigger = { contains: () => false };
        const path = [target, { id: 'unrelated' }];
        assert.equal(shouldDismissPopover(target, popover, trigger, path), true);
    });
});
