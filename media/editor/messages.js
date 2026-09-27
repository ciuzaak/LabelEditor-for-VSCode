// LabelEditor webview — Messages from the extension host, image switching and image-list updates.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'notify': {
            if (!window.notifyBus) break;
            const level = message.level || 'info';
            const opts = {};
            if (message.key) opts.key = message.key;
            if (message.sticky) opts.sticky = true;
            // Prefer i18nKey if the host supplied one; falls back to the raw
            // text so older callers keep working unchanged.
            let displayText = message.text || '';
            if (message.i18nKey && window.i18n && window.i18n.t) {
                const translated = window.i18n.t(message.i18nKey, message.i18nParams);
                if (translated && translated !== message.i18nKey) {
                    displayText = translated;
                }
            }
            window.notifyBus.show(level, displayText, opts);
            break;
        }
        case 'requestSave':
            // The extension's "unsaved changes" prompt is non-modal, so by the
            // time "Save" is clicked the user may already have saved (Ctrl+S).
            if (isSaving) {
                // A save is in flight: navigate once it completes.
                saveTriggeredByNavigation = true;
            } else if (!isDirty) {
                // Nothing left to write; save() would be a no-op and the
                // navigation would otherwise never happen (or fire later).
                vscode.postMessage({ command: 'navigateAfterSave' });
            } else {
                saveTriggeredByNavigation = true;
                save();
            }
            break;
        case 'saveComplete': {
            // Mark clean at the exact history snapshot that was saved
            markCleanAtIndex(pendingSaveHistoryIndex);
            const isClean = (historyIndex === savedHistoryIndex);
            const wasNavigationSave = saveTriggeredByNavigation;
            pendingSaveHistoryIndex = -1;
            isSaving = false;
            saveTriggeredByNavigation = false;

            // Only navigate if:
            // 1. The save was triggered by a navigation request (not manual toolbar save)
            // 2. The webview is actually clean (user didn't edit during save)
            if (wasNavigationSave && isClean) {
                vscode.postMessage({ command: 'navigateAfterSave' });
            }
            break;
        }
        case 'saveFailed':
            // Keep dirty state - save failed on backend
            pendingSaveHistoryIndex = -1;
            isSaving = false;
            saveTriggeredByNavigation = false;
            break;
        case 'yoloClassAdded':
            window.yoloClasses = message.classes || window.yoloClasses;
            // The label is now a valid class — re-run confirm to create/edit the shape.
            labelInput.value = message.label;
            confirmLabel();
            break;
        case 'yoloAddClassCancelled':
            // User declined; keep the modal open so they can pick an existing class.
            if (labelModal.style.display === 'flex') labelInput.focus();
            break;
        case 'updateImage':
            handleImageUpdate(message);
            break;
        case 'vscodeThemeChanged':
            vscodeThemeKind = message.themeKind;
            if (currentTheme === 'auto') {
                applyTheme('auto');
            }
            break;
        case 'updateImageList':
            handleUpdateImageList(message);
            break;
        case 'onnxBrowseResult':
            if (message.field === 'modelDir' && onnxModelDirInput) {
                onnxModelDirInput.value = message.value;
            } else if (message.field === 'pythonPath' && onnxPythonPathInput) {
                onnxPythonPathInput.value = message.value;
            }
            break;
        case 'samBrowseResult': {
            const samModelDirInput = document.getElementById('samModelDir');
            const samPythonPathInput = document.getElementById('samPythonPath');
            if (message.field === 'modelDir' && samModelDirInput) {
                samModelDirInput.value = message.value;
            } else if (message.field === 'pythonPath' && samPythonPathInput) {
                samPythonPathInput.value = message.value;
            }
            break;
        }
        case 'samRunningStatus':
            // Reply to samQueryExtensionRunning (pre-check). Pass the port so the
            // resolver can reject a stale reply meant for an earlier query.
            if (samRunningQueryResolver) samRunningQueryResolver(!!message.running, message.port);
            break;
        case 'exportBrowseResult': {
            const input = document.getElementById('exportOutputDir');
            if (input) input.value = message.value;
            break;
        }
        case 'svgExportBrowseResult': {
            const input = document.getElementById('svgOutputDir');
            if (input) input.value = message.value;
            break;
        }
        case 'exportSvgPrepareResult': {
            const el = document.getElementById('svgImageCount');
            if (el) el.textContent = message.imageCount;
            break;
        }
        case 'exportSvgRunResult': {
            if (message.ok) hideExportSvgModal();
            break;
        }
        case 'exportDatasetPrepareResult': {
            applyExportPrepareResult(message);
            break;
        }
        case 'exportDatasetRunResult': {
            if (message.ok) hideExportDatasetModal();
            break;
        }
        case 'advancedSearchIndexProgress': {
            if (advIndexing) setIndexStatus(tt('advSearch.indexing', { done: message.done, total: message.total }));
            break;
        }
        case 'advancedSearchPrepareResult': {
            applyAdvancedPrepareResult(message);
            break;
        }
        case 'advancedSearchRunResult': {
            applyAdvancedRunResult(message);
            break;
        }
        case 'gpuDetectResult': {
            // Populate BOTH ONNX and SAM GPU dropdowns (whichever modal is open)
            const gpuGroups = [
                { group: document.getElementById('samGpuIndexGroup'), select: document.getElementById('samGpuIndex') },
                { group: document.getElementById('onnxGpuIndexGroup'), select: document.getElementById('onnxGpuIndex') }
            ];
            for (const { group, select } of gpuGroups) {
                if (group && select && message.gpus && message.gpus.length > 1) {
                    select.innerHTML = '';
                    message.gpus.forEach((gpu, idx) => {
                        const opt = document.createElement('option');
                        opt.value = idx;
                        const match = gpu.match(/^GPU\s+(\d+):\s*(.+?)(?:\s*\(UUID.*)?$/);
                        opt.textContent = match ? `GPU ${match[1]}: ${match[2]}` : gpu;
                        select.appendChild(opt);
                    });
                    group.style.display = '';
                    // Restore saved GPU index if available
                    const pendingIdx = group.__pendingGpuIndex;
                    if (pendingIdx !== undefined && pendingIdx >= 0 && pendingIdx < message.gpus.length) {
                        select.value = pendingIdx;
                    }
                    delete group.__pendingGpuIndex;
                } else if (group) {
                    group.style.display = 'none';
                }
            }
            break;
        }
    }
});

// Handle incremental image update (without full HTML reload)
function handleImageUpdate(message) {
    // Force-invalidate the processed-image cache: a same-URL image may carry different
    // bytes after an external edit, so we cannot rely on the URL alone for invalidation.
    processedKey = '';
    imageLayerKey = '';

    // Exit shape edit mode if currently editing (without saving changes to the old image)
    if (isEditingShape) {
        exitShapeEditMode(false);
    }

    // Cancel any current drawing
    if (isDrawing) {
        isDrawing = false;
        currentPoints = [];
    }

    // Cancel any active eraser
    if (eraserActive || eraserMouseDownPos) {
        cancelEraser();
        eraserMouseDownPos = null;
        eraserMouseDownTime = 0;
        eraserIsDragging = false;
        eraserDragCurrent = null;
    }

    // Clear selection and box selection
    clearSelection();
    isBoxSelecting = false;
    boxSelectStart = null;
    boxSelectCurrent = null;
    editingShapeIndex = -1;
    isBatchRenaming = false;
    hoveredShapeIndex = -1; // indexes into the old image's shapes
    if (isMergePending) clearMergePendingState();
    hideLabelModal();
    samResetForNewImage();

    // Reset brightness/contrast if not locked (independently)
    if (!brightnessLocked) {
        brightness = 100;
        if (brightnessSlider) brightnessSlider.value = brightness;
        if (brightnessValue) brightnessValue.textContent = brightness;
        updateBrightnessResetBtn();
        saveGlobalSettings('brightness', brightness);
    }
    if (!contrastLocked) {
        contrast = 100;
        if (contrastSlider) contrastSlider.value = contrast;
        if (contrastValue) contrastValue.textContent = contrast;
        updateContrastResetBtn();
        saveGlobalSettings('contrast', contrast);
    }
    if (!channelLocked) {
        selectedChannel = 'rgb';
        updateChannelRadios();
        saveGlobalSettings('selectedChannel', selectedChannel);
    }
    if (!claheLocked) {
        claheEnabled = false;
        claheClipLimit = 2.0;
        if (claheClipLimitSlider) claheClipLimitSlider.value = claheClipLimit;
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        updateClaheToggleUI();
        updateClaheResetBtn();
        saveGlobalSettings('claheEnabled', claheEnabled);
        saveGlobalSettings('claheClipLimit', claheClipLimit);
    }
    applyImageAdjust();

    // Increment load ID to invalidate any pending callbacks from previous loads
    currentImageLoadId++;
    const thisLoadId = currentImageLoadId;

    // Update global variables (these were injected via script tag initially)
    // Note: imageUrl, imageName, imagePath, currentImageRelativePath are const, 
    // so we need to work around this by using new variables
    const newImageUrl = message.imageUrl;
    const newImageName = message.imageName;
    const newImagePath = message.imagePath;
    const newCurrentImageRelativePath = message.currentImageRelativePath;

    // Store image metadata for info popup
    currentImageMetadata = message.imageMetadata || null;

    // Update filename display. The tip is supplied by data-tip-id="nav.fileName".
    const fileNameSpan = document.getElementById('fileName');
    if (fileNameSpan) {
        fileNameSpan.textContent = newCurrentImageRelativePath || newImageName;
    }

    // Update mutable absolute path for copy feature
    currentAbsoluteImagePath = newImagePath;

    // Load new shapes from existing data
    if (message.existingData) {
        shapes = (message.existingData.shapes || []).map(shape => {
            // Apply global visibility state
            const visible = labelVisibilityState.has(shape.label)
                ? labelVisibilityState.get(shape.label)
                : true;
            return {
                ...shape,
                visible: visible
            };
        });
    } else {
        shapes = [];
    }

    // Reset history for new image
    history = [];
    historyIndex = -1;
    saveHistory();

    // Mark as clean (new image)
    markClean();

    // Update image browser list highlight
    updateImageBrowserHighlight(newCurrentImageRelativePath);

    // If no image URL is provided (e.g., empty folder), clear the canvas and UI
    if (!newImageUrl) {
        imageLoadPending = false;
        img.src = '';
        shapes = [];
        currentPoints = [];
        isDrawing = false;
        clearSelection();
        editingShapeIndex = -1;
        if (window.notifyBus) {
            const msg = (window.i18n && window.i18n.t) ? window.i18n.t('status.noImagesFound') : 'No images found';
            window.notifyBus.show('warn', msg);
        }
        draw();
        renderShapeList();
        renderLabelsList();
        updateZoomUI();
        return;
    }

    // Load new image with stale callback protection
    imageLoadPending = true;
    img.onload = function () {
        // Check if this callback is for the current load request
        if (thisLoadId !== currentImageLoadId) return;
        imageLoadPending = false;

        // Clear the persistent "image error" sticky if a previous load failed.
        if (window.notifyBus) window.notifyBus.clearSticky('image.error');

        // Apply locked view state if enabled, otherwise fit to screen
        if (lockViewEnabled && lockedViewState) {
            applyNormalizedViewState(lockedViewState);
        } else {
            fitImageToScreen();
        }
        draw();
        renderShapeList();
        renderLabelsList();
        updateZoomUI(); // Update zoom percentage display
        updateImageInfoPopup(); // Refresh info popup with actual dimensions
    };
    img.onerror = function () {
        // Check if this callback is for the current load request
        if (thisLoadId !== currentImageLoadId) return;
        imageLoadPending = false;

        handleImageError();
    };
    img.src = newImageUrl;
}

// Track whether the initial scan has completed (to distinguish scanning from empty results)
let scanComplete = false;

// Handle refreshed image list from extension
function handleUpdateImageList(message) {
    scanComplete = Object.prototype.hasOwnProperty.call(message, 'isScanFinished') ? !!message.isScanFinished : true;
    // A manual refresh resets the cached class universe (annotations may have
    // changed), so the next class condition re-indexes. We never auto-CLEAR an
    // active advanced filter here — doing so wiped filters when the async initial
    // scan or a re-send landed after a search. The result set is instead
    // re-validated against the new list below.
    if (message.isRefresh) {
        if (advIndexing) cancelIndexing();
        advPrepareSeq++; // invalidate any in-flight prepare response against the now-stale list
        advClassUniverseLoaded = false;
        advSearchClassData = [];
    }
    // Update the global workspaceImages array
    // Note: workspaceImages is defined in the HTML as a const, so we need to modify it in place
    if (typeof workspaceImages !== 'undefined' && Array.isArray(workspaceImages)) {
        workspaceImages.length = 0; // Clear existing
        message.workspaceImages.forEach(img => workspaceImages.push(img));
    }

    // Keep an active advanced filter alive across list updates — just drop any
    // results that no longer exist in the refreshed list.
    if (advancedFilterActive) {
        const present = new Set(workspaceImages);
        advancedResults = advancedResults.filter(p => present.has(p));
    }

    // Update the current image relative path
    if (message.currentImageRelativePath) {
        currentImageRelativePathMutable = message.currentImageRelativePath;
    }

    // Re-apply filter if search is active
    if (searchQuery) {
        filteredImages = workspaceImages.filter(img =>
            img.toLowerCase().includes(searchQuery)
        );
    } else {
        filteredImages = [];
    }

    // Update image count display
    updateImageCount();

    // Clear saved scroll state to prevent stale scroll position restoration after folder switch
    const state = vscode.getState() || {};
    state.savedScrollTop = undefined;
    state.skipNextScroll = false;
    vscode.setState(state);

    // Reset virtual scroll state and re-render the list
    virtualScrollState = {
        startIndex: 0,
        endIndex: 0,
        scrollTop: 0
    };
    renderImageBrowserList();
}

// Update image browser highlight for virtual scrolling
// We need to store the new path and re-render the visible items
let currentImageRelativePathMutable = currentImageRelativePath; // Mutable version for updates
let currentAbsoluteImagePath = imagePath; // Mutable version for copy feature

function updateImageBrowserHighlight(newRelativePath) {
    if (!imageBrowserList) return;

    // Update the mutable path for virtual scrolling to use
    currentImageRelativePathMutable = newRelativePath;

    // With virtual scrolling, we need to:
    // 1. Scroll to the new active item position
    // 2. Force re-render of visible items to update highlighting

    if (typeof workspaceImages !== 'undefined') {
        // Position is relative to the EFFECTIVE (filtered) list, since that is what
        // the virtual list renders. Using the full-list index here scrolled the
        // filtered list past its end (the "jumps to bottom" bug).
        const newIndex = getEffectiveImageList().indexOf(newRelativePath);
        if (newIndex !== -1) {
            const viewportTop = imageBrowserList.scrollTop;
            const viewportBottom = viewportTop + imageBrowserList.clientHeight;
            const itemTop = newIndex * VIRTUAL_ITEM_HEIGHT;
            const itemBottom = itemTop + VIRTUAL_ITEM_HEIGHT;

            // Only scroll if item is not visible, use minimal scroll (not centering)
            if (itemTop < viewportTop) {
                // Item is above viewport - scroll up to show it at top
                imageBrowserList.scrollTop = itemTop;
            } else if (itemBottom > viewportBottom) {
                // Item is below viewport - scroll down to show it at bottom
                imageBrowserList.scrollTop = itemBottom - imageBrowserList.clientHeight;
            }
            // If item is already visible, don't scroll at all
        }
    }

    // Update image count to reflect new current position
    updateImageCount();

    // Force re-render to update highlighting
    virtualScrollState.startIndex = -1; // Reset to force update
    virtualScrollState.endIndex = -1;
    updateVirtualScroll();
}
