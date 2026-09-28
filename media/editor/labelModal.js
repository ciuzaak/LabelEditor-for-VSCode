// LabelEditor webview — Label dialog and recent-label chips.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- Modal Logic ---

function showBatchRenameModal() {
    isBatchRenaming = true;
    editingShapeIndex = -1;
    labelModal.style.display = 'flex';
    // Pre-fill with the label of the first selected shape
    const firstIdx = [...selectedShapeIndices][0];
    labelInput.value = firstIdx !== undefined ? shapes[firstIdx].label : '';
    const descriptions = new Set([...selectedShapeIndices].map(i => shapes[i].description || ''));
    batchRenameInitialDescription = descriptions.size === 1 ? [...descriptions][0] : '';
    descriptionInput.value = batchRenameInitialDescription;
    labelInput.focus();
    labelInput.select();
    renderRecentLabels();
}

function showLabelModal(editIndex = -1) {
    editingShapeIndex = editIndex;
    labelModal.style.display = 'flex';

    if (editIndex !== -1) {
        labelInput.value = shapes[editIndex].label;
        descriptionInput.value = shapes[editIndex].description || '';
    } else {
        // New shape: default to the label selected in the Labels list
        labelInput.value = activeLabel || '';
        descriptionInput.value = '';
    }

    labelInput.focus();
    labelInput.select();
    renderRecentLabels();
}

function hideLabelModal() {
    labelModal.style.display = 'none';
    cancelShortcutSequence();
}

function renderRecentLabels() {
    recentLabelsDiv.innerHTML = '';

    // 收集当前图片中已有的label，按最近使用顺序排列
    // 通过遍历shapes倒序，第一个出现的label排最前
    const currentImageLabelsOrdered = [];
    for (let i = shapes.length - 1; i >= 0; i--) {
        const label = shapes[i].label;
        if (!currentImageLabelsOrdered.includes(label)) {
            currentImageLabelsOrdered.push(label);
        }
    }

    // 过滤历史标签，排除当前图片中已有的
    const historyLabelsFiltered = recentLabels.filter(label =>
        !currentImageLabelsOrdered.includes(label)
    ).slice(0, 10);

    // Shared 1-based counter across both sections so the Ctrl+D leader sequence
    // maps the next digit (1..9, then 0) to the first 10 chips in the order they
    // appear (Current Image first, then History).
    let chipIndex = 0;

    function buildChip(label, extraClass) {
        chipIndex += 1;
        const chip = document.createElement('div');
        chip.className = 'label-chip' + (extraClass ? ' ' + extraClass : '');
        chip.textContent = label;
        if (chipIndex <= 10) {
            // Visible badge: digits 1..9 then 0 for the 10th, matching the Ctrl+D leader's digit map.
            const badgeText = chipIndex === 10 ? '0' : String(chipIndex);
            chip.dataset.shortcutIndex = String(chipIndex);
            const badge = document.createElement('span');
            badge.className = 'chip-shortcut-badge';
            badge.textContent = badgeText;
            chip.appendChild(badge);
        }
        chip.onclick = () => {
            labelInput.value = label;
            // Highlight the selected chip (clear ALL sections to avoid cross-section dual highlight)
            recentLabelsDiv.querySelectorAll('.label-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            // Focus description field so user can optionally fill it before confirming
            descriptionInput.focus();
        };
        chip.ondblclick = () => {
            labelInput.value = label;
            confirmLabel();
        };
        return chip;
    }

    // 渲染当前图片标签区域（如果有的话）
    if (currentImageLabelsOrdered.length > 0) {
        const currentSection = document.createElement('div');
        currentSection.className = 'label-section current-labels';

        const currentTitle = document.createElement('div');
        currentTitle.className = 'label-section-title';
        currentTitle.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('imageInfo.current') : 'Current Image';
        currentSection.appendChild(currentTitle);

        const currentChips = document.createElement('div');
        currentChips.className = 'label-chips';
        currentImageLabelsOrdered.forEach(label => {
            currentChips.appendChild(buildChip(label, 'current-image-label'));
        });
        currentSection.appendChild(currentChips);
        recentLabelsDiv.appendChild(currentSection);
    }

    // 渲染历史标签区域（如果有的话）
    if (historyLabelsFiltered.length > 0) {
        const historySection = document.createElement('div');
        historySection.className = 'label-section history-labels';

        const historyTitle = document.createElement('div');
        historyTitle.className = 'label-section-title';
        historyTitle.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('imageInfo.history') : 'History';
        historySection.appendChild(historyTitle);

        const historyChips = document.createElement('div');
        historyChips.className = 'label-chips';
        historyLabelsFiltered.forEach(label => {
            historyChips.appendChild(buildChip(label, ''));
        });
        historySection.appendChild(historyChips);
        recentLabelsDiv.appendChild(historySection);
    }
}

function confirmLabel() {
    // YOLO: a label must be one of the data.yaml classes. If the typed label is
    // missing, ask the extension to confirm + add it; on success we re-enter
    // confirmLabel with the now-valid label (see the 'yoloClassAdded' handler).
    if (window.annotationFormat === 'yolo') {
        const typed = labelInput.value.trim();
        if (typed && !window.yoloClasses.includes(typed)) {
            vscode.postMessage({ command: 'yoloConfirmAddClass', label: typed });
            return; // keep the modal open; wait for the reply
        }
    }
    // Merge-pending mode: commit the merge using the chosen label.
    if (isMergePending) {
        if (commitMergePendingFromModal()) return;
        // commit returned false (empty label); fall through so user can re-enter.
        return;
    }

    const label = labelInput.value.trim();
    if (!label) return;

    // 更新历史标签列表（MRU顺序）
    const existingIndex = recentLabels.indexOf(label);
    if (existingIndex !== -1) {
        recentLabels.splice(existingIndex, 1);
    }
    recentLabels.unshift(label);
    if (recentLabels.length > 10) recentLabels.pop();

    // 持久化到全局状态（同时保存到vscodeState和extension globalState）
    saveGlobalSettings('recentLabels', recentLabels);

    // Remember this label as the active/default for subsequent new shapes
    activeLabel = label;

    const description = descriptionInput.value.trim();

    if (isBatchRenaming) {
        // Batch rename all selected shapes; descriptions only if edited.
        const descriptionEdited = description !== batchRenameInitialDescription.trim();
        for (const idx of selectedShapeIndices) {
            shapes[idx].label = label;
            if (!descriptionEdited) continue;
            if (description) {
                shapes[idx].description = description;
            } else {
                delete shapes[idx].description;
            }
        }
        isBatchRenaming = false;
    } else if (editingShapeIndex !== -1) {
        // Editing existing shape
        shapes[editingShapeIndex].label = label;
        if (description) {
            shapes[editingShapeIndex].description = description;
        } else {
            delete shapes[editingShapeIndex].description;
        }
        editingShapeIndex = -1;
    } else {
        // Creating new shape - determine shape_type based on current mode
        let shapeType = 'polygon';
        if (currentMode === 'point') {
            shapeType = 'point';
        } else if (currentMode === 'line') {
            shapeType = 'linestrip';
        } else if (currentMode === 'rectangle') {
            shapeType = 'rectangle';
        } else if (currentMode === 'circle') {
            shapeType = 'circle';
        } else if (currentMode === 'sam') {
            // SAM produces a polygon by default; rectangle when the user chose
            // that output shape AND currentPoints is the 2-point bbox form.
            shapeType = (samOutputFormat === 'rectangle' && currentPoints.length === 2) ? 'rectangle' : 'polygon';
        }

        const newShape = {
            label: label,
            points: currentPoints,
            group_id: null,
            shape_type: shapeType,
            flags: {},
            visible: true
        };
        if (description) {
            newShape.description = description;
        }
        shapes.push(newShape);
        currentPoints = [];
    }

    hideLabelModal();
    // Clear saved SAM state after successful confirm
    if (typeof samSavedStateBeforeConfirm !== 'undefined') samSavedStateBeforeConfirm = null;
    markDirty();
    saveHistory(); // 保存历史记录以支持撤销/恢复
    renderShapeList();
    renderLabelsList();
    draw();
}

// Pick the chip with shortcutIndex N, write its label to the input, and confirm.
// Returns true if a chip with that index existed.
function pickLabelByShortcut(index) {
    const chip = recentLabelsDiv.querySelector(`.label-chip[data-shortcut-index="${index}"]`);
    if (!chip) return false;
    // chip.textContent includes the badge digit because the badge is a child <span>.
    // Read the label text from the first text node instead of textContent.
    let labelText = '';
    for (const node of chip.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            labelText += node.textContent;
        }
    }
    labelText = labelText.trim();
    if (!labelText) return false;
    labelInput.value = labelText;
    confirmLabel();
    return true;
}

// Ctrl+D leader sequence for label modal: press Ctrl+D to reveal chip badges,
// then press 0-9 to pick that chip (0 means chip 10). Any other key cancels
// the sequence without being consumed.
let awaitingShortcutDigit = false;

function cancelShortcutSequence() {
    if (!awaitingShortcutDigit) return;
    awaitingShortcutDigit = false;
    recentLabelsDiv.classList.remove('show-shortcuts');
}

document.addEventListener('keydown', (e) => {
    if (labelModal.style.display !== 'flex') {
        // Modal closed — make sure we don't carry stale state.
        if (awaitingShortcutDigit) cancelShortcutSequence();
        return;
    }

    if (awaitingShortcutDigit) {
        const isPureKey = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
        if (isPureKey && /^[0-9]$/.test(e.key)) {
            e.preventDefault();
            const index = e.key === '0' ? 10 : Number(e.key);
            cancelShortcutSequence();
            pickLabelByShortcut(index);
            return;
        }
        // Any other key cancels the sequence and falls through (key not consumed).
        cancelShortcutSequence();
    }

    // Leader: Ctrl+D (case-insensitive). No other modifiers allowed.
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        awaitingShortcutDigit = true;
        recentLabelsDiv.classList.add('show-shortcuts');
    }
});

modalOkBtn.onclick = confirmLabel;

// 取消标签输入的通用处理函数
function cancelLabelInput() {
    hideLabelModal();

    // If a merge was waiting on a label, abort it without mutating shapes.
    if (isMergePending) {
        clearMergePendingState();
        draw();
        return;
    }

    // If batch renaming, just cancel
    if (isBatchRenaming) {
        isBatchRenaming = false;
        draw();
        return;
    }

    // 如果是编辑已有形状的标签，则只取消编辑
    if (editingShapeIndex !== -1) {
        editingShapeIndex = -1;
        draw();
        return;
    }

    // 点模式：取消应当清除点（因为点模式是单击即完成，取消意味着放弃这个点）
    if (currentMode === 'point') {
        currentPoints = [];
        isDrawing = false;
        draw();
        return;
    }

    // Circle mode: the label modal is opened after the second click, so cancel
    // wipes the in-progress circle (analogous to canceling a rectangle).
    if (currentMode === 'circle') {
        currentPoints = [];
        isDrawing = false;
        draw();
        return;
    }

    // 对于其他模式（polygon, line, rectangle），回到继续绘制状态（不删除任何点）
    // 因为完成标注的操作是"闭合多边形"或"确定矩形"，取消只是撤销这个完成操作
    if (currentMode === 'sam') {
        // SAM mode: restore prompts, mask, crop, sequence state, and embedding identity
        if (samSavedStateBeforeConfirm) {
            samPrompts = samSavedStateBeforeConfirm.prompts;
            samMaskContour = samSavedStateBeforeConfirm.maskContour;
            samCachedCrop = samSavedStateBeforeConfirm.cachedCrop;
            samCachedAdjustSig = samSavedStateBeforeConfirm.cachedAdjustSig ?? null;
            samIsFreshSequence = samSavedStateBeforeConfirm.isFreshSequence;
            samCurrentImagePath = samSavedStateBeforeConfirm.currentImagePath;
            samSavedStateBeforeConfirm = null;
        }
        currentPoints = [];
        draw();
        updateShiftFeedback();
        return;
    }

    if (currentPoints.length > 0) {
        isDrawing = true;
    }

    draw();
}

modalCancelBtn.onclick = cancelLabelInput;

// Wire all modal close (×) buttons — each routes to its modal's existing Cancel handler
document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-modal-close');
        const modal = document.getElementById(modalId);
        if (!modal) return;
        const cancelBtn = modal.querySelector('[id$="CancelBtn"]');
        if (cancelBtn) {
            cancelBtn.click();
        } else {
            modal.style.display = 'none';
        }
    });
});

// 在labelInput上监听Enter键
labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isImeEnter(e)) {
        e.preventDefault();
        e.stopPropagation();
        confirmLabel();
    }
});

// 在document级别监听ESC/Enter键，当任意modal显示时响应
// Enter不拦截焦点在BUTTON/TEXTAREA上的情况（让浏览器正常激活按钮/换行）
document.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement?.tagName;
    // Label modal
    if (labelModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelLabelInput();
        } else if (e.key === 'Enter' && !isImeEnter(e) && activeTag !== 'TEXTAREA' && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            confirmLabel();
        }
        return;
    }
    // Color picker modal
    if (colorPickerModal && colorPickerModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideColorPicker();
        } else if (e.key === 'Enter' && !isImeEnter(e) && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            confirmColorPicker();
        }
        return;
    }
    // ONNX infer modal
    if (onnxInferModal && onnxInferModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideOnnxInferModal();
        } else if (e.key === 'Enter' && !isImeEnter(e) && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            submitOnnxInfer();
        }
        return;
    }
    // SAM config modal
    if (samConfigModal && samConfigModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideSamConfigModal();
        } else if (e.key === 'Enter' && !isImeEnter(e) && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            submitSamConfig();
        }
        return;
    }
    // Export dataset modal — Enter submits, Escape cancels. Only the
    // add-class input swallows Enter (so the user can keep typing class
    // names); other inputs like the output-dir path still submit on Enter.
    if (exportDatasetModal && exportDatasetModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideExportDatasetModal();
        } else if (e.key === 'Enter'
                   && !isImeEnter(e)
                   && activeTag !== 'BUTTON'
                   && document.activeElement !== exportAddClassInput) {
            e.preventDefault();
            e.stopPropagation();
            submitExportDataset();
        }
        return;
    }
    // Export SVG modal — Enter exports, Escape cancels (same as Export Dataset).
    if (exportSvgModal && exportSvgModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideExportSvgModal();
        } else if (e.key === 'Enter' && activeTag !== 'BUTTON') {
            e.preventDefault();
            e.stopPropagation();
            submitExportSvg();
        }
        return;
    }
    // Advanced search modal — Escape closes. (An open class combobox consumes
    // Escape on its input first; Enter is left to the form's own controls.)
    if (advancedSearchModal && advancedSearchModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideAdvancedSearchModal();
        }
        return;
    }
    // More settings modal — Escape closes. hideMoreSettingsModal also tears
    // down any in-progress keybinding capture, so this path doesn't leave a
    // stuck capture listener attached.
    if (moreSettingsModal && moreSettingsModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            hideMoreSettingsModal();
        }
        return;
    }
});
