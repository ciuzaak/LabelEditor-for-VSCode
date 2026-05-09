// Webview-side rich tooltip. Owns one floating <div class="le-tooltip"> and
// attaches mouseenter/leave/focus/blur to elements with a data-tip-id.

(function () {
    const helpers = (typeof tooltipHelpers !== 'undefined')
        ? tooltipHelpers
        : (typeof window !== 'undefined' ? window.tooltipHelpers : null);
    if (!helpers) {
        console.error('tooltip: tooltipHelpers not loaded');
        return;
    }

    const SHOW_DELAY_MS = 350;
    const PAD = 8;

    let tipsDict = null;
    let tooltipEl = null;
    const attachedEls = new WeakSet();
    let showTimer = null;

    function ensureTooltipEl() {
        if (tooltipEl) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'le-tooltip';
        tooltipEl.style.position = 'fixed';
        tooltipEl.style.pointerEvents = 'none';
        tooltipEl.style.opacity = '0';
        tooltipEl.style.transition = 'opacity 120ms ease';
        tooltipEl.style.zIndex = '99999';
        tooltipEl.style.left = '-9999px';
        tooltipEl.style.top = '-9999px';
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    function renderContent(tip) {
        const el = ensureTooltipEl();
        let html = '';
        if (tip.title) html += `<div class="le-tooltip-title">${escapeHtml(tip.title)}</div>`;
        if (tip.desc)  html += `<div class="le-tooltip-desc">${escapeHtml(tip.desc)}</div>`;
        if (tip.shortcut) html += `<div class="le-tooltip-shortcut"><kbd>${escapeHtml(tip.shortcut)}</kbd></div>`;
        el.innerHTML = html;
    }

    function show(target, tip) {
        renderContent(tip);
        const el = ensureTooltipEl();
        // Make it measurable while still invisible.
        el.style.opacity = '0';
        el.style.left = '-9999px';
        el.style.top = '-9999px';
        const tipRect = el.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const pos = helpers.computeTooltipPosition({
            target: targetRect,
            tip: { width: tipRect.width, height: tipRect.height },
            viewport,
            pad: PAD
        });
        el.style.left = `${pos.left}px`;
        el.style.top = `${pos.top}px`;
        el.style.opacity = '1';
    }

    function hide() {
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
        if (tooltipEl) tooltipEl.style.opacity = '0';
    }

    function tipFor(el) {
        // Two routing options:
        //   1. data-tip-id="ns.key" → look up in tipsDict (static controls)
        //   2. data-tip-text="..."  → use the literal attribute as desc
        // Static IDs take precedence so a misconfigured element with both
        // still picks up the canonical text from the dictionary.
        const id = el.getAttribute('data-tip-id');
        if (id && tipsDict && tipsDict[id]) return tipsDict[id];
        const text = el.getAttribute('data-tip-text');
        if (text) return { desc: text };
        return null;
    }

    function onEnter(e) {
        const el = e.currentTarget;
        const tip = tipFor(el);
        if (!tip) return;
        if (showTimer) clearTimeout(showTimer);
        showTimer = setTimeout(() => show(el, tip), SHOW_DELAY_MS);
    }

    function onLeave() { hide(); }

    function onFocus(e) {
        const el = e.currentTarget;
        const tip = tipFor(el);
        if (!tip) return;
        show(el, tip);
    }

    function onBlur() { hide(); }

    function attach(rootEl, tips) {
        if (tips) tipsDict = tips;
        const root = rootEl || document;
        const nodes = root.querySelectorAll('[data-tip-id], [data-tip-text]');
        for (const n of nodes) {
            if (attachedEls.has(n)) continue;
            attachedEls.add(n);
            // Drop the legacy native bubble so it doesn't double up.
            if (n.hasAttribute('title')) n.removeAttribute('title');
            n.addEventListener('mouseenter', onEnter);
            n.addEventListener('mouseleave', onLeave);
            n.addEventListener('focus', onFocus);
            n.addEventListener('blur', onBlur);
        }
    }

    const api = { attach, hide };
    if (typeof window !== 'undefined') window.tooltip = api;
})();
