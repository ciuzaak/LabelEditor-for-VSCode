import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'tooltipHelpers.js'));
const { computeTooltipPosition } = helpers;

const VIEWPORT = { width: 1000, height: 800 };
const PAD = 8;
const TIP = { width: 200, height: 60 };

describe('computeTooltipPosition', () => {
    it('places tooltip below and left-aligned with the target by default', () => {
        const target = { left: 100, top: 100, right: 140, bottom: 130, width: 40, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT, pad: PAD });
        assert.equal(got.placement, 'below');
        assert.equal(got.left, 100);
        assert.equal(got.top, 130 + PAD);
    });

    it('flips above when below would overflow the viewport bottom', () => {
        const target = { left: 100, top: 740, right: 140, bottom: 770, width: 40, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT, pad: PAD });
        assert.equal(got.placement, 'above');
        assert.equal(got.top, 740 - PAD - TIP.height);
    });

    it('clamps right edge into viewport when target sits near right edge', () => {
        const target = { left: 900, top: 100, right: 940, bottom: 130, width: 40, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT, pad: PAD });
        // Tip width 200 from left=900 would reach 1100, so clamp to viewport width - tip.width.
        assert.equal(got.left, VIEWPORT.width - TIP.width);
    });

    it('clamps left edge to zero when target sits near left edge', () => {
        const target = { left: 0, top: 100, right: 30, bottom: 130, width: 30, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT, pad: PAD });
        assert.ok(got.left >= 0);
    });

    it('falls back to bottom-edge clamp when both below and above clip', () => {
        // Tip taller than viewport height makes both placements clip.
        const tallTip = { width: 200, height: 1000 };
        const target = { left: 100, top: 400, right: 140, bottom: 430, width: 40, height: 30 };
        const got = computeTooltipPosition({ target, tip: tallTip, viewport: VIEWPORT, pad: PAD });
        // Falls into the bottom-clamp branch and pins to top: 0.
        assert.equal(got.top, 0);
    });

    it('uses default pad of 8 when pad is not provided', () => {
        const target = { left: 100, top: 100, right: 140, bottom: 130, width: 40, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT });
        assert.equal(got.top, 130 + 8);
    });
});
