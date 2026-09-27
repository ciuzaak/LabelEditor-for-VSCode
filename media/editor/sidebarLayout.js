// LabelEditor webview — Labels / Instances section resizer and blank-area clicks.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- Sidebar Section Resizer Logic ---
// Allows adjustable height ratio between Labels and Instances sections

const sidebarSectionResizer = document.getElementById('sidebarSectionResizer');
const sidebarLabelsSection = document.getElementById('sidebarLabelsSection');
const sidebarInstancesSection = document.getElementById('sidebarInstancesSection');
let isResizingSidebarSection = false;
let sidebarContentHeight = 0;

// Restore saved section ratio
(function restoreSidebarSectionRatio() {
    const state = vscode.getState() || {};
    if (state.labelsSectionRatio !== undefined && sidebarLabelsSection && sidebarInstancesSection) {
        const ratio = state.labelsSectionRatio;
        sidebarLabelsSection.style.flex = `${ratio} 1 0`;
        sidebarInstancesSection.style.flex = `${1 - ratio} 1 0`;
    }
})();

// Clicking the blank area of the Labels or Instances panel (anywhere that isn't
// a row) clears the selection — mirrors clicking empty space on the canvas.
function clearSelectionFromPanelBlank(e) {
    if (e.target.closest('li')) return;                          // a row click is handled by the row itself
    if (e.target.closest('.sidebar-section-header')) return;     // the title/count header is not "blank area"
    if (!isEditingShape && selectedShapeIndices.size === 0) return; // nothing to clear
    // Clicking away while vertex-editing discards the edit, matching ESC and an
    // empty-canvas click (exitShapeEditMode keeps the selection, which we then clear).
    if (isEditingShape) exitShapeEditMode(false);
    clearSelection();
    renderShapeList();
    renderLabelsList();
    draw();
}
if (sidebarLabelsSection) sidebarLabelsSection.addEventListener('click', clearSelectionFromPanelBlank);
if (sidebarInstancesSection) sidebarInstancesSection.addEventListener('click', clearSelectionFromPanelBlank);

if (sidebarSectionResizer && sidebarLabelsSection && sidebarInstancesSection) {
    sidebarSectionResizer.addEventListener('mousedown', (e) => {
        isResizingSidebarSection = true;
        sidebarSectionResizer.classList.add('resizing');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        // Calculate available height for resizing
        const sidebarContent = sidebarLabelsSection.parentElement;
        if (sidebarContent) {
            sidebarContentHeight = sidebarContent.clientHeight - sidebarSectionResizer.offsetHeight;
        }

        e.preventDefault();
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizingSidebarSection) return;
    if (!sidebarLabelsSection || !sidebarInstancesSection) return;

    const sidebarContent = sidebarLabelsSection.parentElement;
    if (!sidebarContent) return;

    // Get the position relative to the sidebar content
    const rect = sidebarContent.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;

    // Calculate ratio (clamped between 0.1 and 0.9)
    const minHeight = 60; // Minimum section height in pixels
    const maxLabelsHeight = sidebarContentHeight - minHeight;
    const labelsHeight = Math.max(minHeight, Math.min(maxLabelsHeight, relativeY));
    const ratio = labelsHeight / sidebarContentHeight;

    // Apply the new heights using flex
    sidebarLabelsSection.style.flex = `${ratio} 1 0`;
    sidebarInstancesSection.style.flex = `${1 - ratio} 1 0`;
});

document.addEventListener('mouseup', () => {
    if (isResizingSidebarSection) {
        isResizingSidebarSection = false;
        if (sidebarSectionResizer) {
            sidebarSectionResizer.classList.remove('resizing');
        }
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';

        // Save the current ratio to state
        if (sidebarLabelsSection && sidebarInstancesSection) {
            const sidebarContent = sidebarLabelsSection.parentElement;
            if (sidebarContent) {
                const labelsHeight = sidebarLabelsSection.offsetHeight;
                const totalHeight = sidebarContent.clientHeight - sidebarSectionResizer.offsetHeight;
                const ratio = labelsHeight / totalHeight;

                const state = vscode.getState() || {};
                state.labelsSectionRatio = ratio;
                vscode.setState(state);
            }
        }
    }
});
