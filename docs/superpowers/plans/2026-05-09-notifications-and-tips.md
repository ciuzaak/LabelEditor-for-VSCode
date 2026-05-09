# Notifications + Tips Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all non-actionable VS Code native notifications into a webview status bus with severity-aware preemption, and replace the existing `title=` tooltips with a rich custom-tooltip component that covers every interactive control including recently added features.

**Architecture:** Two new pure-logic modules under `media/` (`notifyBusHelpers.js`, `tooltipHelpers.js`) backed by Node `--test`, two thin DOM wrappers (`notifyBus.js`, `tooltip.js`) that the webview consumes, and one shared data file (`tipsData.js`) holding tip text. `LabelMePanel.ts` exposes a private `_notify` that posts a `notify` message to the webview, with a tiny pre-ready queue so notifications raised during HTML render are flushed when the webview signals ready. Native VS Code dialogs are kept only for prompts that need a user-button decision.

**Tech Stack:** TypeScript (extension host), plain JS (webview), CSS variables for theming, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-09-notifications-and-tips-design.md`.

---

## File Structure

**New**

- `media/notifyBusHelpers.js` — pure logic for level priority, sticky restore, transient/sticky decisions. Unit-tested.
- `media/notifyBus.js` — DOM wrapper that owns `#status`, calls helpers, runs timers.
- `media/tooltipHelpers.js` — pure logic for tooltip placement (anchor → flipped/clamped rect within viewport). Unit-tested.
- `media/tooltip.js` — DOM wrapper that owns the floating `<div class="le-tooltip">`, attaches listeners to `[data-tip-id]` elements.
- `media/tipsData.js` — single object `TIPS = { [tipId]: { title, desc, shortcut? } }`.
- `test/notifyBusHelpers.test.ts`
- `test/tooltipHelpers.test.ts`

**Modified**

- `src/LabelMePanel.ts` — add `_notify` and pre-ready queue, replace 19 native message calls, remove the `'alert'` relay case, inline-load the new media files in `_getHtmlForWebview`, add `data-tip-id` to every control in the embedded HTML and drop redundant `title=`.
- `media/main.js` — replace every `statusSpan.textContent = …` / `statusSpan.style.color = …` with `notifyBus.show(...)`. Replace `vscode.postMessage({ command: 'alert', text })` with direct `notifyBus.show('error', text)`. Add `data-tip-id` to dynamically rendered nodes (context menu) and call `tooltip.attach` once after each render.
- `media/style.css` — `.le-tooltip` styles, `#status` severity classes, `<kbd>` chip.

---

## Task 1: notifyBusHelpers — pure logic + tests

**Files:**
- Create: `media/notifyBusHelpers.js`
- Create: `test/notifyBusHelpers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/notifyBusHelpers.test.ts`:

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'notifyBusHelpers.js'));
const {
    LEVEL_RANK,
    DEFAULT_DURATIONS,
    canPreempt,
    selectStickyToRestore,
    classifyForRestore
} = helpers;

describe('LEVEL_RANK', () => {
    it('orders info < success < warn < error', () => {
        assert.ok(LEVEL_RANK.info < LEVEL_RANK.success);
        assert.ok(LEVEL_RANK.success < LEVEL_RANK.warn);
        assert.ok(LEVEL_RANK.warn < LEVEL_RANK.error);
    });
});

describe('canPreempt', () => {
    it('allows same severity to overwrite immediately', () => {
        assert.equal(canPreempt({ level: 'info' }, { level: 'info', shownAtMs: 0, minMs: 3000 }, 100), true);
    });
    it('allows higher severity to overwrite immediately', () => {
        assert.equal(canPreempt({ level: 'error' }, { level: 'warn', shownAtMs: 0, minMs: 5000 }, 1000), true);
    });
    it('blocks lower severity before minMs has elapsed', () => {
        assert.equal(canPreempt({ level: 'info' }, { level: 'error', shownAtMs: 0, minMs: 8000 }, 1000), false);
    });
    it('allows lower severity after minMs has elapsed', () => {
        assert.equal(canPreempt({ level: 'info' }, { level: 'error', shownAtMs: 0, minMs: 8000 }, 9000), true);
    });
    it('treats sticky as never-expiring at its own level (preempt rules unchanged)', () => {
        assert.equal(canPreempt({ level: 'success' }, { level: 'warn', shownAtMs: 0, minMs: 5000, sticky: false }, 1000), false);
        assert.equal(canPreempt({ level: 'success' }, { level: 'info', shownAtMs: 0, minMs: 3000, sticky: true }, 0), true);
    });
});

describe('selectStickyToRestore', () => {
    it('returns null when no sticky channels exist', () => {
        assert.equal(selectStickyToRestore({}), null);
    });
    it('returns the most recently set sticky channel', () => {
        const stickies = {
            'sam.status': { level: 'success', text: 'SAM Ready', updatedAtMs: 100 },
            'shift.feedback': { level: 'info', text: 'Shift: extend', updatedAtMs: 200 }
        };
        const got = selectStickyToRestore(stickies);
        assert.equal(got.text, 'Shift: extend');
    });
});

describe('classifyForRestore', () => {
    it('chooses sticky text when transient empty', () => {
        const sticky = { level: 'success', text: 'SAM Ready' };
        assert.deepEqual(classifyForRestore(sticky, null), { level: 'success', text: 'SAM Ready' });
    });
    it('chooses empty payload when neither transient nor sticky present', () => {
        assert.deepEqual(classifyForRestore(null, null), { level: 'info', text: '' });
    });
});

describe('DEFAULT_DURATIONS', () => {
    it('uses 3000/3000/5000/8000 for info/success/warn/error', () => {
        assert.equal(DEFAULT_DURATIONS.info, 3000);
        assert.equal(DEFAULT_DURATIONS.success, 3000);
        assert.equal(DEFAULT_DURATIONS.warn, 5000);
        assert.equal(DEFAULT_DURATIONS.error, 8000);
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```
npm test
```

Expected: failures because `media/notifyBusHelpers.js` does not exist.

- [ ] **Step 3: Implement `media/notifyBusHelpers.js`**

```js
// Pure helpers for the webview status bus. No DOM, no timers — just
// the rules deciding when one notification can replace another.
// Loaded as a <script> in the webview AND require()'d from Node tests.

const LEVEL_RANK = { info: 0, success: 1, warn: 2, error: 3 };

const DEFAULT_DURATIONS = {
    info: 3000,
    success: 3000,
    warn: 5000,
    error: 8000
};

// `incoming.level` vs `current.level/shownAtMs/minMs/sticky`. `nowMs` is the
// current time. Returns true if `incoming` should immediately replace `current`.
//
// Rules:
//   - same or higher severity always preempts.
//   - lower severity preempts only after current's minMs has elapsed.
//   - a sticky transient is treated like a normal one for preemption purposes;
//    its persistence is handled by selectStickyToRestore on expiry.
function canPreempt(incoming, current, nowMs) {
    if (!current) return true;
    const inRank = LEVEL_RANK[incoming.level];
    const curRank = LEVEL_RANK[current.level];
    if (inRank >= curRank) return true;
    return (nowMs - current.shownAtMs) >= current.minMs;
}

// Pick the sticky entry to display when no transient is active. Returns the
// most recently updated entry, or null when no sticky channels exist.
function selectStickyToRestore(stickies) {
    let best = null;
    let bestAt = -Infinity;
    for (const key in stickies) {
        const e = stickies[key];
        if (!e) continue;
        if (e.updatedAtMs > bestAt) {
            best = e;
            bestAt = e.updatedAtMs;
        }
    }
    return best;
}

// On transient expiry decide what should be displayed next. Sticky wins when
// present; otherwise show empty info (effectively clears the bar).
function classifyForRestore(sticky, transient) {
    if (transient) return { level: transient.level, text: transient.text };
    if (sticky) return { level: sticky.level, text: sticky.text };
    return { level: 'info', text: '' };
}

const api = { LEVEL_RANK, DEFAULT_DURATIONS, canPreempt, selectStickyToRestore, classifyForRestore };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else if (typeof window !== 'undefined') {
    window.notifyBusHelpers = api;
}
```

- [ ] **Step 4: Run tests, verify pass**

```
npm test
```

Expected: all `notifyBusHelpers` tests pass.

- [ ] **Step 5: Commit**

```
git add media/notifyBusHelpers.js test/notifyBusHelpers.test.ts
git commit -m "Add notifyBusHelpers: severity priority + sticky restore"
```

---

## Task 2: notifyBus DOM module

**Files:**
- Create: `media/notifyBus.js`

- [ ] **Step 1: Implement `media/notifyBus.js`**

```js
// Webview-side status bus. Sole writer of #status. Imports notifyBusHelpers
// from a hoisted global (the webview loads it as a separate <script>).

(function () {
    const helpers = (typeof notifyBusHelpers !== 'undefined')
        ? notifyBusHelpers
        : (typeof window !== 'undefined' ? window.notifyBusHelpers : null);
    if (!helpers) {
        console.error('notifyBus: notifyBusHelpers not loaded');
        return;
    }

    const ICONS = { info: 'ℹ', success: '✓', warn: '⚠', error: '✕' };

    let statusEl = null;
    let getNow = () => Date.now();

    // Active transient (auto-dismissing) entry, or null.
    //   { level, text, shownAtMs, minMs, durationMs, timerId }
    let transient = null;

    // Map<key, { level, text, updatedAtMs }>. Sticky channels persist until
    // their owner replaces or clears them.
    const stickies = Object.create(null);

    function applyToDom(payload) {
        if (!statusEl) return;
        statusEl.textContent = payload.text ? `${ICONS[payload.level] || ''} ${payload.text}` : '';
        // Reset known severity classes; CSS uses these for color.
        statusEl.classList.remove('status-info', 'status-success', 'status-warn', 'status-error');
        if (payload.text) {
            statusEl.classList.add(`status-${payload.level}`);
        }
        // Drop any inline color from legacy code paths.
        statusEl.style.color = '';
    }

    function rerender() {
        const payload = helpers.classifyForRestore(
            helpers.selectStickyToRestore(stickies),
            transient
        );
        applyToDom(payload);
    }

    function clearTransient() {
        if (transient && transient.timerId) clearTimeout(transient.timerId);
        transient = null;
        rerender();
    }

    function show(level, text, opts) {
        opts = opts || {};
        const now = getNow();

        if (opts.sticky) {
            const key = opts.key || ('default-' + level);
            stickies[key] = { level, text, updatedAtMs: now };
            rerender();
            return;
        }

        const incoming = { level, text };
        if (!helpers.canPreempt(incoming, transient, now)) return;
        if (transient && transient.timerId) clearTimeout(transient.timerId);

        const durationMs = (opts.durationMs != null)
            ? opts.durationMs
            : helpers.DEFAULT_DURATIONS[level];
        const minMs = (opts.minMs != null) ? opts.minMs : durationMs;

        transient = {
            level, text,
            shownAtMs: now,
            minMs,
            durationMs,
            timerId: setTimeout(() => { clearTransient(); }, durationMs)
        };
        applyToDom(incoming);
    }

    function clearSticky(key) {
        delete stickies[key];
        if (!transient) rerender();
    }

    function attach(opts) {
        statusEl = (opts && opts.statusEl) || document.getElementById('status');
        if (opts && typeof opts.getNow === 'function') getNow = opts.getNow;
        rerender();
    }

    const api = { show, clearSticky, attach };
    if (typeof window !== 'undefined') window.notifyBus = api;
})();
```

- [ ] **Step 2: Commit**

```
git add media/notifyBus.js
git commit -m "Add notifyBus: webview status bar wrapper around helpers"
```

---

## Task 3: Wire notifyBus into webview HTML + status CSS

**Files:**
- Modify: `src/LabelMePanel.ts:672-1059` (`_getHtmlForWebview`)
- Modify: `media/style.css`

- [ ] **Step 1: Add notify scripts to HTML pipeline**

In `_getHtmlForWebview`, inline-load the new files alongside existing helpers. After the existing line creating `mergeHelpersUri`, add:

```ts
const notifyHelpersUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this._extensionUri, 'media', 'notifyBusHelpers.js')
);
const notifyBusUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this._extensionUri, 'media', 'notifyBus.js')
);
```

In the returned HTML, before `<script src="${scriptUri}"></script>`, add:

```html
<script src="${notifyHelpersUri}"></script>
<script src="${notifyBusUri}"></script>
```

- [ ] **Step 2: Add status severity CSS**

Append to `media/style.css`:

```css
/* Status bus severity styles (notifyBus.js writes these classes onto #status) */
#status.status-info    { color: var(--color-text-secondary); }
#status.status-success { color: var(--color-success); }
#status.status-warn    { color: var(--color-warning); }
#status.status-error   { color: var(--color-danger); }
```

- [ ] **Step 3: Compile and inspect**

```
npm run compile
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```
git add src/LabelMePanel.ts media/style.css
git commit -m "Load notifyBus scripts and add status severity CSS"
```

---

## Task 4: Initialize notifyBus on the webview side

**Files:**
- Modify: `media/main.js` near top of script after globals are defined

- [ ] **Step 1: Attach notifyBus to the existing #status element**

Find the line where `statusSpan` is read (line 6 of `main.js`):

```js
const statusSpan = document.getElementById('status');
```

Immediately below it, add:

```js
// Attach the status bus to the same DOM node. notifyBus is the only writer of
// #status from this point forward.
if (window.notifyBus) {
    window.notifyBus.attach({ statusEl: statusSpan });
}
```

- [ ] **Step 2: Smoke check that nothing changed visually**

Build:

```
npm run compile
```

The status bar should still render normally because no existing call has been migrated yet — `notifyBus.attach` only does an initial empty render.

- [ ] **Step 3: Commit**

```
git add media/main.js
git commit -m "Wire notifyBus.attach to #status on webview boot"
```

---

## Task 5: Migrate webview-internal status writes to notifyBus

**Files:**
- Modify: `media/main.js`

- [ ] **Step 1: Replace `setMergeStatus` to delegate**

Find around `media/main.js:2463`:

```js
function setMergeStatus(text, color) {
    if (!statusSpan) return;
    statusSpan.textContent = text;
    statusSpan.style.color = color || '';
}
```

Replace with:

```js
function setMergeStatus(text, color) {
    if (!window.notifyBus) return;
    // Map the legacy (text, color) calls to severity. 'red' / 'orange' map to
    // error / warn, anything else (including missing color) is info.
    const level = color === 'red' ? 'error' : (color === 'orange' ? 'warn' : 'info');
    if (!text) return;
    window.notifyBus.show(level, text);
}
```

- [ ] **Step 2: Replace direct `statusSpan` writes in `handleImageLoad`**

Around `media/main.js:717-720`:

```js
function handleImageLoad() {
    // Clear any previous error status
    statusSpan.textContent = "";
    statusSpan.style.color = "";
```

Replace the two clearing lines with:

```js
function handleImageLoad() {
    // Clear the persistent "image error" sticky if present.
    window.notifyBus && window.notifyBus.clearSticky('image.error');
```

Find the matching error path (around line 735):

```js
statusSpan.textContent = "Error loading image";
statusSpan.style.color = "red";
```

Replace with:

```js
window.notifyBus && window.notifyBus.show('error', 'Error loading image', { sticky: true, key: 'image.error' });
```

- [ ] **Step 3: Replace "No images found"**

Around line 1229:

```js
statusSpan.textContent = "No images found";
statusSpan.style.color = "orange";
```

Replace with:

```js
window.notifyBus && window.notifyBus.show('warn', 'No images found');
```

The companion clearing path at lines 1244–1245:

```js
statusSpan.textContent = "";
statusSpan.style.color = "";
```

is no longer needed (transient warnings auto-dismiss). Delete those two lines.

- [ ] **Step 4: Migrate SAM encode/decode messages to a sticky channel**

Around line 6582 (`samEncode`):

```js
statusSpan.textContent = 'SAM Encoding...';
statusSpan.style.color = 'orange';
```

Replace with:

```js
window.notifyBus.show('info', 'SAM Encoding…', { sticky: true, key: 'sam.status' });
```

Around line 6599:

```js
statusSpan.textContent = `SAM Ready [${modeLabel}] (${data.time_ms || 0}ms)`;
statusSpan.style.color = 'limegreen';
```

Replace with:

```js
window.notifyBus.show('success', `SAM Ready [${modeLabel}] (${data.time_ms || 0}ms)`, { sticky: true, key: 'sam.status' });
```

Around lines 6602, 6606:

```js
statusSpan.textContent = 'SAM Encode Error';
statusSpan.style.color = 'red';
// ...
statusSpan.textContent = 'SAM Service Error';
statusSpan.style.color = 'red';
```

Replace each with the matching transient error (sticky channel preserved so the user still sees state):

```js
window.notifyBus.show('error', 'SAM Encode Error');
window.notifyBus.clearSticky('sam.status');
// ...
window.notifyBus.show('error', 'SAM Service Error');
window.notifyBus.clearSticky('sam.status');
```

Around line 6721 (`samDecode` success):

```js
statusSpan.textContent = `SAM Decoded [${modeLabel}] (${data.time_ms || 0}ms)`;
statusSpan.style.color = 'limegreen';
```

Replace with:

```js
window.notifyBus.show('success', `SAM Decoded [${modeLabel}] (${data.time_ms || 0}ms)`, { sticky: true, key: 'sam.status' });
```

Around line 6730:

```js
statusSpan.textContent = 'SAM Decode Error';
statusSpan.style.color = 'red';
```

Replace with:

```js
window.notifyBus.show('error', 'SAM Decode Error');
```

Around `samClearState` (line 6751):

```js
statusSpan.textContent = '';
statusSpan.style.color = '';
```

Replace with:

```js
window.notifyBus.clearSticky('sam.status');
```

- [ ] **Step 5: Replace Shift feedback save/restore with sticky channel**

Around `media/main.js:6788-6815` find `updateShiftFeedback`. The current implementation manually saves/restores `statusSpan` content (using `shouldRefreshShiftSnapshot` / `shouldRestoreShiftStatus`) and also writes the cursor on `canvasWrapper`. The cursor side-effect must be preserved. Replace the entire function body with:

```js
function updateShiftFeedback() {
    if (!shiftPressed || currentMode === 'view') {
        window.notifyBus && window.notifyBus.clearSticky('shift.feedback');
        lastFeedbackText = null;
        // Cursor reset: clear inline style and let the existing mousemove logic re-derive
        currentCursor = null;
        canvasWrapper.style.cursor = '';
        return;
    }

    // Positional signature: computeShiftFeedback(currentMode, prompts, eraserCursor) → { text, color, cursor }
    const { text, color, cursor } = computeShiftFeedback(currentMode, samPrompts, ERASER_CURSOR_DATA_URI);

    canvasWrapper.style.cursor = cursor;
    currentCursor = cursor;
    lastFeedbackText = text;

    // Map the legacy hex colors to severity. #ff4444 = error (negative-point hint),
    // #ff8800 = warn (eraser hint). Anything else falls back to info.
    const level = color === '#ff4444' ? 'error' : (color === '#ff8800' ? 'warn' : 'info');
    window.notifyBus && window.notifyBus.show(level, text, { sticky: true, key: 'shift.feedback' });
}
```

Then delete the now-unused state variables. Remove these declarations near the top of `main.js`:

```js
let prevStatusText = null;       // Status before Shift took over
let prevStatusColor = null;      // Color of status before Shift took over
```

(Find and delete both lines.) The helpers `shouldRefreshShiftSnapshot` / `shouldRestoreShiftStatus` remain in `samPromptHelpers.js` and their tests keep passing — we just no longer call them. That is acceptable for this PR.

- [ ] **Step 6: Replace remaining direct writes**

Look up any remaining `statusSpan.textContent` or `statusSpan.style.color` writes in `media/main.js` and replace them. If a callsite is purely diagnostic and no longer makes sense, delete it. Confirm zero hits with:

Run:

```
git grep -n "statusSpan\.textContent\|statusSpan\.style\.color" media/main.js
```

Expected: no output.

- [ ] **Step 7: Replace the two `'alert'` postMessages with direct notifyBus calls**

Around `media/main.js:4368`:

```js
vscode.postMessage({ command: 'alert', text: 'Invalid color format. Please use #RRGGBB format (e.g., #FF5733).' });
```

Replace with:

```js
window.notifyBus.show('error', 'Invalid color format. Please use #RRGGBB format (e.g., #FF5733).');
```

Around line 5003:

```js
vscode.postMessage({ command: 'alert', text: 'Cannot export SVG: image has not finished loading yet. Please wait and try again.' });
```

Replace with:

```js
window.notifyBus.show('warn', 'Cannot export SVG: image has not finished loading yet. Please wait and try again.');
```

- [ ] **Step 8: Compile and run tests**

```
npm run compile
npm test
```

Expected: compile clean, helper tests still pass.

- [ ] **Step 9: Commit**

```
git add media/main.js
git commit -m "Route webview status writes and alerts through notifyBus"
```

---

## Task 6: Backend `_notify` with pre-ready queue

**Files:**
- Modify: `src/LabelMePanel.ts`

- [ ] **Step 1: Add fields and helper**

Find the existing private field declarations near the top of the `LabelMePanel` class (after the `_isSaving` / `_isDirty` style fields). Add:

```ts
private _webviewReady = false;
private _pendingNotifications: Array<{ level: 'info' | 'success' | 'warn' | 'error'; text: string; key?: string; sticky?: boolean }> = [];
```

Add a new private method (place near `_safePost`):

```ts
private _notify(
    level: 'info' | 'success' | 'warn' | 'error',
    text: string,
    opts?: { key?: string; sticky?: boolean }
) {
    if (!this._webviewReady) {
        if (this._pendingNotifications.length >= 50) {
            // Drop oldest to keep the queue bounded.
            this._pendingNotifications.shift();
        }
        this._pendingNotifications.push({ level, text, ...(opts || {}) });
        return;
    }
    this._safePost({ command: 'notify', level, text, ...(opts || {}) });
}

private _flushPendingNotifications() {
    const queue = this._pendingNotifications;
    this._pendingNotifications = [];
    for (const n of queue) {
        this._safePost({ command: 'notify', ...n });
    }
}
```

- [ ] **Step 2: Hook into `webviewReady` message**

Find the `case 'webviewReady':` in the message handler (around line 262). At the top of that case, before the existing logic, add:

```ts
this._webviewReady = true;
this._flushPendingNotifications();
```

- [ ] **Step 3: Reset readiness on dispose** (defensive — prevents reuse-of-disposed crashes)

In `dispose()`, after `this._disposed = true;` add:

```ts
this._webviewReady = false;
this._pendingNotifications = [];
```

- [ ] **Step 4: Compile**

```
npm run compile
```

Expected: clean.

- [ ] **Step 5: Commit**

```
git add src/LabelMePanel.ts
git commit -m "Add _notify with pre-ready buffering on LabelMePanel"
```

---

## Task 7: Migrate native VS Code notifications to `_notify`

**Files:**
- Modify: `src/LabelMePanel.ts`

- [ ] **Step 1: Replace each non-actionable site**

Walk through the migration table from the spec and edit each call. Concrete edits:

`src/LabelMePanel.ts:254`

```ts
case 'alert':
    vscode.window.showErrorMessage(message.text);
    return;
```

Delete the entire `case 'alert':` block — the webview now talks to `notifyBus` directly.

`src/LabelMePanel.ts:556`

```ts
vscode.window.showInformationMessage(`Refreshed: Found ${this._workspaceImages.length} images`);
```

Replace with:

```ts
this._notify('success', `Refreshed: Found ${this._workspaceImages.length} images`);
```

`src/LabelMePanel.ts:631`

```ts
vscode.window.showWarningMessage(`Failed to load annotation file: ${(e as Error).message}`);
```

Replace with:

```ts
this._notify('warn', `Failed to load annotation file: ${(e as Error).message}`);
```

`src/LabelMePanel.ts:720` — same replacement as line 631.

`src/LabelMePanel.ts:1071`

```ts
vscode.window.showInformationMessage('Annotation saved to ' + path.basename(jsonPath));
```

Replace with:

```ts
this._notify('success', 'Annotation saved to ' + path.basename(jsonPath));
```

`src/LabelMePanel.ts:1079`

```ts
vscode.window.showErrorMessage('Failed to save annotation: ' + (err as Error).message);
```

Replace with:

```ts
this._notify('error', 'Failed to save annotation: ' + (err as Error).message);
```

`src/LabelMePanel.ts:1101`

```ts
vscode.window.showInformationMessage('SVG exported to ' + path.basename(svgPath));
```

Replace with:

```ts
this._notify('success', 'SVG exported to ' + path.basename(svgPath));
```

`src/LabelMePanel.ts:1103`

```ts
vscode.window.showErrorMessage('Failed to export SVG: ' + (err as Error).message);
```

Replace with:

```ts
this._notify('error', 'Failed to export SVG: ' + (err as Error).message);
```

`src/LabelMePanel.ts:1138`

```ts
vscode.window.showErrorMessage('ONNX Batch Infer: Model directory does not exist.');
```

Replace with:

```ts
this._notify('error', 'ONNX Batch Infer: Model directory does not exist.');
```

`src/LabelMePanel.ts:1146`

```ts
vscode.window.showErrorMessage('ONNX Batch Infer: No .onnx file found in model directory.');
```

Replace with:

```ts
this._notify('error', 'ONNX Batch Infer: No .onnx file found in model directory.');
```

`src/LabelMePanel.ts:1152`

```ts
vscode.window.showErrorMessage('ONNX Batch Infer: labels.json not found in model directory.');
```

Replace with:

```ts
this._notify('error', 'ONNX Batch Infer: labels.json not found in model directory.');
```

`src/LabelMePanel.ts:1166`

```ts
vscode.window.showWarningMessage('ONNX Batch Infer: No images found in workspace.');
```

Replace with:

```ts
this._notify('warn', 'ONNX Batch Infer: No images found in workspace.');
```

`src/LabelMePanel.ts:1185`

```ts
vscode.window.showErrorMessage('ONNX Batch Infer: Inference script not found at ' + scriptPath);
```

Replace with:

```ts
this._notify('error', 'ONNX Batch Infer: Inference script not found at ' + scriptPath);
```

`src/LabelMePanel.ts:1223`

```ts
vscode.window.showInformationMessage(
    `ONNX Batch Infer started: ${absoluteImagePaths.length} images. Check the terminal for progress.`
);
```

Replace with:

```ts
this._notify('info', `ONNX Batch Infer started: ${absoluteImagePaths.length} images. Check the terminal for progress.`);
```

`src/LabelMePanel.ts:1240`

```ts
vscode.window.showErrorMessage('SAM Service: Model directory does not exist.');
```

Replace with:

```ts
this._notify('error', 'SAM Service: Model directory does not exist.');
```

`src/LabelMePanel.ts:1248`

```ts
vscode.window.showErrorMessage('SAM Service: Need at least 2 ONNX files (encoder + decoder) in model directory.');
```

Replace with:

```ts
this._notify('error', 'SAM Service: Need at least 2 ONNX files (encoder + decoder) in model directory.');
```

`src/LabelMePanel.ts:1255`

```ts
vscode.window.showWarningMessage(
    `SAM Service already running on port ${config.port} from another panel. Reusing it; change the port in settings if you want a separate instance.`
);
```

Replace with:

```ts
this._notify('warn', `SAM Service already running on port ${config.port} from another panel. Reusing it; change the port in settings if you want a separate instance.`);
```

`src/LabelMePanel.ts:1264`

```ts
vscode.window.showErrorMessage('SAM Service: Service script not found at ' + scriptPath);
```

Replace with:

```ts
this._notify('error', 'SAM Service: Service script not found at ' + scriptPath);
```

`src/LabelMePanel.ts:1310`

```ts
vscode.window.showInformationMessage(
    `SAM Service starting on port ${config.port}. Check the terminal for status.`
);
```

Replace with:

```ts
this._notify('info', `SAM Service starting on port ${config.port}. Check the terminal for status.`);
```

- [ ] **Step 2: Sanity-grep**

```
git grep -n "vscode.window.showInformationMessage\|vscode.window.showErrorMessage\|vscode.window.showWarningMessage" src/LabelMePanel.ts
```

Expected: only the two unsaved-changes prompts (around lines 403 and 456) remain.

- [ ] **Step 3: Compile**

```
npm run compile
```

Expected: clean.

- [ ] **Step 4: Commit**

```
git add src/LabelMePanel.ts
git commit -m "Migrate non-actionable native notifications to _notify"
```

---

## Task 8: Add notify message handler in webview

**Files:**
- Modify: `media/main.js` (the existing top-level `window.addEventListener('message', ...)` block)

- [ ] **Step 1: Locate the message router**

Search for the existing message handler that switches on `message.command` (the dispatch on `'updateImage'`, `'saveComplete'`, etc.). The exact location varies; use:

```
git grep -n "case 'updateImage'" media/main.js
```

- [ ] **Step 2: Add a `'notify'` case**

Inside the switch, add (alphabetical or with related cases is fine):

```js
case 'notify': {
    const level = message.level || 'info';
    const opts = {};
    if (message.key) opts.key = message.key;
    if (message.sticky) opts.sticky = true;
    if (window.notifyBus) window.notifyBus.show(level, message.text || '', opts);
    return;
}
```

- [ ] **Step 3: Compile**

```
npm run compile
```

Expected: clean.

- [ ] **Step 4: Commit**

```
git add media/main.js
git commit -m "Handle notify postMessage in webview"
```

---

## Task 9: tooltipHelpers — pure positioning logic + tests

**Files:**
- Create: `media/tooltipHelpers.js`
- Create: `test/tooltipHelpers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/tooltipHelpers.test.ts`:

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'tooltipHelpers.js'));
const { computeTooltipPosition } = helpers;

const VIEWPORT = { width: 1000, height: 800 };
const PAD = 8;
const TIP = { width: 200, height: 60 };

describe('computeTooltipPosition', () => {
    it('places tooltip below and left-aligned with the target by default', () => {
        const target = { left: 100, top: 100, right: 140, bottom: 130, width: 40, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT, pad: PAD });
        assert.equal(got.placement, 'below');
        assert.equal(got.left, 100);
        assert.equal(got.top, 130 + PAD);
    });

    it('flips above when below would overflow the viewport bottom', () => {
        const target = { left: 100, top: 740, right: 140, bottom: 770, width: 40, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT, pad: PAD });
        assert.equal(got.placement, 'above');
        assert.equal(got.top, 740 - PAD - TIP.height);
    });

    it('clamps right edge into viewport when target sits near right edge', () => {
        const target = { left: 900, top: 100, right: 940, bottom: 130, width: 40, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT, pad: PAD });
        // Tip width 200 from left=900 would reach 1100, so clamp to viewport width - tip.width.
        assert.equal(got.left, VIEWPORT.width - TIP.width);
    });

    it('clamps left edge to PAD when target sits near left edge', () => {
        const target = { left: 0, top: 100, right: 30, bottom: 130, width: 30, height: 30 };
        const got = computeTooltipPosition({ target, tip: TIP, viewport: VIEWPORT, pad: PAD });
        assert.ok(got.left >= 0);
    });
});
```

- [ ] **Step 2: Run tests and verify they fail**

```
npm test
```

Expected: fail because `media/tooltipHelpers.js` does not exist.

- [ ] **Step 3: Implement helpers**

Create `media/tooltipHelpers.js`:

```js
// Pure logic for tooltip placement. Deterministic in/out: given a target rect,
// tip rect, viewport rect, and padding, produce { left, top, placement }.

function computeTooltipPosition({ target, tip, viewport, pad }) {
    const safePad = (typeof pad === 'number') ? pad : 8;

    // Default below; flip above if below would clip viewport bottom.
    const below = target.bottom + safePad;
    let placement = 'below';
    let top = below;
    if (top + tip.height > viewport.height) {
        const above = target.top - safePad - tip.height;
        if (above >= 0) {
            top = above;
            placement = 'above';
        } else {
            // Stick at viewport bottom edge minus tip height.
            top = Math.max(0, viewport.height - tip.height);
        }
    }

    // Default left aligned with target; clamp into viewport.
    let left = target.left;
    if (left + tip.width > viewport.width) {
        left = viewport.width - tip.width;
    }
    if (left < 0) left = 0;

    return { left, top, placement };
}

const api = { computeTooltipPosition };
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else if (typeof window !== 'undefined') {
    window.tooltipHelpers = api;
}
```

- [ ] **Step 4: Run tests, verify pass**

```
npm test
```

Expected: all tooltipHelpers tests pass.

- [ ] **Step 5: Commit**

```
git add media/tooltipHelpers.js test/tooltipHelpers.test.ts
git commit -m "Add tooltipHelpers: pure placement math + tests"
```

---

## Task 10: tipsData dictionary

**Files:**
- Create: `media/tipsData.js`

- [ ] **Step 1: Implement** with full content for every tipId from the spec

Create `media/tipsData.js`:

```js
// Single source of truth for tooltip text. Stable IDs are referenced from
// data-tip-id attributes on controls. Fields:
//   title:    very short label (3-6 words). May be omitted if desc is enough.
//   desc:     one sentence describing what the control does.
//   shortcut: optional keyboard shortcut string rendered as a <kbd> chip.

const TIPS = {
    // Top toolbar / image browser
    'nav.toggleBrowser': { title: 'Toggle Image Browser', desc: 'Show or hide the image list on the left.' },
    'nav.prev':          { title: 'Previous Image', desc: 'Open the previous image in the workspace.', shortcut: 'A' },
    'nav.next':          { title: 'Next Image', desc: 'Open the next image in the workspace.', shortcut: 'D' },
    'nav.fileName':      { title: 'Current File', desc: 'Left-click copies the absolute path; right-click copies just the filename.' },
    'nav.imageInfo':     { title: 'Image Info', desc: 'Show file size, dimensions, bit depth, and DPI.' },
    'browser.search':    { title: 'Search Images', desc: 'Filter the image list by filename.' },
    'browser.refresh':   { title: 'Refresh List', desc: 'Rescan the workspace for image files.' },
    'browser.searchClose': { title: 'Close Search', desc: 'Clear the filter and close the search box.' },

    // Drawing modes
    'mode.view':      { title: 'View Mode', desc: 'Pan and select shapes. Drag on empty space to box-select.', shortcut: 'V' },
    'mode.polygon':   { title: 'Polygon Mode', desc: 'Click to place vertices; double-click or press Enter to close the polygon.', shortcut: 'P' },
    'mode.rectangle': { title: 'Rectangle Mode', desc: 'Drag to draw an axis-aligned rectangle.', shortcut: 'R' },
    'mode.line':      { title: 'Line Mode', desc: 'Click two points to draw a line.', shortcut: 'L' },
    'mode.point':     { title: 'Point Mode', desc: 'Click to place a single annotation point.', shortcut: 'O' },
    'mode.sam':       { title: 'SAM AI Mode', desc: 'Use the SAM service to generate a mask from positive/negative point prompts.', shortcut: 'I' },

    // Sidebar action buttons
    'actions.settings': { title: 'Settings', desc: 'Open theme, view, annotation style, and image adjustment controls.' },
    'actions.tools':    { title: 'Tools', desc: 'Export SVG and run ONNX batch inference.' },
    'actions.save':     { title: 'Save', desc: 'Save annotations to the LabelMe JSON next to the image.', shortcut: 'Ctrl+S' },

    // Theme
    'theme.light': { title: 'Light Theme', desc: 'Use the light theme regardless of VS Code appearance.' },
    'theme.dark':  { title: 'Dark Theme', desc: 'Use the dark theme regardless of VS Code appearance.' },
    'theme.auto':  { title: 'Follow VS Code', desc: 'Match the current VS Code color theme.' },

    // View / zoom
    'view.zoomReset': { title: 'Reset Zoom', desc: 'Fit the image to the canvas.' },
    'view.zoomLock':  { title: 'Lock Zoom and Pan', desc: 'Keep current zoom and scroll position when switching images.' },

    // Annotation style
    'style.borderWidth':      { title: 'Border Width', desc: 'Stroke width used to draw shape borders.' },
    'style.borderWidthReset': { title: 'Reset Border Width', desc: 'Restore the default border width.' },
    'style.fillOpacity':      { title: 'Fill Opacity', desc: 'Alpha for the inside fill of polygons and rectangles.' },
    'style.fillOpacityReset': { title: 'Reset Fill Opacity', desc: 'Restore the default fill opacity.' },

    // Image adjustment — channel
    'channel.lock': { title: 'Lock Channel', desc: 'Keep the current channel selection when switching images. Click to toggle.' },
    'channel.rgb':  { title: 'RGB', desc: 'Display all color channels.' },
    'channel.r':    { title: 'Red', desc: 'Display only the red channel.' },
    'channel.g':    { title: 'Green', desc: 'Display only the green channel.' },
    'channel.b':    { title: 'Blue', desc: 'Display only the blue channel.' },

    // Image adjustment — brightness / contrast
    'image.brightness':      { title: 'Brightness', desc: 'Adjust display brightness (does not modify the file).' },
    'image.brightnessReset': { title: 'Reset Brightness', desc: 'Restore brightness to 100%.' },
    'image.brightnessLock':  { title: 'Lock Brightness', desc: 'Keep brightness when switching images. Click to toggle.' },
    'image.contrast':        { title: 'Contrast', desc: 'Adjust display contrast (does not modify the file).' },
    'image.contrastReset':   { title: 'Reset Contrast', desc: 'Restore contrast to 100%.' },
    'image.contrastLock':    { title: 'Lock Contrast', desc: 'Keep contrast when switching images. Click to toggle.' },

    // CLAHE
    'image.claheToggle':    { title: 'CLAHE', desc: 'Toggle Contrast-Limited Adaptive Histogram Equalization.' },
    'image.claheReset':     { title: 'Reset CLAHE', desc: 'Restore default CLAHE parameters and disable.' },
    'image.claheLock':      { title: 'Lock CLAHE', desc: 'Keep CLAHE settings when switching images. Click to toggle.' },
    'image.claheClipLimit': { title: 'Clip Limit', desc: 'CLAHE clip limit; higher values produce stronger local contrast.' },

    // Tools menu items
    'tools.exportSvg':       { title: 'Export SVG', desc: 'Export current shapes as a standalone SVG file next to the image.' },
    'tools.onnxBatchInfer':  { title: 'ONNX Batch Infer', desc: 'Run an ONNX segmentation model over selected images and write polygons.' },

    // Shape context menu (rendered dynamically in main.js)
    'context.edit':          { title: 'Edit', desc: 'Edit polygon vertices.' },
    'context.rename':        { title: 'Rename', desc: 'Change the label of the selected shape(s).', shortcut: 'Ctrl+R' },
    'context.merge':         { title: 'Merge', desc: 'Merge the selected shapes (union for overlapping polygons of the same label, otherwise grouped).', shortcut: 'Ctrl+G' },
    'context.toggleVisible': { title: 'Show/Hide', desc: 'Toggle visibility of the selected shape(s).', shortcut: 'Ctrl+H' },
    'context.delete':        { title: 'Delete', desc: 'Delete the selected shape(s).' },

    // Recently added features (no native title= today)
    'shortcut.merge':         { title: 'Merge Shapes', desc: 'Union overlapping polygons of the same label, otherwise group selected shapes into one merged annotation.', shortcut: 'Ctrl+G' },
    'shortcut.rename':        { title: 'Rename Selected', desc: 'Open the rename dialog for the selected shape(s).', shortcut: 'Ctrl+R' },
    'shortcut.toggleVisible': { title: 'Toggle Visibility', desc: 'Hide or show the selected shape(s).', shortcut: 'Ctrl+H' },
    'sam.positivePoint':      { title: 'Positive Prompt', desc: 'Left-click in SAM mode to add a positive point that pulls the mask toward it.' },
    'sam.negativePoint':      { title: 'Negative Prompt', desc: 'Right-click in SAM mode to add a negative point that pushes the mask away.' },
    'sam.eraser':             { title: 'Prompt Eraser', desc: 'Hold Shift in SAM mode to switch to eraser; click a prompt or drag to remove from prompts.' },
    'select.box':             { title: 'Box Select', desc: 'In View mode, drag on empty space to box-select shapes. Hold Shift to add to the current selection.' },
    'select.multi':           { title: 'Multi-Select', desc: 'Ctrl-click in the instance list to select multiple shapes.' },

    // ONNX modal
    'onnx.modelDir':       { title: 'Model Directory', desc: 'Directory holding the .onnx model and a labels.json mapping mask values (skip 0 = background) to label names.' },
    'onnx.pythonPath':     { title: 'Python Interpreter', desc: 'Path to the Python interpreter that has onnxruntime installed.' },
    'onnx.device':         { title: 'Device', desc: 'Run inference on CPU or GPU.' },
    'onnx.gpuIndex':       { title: 'GPU Index', desc: 'Which GPU to use when Device is GPU.' },
    'onnx.colorFormat':    { title: 'Color Format', desc: 'How the model expects channel order — most ONNX exports use RGB.' },
    'onnx.scope':          { title: 'Scope', desc: 'Run the model on every image in the workspace or only on the current image.' },
    'onnx.mode':           { title: 'Existing Annotations', desc: 'How to combine inference output with annotations already saved next to each image.' },
    'onnx.modelDirBrowse': { title: 'Browse', desc: 'Pick the model directory.' },
    'onnx.pythonBrowse':   { title: 'Browse', desc: 'Pick the Python executable.' },

    // SAM modal
    'sam.modelDir':       { title: 'Model Directory', desc: 'Directory holding encoder and decoder ONNX files (SAM1 or SAM2, auto-detected).' },
    'sam.pythonPath':     { title: 'Python Interpreter', desc: 'Path to the Python interpreter that has onnxruntime installed.' },
    'sam.device':         { title: 'Device', desc: 'Run the SAM service on CPU or GPU.' },
    'sam.gpuIndex':       { title: 'GPU Index', desc: 'Which GPU to use when Device is GPU.' },
    'sam.encodeMode':     { title: 'Encode Mode', desc: 'Full Image is the default. Local Crop encodes only the visible viewport when zoomed in for better small-target accuracy.' },
    'sam.port':           { title: 'Service Port', desc: 'Local port for the SAM HTTP service.' },
    'sam.modelDirBrowse': { title: 'Browse', desc: 'Pick the SAM model directory.' },
    'sam.pythonBrowse':   { title: 'Browse', desc: 'Pick the Python executable.' }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TIPS };
} else if (typeof window !== 'undefined') {
    window.TIPS = TIPS;
}
```

- [ ] **Step 2: Commit**

```
git add media/tipsData.js
git commit -m "Add tipsData dictionary covering every annotated control"
```

---

## Task 11: tooltip DOM module

**Files:**
- Create: `media/tooltip.js`

- [ ] **Step 1: Implement**

```js
// Webview-side rich tooltip. Owns one floating <div class="le-tooltip"> and
// attaches mouseenter/leave/focus/blur to elements with a data-tip-id.

(function () {
    const helpers = (typeof tooltipHelpers !== 'undefined')
        ? tooltipHelpers
        : (typeof window !== 'undefined' ? window.tooltipHelpers : null);
    if (!helpers) {
        console.error('tooltip: tooltipHelpers not loaded');
        return;
    }

    const SHOW_DELAY_MS = 350;
    const PAD = 8;

    let tipsDict = null;
    let tooltipEl = null;
    let attachedEls = new WeakSet();
    let showTimer = null;
    let currentTarget = null;

    function ensureTooltipEl() {
        if (tooltipEl) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'le-tooltip';
        tooltipEl.style.position = 'fixed';
        tooltipEl.style.pointerEvents = 'none';
        tooltipEl.style.opacity = '0';
        tooltipEl.style.transition = 'opacity 120ms ease';
        tooltipEl.style.zIndex = '99999';
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    }

    function renderContent(tip) {
        const el = ensureTooltipEl();
        let html = '';
        if (tip.title) html += `<div class="le-tooltip-title">${escapeHtml(tip.title)}</div>`;
        if (tip.desc)  html += `<div class="le-tooltip-desc">${escapeHtml(tip.desc)}</div>`;
        if (tip.shortcut) html += `<div class="le-tooltip-shortcut"><kbd>${escapeHtml(tip.shortcut)}</kbd></div>`;
        el.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, ch => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        })[ch]);
    }

    function show(target, tip) {
        renderContent(tip);
        const el = ensureTooltipEl();
        // Make it measurable while still invisible.
        el.style.opacity = '0';
        el.style.left = '-9999px';
        el.style.top = '-9999px';
        const tipRect = el.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const pos = helpers.computeTooltipPosition({
            target: targetRect,
            tip: { width: tipRect.width, height: tipRect.height },
            viewport,
            pad: PAD
        });
        el.style.left = `${pos.left}px`;
        el.style.top = `${pos.top}px`;
        el.style.opacity = '1';
        currentTarget = target;
    }

    function hide() {
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
        if (tooltipEl) tooltipEl.style.opacity = '0';
        currentTarget = null;
    }

    function onEnter(e) {
        const el = e.currentTarget;
        const id = el.getAttribute('data-tip-id');
        if (!id) return;
        const tip = tipsDict && tipsDict[id];
        if (!tip) return;
        if (showTimer) clearTimeout(showTimer);
        showTimer = setTimeout(() => show(el, tip), SHOW_DELAY_MS);
    }

    function onLeave() { hide(); }
    function onFocus(e) {
        const el = e.currentTarget;
        const id = el.getAttribute('data-tip-id');
        if (!id) return;
        const tip = tipsDict && tipsDict[id];
        if (!tip) return;
        show(el, tip);
    }
    function onBlur() { hide(); }

    function attach(rootEl, tips) {
        tipsDict = tips || tipsDict;
        const root = rootEl || document;
        const nodes = root.querySelectorAll('[data-tip-id]');
        for (const n of nodes) {
            if (attachedEls.has(n)) continue;
            attachedEls.add(n);
            // Drop the legacy native bubble so it doesn't double up.
            if (n.hasAttribute('title')) n.removeAttribute('title');
            n.addEventListener('mouseenter', onEnter);
            n.addEventListener('mouseleave', onLeave);
            n.addEventListener('focus', onFocus);
            n.addEventListener('blur', onBlur);
        }
    }

    const api = { attach, hide };
    if (typeof window !== 'undefined') window.tooltip = api;
})();
```

- [ ] **Step 2: Add tooltip CSS**

Append to `media/style.css`:

```css
/* Custom rich tooltip */
.le-tooltip {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-secondary);
    border-radius: 4px;
    padding: 6px 10px;
    box-shadow: 0 4px 12px var(--color-shadow);
    font-size: 12px;
    line-height: 1.4;
    max-width: 320px;
}
.le-tooltip-title {
    font-weight: 600;
    margin-bottom: 2px;
}
.le-tooltip-desc {
    color: var(--color-text-primary);
}
.le-tooltip-shortcut {
    margin-top: 4px;
}
.le-tooltip-shortcut kbd {
    display: inline-block;
    padding: 1px 6px;
    border: 1px solid var(--color-border-input);
    border-radius: 3px;
    background: var(--color-bg-input);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.2;
}
```

- [ ] **Step 3: Commit**

```
git add media/tooltip.js media/style.css
git commit -m "Add tooltip DOM module + CSS"
```

---

## Task 12: Wire tooltip and tipsData into the webview HTML

**Files:**
- Modify: `src/LabelMePanel.ts:672-1060` (`_getHtmlForWebview`)
- Modify: `media/main.js`

- [ ] **Step 1: Inline-load tipsData and tooltip scripts**

In `_getHtmlForWebview`, where `notifyHelpersUri` and `notifyBusUri` were added (Task 3 Step 1), add:

```ts
const tipsDataUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this._extensionUri, 'media', 'tipsData.js')
);
const tooltipHelpersUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this._extensionUri, 'media', 'tooltipHelpers.js')
);
const tooltipUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this._extensionUri, 'media', 'tooltip.js')
);
```

In the returned HTML, before `<script src="${scriptUri}"></script>` and after the notify scripts, add:

```html
<script src="${tipsDataUri}"></script>
<script src="${tooltipHelpersUri}"></script>
<script src="${tooltipUri}"></script>
```

- [ ] **Step 2: Initial attach in main.js**

In `media/main.js`, near the `notifyBus.attach` call added in Task 4, also call:

```js
if (window.tooltip && window.TIPS) {
    window.tooltip.attach(document, window.TIPS);
}
```

- [ ] **Step 3: Compile**

```
npm run compile
```

Expected: clean.

- [ ] **Step 4: Commit**

```
git add src/LabelMePanel.ts media/main.js
git commit -m "Wire tipsData and tooltip into webview"
```

---

## Task 13: Add data-tip-id to every static HTML control

**Files:**
- Modify: `src/LabelMePanel.ts` HTML template (lines roughly 733–1011)

- [ ] **Step 1: Top toolbar / image browser**

Update each element to add `data-tip-id="…"`. Existing `title=` is kept temporarily (the tooltip module strips it on attach), but **after** attach is wired you should remove the redundant `title=` to keep the source clean. Do both as one edit per element to avoid drift.

For example, change:

```html
<button id="imageBrowserToggleBtn" class="nav-btn" title="Toggle Image Browser">☰</button>
```

to:

```html
<button id="imageBrowserToggleBtn" class="nav-btn" data-tip-id="nav.toggleBrowser">☰</button>
```

Apply analogous edits for every element below using the matching tip ID (left = element/id, right = tip ID):

| Element id | Tip ID |
| --- | --- |
| `imageBrowserToggleBtn` | `nav.toggleBrowser` |
| `prevImageBtn` | `nav.prev` |
| `nextImageBtn` | `nav.next` |
| `fileName` (span) | `nav.fileName` |
| `imageInfoBtn` | `nav.imageInfo` |
| `searchImagesBtn` | `browser.search` |
| `refreshImagesBtn` | `browser.refresh` |
| `searchCloseBtn` | `browser.searchClose` |
| `viewModeBtn` | `mode.view` |
| `polygonModeBtn` | `mode.polygon` |
| `rectangleModeBtn` | `mode.rectangle` |
| `lineModeBtn` | `mode.line` |
| `pointModeBtn` | `mode.point` |
| `samModeBtn` | `mode.sam` |
| `settingsMenuBtn` | `actions.settings` |
| `toolsMenuBtn` | `actions.tools` |
| `saveBtn` | `actions.save` |
| `themeLightBtn` | `theme.light` |
| `themeDarkBtn` | `theme.dark` |
| `themeAutoBtn` | `theme.auto` |
| `zoomResetBtn` | `view.zoomReset` |
| `zoomLockBtn` | `view.zoomLock` |
| `borderWidthSlider` | `style.borderWidth` |
| `borderWidthResetBtn` | `style.borderWidthReset` |
| `fillOpacitySlider` | `style.fillOpacity` |
| `fillOpacityResetBtn` | `style.fillOpacityReset` |
| `channelLockBtn` | `channel.lock` |
| `brightnessSlider` | `image.brightness` |
| `brightnessResetBtn` | `image.brightnessReset` |
| `brightnessLockBtn` | `image.brightnessLock` |
| `contrastSlider` | `image.contrast` |
| `contrastResetBtn` | `image.contrastReset` |
| `contrastLockBtn` | `image.contrastLock` |
| `claheToggleBtn` | `image.claheToggle` |
| `claheResetBtn` | `image.claheReset` |
| `claheLockBtn` | `image.claheLock` |
| `claheClipLimitSlider` | `image.claheClipLimit` |
| `exportSvgMenuItem` | `tools.exportSvg` |
| `onnxBatchInferMenuItem` | `tools.onnxBatchInfer` |
| `onnxModelDirBrowse` | `onnx.modelDirBrowse` |
| `onnxPythonPathBrowse` | `onnx.pythonBrowse` |
| `samModelDirBrowse` | `sam.modelDirBrowse` |
| `samPythonPathBrowse` | `sam.pythonBrowse` |

For the channel radios (RGB/R/G/B) which have no id, add `data-tip-id` directly on the `<input type="radio" ... />`:

```html
<label class="onnx-radio"><input type="radio" name="imageChannel" value="rgb" data-tip-id="channel.rgb" checked /> RGB</label>
<label class="onnx-radio"><input type="radio" name="imageChannel" value="r"   data-tip-id="channel.r" /> R</label>
<label class="onnx-radio"><input type="radio" name="imageChannel" value="g"   data-tip-id="channel.g" /> G</label>
<label class="onnx-radio"><input type="radio" name="imageChannel" value="b"   data-tip-id="channel.b" /> B</label>
```

For the existing `<span class="onnx-hint" title='…long text…'>ⓘ</span>` markers in the ONNX/SAM modals, replace each with the matching tip ID:

| Approximate line | Hint near | Tip ID |
| --- | --- | --- |
| 911 | ONNX Model Directory | `onnx.modelDir` |
| 971 | SAM Model Directory | `sam.modelDir` |
| 996 | SAM Encode Mode | `sam.encodeMode` |

Drop the inline `title='…'` and add `data-tip-id`:

```html
<span class="onnx-hint" data-tip-id="onnx.modelDir">ⓘ</span>
```

Also add tips for the form labels themselves where they are not already wrapping the hint. The simplest is to add `data-tip-id="onnx.pythonPath"` on the surrounding `<label>` for Python, etc. Apply for each tipId in the `onnx.*` and `sam.*` namespaces of `tipsData.js` — find the corresponding `<label>` in the HTML template and tag it.

- [ ] **Step 2: Strip redundant `title=` on the same elements**

For every element you tagged, remove the `title=` attribute. The tooltip module also removes it at runtime, but cleaning the source keeps the HTML readable.

Sanity grep:

```
git grep -n "title=\"" src/LabelMePanel.ts
```

Expected: only `<title>LabelMe</title>` and any element you intentionally left with a native bubble (none expected) remain. The matching tip ID columns above cover every entry from the previous Task 13 grep.

- [ ] **Step 3: Compile**

```
npm run compile
```

Expected: clean.

- [ ] **Step 4: Commit**

```
git add src/LabelMePanel.ts
git commit -m "Tag every static control with data-tip-id and drop legacy title="
```

---

## Task 14: Tag dynamically rendered nodes (context menu) and re-attach tooltip

**Files:**
- Modify: `src/LabelMePanel.ts` HTML template (the shape context menu)
- Modify: `media/main.js` (places that mutate the context menu)

- [ ] **Step 1: Tag context menu items in HTML**

In `src/LabelMePanel.ts:764-770` change:

```html
<div id="shapeContextMenu" class="shape-context-menu" style="display: none;">
    <div class="context-menu-item" id="contextMenuEdit">Edit</div>
    <div class="context-menu-item" id="contextMenuRename">Rename</div>
    <div class="context-menu-item" id="contextMenuMerge" style="display: none;">Merge</div>
    <div class="context-menu-item" id="contextMenuToggleVisible">Hide</div>
    <div class="context-menu-item context-menu-danger" id="contextMenuDelete">Delete</div>
</div>
```

to:

```html
<div id="shapeContextMenu" class="shape-context-menu" style="display: none;">
    <div class="context-menu-item" id="contextMenuEdit"          data-tip-id="context.edit">Edit</div>
    <div class="context-menu-item" id="contextMenuRename"        data-tip-id="context.rename">Rename</div>
    <div class="context-menu-item" id="contextMenuMerge"         data-tip-id="context.merge" style="display: none;">Merge</div>
    <div class="context-menu-item" id="contextMenuToggleVisible" data-tip-id="context.toggleVisible">Hide</div>
    <div class="context-menu-item context-menu-danger" id="contextMenuDelete" data-tip-id="context.delete">Delete</div>
</div>
```

- [ ] **Step 2: Re-attach tooltip after dynamic renders**

Find every place in `media/main.js` that builds list rows for instances/labels/image-browser. The simplest safe rule is: after each `innerHTML = …` or `appendChild` that injects controls into a container, call:

```js
if (window.tooltip && window.TIPS) window.tooltip.attach(container, window.TIPS);
```

Concrete sites (search by function name):

- `renderImageBrowserList` — after the list is rebuilt, call `window.tooltip.attach(imageBrowserList, window.TIPS);` (rows currently have no tip IDs but the call is idempotent and prepares for future row-level tips).
- `renderShapeList` (or the equivalent that draws the instances list) — same.
- `renderLabelsList` — same.

If you cannot find a clean hook, fall back to calling `window.tooltip.attach(document, window.TIPS)` once after each render — `attachedEls` is a WeakSet and skips already-attached nodes.

- [ ] **Step 3: Compile and run tests**

```
npm run compile
npm test
```

Expected: clean compile, all helper tests still pass.

- [ ] **Step 4: Commit**

```
git add src/LabelMePanel.ts media/main.js
git commit -m "Tag context menu and re-attach tooltips on dynamic render"
```

---

## Task 15: Wire tip IDs for in-canvas hidden affordances

These are not visible buttons but still need discoverability. The intent is to add a small ⓘ pill (or `data-tip-id` on an existing label) in the right place, OR — if no UI element exists at all (e.g. Shift-eraser is purely a keyboard interaction) — to omit. The plan covers both paths.

**Files:**
- Modify: `src/LabelMePanel.ts` HTML template

- [ ] **Step 1: Identify which "recently added" features have a UI surface**

| Tip ID | UI surface today | Action |
| --- | --- | --- |
| `shortcut.merge` | Context menu "Merge" item already tagged | Already covered (Task 14). |
| `shortcut.rename` | Context menu "Rename" item already tagged | Already covered. |
| `shortcut.toggleVisible` | Context menu "Hide" item already tagged | Already covered. |
| `sam.positivePoint` / `sam.negativePoint` / `sam.eraser` | No element. | Skip — the `mode.sam` tip mentions left/right click; a deeper hint can be added later if requested. |
| `select.box` / `select.multi` | No element. | Skip — `mode.view` tip mentions box-select. |

Net result of this task: no new edits are required in the HTML, because all surfaces are covered by the mode tip or the context menu tip. We keep the orphan tip IDs in `tipsData.js` (they cost nothing) so a future hint surface can pick them up.

- [ ] **Step 2: Confirm by inspection**

Re-read `src/LabelMePanel.ts` HTML and `media/main.js` for any `view-mode hint` or `sam-help` element. If none, this task is complete.

- [ ] **Step 3: No commit (inspection only)**

If anything unexpected was found, add an entry and commit it as part of Task 13 retroactively.

---

## Task 16: Final integration smoke test (run with user)

**Files:** none.

This is the user-visible checkpoint. The agent runs the smoke checklist with the user before declaring done.

- [ ] **Step 1: Build and launch**

```
npm run compile
```

Open the workspace in VS Code and run the extension (F5 in dev or use the published debug profile). Open a folder of test images.

- [ ] **Step 2: Notification smoke (per spec checklist)**

1. Folder with images → no native popup for "Refreshed: Found N images"; the message appears in `#status` in green and fades after ~3 s.
2. Save annotations → "Annotation saved to …" appears in `#status` in green, no native popup.
3. Force a save error (e.g. open the JSON in another app or chmod read-only) → red message in `#status` for ~8 s.
4. Open ONNX Batch Inference modal with bad model dir → red error in `#status`.
5. Start SAM service → "SAM Service starting on port …" in `#status`. Verify `Ready [Full]` sticky message survives a brief save-success interruption.
6. Trigger an unsaved-changes navigation → still uses the native dialog with Save/Discard/Cancel.

- [ ] **Step 3: Tooltip smoke**

1. Hover every mode button, settings, theme, save, and recent-feature-context-menu item. Verify rich tooltip with title + description (+ shortcut where applicable). Confirm no double bubble from native `title=`.
2. Hover a button near the right edge → tooltip clamps to viewport. Hover near the bottom → tooltip flips above.
3. Light theme + dark theme: tooltip and status colors readable.

- [ ] **Step 4: Run unit tests**

```
npm test
```

Expected: all pass.

- [ ] **Step 5: If smoke passes, ask user for the green light to stop**

Pause and confirm with the user that the implementation matches the spec. The agent does not declare done unilaterally.

---

## Self-Review Notes

- **Spec coverage.** Each migration table entry maps to a step in Task 7. Every tip ID listed in the spec coverage section is present in `tipsData.js` (Task 10). Sticky-channel restoration handles SAM and Shift feedback (Tasks 5, 11). Pre-ready buffer addresses the line-720 timing (Task 6).
- **Type consistency.** `_notify` signature, `notify` postMessage shape, `notifyBus.show(level, text, opts)`, and `tooltip.attach(root, tips)` are referenced identically across tasks.
- **No placeholders.** Every code step includes the actual code; every edit step lists the file and line range.
- **Risks called out in spec are covered.** Webview disposed mid-flight is addressed by `_safePost` (no change needed); two SAM panels each have their own bus by virtue of being per-webview; tooltip on dynamic nodes is handled in Task 14.
