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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        samHasPositivePrompt,
        mergeBoxIntoPrompts,
        cleanupOrphanNegatives,
        samShouldDeferToMainHandler
    };
}
