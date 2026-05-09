import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'tooltipHelpers.js'));
const { computeTooltipPosition, escapeHtml, buildTooltipHtml, resolveTipForAttrs } = helpers;

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

describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
        assert.equal(escapeHtml('&'), '&amp;');
        assert.equal(escapeHtml('<'), '&lt;');
        assert.equal(escapeHtml('>'), '&gt;');
        assert.equal(escapeHtml('"'), '&quot;');
        assert.equal(escapeHtml("'"), '&#39;');
    });
    it('escapes a script-tag injection attempt', () => {
        assert.equal(
            escapeHtml('<script>alert(1)</script>'),
            '&lt;script&gt;alert(1)&lt;/script&gt;'
        );
    });
    it('coerces non-string inputs to string before escaping', () => {
        assert.equal(escapeHtml(42 as any), '42');
        assert.equal(escapeHtml(null as any), 'null');
    });
});

describe('buildTooltipHtml', () => {
    it('returns empty string for falsy descriptor', () => {
        assert.equal(buildTooltipHtml(null), '');
        assert.equal(buildTooltipHtml(undefined), '');
    });
    it('renders title, desc, and shortcut into nested divs', () => {
        const html = buildTooltipHtml({ title: 'A', desc: 'B', shortcut: 'C' });
        assert.match(html, /<div class="le-tooltip-title">A<\/div>/);
        assert.match(html, /<div class="le-tooltip-desc">B<\/div>/);
        assert.match(html, /<div class="le-tooltip-shortcut"><kbd>C<\/kbd><\/div>/);
    });
    it('omits sections that are missing', () => {
        const html = buildTooltipHtml({ desc: 'B' });
        assert.equal(html.includes('le-tooltip-title'), false);
        assert.equal(html.includes('le-tooltip-shortcut'), false);
        assert.match(html, /<div class="le-tooltip-desc">B<\/div>/);
    });
    it('escapes user-supplied text in every field — script injection blocked', () => {
        const evil = '<img src=x onerror=alert(1)>';
        const html = buildTooltipHtml({ title: evil, desc: evil, shortcut: evil });
        assert.equal(html.includes('<img'), false);
        assert.equal(html.includes('onerror'), true); // present as text
        // Escaped form must appear in each section
        const escaped = '&lt;img src=x onerror=alert(1)&gt;';
        assert.ok(html.indexOf(escaped) >= 0);
    });
});

describe('resolveTipForAttrs', () => {
    const dict = { 'mode.view': { title: 'View', desc: 'Pan and select' } };

    it('returns null when neither id nor text is provided', () => {
        assert.equal(resolveTipForAttrs({ tipId: null, tipText: null, tipsDict: dict }), null);
    });
    it('returns the dictionary entry for a known id', () => {
        const got = resolveTipForAttrs({ tipId: 'mode.view', tipText: null, tipsDict: dict });
        assert.equal(got.title, 'View');
    });
    it('falls back to a desc-only descriptor when only data-tip-text is present', () => {
        const got = resolveTipForAttrs({ tipId: null, tipText: 'C:\\Users\\me\\img.png', tipsDict: dict });
        assert.deepEqual(got, { desc: 'C:\\Users\\me\\img.png' });
    });
    it('prefers the dictionary entry when both id and text are provided', () => {
        const got = resolveTipForAttrs({ tipId: 'mode.view', tipText: 'shadow', tipsDict: dict });
        assert.equal(got.title, 'View');
    });
    it('falls back to data-tip-text when the id is unknown', () => {
        const got = resolveTipForAttrs({ tipId: 'no.such', tipText: 'fallback', tipsDict: dict });
        assert.deepEqual(got, { desc: 'fallback' });
    });
});
