// LabelEditor webview — Keyboard shortcuts and dialog focus handling.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- Shortcuts ---

// True while any dialog (.modal overlay) is shown. Canvas shortcuts must not
// act on the shapes behind it.
function isAnyModalOpen() {
    return [...document.querySelectorAll('.modal')].some(m => m.style.display === 'flex');
}

// Dialog semantics and focus handling for every .modal overlay, without
// touching each show/hide function: the dialog is announced as such, focus
// moves into it when it opens (unless its show function already focused a
// field), Tab / Shift+Tab stay inside it, and focus returns to the control
// that opened it when it closes.
// (a[href], not [href]: the icon sprites' <use href> must not count.)
const MODAL_FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), '
    + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function modalFocusables(modal) {
    return [...modal.querySelectorAll(MODAL_FOCUSABLE)].filter(el => el.getClientRects().length > 0);
}

(function setupModalAccessibility() {
    // The observer below runs after a show function has already moved focus
    // into its dialog, so remember the last focus outside any dialog instead.
    let lastFocusOutsideModals = null;
    document.addEventListener('focusin', (e) => {
        if (!(e.target instanceof Element) || !e.target.closest('.modal')) lastFocusOutsideModals = e.target;
    });

    for (const modal of document.querySelectorAll('.modal')) {
        const dialog = modal.querySelector('.modal-content') || modal;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        const title = dialog.querySelector('h1, h2, h3');
        if (title) {
            if (!title.id) title.id = modal.id + 'Title';
            dialog.setAttribute('aria-labelledby', title.id);
        }
        let isOpen = modal.style.display === 'flex';
        let returnFocusTo = null;
        let returnListPos = null; // same spot in a list, if the list re-renders meanwhile
        new MutationObserver(() => {
            const nowOpen = modal.style.display === 'flex';
            if (nowOpen === isOpen) return;
            isOpen = nowOpen;
            if (nowOpen) {
                returnFocusTo = modal.contains(document.activeElement)
                    ? lastFocusOutsideModals
                    : document.activeElement;
                returnListPos = rovingFocusPosition(shapeList, returnFocusTo)
                    || rovingFocusPosition(labelsList, returnFocusTo);
                setTimeout(() => {
                    if (modal.style.display !== 'flex' || modal.contains(document.activeElement)) return;
                    const first = modalFocusables(modal).find(el => !el.classList.contains('modal-close'))
                        || modalFocusables(modal)[0];
                    if (first) first.focus();
                }, 0);
            } else {
                const target = returnFocusTo;
                const listPos = returnListPos;
                returnFocusTo = null;
                returnListPos = null;
                const focusLost = modal.contains(document.activeElement) || document.activeElement === document.body;
                if (!focusLost) return;
                if (target && target.isConnected && typeof target.focus === 'function') target.focus();
                else if (listPos) focusRovingPosition(listPos);
            }
        }).observe(modal, { attributes: true, attributeFilter: ['style'] });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const modal = [...document.querySelectorAll('.modal')].find(m => m.style.display === 'flex');
        if (!modal) return;
        const items = modalFocusables(modal);
        if (items.length === 0) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const inside = modal.contains(document.activeElement);
        if (e.shiftKey && (!inside || document.activeElement === first)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
            e.preventDefault();
            first.focus();
        }
    });
})();

// Track Shift press for eraser/negative-point feedback (cursor + status bar).
document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !shiftPressed) {
        if (isAnyModalOpen()) return;
        const focusedTag = document.activeElement?.tagName;
        if (focusedTag === 'INPUT' || focusedTag === 'TEXTAREA' || focusedTag === 'SELECT') return;
        if (eraserActive) return;
        shiftPressed = true;
        // Shift owns the cursor and suppresses hover preview (the mousemove
        // handler early-returns while Shift is held); drop any stale hover.
        if (hoveredShapeIndex !== -1) {
            hoveredShapeIndex = -1;
            draw();
        }
        updateShiftFeedback();
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        shiftPressed = false;
        updateShiftFeedback();
    }
});

window.addEventListener('blur', () => {
    if (shiftPressed) {
        shiftPressed = false;
        updateShiftFeedback();
    }
});

// Dispatcher: every shortcut goes through window.keybindings.matchAction. The
// per-action behaviour lives in handleAction() so the settings UI can rebind
// without touching the dispatcher.
document.addEventListener('keydown', (e) => {
    // Ignore shortcuts while a dialog is open (its Enter/Esc are handled below).
    if (isAnyModalOpen()) return;

    // Capture mode owns the next press — the row in the settings UI is waiting
    // to bind it. The capture handler attaches/detaches itself; this is just a
    // belt-and-braces guard so a stray key doesn't fall through to actions.
    if (keybindingsCapture) return;

    const kb = window.keybindings;
    if (!kb) return;
    const actionId = kb.matchAction(e, currentBindings, kb.ALT_BINDINGS);
    if (!actionId) return;

    // While a form field has focus, keys belong to it: Ctrl+Z / Ctrl+A must
    // undo / select the text, not the shapes. Only Save and image search
    // still work from inside a field.
    const focusedTag = document.activeElement?.tagName;
    if ((focusedTag === 'INPUT' || focusedTag === 'TEXTAREA' || focusedTag === 'SELECT')
        && actionId !== 'edit.save' && actionId !== 'browser.find') {
        return;
    }

    handleAction(actionId, e);
});

function handleAction(id, e) {
    switch (id) {
        case 'browser.find':
            e.preventDefault();
            if (searchInputContainer && searchInput) {
                if (imageBrowserSidebar && imageBrowserSidebar.classList.contains('collapsed')) {
                    imageBrowserSidebar.classList.remove('collapsed');
                    imageBrowserExpanded = true;
                    const state = vscode.getState() || {};
                    if (state.leftSidebarWidth) {
                        imageBrowserSidebar.style.width = state.leftSidebarWidth + 'px';
                    }
                    state.imageBrowserExpanded = true;
                    vscode.setState(state);
                    searchInputContainer.style.display = 'flex';
                    searchInput.focus();
                } else {
                    if (searchInputContainer.style.display === 'none') {
                        searchInputContainer.style.display = 'flex';
                        searchInput.focus();
                    } else {
                        searchInputContainer.style.display = 'none';
                        searchInput.value = '';
                        filterImages('');
                    }
                }
            }
            return;
        case 'edit.save':
            e.preventDefault();
            save();
            return;
        case 'edit.undo':
            e.preventDefault();
            undo();
            return;
        case 'edit.redo':
            e.preventDefault();
            redo();
            return;
        case 'edit.selectAll':
            e.preventDefault();
            selectAllShapes();
            renderShapeList();
            draw();
            return;
        case 'edit.merge':
            e.preventDefault();
            mergeSelectedShapes();
            return;
        case 'edit.rename':
            e.preventDefault();
            if (selectedShapeIndices.size > 1) {
                showBatchRenameModal();
            } else if (selectedShapeIndex !== -1) {
                showLabelModal(selectedShapeIndex);
            }
            return;
        case 'edit.toggleVisible':
            e.preventDefault();
            toggleSelectedVisibility();
            return;
        case 'nav.prev':
            navigateRelative(-1);
            return;
        case 'nav.next':
            navigateRelative(1);
            return;
        case 'edit.delete':
            if (selectedShapeIndices.size > 0) {
                if (selectedShapeIndices.size > 1) {
                    deleteSelectedShapes();
                } else {
                    deleteShape(selectedShapeIndex);
                }
            }
            return;
        case 'edit.cancel': {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (shapeContextMenu && shapeContextMenu.style.display !== 'none') {
                hideShapeContextMenu();
                return;
            }
            if (isBoxSelecting) {
                isBoxSelecting = false;
                boxSelectStart = null;
                boxSelectCurrent = null;
                draw();
                return;
            }
            if (eraserActive || eraserMouseDownPos) {
                cancelEraser();
                eraserMouseDownPos = null;
                eraserMouseDownTime = 0;
                eraserIsDragging = false;
                eraserDragCurrent = null;
                return;
            }
            if (isEditingShape) {
                exitShapeEditMode(false);
                return;
            }
            if (isDrawing) {
                isDrawing = false;
                currentPoints = [];
                draw();
                return;
            }
            if (currentMode === 'sam' && (samPrompts.length > 0 || samMaskContour || samBoxSecondClick)) {
                samClearState();
                return;
            }
            if (selectedShapeIndices.size > 0) {
                clearSelection();
                renderShapeList();
                draw();
            }
            return;
        }
        case 'mode.view':       setMode('view');      return;
        case 'mode.point':      setMode('point');     return;
        case 'mode.line':       setMode('line');      return;
        case 'mode.polygon':    setMode('polygon');   return;
        case 'mode.rectangle':  setMode('rectangle'); return;
        case 'mode.circle':     setMode('circle');    return;
        case 'mode.sam':        setMode('sam');       return;
    }
}
