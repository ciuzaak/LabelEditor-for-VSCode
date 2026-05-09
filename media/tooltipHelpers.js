// Pure logic for tooltip placement and content composition. Deterministic
// in/out so the security-critical path (runtime user text → escaped HTML)
// can be tested without a DOM.
//
// Wrapped in a function so top-level `const` declarations don't collide with
// other helper modules in the shared classic-script lexical scope.

(function (root) {
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

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

// Build the inner HTML for a tooltip. All user-controlled text fields
// (title, desc, shortcut) are escaped here; callers can drop the result into
// innerHTML safely. Returns '' for an empty descriptor so callers can hide
// the tooltip cleanly.
function buildTooltipHtml(tip) {
    if (!tip) return '';
    let html = '';
    if (tip.title)    html += '<div class="le-tooltip-title">' + escapeHtml(tip.title) + '</div>';
    if (tip.desc)     html += '<div class="le-tooltip-desc">' + escapeHtml(tip.desc) + '</div>';
    if (tip.shortcut) html += '<div class="le-tooltip-shortcut"><kbd>' + escapeHtml(tip.shortcut) + '</kbd></div>';
    return html;
}

// Resolve a tooltip descriptor for an element: dictionary lookup via
// `data-tip-id` first, then literal `data-tip-text` as a desc-only fallback.
// Static IDs win even if both are present so ad-hoc text cannot shadow a
// canonical entry. Returns null when no descriptor is available.
function resolveTipForAttrs({ tipId, tipText, tipsDict }) {
    if (tipId && tipsDict && tipsDict[tipId]) return tipsDict[tipId];
    if (tipText) return { desc: tipText };
    return null;
}

const api = { computeTooltipPosition, escapeHtml, buildTooltipHtml, resolveTipForAttrs };
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else if (root) {
    root.tooltipHelpers = api;
}
})(typeof window !== 'undefined' ? window : null);
