# SAM Prompt Combination + Eraser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow SAM mode to combine point and box prompts (1 box max + N points) and route Shift to the eraser when no positive SAM prompt is in progress.

**Architecture:** Extract a pure-function helper module for the routing/merge logic (`media/samPromptHelpers.js`) with unit-test coverage. Edit `media/main.js` in place to remove the `samPromptType` exclusion, lift the box single-instance invariant into a reusable helper, gate Shift dispatch through `samHasPositivePrompt()`, and add Shift keydown/keyup feedback. No backend or persistent-state changes.

**Tech Stack:** Plain JS (webview), TypeScript node test runner (`node --test`), VS Code extension API.

**Spec:** [docs/superpowers/specs/2026-05-08-sam-prompt-combo-and-eraser-design.md](../specs/2026-05-08-sam-prompt-combo-and-eraser-design.md)

---

## File Structure

| File | Purpose | Action |
|------|---------|--------|
| `media/samPromptHelpers.js` | Pure helpers: `samHasPositivePrompt`, `mergeBoxIntoPrompts`, `cleanupOrphanNegatives` | **Create** |
| `test/samPromptHelpers.test.ts` | Unit tests for the helper functions | **Create** |
| `media/main.js` | Remove `samPromptType`, use helpers, add Shift routing + feedback | **Modify** |
| `src/LabelMePanel.ts` | Add `<script>` tag to load `samPromptHelpers.js` before `main.js` | **Modify** (one line) |

---

## Task 1: Extract pure helpers (TDD)

**Files:**
- Create: `media/samPromptHelpers.js`
- Create: `test/samPromptHelpers.test.ts`

The webview loads scripts via `<script>` tags (no module system). To make the helpers both browser-loadable and Node-testable, end the file with a CommonJS export shim guarded by `typeof module`.

- [ ] **Step 1.1: Write the failing test file**

Create `test/samPromptHelpers.test.ts`:

```typescript
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

const helpers = require('../media/samPromptHelpers.js');
const { samHasPositivePrompt, mergeBoxIntoPrompts, cleanupOrphanNegatives } = helpers;

describe('samHasPositivePrompt', () => {
    it('returns false for empty array', () => {
        assert.equal(samHasPositivePrompt([]), false);
    });
    it('returns false when only negative points exist', () => {
        assert.equal(samHasPositivePrompt([
            { type: 'point', data: [10, 10], label: 0 }
        ]), false);
    });
    it('returns true for a single positive point', () => {
        assert.equal(samHasPositivePrompt([
            { type: 'point', data: [10, 10], label: 1 }
        ]), true);
    });
    it('returns true for a single rectangle', () => {
        assert.equal(samHasPositivePrompt([
            { type: 'rectangle', data: [0, 0, 10, 10] }
        ]), true);
    });
    it('returns true when mix contains at least one positive prompt', () => {
        assert.equal(samHasPositivePrompt([
            { type: 'point', data: [1, 1], label: 0 },
            { type: 'rectangle', data: [0, 0, 5, 5] }
        ]), true);
    });
});

describe('mergeBoxIntoPrompts', () => {
    const newBox = { type: 'rectangle', data: [0, 0, 10, 10] };

    it('appends box when prompts are empty', () => {
        assert.deepEqual(mergeBoxIntoPrompts([], newBox), [newBox]);
    });
    it('preserves a positive point and appends box', () => {
        const point = { type: 'point', data: [3, 3], label: 1 };
        assert.deepEqual(mergeBoxIntoPrompts([point], newBox), [point, newBox]);
    });
    it('replaces an existing rectangle and keeps points', () => {
        const oldBox = { type: 'rectangle', data: [50, 50, 60, 60] };
        const point = { type: 'point', data: [3, 3], label: 1 };
        const neg = { type: 'point', data: [4, 4], label: 0 };
        assert.deepEqual(
            mergeBoxIntoPrompts([point, oldBox, neg], newBox),
            [point, neg, newBox]
        );
    });
});

describe('cleanupOrphanNegatives', () => {
    it('returns empty array when no positive remains', () => {
        const prompts = [
            { type: 'point', data: [1, 1], label: 0 },
            { type: 'point', data: [2, 2], label: 0 }
        ];
        assert.deepEqual(cleanupOrphanNegatives(prompts), []);
    });
    it('returns the input unchanged when at least one positive exists', () => {
        const prompts = [
            { type: 'point', data: [1, 1], label: 1 },
            { type: 'point', data: [2, 2], label: 0 }
        ];
        assert.deepEqual(cleanupOrphanNegatives(prompts), prompts);
    });
    it('returns empty array for empty input (idempotent)', () => {
        assert.deepEqual(cleanupOrphanNegatives([]), []);
    });
});
```

- [ ] **Step 1.2: Run tests, expect failure**

Run: `npm test`
Expected: FAIL with `Cannot find module '../media/samPromptHelpers.js'`

- [ ] **Step 1.3: Implement helpers**

Create `media/samPromptHelpers.js`:

```javascript
// Pure helpers for SAM prompt combination and Shift routing.
// Loaded as a <script> in the webview AND required from Node tests.

function samHasPositivePrompt(prompts) {
    return prompts.some(p =>
        p.type === 'rectangle' ||
        (p.type === 'point' && p.label === 1)
    );
}

function mergeBoxIntoPrompts(prompts, newBox) {
    return prompts.filter(p => p.type !== 'rectangle').concat([newBox]);
}

function cleanupOrphanNegatives(prompts) {
    return samHasPositivePrompt(prompts) ? prompts : [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { samHasPositivePrompt, mergeBoxIntoPrompts, cleanupOrphanNegatives };
}
```

- [ ] **Step 1.4: Run tests, expect pass**

Run: `npm test`
Expected: PASS — 3 new suites, 11 new test cases pass; the existing 5 still pass.

- [ ] **Step 1.5: Commit**

```bash
git add media/samPromptHelpers.js test/samPromptHelpers.test.ts
git commit -m "Add pure helpers for SAM prompt combination

samHasPositivePrompt, mergeBoxIntoPrompts, cleanupOrphanNegatives
extracted as a separate module so they can be unit-tested. The webview
loads the file via <script> tag (added in a later task); Node tests
require it via the CommonJS shim at the bottom of the file."
```

---

## Task 2: Wire helpers script into webview HTML

**Files:**
- Modify: `src/LabelMePanel.ts:677-679`
- Modify: `src/LabelMePanel.ts:1015` (add script tag)

- [ ] **Step 2.1: Add URI declaration**

Edit `src/LabelMePanel.ts` near line 677, after the polygon-clipping URI:

Old:
```typescript
        // Polygon-clipping library for eraser feature
        const polyClipPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'polygon-clipping.umd.min.js');
        const polyClipUri = webview.asWebviewUri(polyClipPath);
```

New (add after the polyClipUri line):
```typescript
        // Polygon-clipping library for eraser feature
        const polyClipPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'polygon-clipping.umd.min.js');
        const polyClipUri = webview.asWebviewUri(polyClipPath);

        // SAM prompt helpers (pure functions, must load before main.js)
        const samHelpersPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'samPromptHelpers.js');
        const samHelpersUri = webview.asWebviewUri(samHelpersPath);
```

- [ ] **Step 2.2: Add the script tag**

Edit `src/LabelMePanel.ts` around line 1015, in the script tag block:

Old:
```html
                <script src="${polyClipUri}"></script>
                <script src="${scriptUri}"></script>
```

New:
```html
                <script src="${polyClipUri}"></script>
                <script src="${samHelpersUri}"></script>
                <script src="${scriptUri}"></script>
```

- [ ] **Step 2.3: Compile to verify**

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 2.4: Commit**

```bash
git add src/LabelMePanel.ts
git commit -m "Load samPromptHelpers.js in webview before main.js"
```

---

## Task 3: Remove samPromptType state field

**Files:**
- Modify: `media/main.js` (8 sites: 102, 3496, 6065, 6116, 6136, 6149, 6210, 6310-6313)

The field is purely runtime state. With `samPrompts` now allowed to mix types, this field is dead.

- [ ] **Step 3.1: Delete the declaration**

In `media/main.js` line 102, remove:
```javascript
let samPromptType = null;         // 'point' | 'box'
```

- [ ] **Step 3.2: Remove from samClearState (around line 6065)**

Old:
```javascript
    samPrompts = [];
    samPromptType = null;
    samMaskContour = null;
```

New:
```javascript
    samPrompts = [];
    samMaskContour = null;
```

- [ ] **Step 3.3: Remove from samUndoLastPrompt (around line 6116)**

Old:
```javascript
        if (samPrompts.length === 0) {
            samDecodeVersion++;  // Invalidate any in-flight decode
            samPromptType = null;
            samMaskContour = null;
```

New:
```javascript
        if (samPrompts.length === 0) {
            samDecodeVersion++;  // Invalidate any in-flight decode
            samMaskContour = null;
```

- [ ] **Step 3.4: Remove from samConfirmAnnotation save block (around line 6136)**

Old:
```javascript
    samSavedStateBeforeConfirm = {
        prompts: JSON.parse(JSON.stringify(samPrompts)),
        promptType: samPromptType,
        maskContour: JSON.parse(JSON.stringify(samMaskContour)),
```

New:
```javascript
    samSavedStateBeforeConfirm = {
        prompts: JSON.parse(JSON.stringify(samPrompts)),
        maskContour: JSON.parse(JSON.stringify(samMaskContour)),
```

- [ ] **Step 3.5: Remove from samConfirmAnnotation reset (around line 6149)**

Old:
```javascript
    samPrompts = [];
    samPromptType = null;
    samMaskContour = null;
```

New:
```javascript
    samPrompts = [];
    samMaskContour = null;
```

- [ ] **Step 3.6: Remove from cancel-modal restore (around line 3496)**

Old:
```javascript
        if (samSavedStateBeforeConfirm) {
            samPrompts = samSavedStateBeforeConfirm.prompts;
            samPromptType = samSavedStateBeforeConfirm.promptType;
            samMaskContour = samSavedStateBeforeConfirm.maskContour;
```

New:
```javascript
        if (samSavedStateBeforeConfirm) {
            samPrompts = samSavedStateBeforeConfirm.prompts;
            samMaskContour = samSavedStateBeforeConfirm.maskContour;
```

- [ ] **Step 3.7: Remove from box finalize (line 6210, leave the rest until Task 4)**

Old:
```javascript
        samPrompts = [{ type: 'rectangle', data: [x1, y1, x2, y2] }];
        samPromptType = 'box';
        samBoxSecondClick = false;
```

New (keep the assignment as-is for now; Task 4 changes the merge logic):
```javascript
        samPrompts = [{ type: 'rectangle', data: [x1, y1, x2, y2] }];
        samBoxSecondClick = false;
```

- [ ] **Step 3.8: Remove the `samPromptType === 'box'` clearing in negative-point click (around line 6310)**

Old:
```javascript
            if (samPendingClick) {
                const label = samPendingClick.shiftKey ? 0 : 1;

                // If previous was box, clear it (point and box don't coexist)
                if (samPromptType === 'box') {
                    samPrompts = [];
                }
                samPromptType = 'point';

                const [spx, spy] = clampImageCoords(samPendingClick.x, samPendingClick.y);
                samPrompts.push({ type: 'point', data: [spx, spy], label: label });
```

New:
```javascript
            if (samPendingClick) {
                const label = samPendingClick.shiftKey ? 0 : 1;
                const [spx, spy] = clampImageCoords(samPendingClick.x, samPendingClick.y);
                samPrompts.push({ type: 'point', data: [spx, spy], label: label });
```

- [ ] **Step 3.9: Verify no remaining references**

Run: `grep -n samPromptType media/main.js`
Expected: no output.

- [ ] **Step 3.10: Compile + run tests**

Run: `npm run compile && npm test`
Expected: PASS (no syntax/type regressions; webview JS is not compiled but compile catches the LabelMePanel.ts change from Task 2).

- [ ] **Step 3.11: Commit**

```bash
git add media/main.js
git commit -m "Remove samPromptType, allow point and box prompts to coexist

The exclusivity field is no longer enforced. Negative-point clicks no
longer wipe an existing box; box finalize still does (Task 4 lifts that
into a single-instance helper)."
```

---

## Task 4: Apply box single-instance invariant via helper

**Files:**
- Modify: `media/main.js:6209` (the `samPrompts = [...]` in box finalize)

- [ ] **Step 4.1: Replace the assignment with the helper call**

Old (after Task 3, around line 6209):
```javascript
        samPrompts = [{ type: 'rectangle', data: [x1, y1, x2, y2] }];
        samBoxSecondClick = false;
```

New:
```javascript
        samPrompts = mergeBoxIntoPrompts(samPrompts, { type: 'rectangle', data: [x1, y1, x2, y2] });
        samBoxSecondClick = false;
```

- [ ] **Step 4.2: Verify helpers are reachable in webview**

Read top of `media/main.js` and confirm there is no early reference to `samPromptHelpers` — `mergeBoxIntoPrompts` is loaded as a global from the helper script tag. No import needed.

- [ ] **Step 4.3: Compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 4.4: Commit**

```bash
git add media/main.js
git commit -m "Use mergeBoxIntoPrompts: new box replaces old, points preserved"
```

---

## Task 5: Loosen eraser shift gate to allow SAM-empty case

**Files:**
- Modify: `media/main.js:1749`

- [ ] **Step 5.1: Update the gate condition**

Old:
```javascript
        // Shift+click to START eraser (only needed for the first click)
        if (e.shiftKey && currentMode !== 'sam' && currentMode !== 'view' && !isDrawing) {
            eraserMouseDownTime = Date.now();
```

New:
```javascript
        // Shift+click to START eraser (only needed for the first click).
        // In SAM mode, only allow eraser when no positive prompt is in progress —
        // otherwise Shift is reserved for adding a negative point.
        if (e.shiftKey
            && (currentMode !== 'sam' || !samHasPositivePrompt(samPrompts))
            && currentMode !== 'view'
            && !isDrawing) {
            eraserMouseDownTime = Date.now();
```

- [ ] **Step 5.2: Compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add media/main.js
git commit -m "Allow eraser in SAM mode when no positive prompt exists"
```

---

## Task 6: SAM mousedown bypass for shift+empty

**Files:**
- Modify: `media/main.js:6169-6191` (SAM mousedown capture handler)

The SAM capture handler currently calls `e.stopPropagation()` and prevents the main mousedown handler from running. When Shift is held with no positive prompt, we need to skip that — the main handler must run to start the eraser.

- [ ] **Step 6.1: Add the early bypass**

Insert after the `e.defaultPrevented` guard in `media/main.js` (around line 6173):

Old:
```javascript
canvasWrapper.addEventListener('mousedown', (e) => {
    if (currentMode !== 'sam' || e.button !== 0) return;

    // Skip if event was already consumed by another capture-phase handler (e.g. edit mode exit)
    if (e.defaultPrevented) return;

    // If click is on the context menu itself, let it handle the click
```

New:
```javascript
canvasWrapper.addEventListener('mousedown', (e) => {
    if (currentMode !== 'sam' || e.button !== 0) return;

    // Skip if event was already consumed by another capture-phase handler (e.g. edit mode exit)
    if (e.defaultPrevented) return;

    // Shift+mousedown with no positive SAM prompt: defer to the main handler,
    // which starts the eraser. We don't stopPropagation so the main handler runs.
    if (e.shiftKey && !samBoxSecondClick && !samHasPositivePrompt(samPrompts)) {
        return;
    }

    // If click is on the context menu itself, let it handle the click
```

The `!samBoxSecondClick` condition preserves the existing rule that Shift is ignored during box second-click finalization.

- [ ] **Step 6.2: Compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add media/main.js
git commit -m "Pass shift+mousedown to main handler when SAM has no positive prompt"
```

---

## Task 7: Undo orphan-cleanup

**Files:**
- Modify: `media/main.js:6111-6126` (samUndoLastPrompt)

- [ ] **Step 7.1: Replace the empty check with helper-based cleanup**

Old:
```javascript
function samUndoLastPrompt() {
    if (samPrompts.length > 0) {
        samPrompts.pop();
        if (samPrompts.length === 0) {
            samDecodeVersion++;  // Invalidate any in-flight decode
            samMaskContour = null;
            samCachedCrop = null;
            samCurrentImagePath = null;
            samIsFreshSequence = true;
            draw();
        } else {
            samDecode();
        }
    }
}
```

New:
```javascript
function samUndoLastPrompt() {
    if (samPrompts.length > 0) {
        samPrompts.pop();
        samPrompts = cleanupOrphanNegatives(samPrompts);
        if (samPrompts.length === 0) {
            samDecodeVersion++;  // Invalidate any in-flight decode
            samMaskContour = null;
            samCachedCrop = null;
            samCurrentImagePath = null;
            samIsFreshSequence = true;
            draw();
        } else {
            samDecode();
        }
    }
}
```

- [ ] **Step 7.2: Compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
git add media/main.js
git commit -m "Drop orphan negative prompts on undo when no positive remains"
```

---

## Task 8: Shift visual feedback (cursor + status bar)

**Files:**
- Modify: `media/main.js` (state, listeners, `updateShiftFeedback`)

- [ ] **Step 8.1: Add state declarations**

Edit `media/main.js` near line 117 (after the SAM state block, before `// --- Eraser State ---`):

```javascript
// --- Shift feedback state ---
let shiftPressed = false;
let prevStatusText = null;       // Status before Shift took over
let prevStatusColor = null;
let lastFeedbackText = null;     // What we last wrote, for safe restore
const ERASER_CURSOR_DATA_URI = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'>' +
    '<path d=\'M3 17l6-6 5 5 7-7v3l-7 7-5-5-6 6z\' fill=\'%23ff6b35\' stroke=\'white\' stroke-width=\'1.5\'/>' +
    '</svg>'
) + '") 2 22, crosshair';
```

- [ ] **Step 8.2: Add the feedback function**

Append near the SAM logic block (after `samEnsureEncoded`, around line 6109):

```javascript
function updateShiftFeedback() {
    if (!shiftPressed || currentMode === 'view') {
        // Restore prior status only if nothing else has overwritten it.
        if (lastFeedbackText !== null && statusSpan.textContent === lastFeedbackText) {
            statusSpan.textContent = prevStatusText ?? '';
            statusSpan.style.color = prevStatusColor ?? '';
        }
        prevStatusText = null;
        prevStatusColor = null;
        lastFeedbackText = null;
        // Cursor reset is handled by the existing mousemove cursor logic;
        // force one redraw cycle by clearing currentCursor.
        currentCursor = null;
        canvasWrapper.style.cursor = '';
        return;
    }

    // Snapshot prior state on first transition to feedback.
    if (lastFeedbackText === null) {
        prevStatusText = statusSpan.textContent;
        prevStatusColor = statusSpan.style.color;
    }

    let text, color, cursor;
    if (currentMode === 'sam' && samHasPositivePrompt(samPrompts)) {
        text = 'SAM: Negative point';
        color = '#ff4444';
        cursor = 'crosshair';
    } else {
        // SAM-empty or any non-SAM annotation mode: eraser
        text = currentMode === 'sam' ? 'SAM: Eraser mode' : 'Eraser mode';
        color = '#ff8800';
        cursor = ERASER_CURSOR_DATA_URI;
    }

    statusSpan.textContent = text;
    statusSpan.style.color = color;
    canvasWrapper.style.cursor = cursor;
    currentCursor = cursor;
    lastFeedbackText = text;
}
```

- [ ] **Step 8.3: Add Shift keydown/keyup listeners**

Append at the end of the existing `document.addEventListener('keydown', ...)` block, OR add a separate listener pair near the existing keydown handlers (around line 1314). Use a separate pair for clarity:

Insert near line 1314 (before the existing keydown handler, OR after — order doesn't matter since neither calls `e.preventDefault` for Shift):

```javascript
document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !shiftPressed) {
        // Skip when modals are open (mirrors the existing keydown gate)
        if (labelModal.style.display === 'flex') return;
        if (samConfigModal && samConfigModal.style.display === 'flex') return;
        if (colorPickerModal && colorPickerModal.style.display === 'flex') return;
        if (onnxInferModal && onnxInferModal.style.display === 'flex') return;
        // Skip when typing in inputs (Shift is just capitalization there)
        const focusedTag = document.activeElement?.tagName;
        if (focusedTag === 'INPUT' || focusedTag === 'TEXTAREA' || focusedTag === 'SELECT') return;
        // Skip if eraser is mid-draw (don't interfere with active gesture)
        if (eraserActive) return;
        shiftPressed = true;
        updateShiftFeedback();
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        shiftPressed = false;
        updateShiftFeedback();
    }
});

window.addEventListener('blur', () => {
    if (shiftPressed) {
        shiftPressed = false;
        updateShiftFeedback();
    }
});
```

- [ ] **Step 8.4: Hook state mutations to refresh feedback**

Add `updateShiftFeedback();` call at the end of these functions in `media/main.js`:

1. After `samDecode()` resolves (insert at the end of the success branch, after `draw();`):

   Find the line `draw();` inside the `if (data.ok) {` branch of `samDecode` (around line 6049) and insert:
   ```javascript
                draw();
                updateShiftFeedback();
   ```

2. At the end of `samUndoLastPrompt` (after the closing brace of the inner `if/else`, before the function's closing `}`, around line 6126):

   ```javascript
       }
       updateShiftFeedback();
   }
   ```

3. After the box-finalize draw+decode (line 6216):

   Old:
   ```javascript
        samPrompts = mergeBoxIntoPrompts(samPrompts, { type: 'rectangle', data: [x1, y1, x2, y2] });
        samBoxSecondClick = false;
        samDragStart = null;
        samDragCurrent = null;
        samIsDragging = false;
        draw();
        samDecode();
   ```

   New:
   ```javascript
        samPrompts = mergeBoxIntoPrompts(samPrompts, { type: 'rectangle', data: [x1, y1, x2, y2] });
        samBoxSecondClick = false;
        samDragStart = null;
        samDragCurrent = null;
        samIsDragging = false;
        draw();
        updateShiftFeedback();
        samDecode();
   ```

4. After the negative/positive point push (around line 6316):

   Old:
   ```javascript
                samPrompts.push({ type: 'point', data: [spx, spy], label: label });
                samPendingClick = null;
                draw();
                samDecode();
   ```

   New:
   ```javascript
                samPrompts.push({ type: 'point', data: [spx, spy], label: label });
                samPendingClick = null;
                draw();
                updateShiftFeedback();
                samDecode();
   ```

5. In `samClearState` (around line 6077, after `draw();`):

   ```javascript
       statusSpan.textContent = '';
       statusSpan.style.color = '';
       draw();
       updateShiftFeedback();
   ```

6. In `samConfirmAnnotation` (after `samPrompts = []` and friends, around line 6160, before `showLabelModal()`):

   Insert before `showLabelModal();`:
   ```javascript
       isDrawing = false;
       updateShiftFeedback();
       showLabelModal();
   ```

- [ ] **Step 8.5: Compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 8.6: Commit**

```bash
git add media/main.js
git commit -m "Add Shift keypress visual feedback (cursor + status bar)

Track shiftPressed via document keydown/keyup. updateShiftFeedback
chooses between eraser and negative-point feedback based on
samHasPositivePrompt, with status restored on Shift release if it
hasn't been clobbered. Window blur resets the held state."
```

---

## Task 9: Manual UI verification

**Files:**
- None (test plan execution only)

The webview event handlers cannot be unit-tested without significant refactor. Run a manual checklist in a VS Code dev host with the SAM service running.

- [ ] **Step 9.1: Launch dev host**

Run: `code --extensionDevelopmentPath=. --new-window` (or use VS Code's Run Extension launch config). Open a folder with images, start the SAM service per project README, open an image, click the SAM mode button.

- [ ] **Step 9.2: Run the test matrix**

Verify each row produces the expected outcome — fail fast on any miss.

| # | Setup | Action | Expected |
|---|-------|--------|----------|
| 1 | SAM mode, no prompts | Drag a box | Box appears, mask renders |
| 2 | After #1 | Click inside the mask area | Positive point added, mask updates, **box still visible** |
| 3 | After #2 | Shift+click outside the mask | Negative point added, mask shrinks, status briefly reads "SAM: Negative point" while Shift held |
| 4 | After #3 | Drag a different box | New box replaces old, **points still visible**, mask updates |
| 5 | After #4 | Hold Shift (no click) | Status reads "SAM: Negative point", cursor stays crosshair |
| 6 | After #4, release Shift | Press Ctrl+Z to undo (or whatever undo binding is wired) | Last prompt removed |
| 7 | Empty SAM (no prompts) | Hold Shift | Cursor changes to eraser, status reads "SAM: Eraser mode" |
| 8 | After #7 | Shift+click on a polygon | Polygon eraser starts (first click placed) |
| 9 | After #8 | Click again to close polygon eraser | Eraser applies; SAM state still empty |
| 10 | Empty SAM | Shift+long-press+drag | Rectangle eraser starts |
| 11 | After #10 | Click for 2nd corner | Rectangle eraser applies |
| 12 | Has positive point + negative point | Undo positive | All prompts cleared (orphan negative gone), mask cleared |
| 13 | Box mid-creation (1st click placed) | Hold Shift, click for 2nd corner | Box completes normally — Shift ignored |
| 14 | SAM mode, hold Shift | Alt-Tab away and back | Cursor and status reset (blur handler) |
| 15 | SAM mode, hold Shift | Switch to View mode | Cursor and status reset |

- [ ] **Step 9.3: If any case fails, fix and re-run that case**

For UI bugs: identify the failing handler in `media/main.js`, fix in place, reload the extension (`Ctrl+R` in dev host), re-run the failing case. Do not commit until all 15 cases pass.

- [ ] **Step 9.4: Final regression check**

Run: `npm test && npm run compile`
Expected: all tests pass, no compile errors.

- [ ] **Step 9.5: Final commit (only if any fixes were made in 9.3)**

```bash
git add media/main.js
git commit -m "Fix UI regressions found in manual test pass"
```

---

## Self-Review Checklist (post-execution)

After all tasks complete:

1. `grep -rn samPromptType media/ src/` → empty.
2. `grep -n updateShiftFeedback media/main.js` → at least the 6 hook sites + the function definition.
3. `npm test` → 8 tests pass (5 existing + 3 new helper suites with 11 cases).
4. `npm run compile` → no errors.
5. The 15-case manual test matrix all green.
6. All commits are atomic and titled per task.
