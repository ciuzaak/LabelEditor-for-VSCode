// Pure logic for tooltip placement. Deterministic in/out: given a target rect,
// tip rect, viewport rect, and padding, produce { left, top, placement }.

function computeTooltipPosition({ target, tip, viewport, pad }) {
    const safePad = (typeof pad === 'number') ? pad : 8;

    // Default below; flip above if below would clip viewport bottom.
    const below = target.bottom + safePad;
    let placement = 'below';
    let top = below;
    if (top + tip.height > viewport.height) {
        const above = target.top - safePad - tip.height;
        if (above >= 0) {
            top = above;
            placement = 'above';
        } else {
            // Stick at viewport bottom edge minus tip height.
            top = Math.max(0, viewport.height - tip.height);
        }
    }

    // Default left aligned with target; clamp into viewport.
    let left = target.left;
    if (left + tip.width > viewport.width) {
        left = viewport.width - tip.width;
    }
    if (left < 0) left = 0;

    return { left, top, placement };
}

const api = { computeTooltipPosition };
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else if (typeof window !== 'undefined') {
    window.tooltipHelpers = api;
}
