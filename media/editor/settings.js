// LabelEditor webview — Settings panel, keyboard shortcut editor, image adjustments, toolbar buttons.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// --- Labels Management Event Listeners ---

// Color picker OK button
if (colorOkBtn) {
    colorOkBtn.onclick = confirmColorPicker;
}

// Color picker Cancel button
if (colorCancelBtn) {
    colorCancelBtn.onclick = hideColorPicker;
}

// Color picker input - Enter to confirm
if (customColorInput) {
    customColorInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmColorPicker();
        if (e.key === 'Escape') hideColorPicker();
    });
}

// --- Settings/Tools Dropdown Event Listeners ---

// Settings button
if (settingsMenuBtn) {
    settingsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebarDropdown(settingsMenuDropdown, toolsMenuDropdown, settingsMenuBtn);
    });
}

// Tools button
if (toolsMenuBtn) {
    toolsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebarDropdown(toolsMenuDropdown, settingsMenuDropdown, toolsMenuBtn);
    });
}

// --- More Settings modal (Language + Keyboard Shortcuts) ---
const moreSettingsMenuItem = document.getElementById('moreSettingsMenuItem');
const moreSettingsModal = document.getElementById('moreSettingsModal');
const moreSettingsCloseBtn = document.getElementById('moreSettingsCancelBtn');

function showMoreSettingsModal() {
    if (settingsMenuDropdown) settingsMenuDropdown.style.display = 'none';
    if (!moreSettingsModal) return;
    updateDrawClickThroughToggleUI();
    updateCrosshairToggleUI();
    updateShowShapeLabelsToggleUI();
    moreSettingsModal.style.display = 'flex';
}

function hideMoreSettingsModal() {
    // If the user closes the modal while a capture row is still listening,
    // tear it down — otherwise the document-level keydown handler stays
    // attached and silently swallows every subsequent shortcut.
    if (typeof keybindingsCapture !== 'undefined' && keybindingsCapture) {
        finishKeybindingsCapture(false);
    }
    if (moreSettingsModal) moreSettingsModal.style.display = 'none';
}

if (moreSettingsMenuItem) {
    moreSettingsMenuItem.addEventListener('click', showMoreSettingsModal);
}
if (moreSettingsCloseBtn) {
    moreSettingsCloseBtn.addEventListener('click', hideMoreSettingsModal);
}

// --- Keyboard Shortcuts settings UI ---
const keybindingsList = document.getElementById('keybindingsList');
const keybindingsResetAllBtn = document.getElementById('keybindingsResetAllBtn');

function persistKeyboardBindings() {
    // Strip rows that match the default so the saved object stays small and
    // future default tweaks naturally propagate. Explicit `null` entries
    // (disabled rows from Override) are kept verbatim — they are how we
    // remember that the user intentionally cleared a default binding.
    const diff = {};
    if (window.keybindings) {
        for (const id in currentBindings) {
            const cur = currentBindings[id];
            if (cur === null) { diff[id] = null; continue; }
            if (!window.keybindings.bindingsEqual(cur, window.keybindings.DEFAULTS[id])) {
                diff[id] = cur;
            }
        }
    }
    vscode.postMessage({ command: 'saveGlobalSettings', key: 'keyboardBindings', value: diff });
}

function actionDisplayName(id) {
    // i18n key wins when the localized dictionary defines one; otherwise fall
    // back to the English label baked into keybindings.js.
    if (window.i18n && window.i18n.t) {
        const t = window.i18n.t('kb.action.' + id);
        if (t && t !== 'kb.action.' + id) return t;
    }
    return (window.keybindings && window.keybindings.ACTION_NAMES[id]) || id;
}

function renderKeybindingsList() {
    if (!keybindingsList || !window.keybindings) return;
    keybindingsList.innerHTML = '';
    for (const id in window.keybindings.DEFAULTS) {
        const row = document.createElement('div');
        row.className = 'kb-row';
        row.dataset.action = id;
        const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
        const name = document.createElement('span');
        name.className = 'kb-name';
        name.textContent = actionDisplayName(id);
        const current = document.createElement('span');
        current.className = 'kb-current';
        current.textContent = window.keybindings.display(currentBindings[id]) || tt('kb.none');
        const captureBtn = document.createElement('button');
        captureBtn.className = 'btn btn-icon kb-capture';
        captureBtn.textContent = '✎';
        captureBtn.title = tt('kb.captureNewBinding');
        // Name the action too: every row has the same two icon buttons.
        captureBtn.setAttribute('aria-label', `${tt('kb.captureNewBinding')}: ${name.textContent}`);
        captureBtn.onclick = () => startKeybindingsCapture(id, row);
        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn btn-icon kb-reset';
        resetBtn.textContent = '↺';
        resetBtn.title = tt('kb.resetToDefault');
        resetBtn.setAttribute('aria-label', `${tt('kb.resetToDefault')}: ${name.textContent}`);
        resetBtn.onclick = () => resetKeybinding(id);
        const error = document.createElement('div');
        error.className = 'kb-error';
        error.style.display = 'none';
        row.appendChild(name);
        row.appendChild(current);
        row.appendChild(captureBtn);
        row.appendChild(resetBtn);
        row.appendChild(error);
        keybindingsList.appendChild(row);
    }
}

function startKeybindingsCapture(actionId, rowEl) {
    if (keybindingsCapture) finishKeybindingsCapture(false);
    keybindingsCapture = { actionId, rowEl };
    rowEl.classList.add('kb-capturing');
    const current = rowEl.querySelector('.kb-current');
    if (current) current.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('kb.pressKey') : 'Press a key...';
    const error = rowEl.querySelector('.kb-error');
    if (error) error.style.display = 'none';
    document.addEventListener('keydown', captureKeyHandler, true);
}

function finishKeybindingsCapture(applied) {
    if (!keybindingsCapture) return;
    document.removeEventListener('keydown', captureKeyHandler, true);
    const { rowEl, actionId } = keybindingsCapture;
    keybindingsCapture = null;
    rowEl.classList.remove('kb-capturing');
    const current = rowEl.querySelector('.kb-current');
    if (current) {
        const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
        current.textContent = window.keybindings.display(currentBindings[actionId]) || tt('kb.none');
    }
}

function captureKeyHandler(e) {
    // Always swallow the event while capturing so it neither triggers actions
    // nor reaches focused inputs.
    e.preventDefault();
    e.stopPropagation();

    if (!keybindingsCapture || !window.keybindings) return;

    // ESC cancels capture without binding.
    if (e.key === 'Escape') {
        finishKeybindingsCapture(false);
        return;
    }

    // Modifier-only presses are not bindable.
    if (window.keybindings.isModifierOnly(e)) return;

    const binding = window.keybindings.eventToBinding(e);
    if (!binding) return;

    const { actionId, rowEl } = keybindingsCapture;
    const conflict = window.keybindings.findConflict(actionId, binding, currentBindings);
    if (conflict) {
        const errorEl = rowEl.querySelector('.kb-error');
        if (errorEl) {
            errorEl.style.display = 'block';
            const otherName = actionDisplayName(conflict);
            errorEl.innerHTML = '';
            const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k, p) => k;
            const msg = document.createElement('span');
            msg.textContent = tt('kb.conflictsWith', { name: otherName });
            const overrideBtn = document.createElement('button');
            overrideBtn.className = 'btn';
            overrideBtn.textContent = tt('kb.override');
            overrideBtn.onclick = () => {
                // Mark the conflicting row as disabled (null) instead of
                // deleting it. persistKeyboardBindings stores the null so the
                // override survives reload — otherwise mergeWithDefaults would
                // restore the conflicting default and bring the clash back.
                currentBindings[conflict] = null;
                currentBindings[actionId] = binding;
                persistKeyboardBindings();
                // Tear down the capture listener so subsequent keys reach the
                // dispatcher again — without this, the user can't even click
                // away cleanly because their next keypress would be swallowed.
                finishKeybindingsCapture(true);
                renderKeybindingsList();
                if (window.tooltip && window.tooltip.hide) window.tooltip.hide();
            };
            errorEl.appendChild(msg);
            errorEl.appendChild(overrideBtn);
        }
        // Stay in capture mode so the user can pick a different combo.
        return;
    }

    currentBindings[actionId] = binding;
    persistKeyboardBindings();
    finishKeybindingsCapture(true);
    renderKeybindingsList();
}

function resetKeybinding(actionId) {
    if (!window.keybindings) return;
    currentBindings[actionId] = { ...window.keybindings.DEFAULTS[actionId] };
    persistKeyboardBindings();
    renderKeybindingsList();
}

if (keybindingsResetAllBtn) {
    keybindingsResetAllBtn.addEventListener('click', () => {
        if (!window.keybindings) return;
        currentBindings = window.keybindings.mergeWithDefaults(null);
        window.currentBindings = currentBindings;
        persistKeyboardBindings();
        renderKeybindingsList();
    });
}

renderKeybindingsList();

// --- Language picker ---
const languageSelect = document.getElementById('languageSelect');
if (languageSelect && window.i18n) {
    languageSelect.value = window.i18n.getLocale();
    languageSelect.addEventListener('change', (e) => {
        try {
            window.i18n.setLocale(e.target.value);
        } catch (_) {
            // Unknown locale — ignore, the select reverts on next render.
            return;
        }
        applyI18n();
        // Re-render UI sections whose text we render dynamically. Tooltips
        // re-resolve on next hover automatically. Image-info popup and the
        // currently-rendered canvas overlay (SAM "Encoding…" hint) repaint on
        // their next event; force a draw so the canvas text doesn't lag the
        // language switch when the popup happens to be open.
        renderShapeList();
        renderLabelsList();
        renderKeybindingsList();
        updateImageInfoPopup();
        updateClaheToggleUI();
        updateDrawClickThroughToggleUI();
        updateCrosshairToggleUI();
        updateShowShapeLabelsToggleUI();
        draw();
        vscode.postMessage({ command: 'saveGlobalSettings', key: 'locale', value: e.target.value });
    });
}

// Apply translations on boot once every static label has been parsed.
applyI18n();

// Border Width slider
if (borderWidthSlider) {
    borderWidthSlider.oninput = (e) => {
        borderWidth = parseFloat(e.target.value);
        borderWidthValue.textContent = borderWidth;
        updateBorderWidthResetBtn();
        draw();
    };
    borderWidthSlider.onchange = (e) => saveGlobalSettings('borderWidth', borderWidth);
}

// Fill Opacity slider
if (fillOpacitySlider) {
    fillOpacitySlider.oninput = (e) => {
        fillOpacity = parseInt(e.target.value) / 100;
        fillOpacityValue.textContent = Math.round(fillOpacity * 100);
        updateFillOpacityResetBtn();
        invalidateColorCache();
        draw();
    };
    fillOpacitySlider.onchange = (e) => saveGlobalSettings('fillOpacity', fillOpacity);
}

// Border Width reset button
if (borderWidthResetBtn) {
    borderWidthResetBtn.onclick = () => {
        borderWidth = 2;
        if (borderWidthSlider) borderWidthSlider.value = borderWidth;
        if (borderWidthValue) borderWidthValue.textContent = borderWidth;
        updateBorderWidthResetBtn();
        saveGlobalSettings('borderWidth', borderWidth);
        draw();
    };
}

// Fill Opacity reset button
if (fillOpacityResetBtn) {
    fillOpacityResetBtn.onclick = () => {
        fillOpacity = 0.3;
        if (fillOpacitySlider) fillOpacitySlider.value = fillOpacity * 100;
        if (fillOpacityValue) fillOpacityValue.textContent = Math.round(fillOpacity * 100);
        updateFillOpacityResetBtn();
        invalidateColorCache();
        saveGlobalSettings('fillOpacity', fillOpacity);
        draw();
    };
}

// Update reset button visibility
function updateBorderWidthResetBtn() {
    if (borderWidthResetBtn) {
        if (borderWidth !== 2) {
            borderWidthResetBtn.classList.add('visible');
        } else {
            borderWidthResetBtn.classList.remove('visible');
        }
    }
}

function updateFillOpacityResetBtn() {
    if (fillOpacityResetBtn) {
        if (Math.abs(fillOpacity - 0.3) > 0.001) {
            fillOpacityResetBtn.classList.add('visible');
        } else {
            fillOpacityResetBtn.classList.remove('visible');
        }
    }
}

// --- Image Adjust (Brightness / Contrast) ---
function applyImageAdjust() {
    const filterValue = (brightness === 100 && contrast === 100)
        ? ''
        : `brightness(${brightness / 100}) contrast(${contrast / 100})`;
    canvas.style.filter = filterValue;
}

// Render channel-selected and/or CLAHE-processed image into the cached offscreen canvas.
// Returns the cached canvas, or null if the source image is not ready.
// CLAHE runs in YCbCr space on the Y plane only, so colors are preserved.
function getProcessedCanvas() {
    if (!img.src || !img.complete || !img.width || !img.height) return null;

    const w = img.width;
    const h = img.height;
    const key = img.src + '|' + selectedChannel + '|' + claheEnabled + '|' + claheClipLimit + '|' + w + 'x' + h;
    if (processedCanvas && key === processedKey) return processedCanvas;

    if (!processedCanvas) {
        processedCanvas = document.createElement('canvas');
    }
    if (processedCanvas.width !== w || processedCanvas.height !== h) {
        processedCanvas.width = w;
        processedCanvas.height = h;
    }
    const pCtx = processedCanvas.getContext('2d');
    pCtx.drawImage(img, 0, 0, w, h);
    const imageData = pCtx.getImageData(0, 0, w, h);
    const data = imageData.data;

    if (selectedChannel !== 'rgb') {
        const offset = selectedChannel === 'r' ? 0 : selectedChannel === 'g' ? 1 : 2;
        for (let i = 0; i < data.length; i += 4) {
            const v = data[i + offset];
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
        }
    }

    if (claheEnabled) {
        applyClaheYCbCr(data, w, h, claheClipLimit);
    }

    pCtx.putImageData(imageData, 0, 0);
    processedKey = key;
    return processedCanvas;
}

// CLAHE in YCbCr (Rec.601). Equalizes Y; Cb/Cr pass through. In-place on `data` (RGBA).
function applyClaheYCbCr(data, width, height, clipLimit) {
    const n = width * height;
    const y = new Uint8Array(n);
    const cb = new Uint8Array(n);
    const cr = new Uint8Array(n);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        y[p]  = Math.round( 0.299 * r + 0.587 * g + 0.114 * b);
        cb[p] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5      * b);
        cr[p] = Math.round(128 + 0.5      * r - 0.418688 * g - 0.081312 * b);
    }

    claheOnPlane(y, width, height, clipLimit);

    for (let p = 0, i = 0; p < n; p++, i += 4) {
        const Y  = y[p];
        const Cb = cb[p] - 128;
        const Cr = cr[p] - 128;
        const r = Y + 1.402 * Cr;
        const g = Y - 0.344136 * Cb - 0.714136 * Cr;
        const b = Y + 1.772 * Cb;
        data[i]     = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    }
}

// CLAHE on a single 8-bit plane. 8x8 tile grid sized adaptively to the plane.
// Float clip threshold avoids the floor-to-zero collapse seen with small tiles.
function claheOnPlane(plane, width, height, clipLimit) {
    const tilesX = 8;
    const tilesY = 8;
    const tileW = Math.ceil(width / tilesX);
    const tileH = Math.ceil(height / tilesY);

    const cdfs = new Array(tilesX * tilesY);

    for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
            const startX = tx * tileW;
            const startY = ty * tileH;
            const endX = Math.min(startX + tileW, width);
            const endY = Math.min(startY + tileH, height);
            const tilePixels = (endX - startX) * (endY - startY);

            const hist = new Uint32Array(256);
            for (let py = startY; py < endY; py++) {
                const row = py * width;
                for (let px = startX; px < endX; px++) {
                    hist[plane[row + px]]++;
                }
            }

            // Clip in floating point. Storing back into the integer hist would truncate
            // sub-1.0 thresholds and re-introduce the floor-to-zero collapse on small tiles.
            const clippedHist = new Float64Array(256);
            const clipThreshold = clipLimit * tilePixels / 256;
            let excess = 0;
            for (let i = 0; i < 256; i++) {
                if (hist[i] > clipThreshold) {
                    excess += hist[i] - clipThreshold;
                    clippedHist[i] = clipThreshold;
                } else {
                    clippedHist[i] = hist[i];
                }
            }
            const redistribution = excess / 256;

            const cdf = new Uint8Array(256);
            let acc = 0;
            const scale = 255 / tilePixels;
            for (let i = 0; i < 256; i++) {
                acc += clippedHist[i] + redistribution;
                let v = Math.round(acc * scale);
                if (v > 255) v = 255;
                cdf[i] = v;
            }
            cdfs[ty * tilesX + tx] = cdf;
        }
    }

    // Bilinear interpolation between the 4 surrounding tile CDFs.
    // fx/fy are the pixel position in tile-center coordinates, clamped to the valid range
    // so that edge / corner pixels collapse to a single CDF without reaching across the boundary.
    for (let py = 0; py < height; py++) {
        const row = py * width;
        const rawFy = (py + 0.5) / tileH - 0.5;
        const fy = rawFy < 0 ? 0 : rawFy > tilesY - 1 ? tilesY - 1 : rawFy;
        const ty1 = Math.floor(fy);
        const ty2 = ty1 + 1 > tilesY - 1 ? tilesY - 1 : ty1 + 1;
        const dy = fy - ty1;

        for (let px = 0; px < width; px++) {
            const rawFx = (px + 0.5) / tileW - 0.5;
            const fx = rawFx < 0 ? 0 : rawFx > tilesX - 1 ? tilesX - 1 : rawFx;
            const tx1 = Math.floor(fx);
            const tx2 = tx1 + 1 > tilesX - 1 ? tilesX - 1 : tx1 + 1;
            const dx = fx - tx1;

            const v = plane[row + px];
            const v11 = cdfs[ty1 * tilesX + tx1][v];
            const v12 = cdfs[ty1 * tilesX + tx2][v];
            const v21 = cdfs[ty2 * tilesX + tx1][v];
            const v22 = cdfs[ty2 * tilesX + tx2][v];

            const top = v11 * (1 - dx) + v12 * dx;
            const bot = v21 * (1 - dx) + v22 * dx;
            plane[row + px] = Math.round(top * (1 - dy) + bot * dy);
        }
    }
}

function updateBrightnessResetBtn() {
    if (brightnessResetBtn) {
        brightnessResetBtn.classList.toggle('visible', brightness !== 100);
    }
}

function updateContrastResetBtn() {
    if (contrastResetBtn) {
        contrastResetBtn.classList.toggle('visible', contrast !== 100);
    }
}

// Lock-button updaters: swap the SVG icon and toggle the .locked class.
// LOCK_OPEN_SVG / LOCK_CLOSED_SVG are hoisted near updateZoomUI so all five
// lock buttons share the same icon source.

function updateBrightnessLockUI() {
    if (brightnessLockBtn) {
        brightnessLockBtn.innerHTML = brightnessLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        brightnessLockBtn.classList.toggle('locked', brightnessLocked);
    }
}

function updateContrastLockUI() {
    if (contrastLockBtn) {
        contrastLockBtn.innerHTML = contrastLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        contrastLockBtn.classList.toggle('locked', contrastLocked);
    }
}

function updateChannelLockUI() {
    if (channelLockBtn) {
        channelLockBtn.innerHTML = channelLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        channelLockBtn.classList.toggle('locked', channelLocked);
    }
}

function updateClaheLockUI() {
    if (claheLockBtn) {
        claheLockBtn.innerHTML = claheLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
        claheLockBtn.classList.toggle('locked', claheLocked);
    }
}

function updateClaheResetBtn() {
    if (claheResetBtn) {
        claheResetBtn.classList.toggle('visible', claheEnabled || claheClipLimit !== 2.0);
    }
}

if (brightnessSlider) {
    brightnessSlider.oninput = (e) => {
        brightness = parseInt(e.target.value);
        brightnessValue.textContent = brightness;
        updateBrightnessResetBtn();
        applyImageAdjust();
    };
    brightnessSlider.onchange = () => saveGlobalSettings('brightness', brightness);
}

if (contrastSlider) {
    contrastSlider.oninput = (e) => {
        contrast = parseInt(e.target.value);
        contrastValue.textContent = contrast;
        updateContrastResetBtn();
        applyImageAdjust();
    };
    contrastSlider.onchange = () => saveGlobalSettings('contrast', contrast);
}

// Channel radio event handler
channelRadios.forEach(r => {
    r.addEventListener('change', () => {
        if (r.checked) {
            selectedChannel = r.value;
            draw();
            saveGlobalSettings('selectedChannel', selectedChannel);
        }
    });
});

// CLAHE clip limit slider — only adjusts the value; does not toggle enabled state.
if (claheClipLimitSlider) {
    claheClipLimitSlider.oninput = (e) => {
        claheClipLimit = parseFloat(e.target.value);
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        updateClaheResetBtn();
        draw();
    };
    claheClipLimitSlider.onchange = () => saveGlobalSettings('claheClipLimit', claheClipLimit);
}

// CLAHE toggle button
if (claheToggleBtn) {
    claheToggleBtn.onclick = () => {
        claheEnabled = !claheEnabled;
        updateClaheToggleUI();
        updateClaheResetBtn();
        draw();
        saveGlobalSettings('claheEnabled', claheEnabled);
    };
}

// Draw-click-through toggle button
const drawClickThroughToggleBtn = document.getElementById('drawClickThroughToggleBtn');
function updateDrawClickThroughToggleUI() {
    if (!drawClickThroughToggleBtn) return;
    const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
    drawClickThroughToggleBtn.textContent = drawClickThrough ? tt('toggle.on') : tt('toggle.off');
    drawClickThroughToggleBtn.classList.toggle('active', drawClickThrough);
}
if (drawClickThroughToggleBtn) {
    drawClickThroughToggleBtn.onclick = () => {
        drawClickThrough = !drawClickThrough;
        updateDrawClickThroughToggleUI();
        saveGlobalSettings('drawClickThrough', drawClickThrough);
        // Selection-allowed state just changed; drop any hover preview / cycle
        // state so a stale dashed outline or badge can't linger after the redraw.
        hoveredShapeIndex = -1;
        overlapCycleState = { members: [], pos: -1 };
        hideCycleBadge();
        draw();
    };
}

// Crosshair guide toggle button
const crosshairToggleBtn = document.getElementById('crosshairToggleBtn');
function updateCrosshairToggleUI() {
    if (!crosshairToggleBtn) return;
    const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
    crosshairToggleBtn.textContent = crosshairEnabled ? tt('toggle.on') : tt('toggle.off');
    crosshairToggleBtn.classList.toggle('active', crosshairEnabled);
}
if (crosshairToggleBtn) {
    crosshairToggleBtn.onclick = () => {
        crosshairEnabled = !crosshairEnabled;
        updateCrosshairToggleUI();
        saveGlobalSettings('crosshairEnabled', crosshairEnabled);
        if (!crosshairEnabled) crosshairPos = null;
        draw();
    };
}

// Show-shape-labels toggle button
const showShapeLabelsToggleBtn = document.getElementById('showShapeLabelsToggleBtn');
function updateShowShapeLabelsToggleUI() {
    if (!showShapeLabelsToggleBtn) return;
    const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
    showShapeLabelsToggleBtn.textContent = showShapeLabels ? tt('toggle.on') : tt('toggle.off');
    showShapeLabelsToggleBtn.classList.toggle('active', showShapeLabels);
}
if (showShapeLabelsToggleBtn) {
    showShapeLabelsToggleBtn.onclick = () => {
        showShapeLabels = !showShapeLabels;
        updateShowShapeLabelsToggleUI();
        saveGlobalSettings('showShapeLabels', showShapeLabels);
        draw(); // re-render the canvas to show/hide labels
    };
}

// CLAHE reset button — clears enabled state and restores default clip limit.
if (claheResetBtn) {
    claheResetBtn.onclick = () => {
        claheEnabled = false;
        claheClipLimit = 2.0;
        if (claheClipLimitSlider) claheClipLimitSlider.value = claheClipLimit;
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        updateClaheToggleUI();
        updateClaheResetBtn();
        draw();
        saveGlobalSettings('claheEnabled', claheEnabled);
        saveGlobalSettings('claheClipLimit', claheClipLimit);
    };
}

// CLAHE lock button
if (claheLockBtn) {
    claheLockBtn.onclick = () => {
        claheLocked = !claheLocked;
        updateClaheLockUI();
        saveGlobalSettings('claheLocked', claheLocked);
    };
}

if (brightnessResetBtn) {
    brightnessResetBtn.onclick = () => {
        brightness = 100;
        if (brightnessSlider) brightnessSlider.value = brightness;
        if (brightnessValue) brightnessValue.textContent = brightness;
        updateBrightnessResetBtn();
        applyImageAdjust();
        saveGlobalSettings('brightness', brightness);
    };
}

if (contrastResetBtn) {
    contrastResetBtn.onclick = () => {
        contrast = 100;
        if (contrastSlider) contrastSlider.value = contrast;
        if (contrastValue) contrastValue.textContent = contrast;
        updateContrastResetBtn();
        applyImageAdjust();
        saveGlobalSettings('contrast', contrast);
    };
}

if (brightnessLockBtn) {
    brightnessLockBtn.addEventListener('click', () => {
        brightnessLocked = !brightnessLocked;
        updateBrightnessLockUI();
        saveGlobalSettings('brightnessLocked', brightnessLocked);
    });
}

if (contrastLockBtn) {
    contrastLockBtn.addEventListener('click', () => {
        contrastLocked = !contrastLocked;
        updateContrastLockUI();
        saveGlobalSettings('contrastLocked', contrastLocked);
    });
}

// Initialize channel and CLAHE lock buttons
const channelLockBtn = document.getElementById('channelLockBtn');

if (channelLockBtn) {
    channelLockBtn.addEventListener('click', () => {
        channelLocked = !channelLocked;
        updateChannelLockUI();
        saveGlobalSettings('channelLocked', channelLocked);
    });
}

// Initialize image adjust UI
updateBrightnessLockUI();
updateContrastLockUI();
updateChannelLockUI();
updateClaheLockUI();
updateBrightnessResetBtn();
updateContrastResetBtn();
updateClaheResetBtn();
applyImageAdjust();

// Initialize reset button visibility
updateBorderWidthResetBtn();
updateFillOpacityResetBtn();

// --- Theme Button Event Listeners ---

if (themeLightBtn) {
    themeLightBtn.onclick = () => setTheme('light');
}

if (themeDarkBtn) {
    themeDarkBtn.onclick = () => setTheme('dark');
}

if (themeAutoBtn) {
    themeAutoBtn.onclick = () => setTheme('auto');
}

// --- Navigation Buttons Event Listeners ---

// Previous Image button
if (prevImageBtn) {
    prevImageBtn.onclick = () => {
        navigateRelative(-1);
    };
}

// Next Image button
if (nextImageBtn) {
    nextImageBtn.onclick = () => {
        navigateRelative(1);
    };
}

// Filename click to copy absolute path
const fileNameSpan = document.getElementById('fileName');
if (fileNameSpan) {
    fileNameSpan.onclick = () => {
        if (currentAbsoluteImagePath) {
            navigator.clipboard.writeText(currentAbsoluteImagePath).then(() => {
                const originalText = fileNameSpan.textContent;
                fileNameSpan.textContent = originalText + ' ✓';
                setTimeout(() => { fileNameSpan.textContent = originalText; }, 1000);
            }).catch(err => console.error('Failed to copy path:', err));
        }
    };
    // Right-click to copy filename only
    fileNameSpan.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (currentAbsoluteImagePath) {
            const baseName = currentAbsoluteImagePath.split(/[\\/]/).pop() || currentAbsoluteImagePath;
            navigator.clipboard.writeText(baseName).then(() => {
                const originalText = fileNameSpan.textContent;
                fileNameSpan.textContent = originalText + ' ✓';
                setTimeout(() => { fileNameSpan.textContent = originalText; }, 1000);
            }).catch(err => console.error('Failed to copy filename:', err));
        }
    });
}

// --- Image Info Popup ---

function formatFileSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

function updateImageInfoPopup() {
    const popup = document.getElementById('imageInfoPopup');
    if (!popup || popup.classList.contains('hidden')) return;
    renderImageInfoContent(popup);
}

function renderImageInfoContent(popup) {
    const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
    const rows = [];
    // Dimensions from loaded image
    if (img && img.width > 0 && img.height > 0) {
        rows.push({ label: tt('imageInfo.dimensions'), value: `${img.width} \u00d7 ${img.height}` });
    }
    // File size from extension metadata
    if (currentImageMetadata) {
        if (currentImageMetadata.fileSize) {
            rows.push({ label: tt('imageInfo.fileSize'), value: formatFileSize(currentImageMetadata.fileSize) });
        }
        if (currentImageMetadata.dpiX) {
            const dpi = currentImageMetadata.dpiX === currentImageMetadata.dpiY
                ? `${currentImageMetadata.dpiX}`
                : `${currentImageMetadata.dpiX} \u00d7 ${currentImageMetadata.dpiY}`;
            rows.push({ label: tt('imageInfo.dpi'), value: dpi });
        }
        if (currentImageMetadata.bitDepth) {
            rows.push({ label: tt('imageInfo.bitDepth'), value: `${currentImageMetadata.bitDepth}` });
        }
    }

    popup.textContent = '';
    if (rows.length === 0) {
        const span = document.createElement('span');
        span.style.opacity = '0.5';
        span.textContent = tt('imageInfo.empty');
        popup.appendChild(span);
        return;
    }

    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'info-row';
        const label = document.createElement('span');
        label.className = 'info-label';
        label.textContent = r.label;
        const value = document.createElement('span');
        value.className = 'info-value';
        value.textContent = r.value;
        row.appendChild(label);
        row.appendChild(value);
        popup.appendChild(row);
    });
}

const imageInfoBtn = document.getElementById('imageInfoBtn');
const imageInfoPopup = document.getElementById('imageInfoPopup');

if (imageInfoBtn && imageInfoPopup) {
    imageInfoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = imageInfoPopup.classList.contains('hidden');
        if (isHidden) {
            renderImageInfoContent(imageInfoPopup);
            imageInfoPopup.classList.remove('hidden');
        } else {
            imageInfoPopup.classList.add('hidden');
        }
    });

    // Close popup when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!imageInfoPopup.classList.contains('hidden') &&
            !imageInfoPopup.contains(e.target) &&
            e.target !== imageInfoBtn) {
            imageInfoPopup.classList.add('hidden');
        }
    });
}

// --- Mode Toggle Event Listeners ---

// View Mode button
if (viewModeBtn) {
    viewModeBtn.onclick = () => setMode('view');
}

// Point Mode button
if (pointModeBtn) {
    pointModeBtn.onclick = () => setMode('point');
}

// Line Mode button
if (lineModeBtn) {
    lineModeBtn.onclick = () => setMode('line');
}

// Polygon Mode button
if (polygonModeBtn) {
    polygonModeBtn.onclick = () => setMode('polygon');
}

// Rectangle Mode button
if (rectangleModeBtn) {
    rectangleModeBtn.onclick = () => setMode('rectangle');
}

// Circle Mode button
if (circleModeBtn) {
    circleModeBtn.onclick = () => setMode('circle');
}
