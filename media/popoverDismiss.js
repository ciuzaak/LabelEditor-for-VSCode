function shouldDismissPopover(clickTarget, popoverEl, triggerEl, eventPath) {
    if (!popoverEl) return false;
    // Prefer the event's composedPath() if provided — captures the path at dispatch
    // time, so it's reliable even if a click handler has already mutated the DOM
    // (e.g., a lock toggle replacing its inner <svg>, detaching the original target).
    if (Array.isArray(eventPath) && eventPath.length) {
        if (eventPath.indexOf(popoverEl) !== -1) return false;
        if (triggerEl && eventPath.indexOf(triggerEl) !== -1) return false;
        return true;
    }
    if (popoverEl.contains(clickTarget)) return false;
    if (triggerEl && triggerEl.contains(clickTarget)) return false;
    return true;
}

function installPopoverDismiss(popoverEl, triggerEl, closeFn) {
    const handler = (e) => {
        if (shouldDismissPopover(e.target, popoverEl, triggerEl)) {
            closeFn();
            document.removeEventListener('mousedown', handler, true);
        }
    };
    // Capture phase so we beat any stopPropagation inside
    document.addEventListener('mousedown', handler, true);
    return handler;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { shouldDismissPopover, installPopoverDismiss };
}
if (typeof window !== 'undefined') {
    window.LabelEditorHelpers = window.LabelEditorHelpers || {};
    window.LabelEditorHelpers.shouldDismissPopover = shouldDismissPopover;
    window.LabelEditorHelpers.installPopoverDismiss = installPopoverDismiss;
}
