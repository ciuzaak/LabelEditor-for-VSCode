// LabelEditor webview — ONNX batch inference dialog.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- ONNX Batch Inference ---
const onnxBatchInferMenuItem = document.getElementById('onnxBatchInferMenuItem');
const onnxInferModal = document.getElementById('onnxInferModal');
const onnxModelDirInput = document.getElementById('onnxModelDir');
const onnxPythonPathInput = document.getElementById('onnxPythonPath');
const onnxModelDirBrowse = document.getElementById('onnxModelDirBrowse');
const onnxPythonPathBrowse = document.getElementById('onnxPythonPathBrowse');
const onnxImageCountSpan = document.getElementById('onnxImageCount');
const onnxInferOkBtn = document.getElementById('onnxInferOkBtn');
const onnxInferCancelBtn = document.getElementById('onnxInferCancelBtn');

function updateOnnxImageCount() {
    if (!onnxImageCountSpan) return;
    const scope = document.querySelector('input[name="onnxScope"]:checked')?.value || 'all';
    if (scope === 'current') {
        onnxImageCountSpan.textContent = '1';
    } else {
        onnxImageCountSpan.textContent = (typeof workspaceImages !== 'undefined' ? workspaceImages.length : 0).toString();
    }
}

function showOnnxInferModal() {
    // Close the tools menu
    if (toolsMenuDropdown) toolsMenuDropdown.style.display = 'none';

    // Restore saved settings from globalState (persisted across sessions)
    const gs = (typeof initialGlobalSettings !== 'undefined') ? initialGlobalSettings : {};
    // vscodeState overrides for within-session changes
    const savedState = vscode.getState() || {};

    if (onnxModelDirInput) {
        onnxModelDirInput.value = savedState.onnxModelDir ?? gs.onnxModelDir ?? '';
    }
    if (onnxPythonPathInput) {
        onnxPythonPathInput.value = savedState.onnxPythonPath ?? gs.onnxPythonPath ?? '';
    }

    // Restore radio selections
    const restoreRadio = (name, savedValue) => {
        if (!savedValue) return;
        const radio = document.querySelector(`input[name="${name}"][value="${savedValue}"]`);
        if (radio) radio.checked = true;
    };
    restoreRadio('onnxDevice', savedState.onnxDevice ?? gs.onnxDevice);
    restoreRadio('onnxColor', savedState.onnxColor ?? gs.onnxColor);
    restoreRadio('onnxScope', savedState.onnxScope ?? gs.onnxScope);
    restoreRadio('onnxMode', savedState.onnxMode ?? gs.onnxMode);

    // Update image count based on scope
    updateOnnxImageCount();

    // Trigger GPU detection if GPU is selected
    const onnxGpuGroup = document.getElementById('onnxGpuIndexGroup');
    const onnxSelectedDevice = document.querySelector('input[name="onnxDevice"]:checked')?.value || 'cpu';
    // Store pending GPU index to restore after detection result arrives
    const pendingOnnxGpuIndex = savedState.onnxGpuIndex ?? gs.onnxGpuIndex ?? -1;
    if (onnxSelectedDevice === 'gpu') {
        document.getElementById('onnxGpuIndexGroup').__pendingGpuIndex = pendingOnnxGpuIndex;
        vscode.postMessage({ command: 'detectGpuCount' });
    } else if (onnxGpuGroup) {
        onnxGpuGroup.style.display = 'none';
    }

    // Show modal
    if (onnxInferModal) onnxInferModal.style.display = 'flex';
    if (onnxModelDirInput && !onnxModelDirInput.value) onnxModelDirInput.focus();
}

function hideOnnxInferModal() {
    if (onnxInferModal) onnxInferModal.style.display = 'none';
}

function saveOnnxSettings(settings) {
    // Save to vscode webview state (within session, survives HTML regeneration)
    const state = vscode.getState() || {};
    Object.assign(state, settings);
    vscode.setState(state);

    // Save each setting to globalState (persists across sessions/restarts)
    for (const [key, value] of Object.entries(settings)) {
        vscode.postMessage({ command: 'saveGlobalSettings', key: key, value: value });
    }
}

function submitOnnxInfer() {
    const modelDir = onnxModelDirInput ? onnxModelDirInput.value.trim() : '';
    const pythonPath = onnxPythonPathInput ? onnxPythonPathInput.value.trim() : '';
    const device = document.querySelector('input[name="onnxDevice"]:checked')?.value || 'cpu';
    const colorFormat = document.querySelector('input[name="onnxColor"]:checked')?.value || 'rgb';
    const scope = document.querySelector('input[name="onnxScope"]:checked')?.value || 'all';
    const mode = document.querySelector('input[name="onnxMode"]:checked')?.value || 'skip';
    const onnxGpuSelect = document.getElementById('onnxGpuIndex');
    const onnxGpuGroup = document.getElementById('onnxGpuIndexGroup');
    // Use dropdown value if populated, otherwise fall back to saved/persisted index
    const savedState = vscode.getState() || {};
    const gpuIndex = (device === 'gpu')
        ? (onnxGpuGroup && onnxGpuGroup.style.display !== 'none' && onnxGpuSelect
            ? parseInt(onnxGpuSelect.value)
            : (savedState.onnxGpuIndex ?? (typeof initialGlobalSettings !== 'undefined' ? initialGlobalSettings.onnxGpuIndex : undefined) ?? 0))
        : undefined;

    if (!modelDir) {
        if (onnxModelDirInput) onnxModelDirInput.focus();
        return;
    }

    // Persist all settings
    saveOnnxSettings({
        onnxModelDir: modelDir,
        onnxPythonPath: pythonPath,
        onnxDevice: device,
        onnxColor: colorFormat,
        onnxScope: scope,
        onnxMode: mode,
        onnxGpuIndex: gpuIndex ?? -1
    });

    // Send to extension backend
    vscode.postMessage({
        command: 'onnxBatchInfer',
        config: {
            modelDir: modelDir,
            pythonPath: pythonPath,
            device: device,
            colorFormat: colorFormat,
            scope: scope,
            mode: mode,
            gpuIndex: gpuIndex
        }
    });

    hideOnnxInferModal();
}

if (onnxBatchInferMenuItem) {
    onnxBatchInferMenuItem.addEventListener('click', showOnnxInferModal);
}
if (onnxInferOkBtn) {
    onnxInferOkBtn.addEventListener('click', submitOnnxInfer);
}
if (onnxInferCancelBtn) {
    onnxInferCancelBtn.addEventListener('click', hideOnnxInferModal);
}
// Browse buttons
if (onnxModelDirBrowse) {
    onnxModelDirBrowse.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseOnnxModelDir',
            currentValue: onnxModelDirInput ? onnxModelDirInput.value.trim() : ''
        });
    });
}
if (onnxPythonPathBrowse) {
    onnxPythonPathBrowse.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseOnnxPythonPath',
            currentValue: onnxPythonPathInput ? onnxPythonPathInput.value.trim() : ''
        });
    });
}
// Scope radio change updates image count
document.querySelectorAll('input[name="onnxScope"]').forEach(radio => {
    radio.addEventListener('change', updateOnnxImageCount);
});
// Device radio change: toggle GPU index dropdown
document.querySelectorAll('input[name="onnxDevice"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const onnxGpuGroup = document.getElementById('onnxGpuIndexGroup');
        if (e.target.value === 'gpu') {
            vscode.postMessage({ command: 'detectGpuCount' });
        } else if (onnxGpuGroup) {
            onnxGpuGroup.style.display = 'none';
        }
    });
});
// Allow Enter key to submit in model dir input
if (onnxModelDirInput) {
    onnxModelDirInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitOnnxInfer();
        if (e.key === 'Escape') hideOnnxInferModal();
    });
}
// Close ONNX modal on Escape or click-outside
if (onnxInferModal) {
    onnxInferModal.addEventListener('click', (e) => {
        if (e.target === onnxInferModal) hideOnnxInferModal();
    });
}

// Close sidebar dropdowns when clicking outside.
// Listens on `mousedown` (fires before any inner click handlers can mutate the DOM
// — e.g., a lock toggle re-rendering its <svg> would otherwise detach e.target,
// making contains() falsely return "outside"). composedPath() is also passed as a
// belt-and-braces fallback in case the path is required.
document.addEventListener('mousedown', (e) => {
    const helpers = (typeof window !== 'undefined') ? window.LabelEditorHelpers : null;
    const dismiss = helpers ? helpers.shouldDismissPopover : null;
    if (!dismiss) return;
    const path = (typeof e.composedPath === 'function') ? e.composedPath() : null;
    // Settings dropdown
    if (settingsMenuDropdown && settingsMenuDropdown.style.display !== 'none') {
        if (dismiss(e.target, settingsMenuDropdown, settingsMenuBtn, path)) {
            settingsMenuDropdown.style.display = 'none';
            const state = vscode.getState() || {};
            state.settingsMenuExpanded = false;
            vscode.setState(state);
        }
    }
    // Tools dropdown
    if (toolsMenuDropdown && toolsMenuDropdown.style.display !== 'none') {
        if (dismiss(e.target, toolsMenuDropdown, toolsMenuBtn, path)) {
            toolsMenuDropdown.style.display = 'none';
        }
    }
    // Class combobox (advanced search) — the whole condition row is the "trigger"
    // so clicks on the input/caret/chips keep it open; clicks elsewhere dismiss it.
    if (advClassComboEl && advClassComboEl.style.display !== 'none') {
        const trigger = advClassComboInput ? advClassComboInput.closest('.adv-cond') : null;
        if (dismiss(e.target, advClassComboEl, trigger, path)) closeClassCombo();
    }
});

// Keep the class combobox glued to its input as the modal scrolls or the window
// resizes (it is position:fixed and anchored via getBoundingClientRect). Capture
// phase catches scrolls on the now-scrollable .modal-content (scroll doesn't bubble).
window.addEventListener('resize', () => {
    if (advClassComboInput) positionClassCombo();
    // A window resize can shift the buttons relative to a full-width open menu, so
    // re-aim the arrow (the resize-handle path already closes the menu on mousedown).
    if (settingsMenuDropdown && settingsMenuDropdown.style.display !== 'none' && settingsMenuBtn) {
        positionSidebarDropdownArrow(settingsMenuDropdown, settingsMenuBtn);
    }
    if (toolsMenuDropdown && toolsMenuDropdown.style.display !== 'none' && toolsMenuBtn) {
        positionSidebarDropdownArrow(toolsMenuDropdown, toolsMenuBtn);
    }
});
document.addEventListener('scroll', () => { if (advClassComboInput) positionClassCombo(); }, true);
