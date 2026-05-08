# Settings Panel Redesign — Design

**Date**: 2026-05-08
**Branch**: `pr-1-fixed`
**Predecessor**: PR #1 fix (channel selection + CLAHE) on the same branch

## Goal

Three UI improvements to the settings dropdown introduced by PR #1 (now corrected on `pr-1-fixed`):

1. Channel selector becomes a native `<input type="radio">` group with a working lock button (the source PR added lock state to JS but never added the HTML button).
2. CLAHE control becomes an explicit `Off/On` toggle with the clip-limit slider only visible when on. The lock button locks both the on/off state and the clip-limit value.
3. The settings dropdown gets four labeled groups in a fixed order. Items inside each group are reordered for usability.

## Non-goals

- Not changing globalState field names (`selectedChannel` / `claheEnabled` / `claheClipLimit` / `claheLocked` stay).
- Not introducing collapsible groups (text headers only).
- Not adding a Theme lock (Theme is global, no per-image notion).
- Not touching brightness, contrast, border-width, or fill-opacity behavior.
- Not touching the ONNX or other modals.

## Design

### File touch list

| Path | Action | Responsibility |
|---|---|---|
| `src/LabelMePanel.ts` | Modify | Rewrite the `#settingsMenuDropdown` block: add 4 group headers, reorder items, replace channel button group with radio group + lock button, replace CLAHE slider-auto-enable with explicit toggle button + conditional controls |
| `media/style.css` | Modify | Add `.settings-group-header` rule |
| `media/main.js` | Modify | Replace 4 channel button onclick handlers with one radio `change` listener; replace CLAHE slider's auto-enable behavior with explicit toggle button handler; update reset to also clear `claheEnabled` |

No new files.

### Final settings panel structure

```
── Theme ──
  [☀️] [🌙] [🔄]

── View ──
  Zoom: 100% ↻              🔓

── Annotation Style ──
  Border Width: 2px ↻
  [─────slider─────]
  Fill Opacity: 30% ↻
  [─────slider─────]

── Image Adjustment ──
  Channel:                  🔓
    (●) RGB  ( ) R  ( ) G  ( ) B
  Brightness: 100% ↻        🔓
  [─────slider─────]
  Contrast: 100% ↻          🔓
  [─────slider─────]
  CLAHE: [Off] ↻            🔓
  // slider/limit hidden until On:
  Clip Limit: 2.0
  [─────slider─────]
```

Group order rationale: Theme is a one-time set-and-forget, top of menu for discoverability. View (Zoom) sits next as it positions what you see. Annotation Style above Image Adjustment because annotation tweaks are more frequent during a labeling session. Image Adjustment (the heaviest cluster, with Channel/Brightness/Contrast/CLAHE) sits at the bottom; within it Channel comes first because it gates what gets adjusted.

### Channel selector

HTML — replaces the current 4-button block:

```html
<div class="zoom-control">
    <div class="zoom-header">
        <label>Channel:</label>
        <button id="channelLockBtn" class="zoom-lock-btn"
                title="Unlock: Reset on each image. Click to lock.">🔓</button>
    </div>
    <div class="onnx-radio-group">
        <label class="onnx-radio"><input type="radio" name="imageChannel" value="rgb" checked /> RGB</label>
        <label class="onnx-radio"><input type="radio" name="imageChannel" value="r" /> R</label>
        <label class="onnx-radio"><input type="radio" name="imageChannel" value="g" /> G</label>
        <label class="onnx-radio"><input type="radio" name="imageChannel" value="b" /> B</label>
    </div>
</div>
```

`.onnx-radio-group` / `.onnx-radio` are reused as-is. The names carry an ONNX prefix for historical reasons but the rules are generic radio styling — using them here saves a CSS dup.

The lock button HTML is **new** to the redesign; the existing JS already calls `getElementById('channelLockBtn')`, but the source PR forgot to put the button in the DOM, so the click never wires up. Adding the button activates the existing JS path.

JS — replaces the four `channelXxxBtn.onclick` handlers and the `updateChannelButtons()` helper:

```javascript
const channelRadios = document.querySelectorAll('input[name="imageChannel"]');

function updateChannelRadios() {
    channelRadios.forEach(r => { r.checked = r.value === selectedChannel; });
}
updateChannelRadios();

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

The `handleImageUpdate`/reset paths that already call `updateChannelButtons()` get renamed to `updateChannelRadios()` (one-line refactor).

### CLAHE toggle + conditional slider

HTML — replaces the current CLAHE block:

```html
<div class="zoom-control">
    <div class="zoom-header">
        <label>CLAHE:</label>
        <button id="claheToggleBtn" class="channel-btn"
                title="Click to enable">Off</button>
        <span id="claheResetBtn" class="slider-reset-btn"
              title="Reset to default">↻</span>
        <button id="claheLockBtn" class="zoom-lock-btn"
                title="Unlock: Reset on each image. Click to lock.">🔓</button>
    </div>
    <div id="claheControls" style="display: none;">
        <div style="font-size: 0.8em; margin-top: 4px;">
            Clip Limit: <span id="claheClipLimitValue">2.0</span>
        </div>
        <input type="range" id="claheClipLimitSlider"
               min="1" max="10" value="2" step="0.5" title="Clip Limit">
    </div>
</div>
```

The `#claheValue` span (currently shows "Off"/"On" inline next to "CLAHE:") is removed — the toggle button's text becomes the source of truth.

JS — adds toggle button handler and changes slider/reset semantics:

```javascript
const claheToggleBtn = document.getElementById('claheToggleBtn');
const claheControls = document.getElementById('claheControls');

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

if (claheToggleBtn) {
    claheToggleBtn.onclick = () => {
        claheEnabled = !claheEnabled;
        updateClaheToggleUI();
        updateClaheResetBtn();
        draw();
        saveGlobalSettings('claheEnabled', claheEnabled);
    };
}

// Slider only updates clipLimit; no longer auto-enables CLAHE.
if (claheClipLimitSlider) {
    claheClipLimitSlider.oninput = (e) => {
        claheClipLimit = parseFloat(e.target.value);
        if (claheClipLimitValue) claheClipLimitValue.textContent = claheClipLimit.toFixed(1);
        updateClaheResetBtn();
        draw();
    };
    claheClipLimitSlider.onchange = () => saveGlobalSettings('claheClipLimit', claheClipLimit);
}

// Reset clears both.
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

`handleImageUpdate` (the per-image-load reset, when not locked) keeps its current behavior of zeroing `claheEnabled` / `claheClipLimit`, but additionally calls `updateClaheToggleUI()` so the button text + controls visibility re-sync.

### Group header CSS

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

In HTML, group headers are simple `<div class="settings-group-header">Theme</div>` lines placed between control rows.

### Behavior / data compatibility

- Radio `value` strings (`'rgb' | 'r' | 'g' | 'b'`) match the existing `selectedChannel` field — no migration.
- `claheEnabled` / `claheClipLimit` / `claheLocked` types and persistence unchanged.
- The dead `channelLockBtn` JS path becomes live (button now exists in DOM); state field `channelLocked` already wired.
- Removed: `claheValue` span (was showing "Off"/"On"); removed: 4 `channelXxxBtn` element references and `updateChannelButtons()` helper.

## Verification

- `npm run compile` — TypeScript build passes (only `LabelMePanel.ts` changed on the TS side; HTML template literal stays a string from TS's view).
- `npm test` — 5 existing utils tests pass (no test target touches webview).
- Manual:
  1. Open editor, settings dropdown shows 4 labeled groups in order Theme → View → Annotation Style → Image Adjustment.
  2. Channel: clicking a radio selects exactly one; rendering switches; lock toggles 🔓 ↔ 🔒; with lock on, switching images keeps the channel.
  3. CLAHE: button toggles Off ↔ On; clip-limit slider visible only when On; lock keeps both state + value across image switches; reset returns to Off + 2.0 in one click.
  4. All other settings (Zoom/Brightness/Contrast/Border/Fill/Theme) behave as before.

## Risks

- Reusing `.onnx-radio-group` / `.onnx-radio` outside the ONNX modal makes the names misleading. Acceptable trade-off vs. CSS duplication; no functional risk.
- The toggle button reuses `.channel-btn` styling for visual consistency with R/G/B/RGB-style "active state" buttons. If the user wants a distinct visual treatment for toggles later, that's a follow-up.
- Group header `border-bottom` may look heavy on dense menus; using `--color-border` so it picks up the existing palette and stays subtle.
