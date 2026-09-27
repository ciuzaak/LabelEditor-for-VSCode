// LabelEditor webview — Tools menu, SVG export and dataset export dialogs.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- Tools Menu ---
const toolsMenuBtn = document.getElementById('toolsMenuBtn');
const toolsMenuDropdown = document.getElementById('toolsMenuDropdown');
const exportSvgMenuItem = document.getElementById('exportSvgMenuItem');

// --- Export SVG (modal: scope + output directory, mirrors Export Dataset) ---
const exportSvgModal = document.getElementById('exportSvgModal');
const svgOutputDirInput = document.getElementById('svgOutputDir');
const svgOutputDirBrowse = document.getElementById('svgOutputDirBrowse');
const svgImageCountSpan = document.getElementById('svgImageCount');
const svgExportRunBtn = document.getElementById('svgExportRunBtn');
const svgExportCancelBtn = document.getElementById('svgExportCancelBtn');

function getSvgExportScope() {
    const checked = document.querySelector('input[name="svgExportScope"]:checked');
    return checked ? checked.value : 'all';
}

function showExportSvgModal() {
    if (toolsMenuDropdown) toolsMenuDropdown.style.display = 'none';
    if (!exportSvgModal) return;
    // Restore the last-used scope: session state (survives HTML regeneration)
    // takes priority, then the persisted global setting.
    const savedState = vscode.getState() || {};
    const savedScope = savedState.svgExportScope || (initialGlobalSettings && initialGlobalSettings.svgExportScope);
    if (savedScope) {
        const scopeInput = document.querySelector(`input[name="svgExportScope"][value="${savedScope}"]`);
        if (scopeInput) scopeInput.checked = true;
    }
    if (svgImageCountSpan) svgImageCountSpan.textContent = '0';
    exportSvgModal.style.display = 'flex';
    // Forward the unsaved current-image shapes so the count (and the run) reflect
    // in-memory edits rather than the stale sidecar.
    vscode.postMessage({
        command: 'exportSvgPrepare',
        scope: getSvgExportScope(),
        currentImage: buildExportCurrentImageOverride() || undefined
    });
}

function hideExportSvgModal() {
    if (exportSvgModal) exportSvgModal.style.display = 'none';
}

function submitExportSvg() {
    const config = {
        scope: getSvgExportScope(),
        outputDir: svgOutputDirInput ? svgOutputDirInput.value.trim() : ''
    };
    const override = buildExportCurrentImageOverride();
    if (override) config.currentImage = override;
    saveGlobalSettings('svgExportScope', config.scope);
    vscode.postMessage({ command: 'exportSvgRun', config });
}

if (exportSvgMenuItem) {
    exportSvgMenuItem.addEventListener('click', showExportSvgModal);
}
if (svgOutputDirBrowse && svgOutputDirInput) {
    svgOutputDirBrowse.addEventListener('click', () => {
        vscode.postMessage({
            command: 'saveAsSvgOutputDir',
            currentValue: svgOutputDirInput.value || undefined
        });
    });
}
if (svgExportRunBtn) svgExportRunBtn.addEventListener('click', submitExportSvg);
if (svgExportCancelBtn) svgExportCancelBtn.addEventListener('click', hideExportSvgModal);
// Re-request the count when the scope flips between "all" and "current".
document.querySelectorAll('input[name="svgExportScope"]').forEach(radio => {
    radio.addEventListener('change', () => {
        vscode.postMessage({
            command: 'exportSvgPrepare',
            scope: getSvgExportScope(),
            currentImage: buildExportCurrentImageOverride() || undefined
        });
    });
});

// --- Export Dataset (COCO / YOLO) ---
const exportDatasetMenuItem = document.getElementById('exportDatasetMenuItem');
const exportDatasetModal = document.getElementById('exportDatasetModal');
const exportOutputDirInput = document.getElementById('exportOutputDir');
const exportOutputDirBrowse = document.getElementById('exportOutputDirBrowse');
const exportClassList = document.getElementById('exportClassList');
const exportAddClassInput = document.getElementById('exportAddClassInput');
const exportAddClassBtn = document.getElementById('exportAddClassBtn');
const exportImageCountSpan = document.getElementById('exportImageCount');
const exportAnnotationCountSpan = document.getElementById('exportAnnotationCount');
const exportRunBtn = document.getElementById('exportRunBtn');
const exportCancelBtn = document.getElementById('exportCancelBtn');

// Working class list — user edits this until they Run.
let exportClasses = [];

function getExportFormat() {
    const checked = document.querySelector('input[name="exportFormat"]:checked');
    return checked ? checked.value : 'coco';
}

function getExportScope() {
    const checked = document.querySelector('input[name="exportScope"]:checked');
    return checked ? checked.value : 'all';
}

function renderExportClassList() {
    if (!exportClassList) return;
    exportClassList.innerHTML = '';
    exportClasses.forEach((name, idx) => {
        const li = document.createElement('li');
        li.className = 'export-class-row';
        const idxBadge = document.createElement('span');
        idxBadge.className = 'export-class-index';
        idxBadge.textContent = '#' + idx;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'export-class-name';
        nameSpan.textContent = name;
        const upBtn = document.createElement('button');
        upBtn.className = 'btn btn-icon';
        upBtn.textContent = '↑';
        upBtn.disabled = idx === 0;
        upBtn.onclick = () => {
            if (idx === 0) return;
            const tmp = exportClasses[idx - 1];
            exportClasses[idx - 1] = exportClasses[idx];
            exportClasses[idx] = tmp;
            renderExportClassList();
        };
        const downBtn = document.createElement('button');
        downBtn.className = 'btn btn-icon';
        downBtn.textContent = '↓';
        downBtn.disabled = idx === exportClasses.length - 1;
        downBtn.onclick = () => {
            if (idx === exportClasses.length - 1) return;
            const tmp = exportClasses[idx + 1];
            exportClasses[idx + 1] = exportClasses[idx];
            exportClasses[idx] = tmp;
            renderExportClassList();
        };
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-icon';
        removeBtn.textContent = '×';
        removeBtn.onclick = () => {
            exportClasses.splice(idx, 1);
            renderExportClassList();
        };
        li.appendChild(idxBadge);
        li.appendChild(nameSpan);
        li.appendChild(upBtn);
        li.appendChild(downBtn);
        li.appendChild(removeBtn);
        exportClassList.appendChild(li);
    });
}

function applyExportPrepareResult(message) {
    if (exportImageCountSpan) exportImageCountSpan.textContent = message.imageCount;
    if (exportAnnotationCountSpan) exportAnnotationCountSpan.textContent = message.annotationCount;
    // Merge detected classes into the working list — preserve user-edited order;
    // append any newly seen labels at the end. Existing entries unchanged.
    const present = new Set(exportClasses);
    for (const c of message.detectedClasses) {
        if (!present.has(c)) {
            exportClasses.push(c);
            present.add(c);
        }
    }
    renderExportClassList();
}

function showExportDatasetModal() {
    if (toolsMenuDropdown) toolsMenuDropdown.style.display = 'none';
    if (!exportDatasetModal) return;
    // Restore persisted settings
    // Restore the format. Legacy persisted values (yolo-bbox/yolo-seg) map to
    // the single merged "yolo" option.
    let savedFmt = initialGlobalSettings && initialGlobalSettings.exportFormat;
    if (savedFmt === 'yolo-bbox' || savedFmt === 'yolo-seg') savedFmt = 'yolo';
    if (savedFmt) {
        const fmtInput = document.querySelector(`input[name="exportFormat"][value="${savedFmt}"]`);
        if (fmtInput) fmtInput.checked = true;
    }
    if (initialGlobalSettings && initialGlobalSettings.exportScope) {
        const scopeInput = document.querySelector(`input[name="exportScope"][value="${initialGlobalSettings.exportScope}"]`);
        if (scopeInput) scopeInput.checked = true;
    }
    // Default the output directory to a folder inside the CURRENT dataset, so it
    // changes per dataset instead of stubbornly keeping the last-used path.
    if (exportOutputDirInput) {
        exportOutputDirInput.value = (initialGlobalSettings && initialGlobalSettings.defaultExportDir) || '';
    }
    // Seed the class list from the CURRENT dataset, not stale persisted classes.
    // YOLO uses the data.yaml names (order = class index); other modes start
    // empty and are filled by auto-detect (applyExportPrepareResult).
    exportClasses = (window.annotationFormat === 'yolo' && Array.isArray(window.yoloClasses))
        ? window.yoloClasses.slice()
        : [];
    // Restore the copy-images preference.
    const exportCopyChk = document.getElementById('exportCopyImages');
    if (exportCopyChk) exportCopyChk.checked = !!(initialGlobalSettings && initialGlobalSettings.exportCopyImages);
    renderExportClassList();
    exportDatasetModal.style.display = 'flex';
    // Request scope-aware prep
    // Forward the unsaved-shapes override so the class-detection preview sees
    // exactly what the run step will write — without it, new labels from a
    // dirty edit don't show up in the modal's class list.
    vscode.postMessage({
        command: 'exportDatasetPrepare',
        scope: getExportScope(),
        currentImage: buildExportCurrentImageOverride() || undefined
    });
}

function hideExportDatasetModal() {
    if (exportDatasetModal) exportDatasetModal.style.display = 'none';
}

// Build the unsaved-shapes override the host should substitute for the
// current image. Sent for both 'current' and 'all' scope: when the user is
// editing image #3 of 100 and runs export-all, we still want #3 to reflect
// the in-memory shapes, not the stale sidecar JSON. The host decides whether
// the current image is even in scope before applying the override.
function buildExportCurrentImageOverride() {
    if (!img || !(img.width > 0) || !(img.height > 0)) return null;
    return {
        shapes: shapes.map(shape => {
            const { visible, ...rest } = shape;
            if (!rest.description) delete rest.description;
            return rest;
        }),
        width: img.width,
        height: img.height
    };
}

function submitExportDataset() {
    const exportCopyChk = document.getElementById('exportCopyImages');
    const config = {
        format: getExportFormat(),
        scope: getExportScope(),
        outputDir: exportOutputDirInput ? exportOutputDirInput.value.trim() : '',
        classes: exportClasses.slice(),
        copyImages: exportCopyChk ? exportCopyChk.checked : false
    };
    const override = buildExportCurrentImageOverride();
    if (override) config.currentImage = override;
    vscode.postMessage({ command: 'exportDatasetRun', config });
}

if (exportDatasetMenuItem) {
    exportDatasetMenuItem.addEventListener('click', showExportDatasetModal);
}
if (exportOutputDirBrowse && exportOutputDirInput) {
    exportOutputDirBrowse.addEventListener('click', () => {
        vscode.postMessage({
            command: 'saveAsExportOutputDir',
            currentValue: exportOutputDirInput.value || undefined
        });
    });
}
if (exportAddClassBtn && exportAddClassInput) {
    const addClassFromInput = () => {
        const name = exportAddClassInput.value.trim();
        if (!name) return;
        if (exportClasses.includes(name)) {
            if (window.notifyBus) {
                const msg = (window.i18n && window.i18n.t)
                    ? window.i18n.t('status.exportClassDuplicate', { name })
                    : `Class "${name}" already in list`;
                window.notifyBus.show('warn', msg);
            }
            return;
        }
        exportClasses.push(name);
        exportAddClassInput.value = '';
        renderExportClassList();
    };
    exportAddClassBtn.addEventListener('click', addClassFromInput);
    exportAddClassInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addClassFromInput();
        }
    });
}
if (exportRunBtn) exportRunBtn.addEventListener('click', submitExportDataset);
if (exportCancelBtn) exportCancelBtn.addEventListener('click', hideExportDatasetModal);
// Re-request preparation when the scope flips between "all" and "current".
document.querySelectorAll('input[name="exportScope"]').forEach(radio => {
    radio.addEventListener('change', () => {
        // Forward the unsaved-shapes override so the class-detection preview
        // sees exactly what the run step will write — without it, new labels
        // from a dirty edit don't show up in the modal's class list.
        vscode.postMessage({
            command: 'exportDatasetPrepare',
            scope: getExportScope(),
            currentImage: buildExportCurrentImageOverride() || undefined
        });
    });
});
