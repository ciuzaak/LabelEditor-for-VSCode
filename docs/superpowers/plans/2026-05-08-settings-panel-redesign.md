# Settings Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the editor's settings dropdown into 4 labeled groups (Theme / View / Annotation Style / Image Adjustment), convert the Channel selector to a native radio group with a lock button, and convert the CLAHE control to an explicit Off/On toggle with a conditional clip-limit slider.

**Architecture:** Three sequential changes, each leaving a working build. Task 1 reshapes the dropdown structure (group headers + reordering) without touching individual control behavior. Task 2 swaps the Channel button group for radio inputs + activates the previously-dead lock button. Task 3 replaces the CLAHE slider's implicit auto-enable with an explicit toggle button + conditional UI region.

**Tech Stack:** Plain JS in `media/main.js`, plain CSS in `media/style.css`, settings dropdown HTML lives inside a TypeScript template literal in `src/LabelMePanel.ts`.

**Spec:** [`docs/superpowers/specs/2026-05-08-settings-panel-redesign-design.md`](../specs/2026-05-08-settings-panel-redesign-design.md)

---

## File Structure

| Path | Touched in | Responsibility |
|---|---|---|
| `media/style.css` | T1 | New `.settings-group-header` rule |
| `src/LabelMePanel.ts` | T1, T2, T3 | Settings dropdown HTML — group headers, reordering, channel radio, CLAHE toggle |
| `media/main.js` | T2, T3 | Channel radio handlers; CLAHE toggle handler + conditional UI sync |

---

### Task 1: Restructure settings dropdown — group headers + reordering

**Files:**
- Modify: `media/style.css` (append at end)
- Modify: `src/LabelMePanel.ts:782-836` (settings dropdown HTML)

- [ ] **Step 1: Add `.settings-group-header` CSS rule**

Append to the end of `media/style.css`:

```css

.settings-group-header {
    font-size: 0.75em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    letter-spacing: 0.5px;
    margin: 10px 0 4px 0;
    padding: 0 4px;
    border-bottom: 1px solid var(--color-border);
}

.settings-group-header:first-child {
    margin-top: 0;
}
```

- [ ] **Step 2: Replace the settings dropdown body with the regrouped structure**

In `src/LabelMePanel.ts`, locate the block opened by `<div id="settingsMenuDropdown" ...>` (around line 782) and closed by its matching `</div>` (around line 836). Replace its inner contents — but keep the opening `<div id="settingsMenuDropdown" class="sidebar-dropdown" style="display: none;">` line and the matching closing `</div>` — with this body:

```html
                                    <div class="settings-group-header">Theme</div>
                                    <div class="theme-control">
                                        <label>Theme</label>
                                        <div class="theme-toggle-group">
                                            <button id="themeLightBtn" class="theme-btn" title="Light">☀️</button>
                                            <button id="themeDarkBtn" class="theme-btn" title="Dark">🌙</button>
                                            <button id="themeAutoBtn" class="theme-btn" title="Follow VS Code">🔄</button>
                                        </div>
                                    </div>
                                    <div class="settings-group-header">View</div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Zoom: <span id="zoomPercentage">100%</span> <span id="zoomResetBtn" class="slider-reset-btn" title="Reset zoom to fit screen">&#8634;</span></label>
                                            <button id="zoomLockBtn" class="zoom-lock-btn" title="Lock: Keep zoom and position when switching images">🔓</button>
                                        </div>
                                    </div>
                                    <div class="settings-group-header">Annotation Style</div>
                                    <div class="slider-control">
                                        <label>Border Width: <span id="borderWidthValue">2</span>px <span id="borderWidthResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                        <input type="range" id="borderWidthSlider" min="1" max="5" value="2" step="0.5">
                                    </div>
                                    <div class="slider-control">
                                        <label>Fill Opacity: <span id="fillOpacityValue">30</span>% <span id="fillOpacityResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                        <input type="range" id="fillOpacitySlider" min="0" max="100" value="30" step="5">
                                    </div>
                                    <div class="settings-group-header">Image Adjustment</div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Channel:</label>
                                            <button id="channelRgbBtn" class="channel-btn active" title="RGB (All Channels)">RGB</button>
                                            <button id="channelRBtn" class="channel-btn" title="Red Channel Only">R</button>
                                            <button id="channelGBtn" class="channel-btn" title="Green Channel Only">G</button>
                                            <button id="channelBBtn" class="channel-btn" title="Blue Channel Only">B</button>
                                        </div>
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Brightness: <span id="brightnessValue">100</span>% <span id="brightnessResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                            <button id="brightnessLockBtn" class="zoom-lock-btn" title="Unlock: Reset on each image. Click to lock.">🔓</button>
                                        </div>
                                        <input type="range" id="brightnessSlider" min="10" max="300" value="100" step="5">
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Contrast: <span id="contrastValue">100</span>% <span id="contrastResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                            <button id="contrastLockBtn" class="zoom-lock-btn" title="Unlock: Reset on each image. Click to lock.">🔓</button>
                                        </div>
                                        <input type="range" id="contrastSlider" min="10" max="300" value="100" step="5">
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>CLAHE: <span id="claheValue">Off</span> <span id="claheResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                            <button id="claheLockBtn" class="zoom-lock-btn" title="Unlock: Reset on each image. Click to lock.">🔓</button>
                                        </div>
                                        <input type="range" id="claheClipLimitSlider" min="1" max="10" value="2" step="0.5" title="Clip Limit">
                                        <div style="font-size: 0.8em; margin-top: 4px;">Clip Limit: <span id="claheClipLimitValue">2.0</span></div>
                                    </div>
```

(Indentation: 36 spaces for top-level children of `#settingsMenuDropdown`.)

The Channel and CLAHE blocks are still the original (unchanged) inner HTML — Tasks 2 and 3 replace them. This task only reorders + adds group headers.

- [ ] **Step 3: Compile**

Run: `npm run compile`
Expected: exits 0.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add media/style.css src/LabelMePanel.ts
git commit -m "Reorganize settings dropdown into Theme/View/Annotation Style/Image Adjustment groups"
```

---

### Task 2: Channel selector — radio inputs + lock button

**Files:**
- Modify: `src/LabelMePanel.ts` (Channel block inside settings dropdown — landed in Task 1 around the "Image Adjustment" header)
- Modify: `media/main.js` — multiple regions described per step

- [ ] **Step 1: Replace the Channel HTML block**

In `src/LabelMePanel.ts`, find the Channel block (post-Task-1) and replace it with the radio version:

Old:
```html
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Channel:</label>
                                            <button id="channelRgbBtn" class="channel-btn active" title="RGB (All Channels)">RGB</button>
                                            <button id="channelRBtn" class="channel-btn" title="Red Channel Only">R</button>
                                            <button id="channelGBtn" class="channel-btn" title="Green Channel Only">G</button>
                                            <button id="channelBBtn" class="channel-btn" title="Blue Channel Only">B</button>
                                        </div>
                                    </div>
```

New:
```html
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Channel:</label>
                                            <button id="channelLockBtn" class="zoom-lock-btn" title="Unlock: Reset on each image. Click to lock.">🔓</button>
                                        </div>
                                        <div class="onnx-radio-group">
                                            <label class="onnx-radio"><input type="radio" name="imageChannel" value="rgb" checked /> RGB</label>
                                            <label class="onnx-radio"><input type="radio" name="imageChannel" value="r" /> R</label>
                                            <label class="onnx-radio"><input type="radio" name="imageChannel" value="g" /> G</label>
                                            <label class="onnx-radio"><input type="radio" name="imageChannel" value="b" /> B</label>
                                        </div>
                                    </div>
```

- [ ] **Step 2: Replace channel button refs and `updateChannelButtons` in `media/main.js`**

In `media/main.js`, locate the block at lines ~366-378:

Old:
```javascript
// Initialize channel buttons
const channelRgbBtn = document.getElementById('channelRgbBtn');
const channelRBtn = document.getElementById('channelRBtn');
const channelGBtn = document.getElementById('channelGBtn');
const channelBBtn = document.getElementById('channelBBtn');

function updateChannelButtons() {
    if (channelRgbBtn) channelRgbBtn.classList.toggle('active', selectedChannel === 'rgb');
    if (channelRBtn) channelRBtn.classList.toggle('active', selectedChannel === 'r');
    if (channelGBtn) channelGBtn.classList.toggle('active', selectedChannel === 'g');
    if (channelBBtn) channelBBtn.classList.toggle('active', selectedChannel === 'b');
}
updateChannelButtons();
```

New:
```javascript
// Initialize channel radios
const channelRadios = document.querySelectorAll('input[name="imageChannel"]');

function updateChannelRadios() {
    channelRadios.forEach(r => { r.checked = r.value === selectedChannel; });
}
updateChannelRadios();
```

- [ ] **Step 3: Replace the four `channelXxxBtn.onclick` blocks with radio change listeners**

In `media/main.js`, locate the block at lines ~5175-5210 (the four Channel onclick handlers). Replace it with:

Old:
```javascript
// Channel button event handlers
if (channelRgbBtn) {
    channelRgbBtn.onclick = () => {
        selectedChannel = 'rgb';
        updateChannelButtons();
        draw();
        saveGlobalSettings('selectedChannel', selectedChannel);
    };
}

if (channelRBtn) {
    channelRBtn.onclick = () => {
        selectedChannel = 'r';
        updateChannelButtons();
        draw();
        saveGlobalSettings('selectedChannel', selectedChannel);
    };
}

if (channelGBtn) {
    channelGBtn.onclick = () => {
        selectedChannel = 'g';
        updateChannelButtons();
        draw();
        saveGlobalSettings('selectedChannel', selectedChannel);
    };
}

if (channelBBtn) {
    channelBBtn.onclick = () => {
        selectedChannel = 'b';
        updateChannelButtons();
        draw();
        saveGlobalSettings('selectedChannel', selectedChannel);
    };
}
```

New:
```javascript
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
```

- [ ] **Step 4: Update `handleImageUpdate`'s channel reset path**

In `media/main.js`, locate line ~1108 in `handleImageUpdate`:

Old:
```javascript
    if (!channelLocked) {
        selectedChannel = 'rgb';
        updateChannelButtons();
        saveGlobalSettings('selectedChannel', selectedChannel);
    }
```

New:
```javascript
    if (!channelLocked) {
        selectedChannel = 'rgb';
        updateChannelRadios();
        saveGlobalSettings('selectedChannel', selectedChannel);
    }
```

- [ ] **Step 5: Verify no stale references remain**

Run: Use Grep tool with pattern `channelRgbBtn|channelRBtn|channelGBtn|channelBBtn|updateChannelButtons` against `media/main.js`.
Expected: no matches.

- [ ] **Step 6: Compile**

Run: `npm run compile`
Expected: exits 0.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: 5 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/LabelMePanel.ts media/main.js
git commit -m "Convert channel selector to native radio group and wire up lock button"
```

---

### Task 3: CLAHE — Off/On toggle + conditional clip-limit slider

**Files:**
- Modify: `src/LabelMePanel.ts` (CLAHE block in settings dropdown)
- Modify: `media/main.js` — multiple regions

- [ ] **Step 1: Replace the CLAHE HTML block**

In `src/LabelMePanel.ts`, find the CLAHE block (the last `<div class="zoom-control">` inside Image Adjustment) and replace it:

Old:
```html
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>CLAHE: <span id="claheValue">Off</span> <span id="claheResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                            <button id="claheLockBtn" class="zoom-lock-btn" title="Unlock: Reset on each image. Click to lock.">🔓</button>
                                        </div>
                                        <input type="range" id="claheClipLimitSlider" min="1" max="10" value="2" step="0.5" title="Clip Limit">
                                        <div style="font-size: 0.8em; margin-top: 4px;">Clip Limit: <span id="claheClipLimitValue">2.0</span></div>
                                    </div>
```

New:
```html
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>CLAHE:</label>
                                            <button id="claheToggleBtn" class="channel-btn" title="Click to enable">Off</button>
                                            <span id="claheResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span>
                                            <button id="claheLockBtn" class="zoom-lock-btn" title="Unlock: Reset on each image. Click to lock.">🔓</button>
                                        </div>
                                        <div id="claheControls" style="display: none;">
                                            <div style="font-size: 0.8em; margin-top: 4px;">Clip Limit: <span id="claheClipLimitValue">2.0</span></div>
                                            <input type="range" id="claheClipLimitSlider" min="1" max="10" value="2" step="0.5" title="Clip Limit">
                                        </div>
                                    </div>
```

- [ ] **Step 2: Replace CLAHE element refs + init in `media/main.js`**

In `media/main.js`, locate lines ~380-394 (CLAHE controls init):

Old:
```javascript
// Initialize CLAHE controls
const claheClipLimitSlider = document.getElementById('claheClipLimitSlider');
const claheClipLimitValue = document.getElementById('claheClipLimitValue');
const claheValue = document.getElementById('claheValue');
const claheResetBtn = document.getElementById('claheResetBtn');
const claheLockBtn = document.getElementById('claheLockBtn');

if (claheClipLimitSlider && claheClipLimitValue) {
    claheClipLimitSlider.value = claheClipLimit;
    claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
}
if (claheValue) {
    claheValue.textContent = claheEnabled ? 'On' : 'Off';
}
```

New:
```javascript
// Initialize CLAHE controls
const claheClipLimitSlider = document.getElementById('claheClipLimitSlider');
const claheClipLimitValue = document.getElementById('claheClipLimitValue');
const claheToggleBtn = document.getElementById('claheToggleBtn');
const claheControls = document.getElementById('claheControls');
const claheResetBtn = document.getElementById('claheResetBtn');
const claheLockBtn = document.getElementById('claheLockBtn');

if (claheClipLimitSlider && claheClipLimitValue) {
    claheClipLimitSlider.value = claheClipLimit;
    claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
}

function updateClaheToggleUI() {
    if (claheToggleBtn) {
        claheToggleBtn.textContent = claheEnabled ? 'On' : 'Off';
        claheToggleBtn.classList.toggle('active', claheEnabled);
    }
    if (claheControls) {
        claheControls.style.display = claheEnabled ? '' : 'none';
    }
}
updateClaheToggleUI();
```

- [ ] **Step 3: Replace the CLAHE clip-limit slider handler — drop auto-enable**

In `media/main.js`, locate the slider handler (lines ~5212-5228):

Old:
```javascript
// CLAHE clip limit slider
if (claheClipLimitSlider) {
    claheClipLimitSlider.oninput = (e) => {
        claheClipLimit = parseFloat(e.target.value);
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        if (!claheEnabled) {
            claheEnabled = true;
            if (claheValue) claheValue.textContent = 'On';
        }
        updateClaheResetBtn();
        draw();
    };
    claheClipLimitSlider.onchange = () => {
        saveGlobalSettings('claheClipLimit', claheClipLimit);
        saveGlobalSettings('claheEnabled', claheEnabled);
    };
}
```

New:
```javascript
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
```

- [ ] **Step 4: Update CLAHE reset button — clear enabled and limit, drop `claheValue`**

In `media/main.js`, locate the reset handler (lines ~5230-5243):

Old:
```javascript
// CLAHE reset button
if (claheResetBtn) {
    claheResetBtn.onclick = () => {
        claheEnabled = false;
        claheClipLimit = 2.0;
        if (claheClipLimitSlider) claheClipLimitSlider.value = claheClipLimit;
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        if (claheValue) claheValue.textContent = 'Off';
        updateClaheResetBtn();
        draw();
        saveGlobalSettings('claheEnabled', claheEnabled);
        saveGlobalSettings('claheClipLimit', claheClipLimit);
    };
}
```

New:
```javascript
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
```

- [ ] **Step 5: Update `handleImageUpdate`'s CLAHE reset path — drop `claheValue`, add `updateClaheToggleUI`**

In `media/main.js`, locate the CLAHE reset block in `handleImageUpdate` (lines ~1111-1120):

Old:
```javascript
    if (!claheLocked) {
        claheEnabled = false;
        claheClipLimit = 2.0;
        if (claheClipLimitSlider) claheClipLimitSlider.value = claheClipLimit;
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        if (claheValue) claheValue.textContent = 'Off';
        updateClaheResetBtn();
        saveGlobalSettings('claheEnabled', claheEnabled);
        saveGlobalSettings('claheClipLimit', claheClipLimit);
    }
```

New:
```javascript
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
```

- [ ] **Step 6: Verify no stale references remain**

Run: Use Grep tool with pattern `claheValue` against `media/main.js`.
Expected: no matches.

- [ ] **Step 7: Compile**

Run: `npm run compile`
Expected: exits 0.

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: 5 tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/LabelMePanel.ts media/main.js
git commit -m "Replace CLAHE auto-enable slider with explicit Off/On toggle and conditional controls"
```

---

### Task 4: Final verification

**Files:** None.

- [ ] **Step 1: Final compile + test**

Run: `npm run compile && npm test`
Expected: compile exits 0; 5 tests pass.

- [ ] **Step 2: Cumulative diff sanity check**

Run: `git log --oneline pr-1-original..HEAD`
Expected: 4 commits from earlier PR fix work + 4 new commits from this redesign (design doc, T1, T2, T3).

Run: `git diff pr-1-original -- src/LabelMePanel.ts media/main.js media/style.css`
Read the output and verify:
- `src/LabelMePanel.ts`: settings dropdown reorganized; Channel block uses radio; CLAHE block uses toggle + conditional controls
- `media/main.js`: no remaining `channelXxxBtn` refs, no `claheValue` ref, `updateChannelRadios` and `updateClaheToggleUI` defined and called
- `media/style.css`: `.settings-group-header` rule added

- [ ] **Step 3: Document manual verification list for user**

Report to the user that the following must be tested in VSCode Extension Development Host:
1. Settings dropdown shows 4 labeled groups in order: **Theme**, **View**, **Annotation Style**, **Image Adjustment**.
2. Channel: 4 native radio inputs; selecting any one changes rendering; lock button toggles 🔓 ↔ 🔒; with lock on, switching images keeps the channel.
3. CLAHE: Off/On toggle button; clip-limit slider hidden when Off, visible when On; reset returns to Off + 2.0 in one click; lock keeps both state and value across image switches.
4. Other controls (Zoom, Brightness, Contrast, Border Width, Fill Opacity, Theme) behave as before.
