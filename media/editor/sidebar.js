// LabelEditor webview — Instances and Labels lists, label management, session state.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- Sidebar Logic ---
// --- Keyboard access for the Instances / Labels lists ---
// A roving tabindex keeps each list a single Tab stop (a Tab stop per row is
// unusable with hundreds of shapes). Arrow keys / Home / End move between
// rows and Enter / Space activate the focused row like a click. Row actions
// have keyboard equivalents on the selection (Delete, Ctrl+R, Ctrl+H), so the
// small per-row icons are not separate Tab stops.

// Swap a list's rows for `fragment`, keeping keyboard focus on the same row
// position when the list had focus (activating a row re-renders the list).
// Otherwise the tabbable row is `preferredIndex`, or the previous one.
function replaceRovingRows(listEl, fragment, preferredIndex) {
    const oldRows = [...listEl.children];
    const focusedIndex = oldRows.indexOf(document.activeElement);
    const previousTabIndex = oldRows.findIndex(r => r.tabIndex === 0);
    listEl.innerHTML = '';
    listEl.appendChild(fragment);
    const rows = [...listEl.children];
    if (rows.length === 0) return;
    let index = focusedIndex !== -1 ? focusedIndex
        : (preferredIndex >= 0 ? preferredIndex : previousTabIndex);
    index = Math.min(Math.max(index, 0), rows.length - 1);
    rows.forEach((row, i) => { row.tabIndex = i === index ? 0 : -1; });
    if (focusedIndex !== -1) rows[index].focus();
}

function enableRovingRows(listEl) {
    if (!listEl) return;
    listEl.addEventListener('keydown', (e) => {
        const rows = [...listEl.children];
        const i = rows.indexOf(document.activeElement);
        if (i === -1) return;
        let next;
        switch (e.key) {
            case 'ArrowDown': next = Math.min(rows.length - 1, i + 1); break;
            case 'ArrowUp':   next = Math.max(0, i - 1); break;
            case 'Home':      next = 0; break;
            case 'End':       next = rows.length - 1; break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                rows[i].click();
                return;
            default:
                return;
        }
        e.preventDefault();
        rows.forEach((row, k) => { row.tabIndex = k === next ? 0 : -1; });
        rows[next].focus();
        rows[next].scrollIntoView({ block: 'nearest' });
    });
}
enableRovingRows(shapeList);
enableRovingRows(labelsList);

function renderShapeList() {
    // 使用 DocumentFragment 批量添加 DOM，减少重排
    const fragment = document.createDocumentFragment();
    const multiSelected = selectedShapeIndices.size > 1;

    shapes.forEach((shape, index) => {
        const li = document.createElement('li');

        // Label text
        const labelSpan = document.createElement('span');
        labelSpan.className = 'shape-label-text';
        labelSpan.textContent = shape.label;
        li.appendChild(labelSpan);

        // Description subtitle (if present)
        if (shape.description) {
            const descSpan = document.createElement('span');
            descSpan.className = 'shape-description';
            descSpan.textContent = shape.description;
            // Runtime data — use data-tip-text so the rich tooltip can show
            // the full description on hover when the row truncates.
            descSpan.setAttribute('data-tip-text', shape.description);
            li.appendChild(descSpan);
        }

        const colors = getColorsForLabel(shape.label);
        li.style.borderLeftColor = colors.stroke;

        if (isShapeSelected(index)) {
            li.classList.add('active');
        }

        li.onclick = (e) => {
            if (e.ctrlKey || e.metaKey) {
                // Ctrl+click: toggle selection
                toggleShapeSelection(index);
            } else if (e.shiftKey && selectedShapeIndex !== -1) {
                // Shift+click: range select
                selectShapeRange(selectedShapeIndex, index);
            } else {
                selectShape(index);
            }
            renderShapeList();
            draw();
        };

        const visibleBtn = document.createElement('span');
        visibleBtn.className = 'visible-btn';
        visibleBtn.innerHTML = shape.visible === false ? '&#128065;' : '&#128065;'; // Eye icon
        visibleBtn.setAttribute('data-tip-id', 'shape.toggleVisible');
        visibleBtn.setAttribute('role', 'button');
        if (shape.visible === false) {
            visibleBtn.classList.add('hidden-shape');
            visibleBtn.style.opacity = '0.5';
        }
        visibleBtn.onclick = (e) => {
            e.stopPropagation();
            hideShapeContextMenu();
            // If this shape is part of multi-selection, set all to same state
            if (multiSelected && isShapeSelected(index)) {
                const anyVisible = [...selectedShapeIndices].some(idx => shapes[idx].visible !== false);
                const newState = !anyVisible;
                for (const idx of selectedShapeIndices) {
                    shapes[idx].visible = newState;
                }
            } else {
                shape.visible = shape.visible === undefined ? false : !shape.visible;
            }
            renderShapeList();
            renderLabelsList();
            draw();
        };

        const editBtn = document.createElement('span');
        editBtn.className = 'edit-btn';
        editBtn.innerHTML = '&#9998;'; // Pencil icon
        editBtn.setAttribute('data-tip-id', 'shape.rename'); // opens the label/description dialog
        editBtn.setAttribute('role', 'button');
        editBtn.onclick = (e) => {
            e.stopPropagation();
            hideShapeContextMenu();
            // If multi-selected, batch rename
            if (multiSelected && isShapeSelected(index)) {
                showBatchRenameModal();
            } else {
                showLabelModal(index);
            }
        };

        const delBtn = document.createElement('span');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '×';
        delBtn.setAttribute('data-tip-id', 'shape.delete');
        delBtn.setAttribute('role', 'button');
        delBtn.onclick = (e) => {
            e.stopPropagation();
            hideShapeContextMenu();
            // If multi-selected, batch delete
            if (multiSelected && isShapeSelected(index)) {
                deleteSelectedShapes();
            } else {
                deleteShape(index);
            }
        };

        li.appendChild(visibleBtn);
        li.appendChild(editBtn);
        li.appendChild(delBtn);
        fragment.appendChild(li);
    });

    // Cancel any pending hover timer before detaching the rows it captured —
    // otherwise show() would later run getBoundingClientRect on a detached node
    // and place the tooltip at viewport (0, 0).
    if (window.tooltip) window.tooltip.hide();

    // 一次性更新 DOM
    replaceRovingRows(shapeList, fragment, selectedShapeIndex);

    // Bind rich tooltips to the freshly-rendered per-row controls. attach()
    // is idempotent (skips already-bound nodes via WeakSet).
    if (window.tooltip && window.TIPS) window.tooltip.attach(shapeList, window.TIPS);

    // 更新 Instances 计数
    const instancesCountEl = document.getElementById('instancesCount');
    if (instancesCountEl) {
        const selCount = selectedShapeIndices.size;
        instancesCountEl.textContent = selCount > 1 ? `(${selCount}/${shapes.length})` : `(${shapes.length})`;
    }

    // 滚动选中项到可视区域
    scrollSelectedShapeIntoView();

    // Keep the Labels highlight consistent with whatever is now selected.
    syncLabelsActiveState();
}

// 滚动选中的形状到可视区域
function scrollSelectedShapeIntoView() {
    if (selectedShapeIndex === -1 || !shapeList) return;

    const selectedItem = shapeList.children[selectedShapeIndex];
    if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
    }
}

function deleteShape(index) {
    // Check if we are deleting the shape currently being edited
    if (isEditingShape) {
        if (shapeBeingEdited === index) {
            exitShapeEditMode(false); // Exit edit mode (points restoration doesn't matter as it will be deleted)
        } else if (shapeBeingEdited > index) {
            shapeBeingEdited--; // Shift index if a preceding shape is deleted
        }
    }

    shapes.splice(index, 1);
    adjustSelectionAfterDelete(index);
    // Hover index and any overlap-cycle stack/badge are stale once a shape is
    // spliced. deleteSelectedShapes gets this via clearSelection(); deleteShape
    // keeps the selection, so reset them explicitly here.
    hoveredShapeIndex = -1;
    overlapCycleState = { members: [], pos: -1 };
    hideCycleBadge();
    markDirty();
    saveHistory(); // 保存历史记录以支持撤销/恢复
    renderShapeList();
    renderLabelsList(); // 更新Labels列表
    draw();
}

// --- Labels Management ---

// 获取所有唯一标签及其统计信息
function getLabelsStats() {
    const stats = new Map();
    shapes.forEach(shape => {
        const label = shape.label;
        if (!stats.has(label)) {
            stats.set(label, { count: 0, allHidden: true });
        }
        const stat = stats.get(label);
        stat.count++;
        if (shape.visible !== false) {
            stat.allHidden = false;
        }
    });
    return stats;
}

// 渲染Labels列表
function renderLabelsList() {
    if (!labelsList) return;

    const labelsStats = getLabelsStats();
    const fragment = document.createDocumentFragment();

    // 按标签名称排序
    const sortedLabels = Array.from(labelsStats.keys()).sort();

    sortedLabels.forEach(label => {
        const stat = labelsStats.get(label);
        const li = document.createElement('li');
        li.dataset.label = label; // lets syncLabelsActiveState() map rows back to labels

        // Clicking the row selects every shape with this label. Ctrl/Cmd-click
        // unions/toggles the group into the current selection. The per-row
        // controls below stop propagation, so they keep their own behavior.
        li.onclick = (e) => {
            selectShapesByLabel(label, e.ctrlKey || e.metaKey);
            renderShapeList();
            renderLabelsList();
            draw();
        };

        // 颜色指示器
        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'label-color-indicator';
        const colors = getColorsForLabel(label);
        colorIndicator.style.backgroundColor = colors.stroke;
        colorIndicator.setAttribute('data-tip-id', 'label.color');
        colorIndicator.setAttribute('role', 'button');
        colorIndicator.onclick = (e) => {
            e.stopPropagation();
            showColorPicker(label);
        };

        // 标签名称
        const labelName = document.createElement('span');
        labelName.className = 'label-name';
        labelName.textContent = label;
        labelName.setAttribute('data-tip-id', 'label.selectInstances');

        // 实例数量
        const labelCount = document.createElement('span');
        labelCount.className = 'label-count';
        labelCount.textContent = `(${stat.count})`;

        // 可见性切换按钮
        const visibilityBtn = document.createElement('span');
        visibilityBtn.className = 'label-visibility-btn';
        visibilityBtn.innerHTML = '&#128065;'; // Eye icon
        visibilityBtn.setAttribute('data-tip-id', 'label.toggleVisible');
        visibilityBtn.setAttribute('role', 'button');
        if (stat.allHidden) {
            visibilityBtn.classList.add('all-hidden');
        }
        visibilityBtn.onclick = (e) => {
            e.stopPropagation();
            toggleLabelVisibility(label);
        };

        // Reset按钮（只在有自定义颜色时显示）
        const resetBtn = document.createElement('span');
        resetBtn.className = 'label-reset-btn';
        resetBtn.innerHTML = '&#8634;'; // Circular arrow icon
        resetBtn.setAttribute('data-tip-id', 'label.colorReset');
        resetBtn.setAttribute('role', 'button');
        if (customColors.has(label)) {
            resetBtn.classList.add('visible');
        }
        resetBtn.onclick = (e) => {
            e.stopPropagation();
            resetLabelColor(label);
        };

        li.appendChild(colorIndicator);
        li.appendChild(labelName);
        li.appendChild(labelCount);
        li.appendChild(visibilityBtn);
        li.appendChild(resetBtn);
        fragment.appendChild(li);
    });

    // Cancel pending hover timer (see renderShapeList for rationale).
    if (window.tooltip) window.tooltip.hide();

    replaceRovingRows(labelsList, fragment, -1);

    // Bind rich tooltips to the freshly-rendered per-row controls.
    if (window.tooltip && window.TIPS) window.tooltip.attach(labelsList, window.TIPS);

    // 更新 Labels 计数
    const labelsCountEl = document.getElementById('labelsCount');
    if (labelsCountEl) {
        labelsCountEl.textContent = `(${sortedLabels.length})`;
    }

    syncLabelsActiveState();
}

// Toggle the .active highlight on each Labels row. A label is active when every
// one of its instances is currently selected — so clicking a label (which selects
// exactly those) lights it up, and selecting/clearing instances any other way
// keeps it in sync. Kept separate from renderLabelsList so a selection change can
// refresh the highlight (via renderShapeList) without rebuilding the whole list.
function syncLabelsActiveState() {
    if (!labelsList) return;
    const selectedByLabel = new Map();
    selectedShapeIndices.forEach(i => {
        const s = shapes[i];
        if (s) selectedByLabel.set(s.label, (selectedByLabel.get(s.label) || 0) + 1);
    });
    const stats = getLabelsStats();
    for (const li of labelsList.children) {
        const label = li.dataset ? li.dataset.label : undefined;
        if (label === undefined) continue;
        const stat = stats.get(label);
        const active = !!stat && stat.count > 0 && selectedByLabel.get(label) === stat.count;
        li.classList.toggle('active', active);
    }
}

// 切换指定标签的所有实例的可见性
function toggleLabelVisibility(label) {
    const labelsStats = getLabelsStats();
    const stat = labelsStats.get(label);

    // 如果全部隐藏，则显示；否则隐藏
    const newVisibility = stat.allHidden;

    shapes.forEach(shape => {
        if (shape.label === label) {
            shape.visible = newVisibility;
        }
    });

    // 保存到全局状态
    labelVisibilityState.set(label, newVisibility);

    // 保存到vscode state
    saveState();

    renderLabelsList();
    renderShapeList();
    draw();
}

// 显示颜色选择器
function showColorPicker(label) {
    currentEditingLabel = label;

    // 渲染调色板
    const palette = colorPickerModal.querySelector('.color-palette');
    palette.innerHTML = '';

    // 使用 DocumentFragment 批量添加 DOM
    const fragment = document.createDocumentFragment();
    PRESET_COLORS.forEach(color => {
        const colorOption = document.createElement('div');
        colorOption.className = 'color-option';
        colorOption.style.backgroundColor = color;
        colorOption.dataset.color = color;
        fragment.appendChild(colorOption);
    });
    palette.appendChild(fragment);

    // 移除旧的事件处理器（如果存在）。两个 handler 都要清理，
    // 否则每次打开 color picker 都会累积一个匿名 dblclick 监听器。
    if (paletteClickHandler) {
        palette.removeEventListener('click', paletteClickHandler);
    }
    if (paletteDblClickHandler) {
        palette.removeEventListener('dblclick', paletteDblClickHandler);
    }

    // 使用事件委托处理颜色选择（单击选中，双击确认）
    paletteClickHandler = (e) => {
        const target = e.target;
        if (target.classList.contains('color-option')) {
            palette.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            target.classList.add('selected');
            customColorInput.value = target.dataset.color;
        }
    };
    paletteDblClickHandler = (e) => {
        const target = e.target;
        if (target.classList.contains('color-option')) {
            customColorInput.value = target.dataset.color;
            confirmColorPicker();
        }
    };
    palette.addEventListener('click', paletteClickHandler);
    palette.addEventListener('dblclick', paletteDblClickHandler);

    // 设置当前颜色 - 转换为#XXXXXX格式
    const currentColors = getColorsForLabel(label);
    // 如果有自定义颜色，直接使用；否则从rgba转换为hex
    if (customColors.has(label)) {
        customColorInput.value = customColors.get(label);
    } else {
        // 将rgba格式转换为#XXXXXX格式
        const rgbaMatch = currentColors.stroke.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbaMatch) {
            const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, '0');
            const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, '0');
            const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, '0');
            customColorInput.value = `#${r}${g}${b}`.toUpperCase();
        } else {
            customColorInput.value = '#000000';
        }
    }

    // 显示模态框
    colorPickerModal.style.display = 'flex';
    customColorInput.focus();
}

// 隐藏颜色选择器
function hideColorPicker() {
    colorPickerModal.style.display = 'none';
    currentEditingLabel = null;
}

function saveGlobalSettings(key, value) {
    // Save to vscodeState immediately (synchronous, survives HTML regeneration)
    const state = vscode.getState() || {};
    state[key] = value;
    vscode.setState(state);

    // Also send to extension for persistent storage across sessions
    vscode.postMessage({
        command: 'saveGlobalSettings',
        key: key,
        value: value
    });
}

// Unified state saving (keep for session-specific state like mode/visibility)
function saveState() {
    const state = vscode.getState() || {};
    state.labelVisibility = Object.fromEntries(labelVisibilityState);
    state.currentMode = currentMode;
    vscode.setState(state);
}

// 确认颜色选择
function confirmColorPicker() {
    if (!currentEditingLabel) return;

    let color = customColorInput.value.trim();

    // 验证颜色格式 - 只接受#XXXXXX格式
    if (!color.startsWith('#') || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        if (window.notifyBus) {
            const msg = (window.i18n && window.i18n.t)
                ? window.i18n.t('status.invalidColor')
                : 'Invalid color format. Please use #RRGGBB format (e.g., #FF5733).';
            window.notifyBus.show('error', msg);
        }
        return;
    }

    // 保存自定义颜色
    customColors.set(currentEditingLabel, color.toUpperCase());

    // Save to global settings
    saveGlobalSettings('customColors', Object.fromEntries(customColors));

    // 清除颜色缓存以强制重新计算
    colorCache.delete(currentEditingLabel);

    hideColorPicker();
    renderLabelsList();
    renderShapeList();
    draw();
}

// 重置单个标签的颜色
function resetLabelColor(label) {
    customColors.delete(label);

    // Save to global settings
    saveGlobalSettings('customColors', Object.fromEntries(customColors));

    colorCache.delete(label);
    renderLabelsList();
    renderShapeList();
    draw();
}

// --- Sidebar Dropdown Toggle ---

// Generic toggle for sidebar dropdowns — opening one closes the other
function toggleSidebarDropdown(dropdown, otherDropdown, btn) {
    if (!dropdown) return;
    const isVisible = dropdown.style.display !== 'none';
    const newState = isVisible ? 'none' : 'block';
    dropdown.style.display = newState;

    // Close the other dropdown
    if (otherDropdown && newState === 'block') {
        otherDropdown.style.display = 'none';
    }

    // The menu spans the full toolbar width (so its width tracks the sidebar as it
    // is resized); point the arrow at whichever button opened it.
    if (newState === 'block' && btn) positionSidebarDropdownArrow(dropdown, btn);

    // Save state to vscodeState
    const state = vscode.getState() || {};
    state.settingsMenuExpanded = settingsMenuDropdown ? settingsMenuDropdown.style.display !== 'none' : false;
    vscode.setState(state);
}

// Point a sidebar dropdown's arrow (::before) at the center of the button that
// opened it, clamped to stay within the menu's rounded corners.
function positionSidebarDropdownArrow(dropdown, btn) {
    const dropRect = dropdown.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const ARROW = 10; // px — matches .sidebar-dropdown::before width
    let x = btnRect.left + btnRect.width / 2 - dropRect.left - ARROW / 2;
    x = Math.max(8, Math.min(dropRect.width - ARROW - 8, x));
    dropdown.style.setProperty('--arrow-x', x + 'px');
}
