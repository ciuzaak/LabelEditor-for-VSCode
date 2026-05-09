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

    const SHOW_DELAY_MS = 500;
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

    function renderContent(tip) {
        const el = ensureTooltipEl();
        el.innerHTML = helpers.buildTooltipHtml(tip);
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
        return helpers.resolveTipForAttrs({
            tipId:   el.getAttribute('data-tip-id'),
            tipText: el.getAttribute('data-tip-text'),
            tipsDict
        });
    }

    function onEnter(e) {
        const el = e.currentTarget;
        const tip = tipFor(el);
        if (!tip) return;
        if (showTimer) clearTimeout(showTimer);
        showTimer = setTimeout(() => show(el, tip), SHOW_DELAY_MS);
    }

    function onLeave() { hide(); }

    // Pointer-driven focus (clicking a button) should NOT surface a tooltip —
    // the user already knows what they clicked. Only show on focus when the
    // browser flags it as keyboard-driven via :focus-visible.
    function onFocus(e) {
        const el = e.currentTarget;
        if (typeof el.matches === 'function' && !el.matches(':focus-visible')) return;
        const tip = tipFor(el);
        if (!tip) return;
        show(el, tip);
    }

    function onBlur() { hide(); }

    // Cancel any pending show + hide the visible tip when the user starts a
    // click. Fires on mousedown (capture is unnecessary here — bubbling on
    // the element itself is enough) so the tip is gone before the click's
    // focus lands.
    function onMouseDown() { hide(); }

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
            n.addEventListener('mousedown', onMouseDown);
            n.addEventListener('focus', onFocus);
            n.addEventListener('blur', onBlur);
        }
    }

    const api = { attach, hide };
    if (typeof window !== 'undefined') window.tooltip = api;
})();
