# Click-through guard, SAM rectangle output, on-canvas class labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three opt-in toggles to the LabelEditor webview: (1) "draw over instances" in non-view modes, (2) SAM output as an axis-aligned rectangle, (3) on-canvas class-name labels.

**Architecture:** Three independent features sharing one new pure-helper module. A new `media/shapeHelpers.js` holds the testable logic (click gate, contour→bbox, label anchor), loaded as a `<script>` before `main.js` and `require`d by Node tests — mirroring `media/samPromptHelpers.js`. Settings persist through the existing `saveGlobalSettings` / `initialGlobalSettings` plumbing. All toggles default to current behavior, so nothing changes unless the user opts in.

**Tech Stack:** TypeScript (extension host, `src/LabelMePanel.ts`), vanilla JS webview (`media/*.js`), SVG overlay rendering, `node:test` + `node:assert` unit tests compiled via `tsconfig.test.json`.

---

## File Structure

- **Create** `media/shapeHelpers.js` — pure helpers: `allowSelectByClick`, `contourToBBoxRect`, `labelAnchorFromPoints`. Loaded in webview + required by tests.
- **Create** `test/shapeHelpers.test.ts` — unit tests for the three helpers.
- **Modify** `src/LabelMePanel.ts` — register the helper script URI; add three keys to `initialGlobalSettings`; add SAM "Output Shape" radio group + two More-Settings toggle rows to the HTML.
- **Modify** `media/main.js` — state vars + load; click gate (mousedown + SAM idle); SAM modal read/restore/persist + confirm conversion + shape_type + preview; `drawShapeLabel` + call site; More-Settings toggle wiring.
- **Modify** `media/i18n.js` — new label/header strings in `en` and `zh-CN` dicts.

Conventions to follow (do not deviate): pure logic goes in helper modules with a `module.exports` footer; settings load with the `vscodeState ?? initialGlobalSettings ?? default` fallback; persistence calls `saveGlobalSettings(key, value)`.

---

## Task 1: Pure helper module + tests (TDD)

**Files:**
- Create: `media/shapeHelpers.js`
- Test: `test/shapeHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/shapeHelpers.test.ts`:

```typescript
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Test runs from out-test/test/, so resolve to <repo-root>/media/shapeHelpers.js
const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'shapeHelpers.js'));
const { allowSelectByClick, contourToBBoxRect, labelAnchorFromPoints } = helpers;

describe('allowSelectByClick', () => {
    it('always allows selection in view mode, regardless of the guard', () => {
        assert.equal(allowSelectByClick('view', false), true);
        assert.equal(allowSelectByClick('view', true), true);
    });
    it('allows selection in drawing modes when the guard is off', () => {
        for (const m of ['point', 'line', 'polygon', 'rectangle', 'circle', 'sam']) {
            assert.equal(allowSelectByClick(m, false), true);
        }
    });
    it('blocks selection in drawing modes when the guard is on', () => {
        for (const m of ['point', 'line', 'polygon', 'rectangle', 'circle', 'sam']) {
            assert.equal(allowSelectByClick(m, true), false);
        }
    });
});

describe('contourToBBoxRect', () => {
    it('returns the 2-point axis-aligned bbox of a contour', () => {
        assert.deepEqual(
            contourToBBoxRect([[10, 20], [30, 5], [25, 40], [8, 12]]),
            [[8, 5], [30, 40]]
        );
    });
    it('returns null for missing / empty / non-array input', () => {
        assert.equal(contourToBBoxRect(null), null);
        assert.equal(contourToBBoxRect(undefined), null);
        assert.equal(contourToBBoxRect([]), null);
        assert.equal(contourToBBoxRect('nope' as any), null);
    });
    it('skips malformed / non-finite points and uses the rest', () => {
        assert.deepEqual(
            contourToBBoxRect([[1, 1], ['x', 2] as any, [3], [NaN, 9], [4, 6]]),
            [[1, 1], [4, 6]]
        );
    });
    it('returns null when no point is usable', () => {
        assert.equal(contourToBBoxRect([[NaN, NaN], [3]]), null);
    });
});

describe('labelAnchorFromPoints', () => {
    it('returns the top-left (min x, min y) corner', () => {
        assert.deepEqual(
            labelAnchorFromPoints([[10, 20], [30, 5], [25, 40]]),
            { x: 10, y: 5 }
        );
    });
    it('returns null for missing / empty input', () => {
        assert.equal(labelAnchorFromPoints(null), null);
        assert.equal(labelAnchorFromPoints([]), null);
    });
    it('ignores malformed points', () => {
        assert.deepEqual(
            labelAnchorFromPoints([[5, 5], [2] as any, [3, 9]]),
            { x: 3, y: 5 }
        );
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module .../media/shapeHelpers.js` (file does not exist yet).

- [ ] **Step 3: Write the helper module**

Create `media/shapeHelpers.js`:

```javascript
// Pure helpers for canvas shape interaction, SAM output shaping, and class
// label placement. Loaded as a <script> in the webview AND required from Node
// tests. No DOM access here.

// Feature 1: whether a left-click should be allowed to SELECT an existing
// instance. View mode is always selectable; other (drawing) modes only when
// the "draw over instances" guard is off.
function allowSelectByClick(currentMode, drawClickThrough) {
    return currentMode === 'view' || !drawClickThrough;
}

// Feature 2: reduce a SAM mask contour (array of [x, y]) to an axis-aligned
// rectangle in the 2-point format [[minX, minY], [maxX, maxY]]. Returns null
// when the contour is missing or has no usable points.
function contourToBBoxRect(contour) {
    if (!Array.isArray(contour) || contour.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;
    for (const p of contour) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = p[0], y = p[1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
    }
    if (count === 0) return null;
    return [[minX, minY], [maxX, maxY]];
}

// Feature 3: top-left anchor (image coords) for an instance's class label,
// computed from already-expanded polygon points (the caller pre-expands
// rectangles to 4 corners). Returns { x, y } or null when no point is usable.
function labelAnchorFromPoints(points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    let minX = Infinity, minY = Infinity;
    let found = false;
    for (const p of points) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = p[0], y = p[1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        found = true;
    }
    if (!found) return null;
    return { x: minX, y: minY };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { allowSelectByClick, contourToBBoxRect, labelAnchorFromPoints };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `shapeHelpers` tests green, existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add media/shapeHelpers.js test/shapeHelpers.test.ts
git commit -m "feat: add shapeHelpers pure module (click gate, bbox, label anchor)"
```

---

## Task 2: Wire helper into webview + settings plumbing + i18n

This task adds no behavior; it makes the helper available in the webview and threads the three new settings through persistence so later tasks can read them. After this task the extension compiles and runs unchanged.

**Files:**
- Modify: `src/LabelMePanel.ts:795-797` (URI), `src/LabelMePanel.ts:1308` (script tag), `src/LabelMePanel.ts:1294-1296` (initialGlobalSettings)
- Modify: `media/main.js:128` & `:279` (state vars), `:426` & `:415` (load)
- Modify: `media/i18n.js` (en ~line 19/45, zh-CN ~line 413/437)

- [ ] **Step 1: Register the helper script URI**

In `src/LabelMePanel.ts`, after the merge-helpers URI block (currently lines 795-797), add:

```typescript
        // Shape helpers (pure functions, must load before main.js)
        const shapeHelpersPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'shapeHelpers.js');
        const shapeHelpersUri = webview.asWebviewUri(shapeHelpersPath);
```

- [ ] **Step 2: Add the script tag**

In `src/LabelMePanel.ts`, after the `mergeHelpersUri` script tag (line 1308), add:

```html
                <script src="${shapeHelpersUri}"></script>
```

- [ ] **Step 3: Add three keys to initialGlobalSettings**

In `src/LabelMePanel.ts`, inside the `initialGlobalSettings` object, after the `samEncodeAdjusted` line (1295), add:

```typescript
                        samOutputFormat: ${JSON.stringify(this._globalState.get('samOutputFormat') || 'polygon')},
                        drawClickThrough: ${this._globalState.get('drawClickThrough') ?? false},
                        showShapeLabels: ${this._globalState.get('showShapeLabels') ?? false},
```

- [ ] **Step 4: Declare webview state vars**

In `media/main.js`, after the `samEncodeMode` declaration (line 128), add:

```javascript
let samOutputFormat = 'polygon'; // 'polygon' | 'rectangle' — SAM result shape type
```

After the `lockViewEnabled` declaration (line 279), add:

```javascript
let drawClickThrough = false; // when true, clicks in non-view modes start drawing over existing instances
let showShapeLabels = false;  // when true, draw each instance's class name on the canvas
```

- [ ] **Step 5: Load the vars with the standard fallback**

In `media/main.js`, after the `samEncodeMode` restore block (lines 426-429), add:

```javascript
if (vscodeState && vscodeState.samOutputFormat) {
    samOutputFormat = vscodeState.samOutputFormat;
} else if (initialGlobalSettings.samOutputFormat) {
    samOutputFormat = initialGlobalSettings.samOutputFormat;
}
```

Near the `lockViewEnabled` restore block (lines 415-419), add:

```javascript
if (vscodeState && vscodeState.drawClickThrough !== undefined) {
    drawClickThrough = vscodeState.drawClickThrough;
} else if (initialGlobalSettings.drawClickThrough !== undefined) {
    drawClickThrough = initialGlobalSettings.drawClickThrough;
}
if (vscodeState && vscodeState.showShapeLabels !== undefined) {
    showShapeLabels = vscodeState.showShapeLabels;
} else if (initialGlobalSettings.showShapeLabels !== undefined) {
    showShapeLabels = initialGlobalSettings.showShapeLabels;
}
```

- [ ] **Step 6: Add i18n strings**

In `media/i18n.js`, in the **`en`** dict add (next to the existing `settings.appearance` / `label.encodeMode` lines):

```javascript
            'settings.annotationBehavior': 'Annotation Behavior',
            'label.drawClickThrough': 'Draw over instances',
            'label.showShapeLabels': 'Show class names',
            'label.samOutputFormat': 'Output Shape',
            'sam.outputPolygon': 'Polygon',
            'sam.outputRectangle': 'Rectangle',
```

In the **`zh-CN`** dict add the same keys:

```javascript
            'settings.annotationBehavior': '标注行为',
            'label.drawClickThrough': '允许在实例上起笔',
            'label.showShapeLabels': '显示类名',
            'label.samOutputFormat': '输出形状',
            'sam.outputPolygon': '多边形',
            'sam.outputRectangle': '矩形',
```

- [ ] **Step 7: Compile and run tests**

Run: `npm run compile && npm test`
Expected: compile succeeds, all tests still PASS (no behavior change yet).

- [ ] **Step 8: Commit**

```bash
git add src/LabelMePanel.ts media/main.js media/i18n.js
git commit -m "chore: load shapeHelpers and thread three new settings through persistence"
```

---

## Task 3: Feature 1 — click-through guard in drawing modes

**Files:**
- Modify: `media/main.js:1938` (mousedown gate), `:7797` (SAM idle gate)
- Modify: `src/LabelMePanel.ts:1243` (More-Settings toggle row)
- Modify: `media/main.js` (toggle wiring + modal sync)

- [ ] **Step 1: Gate the mousedown hit-test/selection block**

In `media/main.js`, in the `!isDrawing` branch, replace the line that reads (line 1938):

```javascript
            const overlappingShapes = findAllShapesAt(x, y);
```

with:

```javascript
            const overlappingShapes = allowSelectByClick(currentMode, drawClickThrough)
                ? findAllShapesAt(x, y)
                : [];
```

When the guard blocks selection, `overlappingShapes` is empty, so control falls through to the existing "click on empty area" path and the drawing-start branches (lines 1968-2011) run unchanged.

- [ ] **Step 2: Gate the SAM idle selection handler**

In `media/main.js`, in the SAM mousedown capture handler (lines 7797-7801), replace:

```javascript
    if (samPrompts.length === 0 && !samMaskContour && !samPendingClick && !samClickTimer) {
        const overlappingShapes = findAllShapesAt(x, y);
        if (overlappingShapes.length > 0) {
            return; // Don't stopPropagation — main handler will select the shape
        }
    }
```

with:

```javascript
    if (samPrompts.length === 0 && !samMaskContour && !samPendingClick && !samClickTimer
        && allowSelectByClick('sam', drawClickThrough)) {
        const overlappingShapes = findAllShapesAt(x, y);
        if (overlappingShapes.length > 0) {
            return; // Don't stopPropagation — main handler will select the shape
        }
    }
```

When the guard is on, this block is skipped and the SAM interaction proceeds to place a prompt over the existing instance.

- [ ] **Step 3: Add the More-Settings toggle row (new "Annotation Behavior" group)**

In `src/LabelMePanel.ts`, immediately before the `Keyboard Shortcuts` group header (line 1245), insert:

```html
                        <div class="settings-group-header" data-i18n="settings.annotationBehavior">Annotation Behavior</div>
                        <div class="more-settings-row">
                            <label data-i18n="label.drawClickThrough">Draw over instances</label>
                            <button id="drawClickThroughToggleBtn" class="channel-btn">Off</button>
                        </div>
```

- [ ] **Step 4: Wire the toggle in main.js**

In `media/main.js`, near the other More-Settings/toggle wiring (after the `claheToggleBtn` block around line 6386), add:

```javascript
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
    };
}
```

- [ ] **Step 5: Sync the toggle UI when the modal opens**

In `media/main.js`, inside `showMoreSettingsModal` (line 5812), add a call to the updater before the modal is shown:

```javascript
    updateDrawClickThroughToggleUI();
```

(If `showShapeLabels`' updater from Task 5 also lands here, both calls sit together.)

- [ ] **Step 6: Compile and run tests**

Run: `npm run compile && npm test`
Expected: compile succeeds, all tests PASS.

- [ ] **Step 7: Manual smoke check**

Launch the Extension Development Host (F5). With the toggle **Off** (default): in polygon mode, clicking an existing polygon selects it (unchanged). Open More Settings → Annotation Behavior → turn **On**: in polygon mode, clicking inside an existing polygon now starts a new polygon vertex instead of selecting; right-click still selects/deletes. Confirm the setting survives closing/reopening the editor.

- [ ] **Step 8: Commit**

```bash
git add src/LabelMePanel.ts media/main.js
git commit -m "feat: optional click-through guard to draw over existing instances"
```

---

## Task 4: Feature 2 — SAM rectangle output

**Files:**
- Modify: `src/LabelMePanel.ts:1171` (SAM modal radio group)
- Modify: `media/main.js:7161` (restore), `:7210-7219` (persist + apply), `:7704-7705` (confirm conversion), `:3970-3972` (shape_type), `:7949-7958` (preview)

- [ ] **Step 1: Add the "Output Shape" radio group to the SAM modal**

In `src/LabelMePanel.ts`, after the Port form group (line 1171, `</div>` closing the port group) and before `<div class="modal-buttons">`, insert:

```html
                        <div class="onnx-form-group">
                            <label data-i18n="label.samOutputFormat">Output Shape</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="samOutputFormat" value="polygon" checked /> <span data-i18n="sam.outputPolygon">Polygon</span></label>
                                <label class="onnx-radio"><input type="radio" name="samOutputFormat" value="rectangle" /> <span data-i18n="sam.outputRectangle">Rectangle</span></label>
                            </div>
                        </div>
```

- [ ] **Step 2: Restore the radio when the modal opens**

In `media/main.js`, in `showSamConfigModal`, after the `restoreRadio('samEncodeMode', ...)` line (7161), add:

```javascript
    restoreRadio('samOutputFormat', savedState.samOutputFormat ?? gs.samOutputFormat ?? 'polygon');
```

- [ ] **Step 3: Read, persist, and apply the setting in submitSamConfig**

In `media/main.js` `submitSamConfig`, after the `encodeAdjusted` read (line 7192), add:

```javascript
    const outputFormat = document.querySelector('input[name="samOutputFormat"]:checked')?.value || 'polygon';
```

In the same function, change the `settings` object (line 7210) to include the new key:

```javascript
    const settings = { samModelDir: modelDir, samPythonPath: pythonPath, samDevice: device, samPort: port, samEncodeMode: encodeMode, samEncodeAdjusted: encodeAdjusted, samGpuIndex: gpuIndex ?? -1, samOutputFormat: outputFormat };
```

After the `samEncodeMode = encodeMode;` line (7219), add:

```javascript
    samOutputFormat = outputFormat;
```

(The existing `for (const [key, value] of Object.entries(settings))` loop already persists `samOutputFormat` via `saveGlobalSettings`, and `Object.assign(state, settings)` mirrors it into vscode state.)

- [ ] **Step 4: Convert the contour at confirm time**

In `media/main.js` `samConfirmAnnotation`, replace the line (7705):

```javascript
    currentPoints = samMaskContour.map(p => [p[0], p[1]]);
```

with:

```javascript
    if (samOutputFormat === 'rectangle') {
        const rect = contourToBBoxRect(samMaskContour);
        currentPoints = rect ? rect : samMaskContour.map(p => [p[0], p[1]]);
    } else {
        currentPoints = samMaskContour.map(p => [p[0], p[1]]);
    }
```

- [ ] **Step 5: Emit the right shape_type**

In `media/main.js`, in the shape-creation block, replace the SAM branch (lines 3970-3971):

```javascript
        } else if (currentMode === 'sam') {
            shapeType = 'polygon'; // SAM always produces polygon shapes
        }
```

with:

```javascript
        } else if (currentMode === 'sam') {
            // SAM produces a polygon by default; rectangle when the user chose
            // that output shape AND currentPoints is the 2-point bbox form.
            shapeType = (samOutputFormat === 'rectangle' && currentPoints.length === 2) ? 'rectangle' : 'polygon';
        }
```

- [ ] **Step 6: Make the live preview WYSIWYG**

In `media/main.js` `drawSAMOverlay`, replace the mask-contour block (lines 7949-7958):

```javascript
    if (samMaskContour && samMaskContour.length >= 3) {
        const polygon = document.createElementNS(SVG_NS, 'polygon');
        const pointsStr = samMaskContour.map(p => `${p[0]},${p[1]}`).join(' ');
        polygon.setAttribute('points', pointsStr);
        polygon.setAttribute('fill', 'rgba(30, 144, 255, 0.35)');
        polygon.setAttribute('stroke', 'rgba(30, 144, 255, 0.9)');
        polygon.setAttribute('stroke-width', sw * 1.5);
        polygon.style.pointerEvents = 'none';
        svgOverlay.appendChild(polygon);
    }
```

with:

```javascript
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
```

(`getRectPoints` already exists — it expands `[[minX,minY],[maxX,maxY]]` to four corners, see `media/main.js:5256`.)

- [ ] **Step 7: Compile and run tests**

Run: `npm run compile && npm test`
Expected: compile succeeds, all tests PASS.

- [ ] **Step 8: Manual smoke check**

In the Extension Development Host: open the SAM config, set Output Shape = **Rectangle**, start the service. Make a SAM prompt — the live preview shows a blue **rectangle** around the mask; confirming creates a `rectangle` instance (verify in the instance list / saved JSON: `shape_type: "rectangle"`, two points). Switch Output Shape back to **Polygon** and confirm the next result is a polygon. Confirm the choice persists across editor reopen.

- [ ] **Step 9: Commit**

```bash
git add src/LabelMePanel.ts media/main.js
git commit -m "feat: optional SAM rectangle output with WYSIWYG preview"
```

---

## Task 5: Feature 3 — on-canvas class labels

**Files:**
- Modify: `media/main.js:4880` (call site in `drawSVGAnnotations`), new `drawShapeLabel` function near it
- Modify: `src/LabelMePanel.ts:1236` (More-Settings toggle row under Appearance)
- Modify: `media/main.js` (toggle wiring + modal sync)

- [ ] **Step 1: Add the `drawShapeLabel` function**

In `media/main.js`, immediately after `drawSVGAnnotations` (after line 4881's `});` closing the forEach is inside the function — place the new function right after the whole `drawSVGAnnotations` function body, e.g. before `drawSAMOverlay` or near `drawPixelValues`). Add:

```javascript
// Draw an instance's class name as a small colored pill at its top-left.
// `points` is already rect-expanded by the caller; `color` is the shape's stroke.
function drawShapeLabel(shape, points, color) {
    const label = shape && shape.label;
    if (!label) return;
    const anchor = labelAnchorFromPoints(points);
    if (!anchor) return;

    const fontSize = 12 / zoomLevel;
    const padX = 4 / zoomLevel;
    const padY = 2 / zoomLevel;

    // Text first, so we can measure it, then put the pill behind it.
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', anchor.x + padX);
    text.setAttribute('y', anchor.y - padY);
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-size', fontSize);
    text.setAttribute('font-family', 'sans-serif');
    text.setAttribute('dominant-baseline', 'alphabetic');
    text.style.pointerEvents = 'none';
    text.textContent = label;
    svgOverlay.appendChild(text);

    let box;
    try { box = text.getBBox(); } catch (e) { box = null; }
    if (!box || box.width === 0) return; // not measurable yet; skip pill this frame

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', box.x - padX);
    rect.setAttribute('y', box.y - padY);
    rect.setAttribute('width', box.width + padX * 2);
    rect.setAttribute('height', box.height + padY * 2);
    rect.setAttribute('rx', 2 / zoomLevel);
    rect.setAttribute('fill', color);
    rect.style.pointerEvents = 'none';
    // Insert the pill BEHIND the text.
    svgOverlay.insertBefore(rect, text);
}
```

- [ ] **Step 2: Call it from the shapes loop**

In `media/main.js` `drawSVGAnnotations`, after the `drawSVGShape(...)` call (line 4880) and before the forEach closes, add:

```javascript
        if (showShapeLabels && shape.label) {
            drawShapeLabel(shape, points, colors.stroke);
        }
```

(`points` here is already rect-expanded for rectangles per line 4876-4878; `colors` is in scope from line 4863.)

- [ ] **Step 3: Add the More-Settings toggle row (under Appearance)**

In `src/LabelMePanel.ts`, insert directly after the Language `more-settings-row` (it ends at line 1243) so this becomes the last row under the **Appearance** header, before the next `settings-group-header`:

```html
                        <div class="more-settings-row">
                            <label data-i18n="label.showShapeLabels">Show class names</label>
                            <button id="showShapeLabelsToggleBtn" class="channel-btn">Off</button>
                        </div>
```

- [ ] **Step 4: Wire the toggle in main.js**

In `media/main.js`, near the Task 3 toggle wiring, add:

```javascript
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
```

- [ ] **Step 5: Sync the toggle UI when the modal opens**

In `media/main.js` `showMoreSettingsModal` (line 5812), alongside the Task 3 call, add:

```javascript
    updateShowShapeLabelsToggleUI();
```

- [ ] **Step 6: Compile and run tests**

Run: `npm run compile && npm test`
Expected: compile succeeds, all tests PASS.

- [ ] **Step 7: Manual smoke check**

In the Extension Development Host: with the toggle **Off** (default) no labels appear (unchanged). Open More Settings → Appearance → turn **Show class names On**: every visible instance shows its class name in a colored pill at its top-left; the pill color matches the instance color; labels do not block clicks (you can still select/draw through them). Zoom in/out and pan — the label text stays a readable, roughly constant on-screen size and the pill tracks the shape. Switch language to 中文 and reopen More Settings — the toggle label/On-Off text is localized. Confirm the setting persists across editor reopen.

- [ ] **Step 8: Commit**

```bash
git add src/LabelMePanel.ts media/main.js
git commit -m "feat: optional on-canvas class-name labels"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test + compile**

Run: `npm run compile && npm test`
Expected: compile clean; all unit tests PASS (including the new `shapeHelpers` suite).

- [ ] **Step 2: Cross-feature manual smoke**

In one Extension Development Host session verify the three features do not interfere:
1. Turn **all three** toggles on. Draw a polygon over an existing instance (click-through works), the new instance shows a class-name pill.
2. SAM rectangle output: confirm a rectangle instance, which also shows its class-name pill at its top-left.
3. Reload the editor — all three settings restore from global state. Switch language and confirm the More-Settings labels and SAM "Output Shape" radio labels are localized in both `en` and `zh-CN`.

- [ ] **Step 3: Final commit (if any doc/cleanup needed)**

Only commit if there is uncommitted cleanup. Otherwise the per-task commits stand.

---

## Notes for the implementer

- The SVG overlay is rebuilt every `draw()`; `getBBox()` in `drawShapeLabel` works because the `<text>` is appended to the live, rendered SVG before measuring. If a label's pill is ever missing on the first frame (text not yet laid out), the next `draw()` (any pan/zoom/selection) fixes it — acceptable and self-correcting.
- Do **not** touch `scripts/sam_service.py`, `src/exportFormats.ts`, or export logic — rectangles created by SAM are ordinary `rectangle` shapes already handled by existing export/render code.
- Keep all three toggles defaulting to the pre-existing behavior (`drawClickThrough=false`, `showShapeLabels=false`, `samOutputFormat='polygon'`).
