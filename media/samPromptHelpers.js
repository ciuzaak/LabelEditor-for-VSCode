// Pure helpers for SAM prompt combination and Shift routing.
// Loaded as a <script> in the webview AND required from Node tests.

function samHasPositivePrompt(prompts) {
    return prompts.some(p =>
        p.type === 'rectangle' ||
        (p.type === 'point' && p.label === 1)
    );
}

function mergeBoxIntoPrompts(prompts, newBox) {
    return prompts.filter(p => p.type !== 'rectangle').concat([newBox]);
}

function cleanupOrphanNegatives(prompts) {
    return samHasPositivePrompt(prompts) ? prompts : [];
}

// Returns true when the SAM mousedown capture handler should NOT consume
// the event, so the main mousedown handler runs instead.
//
// Cases (only relevant when currentMode === 'sam' and button === 0):
//   - eraser is mid-draw: subsequent clicks must reach the main handler's
//     eraserActive branch to extend or close the shape, regardless of shift.
//   - shift+click with no positive prompt and not in box-second-click:
//     start eraser (negative-point routing requires a positive prompt first).
function samShouldDeferToMainHandler({ shiftKey, eraserActive, samBoxSecondClick, prompts }) {
    if (eraserActive) return true;
    if (shiftKey && !samBoxSecondClick && !samHasPositivePrompt(prompts)) return true;
    return false;
}

// --- Shift feedback decision helpers (pure) ---

// Refresh the prior-status snapshot whenever statusSpan currently holds a
// non-feedback string. This catches both the initial Shift-down transition
// and any external write that happened mid-hold (e.g., SAM encode/decode
// finishing during Shift hold). Without this refresh, on Shift-up we would
// restore the stale snapshot and clobber the external write.
function shouldRefreshShiftSnapshot(currentStatusText, lastFeedbackText) {
    return currentStatusText !== lastFeedbackText;
}

// Restore the prior-status only when we still own the status bar — i.e.
// statusSpan still contains the feedback string we wrote. If something
// else has overwritten it, leave their text in place.
function shouldRestoreShiftStatus(lastFeedbackText, currentStatusText) {
    return lastFeedbackText !== null && currentStatusText === lastFeedbackText;
}

// Compute the feedback descriptor for the current mode and prompt state.
// `eraserCursor` is supplied by the caller so this stays free of any
// DOM-only constants. Returns { text, color, cursor }.
function computeShiftFeedback(currentMode, prompts, eraserCursor) {
    if (currentMode === 'sam' && samHasPositivePrompt(prompts)) {
        return { text: 'SAM: Negative point', color: '#ff4444', cursor: 'crosshair' };
    }
    const text = currentMode === 'sam' ? 'SAM: Eraser mode' : 'Eraser mode';
    return { text, color: '#ff8800', cursor: eraserCursor };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        samHasPositivePrompt,
        mergeBoxIntoPrompts,
        cleanupOrphanNegatives,
        samShouldDeferToMainHandler,
        shouldRefreshShiftSnapshot,
        shouldRestoreShiftStatus,
        computeShiftFeedback
    };
}
