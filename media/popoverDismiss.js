function shouldDismissPopover(clickTarget, popoverEl, triggerEl) {
    if (!popoverEl) return false;
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
