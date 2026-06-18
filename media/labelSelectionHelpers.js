// Pure, DOM-free helper for selecting shape instances by label from the Labels
// list. Loaded as a <script> in the webview AND required from Node tests.
(function (root) {
    // Given the shapes array and a target label, return the shape indices that
    // should be selected after a click on that label's row.
    //
    //   additive=false (plain click): exactly the indices whose shape.label
    //     matches `label` — replaces the current selection.
    //   additive=true (Ctrl/Cmd click): toggle the label's group against the
    //     current selection. If every instance of the label is already selected,
    //     drop them all; otherwise add the missing ones. Indices belonging to
    //     other labels are preserved.
    //
    // The result is always ascending, de-duplicated, and clamped to valid indices.
    function computeLabelSelection(shapes, label, currentIndices, additive) {
        const list = Array.isArray(shapes) ? shapes : [];
        const group = [];
        for (let i = 0; i < list.length; i++) {
            if (list[i] && list[i].label === label) group.push(i);
        }
        if (!additive) return group;

        const selected = new Set(currentIndices || []);
        const allSelected = group.length > 0 && group.every(i => selected.has(i));
        if (allSelected) {
            group.forEach(i => selected.delete(i));
        } else {
            group.forEach(i => selected.add(i));
        }
        return [...selected].filter(i => i >= 0 && i < list.length).sort((a, b) => a - b);
    }

    const api = { computeLabelSelection };
    if (root) root.LabelSelectionHelpers = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
