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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { samHasPositivePrompt, mergeBoxIntoPrompts, cleanupOrphanNegatives };
}
