// LabelEditor webview — SAM (Segment Anything) mode: config dialog, service calls, prompts, overlay.
// Part of the editor bundle: build/bundle-webview.js concatenates media/editor/*.js,
// in the order listed there, into one classic script (shared scope, hoisting).

// ============================================================================
// SAM AI Annotation Mode
// ============================================================================

// --- SAM Config Modal ---
const samConfigModal = document.getElementById('samConfigModal');
const samConfigOkBtn = document.getElementById('samConfigOkBtn');
const samConfigCancelBtn = document.getElementById('samConfigCancelBtn');
const samModelDirBrowseBtn = document.getElementById('samModelDirBrowse');
const samPythonPathBrowseBtn = document.getElementById('samPythonPathBrowse');

function showSamConfigModal() {
    const gs = (typeof initialGlobalSettings !== 'undefined') ? initialGlobalSettings : {};
    const savedState = vscode.getState() || {};

    const modelDirInput = document.getElementById('samModelDir');
    const pythonPathInput = document.getElementById('samPythonPath');
    const portInput = document.getElementById('samPort');

    if (modelDirInput) modelDirInput.value = savedState.samModelDir ?? gs.samModelDir ?? '';
    if (pythonPathInput) pythonPathInput.value = savedState.samPythonPath ?? gs.samPythonPath ?? '';
    if (portInput) portInput.value = savedState.samPort ?? gs.samPort ?? 8765;

    const restoreRadio = (name, savedValue) => {
        if (!savedValue) return;
        const radio = document.querySelector(`input[name="${name}"][value="${savedValue}"]`);
        if (radio) radio.checked = true;
    };
    restoreRadio('samDevice', savedState.samDevice ?? gs.samDevice);
    restoreRadio('samEncodeMode', savedState.samEncodeMode ?? gs.samEncodeMode ?? 'full');
    restoreRadio('samOutputFormat', savedState.samOutputFormat ?? gs.samOutputFormat ?? 'polygon');
    const encodeAdjustedSaved = savedState.samEncodeAdjusted ?? gs.samEncodeAdjusted ?? false;
    restoreRadio('samEncodeSource', encodeAdjustedSaved ? 'adjusted' : 'original');

    // Trigger GPU detection if GPU is selected
    const gpuGroup = document.getElementById('samGpuIndexGroup');
    const selectedDevice = document.querySelector('input[name="samDevice"]:checked')?.value || 'cpu';
    // Store pending GPU index to restore after detection result arrives
    const pendingSamGpuIndex = savedState.samGpuIndex ?? gs.samGpuIndex ?? -1;
    if (selectedDevice === 'gpu') {
        const samGpuGroup = document.getElementById('samGpuIndexGroup');
        if (samGpuGroup) samGpuGroup.__pendingGpuIndex = pendingSamGpuIndex;
        vscode.postMessage({ command: 'detectGpuCount' });
    } else if (gpuGroup) {
        gpuGroup.style.display = 'none';
    }

    if (samConfigModal) samConfigModal.style.display = 'flex';
    if (modelDirInput && !modelDirInput.value) modelDirInput.focus();
}

function hideSamConfigModal() {
    if (samConfigModal) samConfigModal.style.display = 'none';
}

function submitSamConfig() {
    const modelDir = document.getElementById('samModelDir')?.value.trim() || '';
    const pythonPath = document.getElementById('samPythonPath')?.value.trim() || '';
    const device = document.querySelector('input[name="samDevice"]:checked')?.value || 'cpu';
    const port = parseInt(document.getElementById('samPort')?.value) || 8765;
    const encodeMode = document.querySelector('input[name="samEncodeMode"]:checked')?.value || 'full';
    const encodeAdjusted = (document.querySelector('input[name="samEncodeSource"]:checked')?.value === 'adjusted');
    const outputFormat = document.querySelector('input[name="samOutputFormat"]:checked')?.value || 'polygon';
    const gpuSelect = document.getElementById('samGpuIndex');
    const gpuGroup = document.getElementById('samGpuIndexGroup');
    // Use dropdown value if populated, otherwise fall back to saved/persisted index
    const samSavedState = vscode.getState() || {};
    const gpuIndex = (device === 'gpu')
        ? (gpuGroup && gpuGroup.style.display !== 'none' && gpuSelect
            ? parseInt(gpuSelect.value)
            : (samSavedState.samGpuIndex ?? (typeof initialGlobalSettings !== 'undefined' ? initialGlobalSettings.samGpuIndex : undefined) ?? 0))
        : undefined;

    if (!modelDir) {
        const input = document.getElementById('samModelDir');
        if (input) input.focus();
        return;
    }

    // Persist settings
    const settings = { samModelDir: modelDir, samPythonPath: pythonPath, samDevice: device, samPort: port, samEncodeMode: encodeMode, samEncodeAdjusted: encodeAdjusted, samGpuIndex: gpuIndex ?? -1, samOutputFormat: outputFormat };
    const state = vscode.getState() || {};
    Object.assign(state, settings);
    vscode.setState(state);
    for (const [key, value] of Object.entries(settings)) {
        vscode.postMessage({ command: 'saveGlobalSettings', key, value });
    }

    samServicePort = port;
    samEncodeMode = encodeMode;
    samOutputFormat = outputFormat;
    // If the toggle changed, invalidate the cache so the next click re-encodes
    // with (or without) the adjusted view.
    if (samEncodeAdjusted !== encodeAdjusted) {
        samEncodeAdjusted = encodeAdjusted;
        samCachedAdjustSig = null;
        samCurrentImagePath = null;
    } else {
        samEncodeAdjusted = encodeAdjusted;
    }

    // Send to extension to start service
    vscode.postMessage({
        command: 'samStartService',
        config: { modelDir, pythonPath, device, port, gpuIndex }
    });

    hideSamConfigModal();

    // Now enter SAM mode
    currentMode = 'sam';
    saveState();
    updateModeButtons();
    draw();

    // Wait briefly for service to start, then mark running
    setTimeout(() => {
        samPingService().then(ok => {
            samServiceRunning = ok;
        });
    }, 3000);
}

if (samConfigOkBtn) samConfigOkBtn.addEventListener('click', submitSamConfig);
if (samConfigCancelBtn) samConfigCancelBtn.addEventListener('click', hideSamConfigModal);
if (samModelDirBrowseBtn) {
    samModelDirBrowseBtn.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseSamModelDir',
            currentValue: document.getElementById('samModelDir')?.value.trim() || ''
        });
    });
}
if (samPythonPathBrowseBtn) {
    samPythonPathBrowseBtn.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseSamPythonPath',
            currentValue: document.getElementById('samPythonPath')?.value.trim() || ''
        });
    });
}
if (samConfigModal) {
    samConfigModal.addEventListener('click', (e) => {
        if (e.target === samConfigModal) hideSamConfigModal();
    });
}
// Device radio change: toggle GPU index dropdown
document.querySelectorAll('input[name="samDevice"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const gpuGroup = document.getElementById('samGpuIndexGroup');
        if (e.target.value === 'gpu') {
            vscode.postMessage({ command: 'detectGpuCount' });
        } else if (gpuGroup) {
            gpuGroup.style.display = 'none';
        }
    });
});
// Enter/Escape in SAM config modal
const samModelDirInput_ = document.getElementById('samModelDir');
if (samModelDirInput_) {
    samModelDirInput_.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitSamConfig();
        if (e.key === 'Escape') hideSamConfigModal();
    });
}

// --- SAM Service Communication ---

// /encode and /decode require the shared token the extension passes to the
// service it launches (LABELEDITOR_SAM_TOKEN); /ping stays unauthenticated.
function samRequestHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-LabelEditor-Token': initialGlobalSettings.samAuthToken || ''
    };
}

async function samPingService() {
    try {
        const resp = await fetch(`http://127.0.0.1:${samServicePort}/ping`, { signal: AbortSignal.timeout(100) });
        const data = await resp.json();
        return data.ok === true;
    } catch {
        return false;
    }
}

// Ask the extension host to ping the SAM service on `port`. The extension is
// co-located with the service, so this is authoritative and works under
// remote-SSH, where the webview can't reach 127.0.0.1. Resolves false if the
// extension doesn't answer within the fallback window. The reply's port is
// validated so a late/stale response can't resolve a newer query.
let samRunningQueryResolver = null;
function samQueryExtensionRunning(port) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (val) => {
            if (done) return;
            done = true;
            samRunningQueryResolver = null;
            resolve(val);
        };
        samRunningQueryResolver = (running, replyPort) => {
            if (replyPort !== port) return; // ignore stale/mismatched replies
            finish(running);
        };
        vscode.postMessage({ command: 'samQueryRunning', port });
        // Fallback must exceed the extension-side ping timeout (1500ms) so the
        // real reply wins; only fires if the extension never answers.
        setTimeout(() => finish(false), 2500);
    });
}

let samEncodePromise = null; // Serialization chain for encode requests

// Adjustment signature: a stable string the cache can key on. Null when the
// toggle is off OR all adjustments are at defaults — both mean "encoding the
// raw original," and the server-side cache treats them as the same entry.
// Caveat: collapsing "Adjusted at defaults" to null assumes the processed
// canvas at defaults is byte-equivalent to cv2.imread of the source file.
// PNG re-encode is lossless, but exotic inputs (color-managed, EXIF-oriented,
// non-RGB color spaces) could drift; in practice not an issue for the formats
// this editor ingests.
function samCurrentAdjustSig() {
    if (!samEncodeAdjusted) return null;
    const atDefault = (brightness === 100) && (contrast === 100)
        && (selectedChannel === 'rgb') && !claheEnabled;
    if (atDefault) return null;
    const clip = claheEnabled ? Number(claheClipLimit).toFixed(2) : '0';
    return `b${brightness}|c${contrast}|ch${selectedChannel}|cl${claheEnabled ? 1 : 0}:${clip}`;
}

// Build a PNG (base64, no data: prefix) of the current adjusted view. Applies
// channel/CLAHE via the existing processed-canvas pipeline, then layers on
// brightness/contrast via Canvas2D `filter` so the pixels SAM sees match what
// the user sees on screen. Returns null if the source isn't ready or context
// can't be acquired — caller must treat null as an encode failure.
// Note: toDataURL is synchronous and can take several hundred ms on large
// images; acceptable here because it only runs on re-encode (rare), gated
// behind the "SAM Encoding…" notification.
function samBuildAdjustedPngB64() {
    const src = getProcessedCanvas();
    if (!src) return null;
    let pngCanvas = src;
    if (brightness !== 100 || contrast !== 100) {
        const tmp = document.createElement('canvas');
        tmp.width = src.width;
        tmp.height = src.height;
        const tctx = tmp.getContext('2d');
        if (!tctx) return null;
        tctx.filter = `brightness(${brightness / 100}) contrast(${contrast / 100})`;
        tctx.drawImage(src, 0, 0);
        pngCanvas = tmp;
    }
    const dataUrl = pngCanvas.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

// Calculate the current visible viewport region in original image coordinates
function samGetVisibleCrop() {
    const scrollX = canvasContainer.scrollLeft;
    const scrollY = canvasContainer.scrollTop;
    const viewportW = canvasContainer.clientWidth;
    const viewportH = canvasContainer.clientHeight;

    const imageW = img.width * zoomLevel;
    const imageH = img.height * zoomLevel;

    // If image fits in viewport (no scroll needed), return null (use full image)
    if (imageW <= viewportW && imageH <= viewportH) {
        return null;
    }

    // Calculate crop in original image coordinates
    // Store both integer bounds (for backend raster extraction) and true floating origin
    // (for accurate prompt/contour coordinate translation)
    const originX = scrollX / zoomLevel;
    const originY = scrollY / zoomLevel;

    let x = Math.floor(originX);
    let y = Math.floor(originY);
    let right = Math.ceil((scrollX + viewportW) / zoomLevel);
    let bottom = Math.ceil((scrollY + viewportH) / zoomLevel);

    // Clamp to image bounds
    x = Math.max(0, Math.min(x, img.width - 1));
    y = Math.max(0, Math.min(y, img.height - 1));
    right = Math.min(right, img.width);
    bottom = Math.min(bottom, img.height);

    let w = right - x;
    let h = bottom - y;

    return { x, y, w, h, originX, originY };
}

// Check if a point (in original image coords) falls within a crop region
function samPointInCrop(px, py, crop) {
    if (!crop) return true; // No crop = full image, always in range
    return px >= crop.originX && px <= crop.originX + crop.w &&
        py >= crop.originY && py <= crop.originY + crop.h;
}

async function samEncode(imagePath, crop, adjustSig) {
    // If an encode is already in flight, wait for it to finish, then re-check
    if (samEncodePromise) {
        await samEncodePromise;
        // After previous encode settled, check if cache matches
        if (samCurrentImagePath === imagePath &&
            JSON.stringify(samCachedCrop) === JSON.stringify(crop) &&
            samCachedAdjustSig === adjustSig) return;
    }

    const doEncode = async () => {
        samIsEncoding = true;
        const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k, p) => k;
        window.notifyBus.show('info', tt('status.samEncoding'), { sticky: true, key: 'sam.status' });
        try {
            const payload = { image_path: imagePath };
            if (crop) payload.crop = crop;
            // When an adjustment signature is active, send the rendered PNG so the
            // server encodes pixels matching what the user sees on screen.
            // If the PNG build fails we must abort — silently falling back to the
            // raw image would mark the cache as "adjusted" while it isn't.
            if (adjustSig) {
                const b64 = samBuildAdjustedPngB64();
                if (!b64) {
                    window.notifyBus.show('error', tt('status.samAdjEncodeError'));
                    window.notifyBus.clearSticky('sam.status');
                    return;
                }
                payload.image_b64 = b64;
                payload.adjust_sig = adjustSig;
            }

            const resp = await fetch(`http://127.0.0.1:${samServicePort}/encode`, {
                method: 'POST',
                headers: samRequestHeaders(),
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.ok) {
                samCurrentImagePath = imagePath;
                samCachedCrop = crop || null;
                samCachedAdjustSig = adjustSig || null;
                // Mode and adjust fragments are translatable too — without
                // this they appeared as "Local" / "Full" / "Adjusted" inside
                // an otherwise translated SAM-ready toast.
                const modeLabel = crop ? tt('sam.mode.local') : tt('sam.mode.full');
                const adjLabel = adjustSig ? ' • ' + tt('sam.mode.adjusted') : '';
                window.notifyBus.show('success', tt('status.samReady', { mode: modeLabel, adj: adjLabel, time: data.time_ms || 0 }), { sticky: true, key: 'sam.status' });
            } else {
                window.notifyBus.show('error', tt('status.samEncodeError'));
                window.notifyBus.clearSticky('sam.status');
            }
        } catch (err) {
            window.notifyBus.show('error', tt('status.samServiceError'));
            window.notifyBus.clearSticky('sam.status');
        } finally {
            samIsEncoding = false;
            samEncodePromise = null;
        }
    };

    samEncodePromise = doEncode();
    await samEncodePromise;
}

async function samDecode() {
    if (samPrompts.length === 0) return;

    // Capture version BEFORE any async work to detect state changes during encode
    const preEncodeVersion = samDecodeVersion;

    // Determine encode parameters based on mode
    const requestPath = currentAbsoluteImagePath || imagePath;
    let requestCrop = null;
    if (samEncodeMode === 'local') {
        requestCrop = samGetVisibleCrop(); // null if no scrollbars (falls back to full)
    }
    const requestAdjustSig = samCurrentAdjustSig();

    // Lazy encode: ensure current image is encoded before first decode
    // In local mode, also re-encode when:
    //   1. This is a fresh sequence AND the current viewport crop differs from cached
    //   2. Any prompt falls outside the existing cached crop (user scrolled away)
    // Independent of mode: re-encode when the image-adjustment signature changes.
    // For an in-progress local sequence, the crop check still has to run because
    // adopting a new viewport crop would orphan earlier prompts — we re-encode at
    // the cached crop instead so prompt coordinates stay valid.
    const adjustMismatched = (requestAdjustSig !== samCachedAdjustSig);
    let needEncode = (samCurrentImagePath !== requestPath);

    if (!needEncode && samEncodeMode === 'local') {
        const cropMismatched = JSON.stringify(requestCrop) !== JSON.stringify(samCachedCrop);

        if (samIsFreshSequence && cropMismatched) {
            // Fresh sequence: safe to adopt current viewport as new crop
            needEncode = true;
        } else {
            // Sequence in progress: stick to the existing cached crop to avoid orphaning old prompts.
            let promptsOutside = false;
            for (const prompt of samPrompts) {
                if (prompt.type === 'point') {
                    if (!samPointInCrop(prompt.data[0], prompt.data[1], samCachedCrop)) {
                        promptsOutside = true;
                        break;
                    }
                } else if (prompt.type === 'rectangle') {
                    if (!samPointInCrop(prompt.data[0], prompt.data[1], samCachedCrop) ||
                        !samPointInCrop(prompt.data[2], prompt.data[3], samCachedCrop)) {
                        promptsOutside = true;
                        break;
                    }
                }
            }

            if (promptsOutside) {
                needEncode = true;
            } else if (adjustMismatched) {
                // Adjustment changed mid-sequence and prompts still fit the cached
                // crop — re-encode at that same crop so coordinates remain valid.
                requestCrop = samCachedCrop;
                needEncode = true;
            }

            // If re-encoding is needed because prompts were outside, clear older prompts.
            if (promptsOutside) {
                samPrompts = [samPrompts[samPrompts.length - 1]]; // Keep only the latest prompt
                samMaskContour = null;
                samIsFreshSequence = true; // We are essentially starting over
                // Prompts mutated — refresh Shift feedback in case the routing
                // role flipped (e.g. trimmed away the only positive prompt).
                updateShiftFeedback();
            }
        }
    }

    // Full-mode adjust mismatch (or any unhandled case): force re-encode.
    if (!needEncode && adjustMismatched) {
        needEncode = true;
    }

    if (needEncode) {
        await samEncode(requestPath, requestCrop, requestAdjustSig);
        // After encode success/fail, reset fresh flag (it will be true again on clear/confirm)
        samIsFreshSequence = false;
        // After encode, revalidate: has the state been cleared or image changed?
        if (preEncodeVersion !== samDecodeVersion) return;
        const activePath = currentAbsoluteImagePath || imagePath;
        if (activePath !== requestPath) return;
        if (samCurrentImagePath !== requestPath) return;
        // If the user moved an adjustment slider during the encode, the cache is
        // already stale for what's on screen — bail and let the next click re-encode.
        if (samCurrentAdjustSig() !== samCachedAdjustSig) return;
    }

    // Translate prompt coordinates using floating origin if crop is active
    let decodedPrompts = samPrompts;
    if (samCachedCrop) {
        decodedPrompts = samPrompts.map(p => {
            if (p.type === 'point') {
                return { ...p, data: [p.data[0] - samCachedCrop.originX, p.data[1] - samCachedCrop.originY] };
            } else if (p.type === 'rectangle') {
                return {
                    ...p, data: [
                        p.data[0] - samCachedCrop.originX, p.data[1] - samCachedCrop.originY,
                        p.data[2] - samCachedCrop.originX, p.data[3] - samCachedCrop.originY
                    ]
                };
            }
            return p;
        });
    }

    // Capture version at request time to detect stale responses
    const requestVersion = ++samDecodeVersion;
    samIsDecoding = true;
    try {
        const resp = await fetch(`http://127.0.0.1:${samServicePort}/decode`, {
            method: 'POST',
            headers: samRequestHeaders(),
            body: JSON.stringify({ prompts: decodedPrompts })
        });
        const data = await resp.json();
        // Only apply if this is still the latest request
        if (requestVersion !== samDecodeVersion) return;
        if (data.ok) {
            // Translate contour coordinates back to full-image space using floating origin
            if (samCachedCrop && data.contour) {
                samMaskContour = data.contour.map(p => [p[0] + samCachedCrop.originX, p[1] + samCachedCrop.originY]);
            } else {
                samMaskContour = data.contour;
            }
            const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k, p) => k;
            const modeLabel = samCachedCrop ? tt('sam.mode.local') : tt('sam.mode.full');
            window.notifyBus.show('success', tt('status.samDecoded', { mode: modeLabel, time: data.time_ms || 0 }), { sticky: true, key: 'sam.status' });
            draw();
            // Note: don't call updateShiftFeedback here — samDecode doesn't
            // mutate samPrompts, so feedback content is unchanged. Calling it
            // would only clobber the decode status message during Shift hold.
        }
    } catch (err) {
        if (requestVersion !== samDecodeVersion) return;
        const tt = (window.i18n && window.i18n.t) ? window.i18n.t.bind(window.i18n) : (k) => k;
        window.notifyBus.show('error', tt('status.samDecodeError'));
    } finally {
        samIsDecoding = false;
    }
}

// --- SAM Mode Logic ---

function samClearState() {
    samDecodeVersion++;  // Invalidate any in-flight decode
    samPrompts = [];
    samMaskContour = null;
    samIsDragging = false;
    samDragStart = null;
    samDragCurrent = null;
    samBoxSecondClick = false;
    samMouseDownTime = 0;
    samCachedCrop = null;
    samCachedAdjustSig = null;
    samCurrentImagePath = null;
    samIsFreshSequence = true;
    if (window.notifyBus) window.notifyBus.clearSticky('sam.status');
    draw();
    updateShiftFeedback();
}

let samCheckInProgress = false;
async function samCheckAndEnterMode() {
    // Guard against re-entry: setMode('sam') fires this without awaiting, so a
    // rapid second SAM-mode click could overlap and race the single query
    // resolver. Ignore re-entrant calls while one check is already in flight.
    if (samCheckInProgress) return;
    samCheckInProgress = true;
    try {
        // Restore port and encode mode from saved state
        const savedState = vscode.getState() || {};
        const gs = (typeof initialGlobalSettings !== 'undefined') ? initialGlobalSettings : {};
        samServicePort = savedState.samPort ?? gs.samPort ?? 8765;
        samEncodeMode = savedState.samEncodeMode ?? gs.samEncodeMode ?? 'full';
        samEncodeAdjusted = !!(savedState.samEncodeAdjusted ?? gs.samEncodeAdjusted ?? false);

        // Ask the extension host to ping the service — an authoritative liveness
        // check that works under remote-SSH (see samQueryExtensionRunning). Enter
        // SAM mode if it's alive; otherwise show the config modal.
        const ok = await samQueryExtensionRunning(samServicePort);
        if (ok) {
            samServiceRunning = true;
            currentMode = 'sam';
            saveState();
            updateModeButtons();
            draw();
        } else {
            // Show config modal
            showSamConfigModal();
        }
    } finally {
        samCheckInProgress = false;
    }
}

function updateShiftFeedback() {
    if (!shiftPressed || currentMode === 'view') {
        if (window.notifyBus) window.notifyBus.clearSticky('shift.feedback');
        // Cursor reset: clear inline style and let the existing mousemove logic re-derive
        currentCursor = null;
        canvasWrapper.style.cursor = '';
        return;
    }

    // Positional signature: computeShiftFeedback(currentMode, prompts, eraserCursor) → { text, color, cursor }
    const { text, color, cursor } = computeShiftFeedback(currentMode, samPrompts, ERASER_CURSOR_DATA_URI);

    canvasWrapper.style.cursor = cursor;
    currentCursor = cursor;

    // Map the legacy hex colors to severity. #ff4444 is the negative-point hint
    // (treat as warn — informational caution, not an error), #ff8800 the eraser
    // hint. Anything else falls back to info.
    const level = color === '#ff4444' ? 'warn' : (color === '#ff8800' ? 'warn' : 'info');
    if (window.notifyBus) window.notifyBus.show(level, text, { sticky: true, key: 'shift.feedback' });
}

function samUndoLastPrompt() {
    if (samPrompts.length > 0) {
        samPrompts.pop();
        samPrompts = cleanupOrphanNegatives(samPrompts);
        if (samPrompts.length === 0) {
            samDecodeVersion++;  // Invalidate any in-flight decode
            samMaskContour = null;
            samCachedCrop = null;
            samCachedAdjustSig = null;
            samCurrentImagePath = null;
            samIsFreshSequence = true;
            draw();
        } else {
            samDecode();
        }
    }
    updateShiftFeedback();
}

let samSavedStateBeforeConfirm = null; // For restoring on modal cancel

function samConfirmAnnotation() {
    if (!samMaskContour || samMaskContour.length < 3) return;

    // Save SAM state so we can restore if user cancels the label modal
    samSavedStateBeforeConfirm = {
        prompts: JSON.parse(JSON.stringify(samPrompts)),
        maskContour: JSON.parse(JSON.stringify(samMaskContour)),
        cachedCrop: samCachedCrop ? JSON.parse(JSON.stringify(samCachedCrop)) : null,
        cachedAdjustSig: samCachedAdjustSig,
        isFreshSequence: samIsFreshSequence,
        currentImagePath: samCurrentImagePath
    };

    // Convert mask contour to polygon points (or bbox rect if output format is rectangle)
    if (samOutputFormat === 'rectangle') {
        const rect = contourToBBoxRect(samMaskContour);
        currentPoints = rect ? rect : samMaskContour.map(p => [p[0], p[1]]);
    } else {
        currentPoints = samMaskContour.map(p => [p[0], p[1]]);
    }
    currentMode = 'sam'; // Stay in SAM mode

    // Clear SAM prompt state but keep service running
    samPrompts = [];
    samMaskContour = null;
    samIsDragging = false;
    samDragStart = null;
    samDragCurrent = null;
    samCachedCrop = null;
    samCachedAdjustSig = null;
    samCurrentImagePath = null;
    samIsFreshSequence = true;

    // Show label modal (same as finishPolygon)
    isDrawing = false;
    updateShiftFeedback();
    showLabelModal();
}

// --- SAM Mouse Events ---

let samClickTimer = null; // Timer to debounce single-click vs double-click
let samPendingClick = null; // Pending click data

// SAM mousedown handler (integrate into existing canvasWrapper mousedown)
canvasWrapper.addEventListener('mousedown', (e) => {
    if (currentMode !== 'sam' || e.button !== 0) return;

    // Skip if event was already consumed by another capture-phase handler (e.g. edit mode exit)
    if (e.defaultPrevented) return;

    // Defer to the main handler when the eraser owns the click stream
    // (eraser mid-draw, or shift+empty starting a new eraser).
    if (samShouldDeferToMainHandler({
        shiftKey: e.shiftKey,
        eraserActive,
        samBoxSecondClick,
        prompts: samPrompts
    })) {
        return;
    }

    // If click is on the context menu itself, let it handle the click
    if (shapeContextMenu && shapeContextMenu.contains(e.target)) {
        return;
    }

    // If context menu is visible and click is outside it, hide it and consume the event
    // so it doesn't start a SAM annotation
    if (shapeContextMenu && shapeContextMenu.style.display !== 'none') {
        hideShapeContextMenu();
        e.stopPropagation();
        e.preventDefault();
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomLevel;
    const y = (e.clientY - rect.top) / zoomLevel;

    // If waiting for second click to complete box, finalize the box
    if (samBoxSecondClick) {
        if (!samDragStart) {
            // Guard: samDragStart was cleared (e.g. by image navigation)
            samBoxSecondClick = false;
            samIsDragging = false;
            return;
        }
        // Clamp both corners to image bounds — the cursor may have ended up in the padding ring.
        const [cx, cy] = clampImageCoords(x, y);
        const [csx, csy] = clampImageCoords(samDragStart.x, samDragStart.y);
        const x1 = Math.min(csx, cx);
        const y1 = Math.min(csy, cy);
        const x2 = Math.max(csx, cx);
        const y2 = Math.max(csy, cy);

        samPrompts = mergeBoxIntoPrompts(samPrompts, { type: 'rectangle', data: [x1, y1, x2, y2] });
        samBoxSecondClick = false;
        samDragStart = null;
        samDragCurrent = null;
        samIsDragging = false;
        draw();
        updateShiftFeedback();
        samDecode();
        e.stopPropagation();
        e.preventDefault();
        return;
    }

    // If SAM is idle (no prompts, no mask, no pending click), check if clicking
    // on an existing shape. If so, let the main mousedown handler select it.
    if (samPrompts.length === 0 && !samMaskContour && !samPendingClick && !samClickTimer
        && allowSelectByClick('sam', drawClickThrough)) {
        const overlappingShapes = findAllShapesAt(x, y);
        if (overlappingShapes.length > 0) {
            return; // Don't stopPropagation — main handler will select the shape
        }
    }

    // Clear any existing shape selection since we're starting SAM interaction
    if (selectedShapeIndices.size > 0) {
        clearSelection();
        renderShapeList();
        draw();
    }

    // Record drag start and time for long-press detection
    samIsDragging = false;
    samDragStart = { x, y };
    samDragCurrent = { x, y };
    samMouseDownTime = Date.now();

    e.stopPropagation();
    e.preventDefault();
}, true); // Use capture phase to run before main mousedown handler

canvasWrapper.addEventListener('mousemove', (e) => {
    if (currentMode !== 'sam' || !samDragStart) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomLevel;
    const y = (e.clientY - rect.top) / zoomLevel;

    // Box mode waiting for second click: update preview
    if (samBoxSecondClick) {
        samDragCurrent = { x, y };
        scheduleDraw(e);
        return;
    }

    // Initial drag detection
    const dx = x - samDragStart.x;
    const dy = y - samDragStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > SAM_DRAG_THRESHOLD) {
        samIsDragging = true;
        samDragCurrent = { x, y };
        // Draw drag rectangle preview
        scheduleDraw(e);
    }
});

canvasWrapper.addEventListener('mouseup', (e) => {
    if (currentMode !== 'sam' || e.button !== 0 || !samDragStart) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomLevel;
    const y = (e.clientY - rect.top) / zoomLevel;

    const elapsed = Date.now() - samMouseDownTime;
    const isLongPress = elapsed >= SAM_LONG_PRESS_MS;

    if (samIsDragging || isLongPress) {
        // Long press or drag: enter box mode, wait for second click
        samBoxSecondClick = true;
        samDragCurrent = { x, y };
        samIsDragging = true; // Ensure drag preview shows
        draw();
    } else {
        // Click (not drag): defer to distinguish from double-click
        const shiftKey = e.shiftKey;
        samDragStart = null;
        samDragCurrent = null;

        // Cancel any pending click timer
        if (samClickTimer) {
            clearTimeout(samClickTimer);
            samClickTimer = null;
        }

        // Store pending click; process after 200ms if no dblclick fires
        samPendingClick = { x, y, shiftKey };
        samClickTimer = setTimeout(() => {
            if (samPendingClick) {
                const label = samPendingClick.shiftKey ? 0 : 1;
                const [spx, spy] = clampImageCoords(samPendingClick.x, samPendingClick.y);
                samPrompts.push({ type: 'point', data: [spx, spy], label: label });
                samPendingClick = null;
                draw();
                updateShiftFeedback();
                samDecode();
            }
            samClickTimer = null;
        }, 200);
    }

    e.stopPropagation();
    e.preventDefault();
});

// SAM double-click to confirm
canvasWrapper.addEventListener('dblclick', (e) => {
    if (currentMode !== 'sam' || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Cancel pending single-click timer to prevent adding unwanted point
    if (samClickTimer) {
        clearTimeout(samClickTimer);
        samClickTimer = null;
        samPendingClick = null;
    }

    samConfirmAnnotation();
});

// SAM mode button click
if (samModeBtn) {
    samModeBtn.addEventListener('click', () => setMode('sam'));
}

// When the image changes, drop SAM prompts and any pending click (encoder
// cache is refreshed lazily on the next interaction). Called from
// handleImageUpdate.
function samResetForNewImage() {
    // A click on the old image whose 200 ms single-click timer hasn't fired
    // yet would otherwise add a prompt to — and decode on — the new image.
    if (samClickTimer) {
        clearTimeout(samClickTimer);
        samClickTimer = null;
    }
    samPendingClick = null;
    if (currentMode === 'sam') {
        samDecodeVersion++;  // Invalidate any in-flight decode
        samPrompts = [];
        samMaskContour = null;
        samIsDragging = false;
        samDragStart = null;
        samDragCurrent = null;
        samBoxSecondClick = false;
        samMouseDownTime = 0;
        samCachedCrop = null;
        samCachedAdjustSig = null;
        // Clear samCurrentImagePath so lazy encode triggers on next interaction
        samCurrentImagePath = null;
        updateShiftFeedback();
    }
}

// --- SAM SVG Drawing ---

function drawSAMOverlay() {
    const sw = borderWidth / zoomLevel; // Scale-independent stroke width

    // Draw mask contour
    if (samMaskContour && samMaskContour.length >= 3) {
        let previewPoints = samMaskContour;
        if (samOutputFormat === 'rectangle') {
            const rect = contourToBBoxRect(samMaskContour);
            if (rect) previewPoints = getRectPoints(rect); // expand 2-point bbox to 4 corners
        }
        const polygon = document.createElementNS(SVG_NS, 'polygon');
        const pointsStr = previewPoints.map(p => `${p[0]},${p[1]}`).join(' ');
        polygon.setAttribute('points', pointsStr);
        polygon.setAttribute('fill', 'rgba(30, 144, 255, 0.35)');
        polygon.setAttribute('stroke', 'rgba(30, 144, 255, 0.9)');
        polygon.setAttribute('stroke-width', sw * 1.5);
        polygon.style.pointerEvents = 'none';
        svgOverlay.appendChild(polygon);
    }

    // Draw prompts
    samPrompts.forEach(prompt => {
        if (prompt.type === 'point') {
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', prompt.data[0]);
            circle.setAttribute('cy', prompt.data[1]);
            circle.setAttribute('r', 6 / zoomLevel);
            if (prompt.label === 1) {
                // Positive: green
                circle.setAttribute('fill', 'rgba(0, 255, 0, 0.8)');
                circle.setAttribute('stroke', 'white');
            } else {
                // Negative: red
                circle.setAttribute('fill', 'rgba(255, 0, 0, 0.8)');
                circle.setAttribute('stroke', 'white');
            }
            circle.setAttribute('stroke-width', sw * 0.5);
            circle.style.pointerEvents = 'none';
            svgOverlay.appendChild(circle);
        } else if (prompt.type === 'rectangle') {
            const [x1, y1, x2, y2] = prompt.data;
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', x1);
            rect.setAttribute('y', y1);
            rect.setAttribute('width', x2 - x1);
            rect.setAttribute('height', y2 - y1);
            rect.setAttribute('fill', 'rgba(0, 200, 0, 0.1)');
            rect.setAttribute('stroke', 'rgba(0, 200, 0, 0.8)');
            rect.setAttribute('stroke-width', sw);
            rect.setAttribute('stroke-dasharray', `${4 / zoomLevel}`);
            rect.style.pointerEvents = 'none';
            svgOverlay.appendChild(rect);
        }
    });

    // Draw drag-in-progress rectangle
    if (samIsDragging && samDragStart && samDragCurrent) {
        const x1 = Math.min(samDragStart.x, samDragCurrent.x);
        const y1 = Math.min(samDragStart.y, samDragCurrent.y);
        const x2 = Math.max(samDragStart.x, samDragCurrent.x);
        const y2 = Math.max(samDragStart.y, samDragCurrent.y);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x1);
        rect.setAttribute('y', y1);
        rect.setAttribute('width', x2 - x1);
        rect.setAttribute('height', y2 - y1);
        rect.setAttribute('fill', 'rgba(0, 200, 0, 0.1)');
        rect.setAttribute('stroke', 'rgba(0, 200, 0, 0.8)');
        rect.setAttribute('stroke-width', sw);
        rect.setAttribute('stroke-dasharray', `${4 / zoomLevel}`);
        rect.style.pointerEvents = 'none';
        svgOverlay.appendChild(rect);
    }

    // Draw encoded region indicator in local mode
    if (samCachedCrop && samEncodeMode === 'local') {
        const cropRect = document.createElementNS(SVG_NS, 'rect');
        cropRect.setAttribute('x', samCachedCrop.x);
        cropRect.setAttribute('y', samCachedCrop.y);
        cropRect.setAttribute('width', samCachedCrop.w);
        cropRect.setAttribute('height', samCachedCrop.h);
        cropRect.setAttribute('fill', 'none');
        cropRect.setAttribute('stroke', 'rgba(255, 200, 0, 0.5)');
        cropRect.setAttribute('stroke-width', sw);
        cropRect.setAttribute('stroke-dasharray', `${6 / zoomLevel} ${3 / zoomLevel}`);
        cropRect.style.pointerEvents = 'none';
        svgOverlay.appendChild(cropRect);
    }

    // Status indicator
    if (samIsEncoding) {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', 10 / zoomLevel);
        text.setAttribute('y', 30 / zoomLevel);
        text.setAttribute('font-size', `${16 / zoomLevel}px`);
        text.setAttribute('fill', 'orange');
        text.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('status.samEncodingShort') : 'Encoding...';
        text.style.pointerEvents = 'none';
        svgOverlay.appendChild(text);
    }
}
