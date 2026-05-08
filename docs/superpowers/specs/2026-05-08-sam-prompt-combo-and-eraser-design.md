# SAM Prompt Combination + Eraser Support — Design

**Date:** 2026-05-08
**Branch:** `feature/sam-prompt-combo-eraser`
**Status:** Approved (no separate user review pass per request)

---

## Background

Two related friction points in SAM mode:

1. **Point and box prompts are mutually exclusive.** The frontend tracks `samPromptType` as `'point' | 'box'` and clears the prompt array whenever the user switches modality. Adding a point after drawing a box discards the box, and vice versa. Reference tools (X-AnyLabeling, EISeg, Roboflow) instead support a single box plus arbitrary positive/negative refinement points — a strictly more expressive subset that the SAM ONNX backend already handles natively (point labels `0/1`, box corners `2/3` in [scripts/sam_service.py:120-131](scripts/sam_service.py#L120-L131)).

2. **The eraser is unavailable in SAM mode** because Shift+click is overloaded for negative points ([media/main.js:1749](media/main.js#L1749) excludes SAM from eraser triggering). Users who want to erase a stray polygon while in SAM must mode-switch to Polygon/Rectangle, erase, then switch back.

This design addresses both with a single coherent change to SAM's prompt model and Shift handling.

---

## Goals

- **G1.** Allow positive points, negative points, and one box to coexist in a single SAM prompt sequence. The mask updates after each addition.
- **G2.** In SAM mode, Shift acts as the eraser trigger when no SAM annotation is in progress, and as the negative-point trigger once an annotation has been started. The eraser reuses the exact same gestures as in non-SAM modes (short-click → polygon, long-press/drag → rectangle).
- **G3.** Provide visual feedback (cursor + status bar) so users can see which role Shift will play before clicking.

## Non-Goals

- Negative box / box subtraction (SAM ONNX label encoding `[2,3]` only represents positive boxes).
- Multiple boxes per annotation. Only one box at a time.
- Refactoring the broader webview architecture or extracting `media/main.js` into modules.
- Introducing a unit test harness for webview event handlers; tests cover pure helpers only.

---

## Architecture

### Data model change

Remove the `samPromptType` field from state. It is currently the source of the artificial point/box exclusion. The backend already accepts a single mixed-type array.

After this change, `samPrompts` is the sole source of truth: an array of `{type: 'point', data: [x,y], label: 0|1}` and at-most-one `{type: 'rectangle', data: [x1,y1,x2,y2]}`.

Add a single derived helper:

```js
function samHasPositivePrompt() {
    return samPrompts.some(p =>
        p.type === 'rectangle' ||
        (p.type === 'point' && p.label === 1)
    );
}
```

This is the **only** judgment used to route Shift behavior.

### Box single-instance invariant

When the user finalizes a new box (the second click of the box gesture), the new box replaces any existing box but preserves all points:

```js
samPrompts = samPrompts
    .filter(p => p.type !== 'rectangle')
    .concat([{ type: 'rectangle', data: [x1, y1, x2, y2] }]);
```

No special handling needed elsewhere — point additions don't touch the rectangle, and the rectangle filter is only applied at box-finalize time.

### Shift routing

The SAM mousedown handler runs in the capture phase ([media/main.js:6433](media/main.js#L6433), `addEventListener(..., true)`) and currently calls `e.stopPropagation()` to prevent the main mousedown handler from running. The new rule:

```
SAM mousedown capture handler:
    if (e.shiftKey && !samHasPositivePrompt()) {
        return;  // do not stopPropagation — let main handler run eraser flow
    }
    // else: existing SAM handling (positive point, negative point, box drag)
```

Symmetrically, the eraser gate in the main handler ([media/main.js:1749](media/main.js#L1749)) loosens its SAM exclusion:

```
if (e.shiftKey
    && (currentMode !== 'sam' || !samHasPositivePrompt())
    && currentMode !== 'view'
    && !isDrawing) {
    // start eraser as before
}
```

Once the eraser has started (`eraserActive === true`), it owns the click stream until completion or cancellation, regardless of subsequent Shift state or `samHasPositivePrompt()` changes. This keeps the existing eraser semantics intact.

When the user *does* have a positive prompt in flight, Shift+click in SAM continues to add a negative point exactly as today ([media/main.js:6568](media/main.js#L6568)); the only adjustment is removing the line that auto-clears existing rectangles when a point is added (so points and boxes can coexist).

### Visual feedback

Add document-level Shift `keydown`/`keyup` listeners that maintain a `shiftPressed` flag and dispatch to a new `updateShiftFeedback()` function. This function reads `currentMode`, `shiftPressed`, `samHasPositivePrompt()`, and `eraserActive`, and applies:

| State | Cursor | Status bar |
|-------|--------|------------|
| Shift down, SAM mode, no positive prompt | Custom eraser cursor (SVG data URI) | `"SAM: Eraser mode"` (orange) |
| Shift down, SAM mode, has positive prompt | `crosshair` (no change) | `"SAM: Negative point"` (red text) |
| Shift down, non-SAM annotation mode | Custom eraser cursor | `"Eraser mode"` (orange) |
| Shift down, view mode | unchanged | unchanged |
| Shift up | restored from `currentCursor` cache | restored to prior message |

`updateShiftFeedback()` is also called whenever `samPrompts` changes (after box finalize, after `samDecode` resolution, after `samUndoLastPrompt`) so the displayed role stays in sync if the user holds Shift across state transitions.

The status bar message is restored to its prior value on Shift release. The implementation caches the previous `statusSpan.textContent`/`color` on Shift down and restores on Shift up, but suppresses the cached value if it was itself written by a feedback transition (prevents echo loops).

### Undo: orphan-negative cleanup

In [media/main.js:6376](media/main.js#L6376) `samUndoLastPrompt`, after popping the last prompt, add:

```js
if (!samHasPositivePrompt()) {
    samPrompts = [];
    samDecodeVersion++;
    samMaskContour = null;
    samCachedCrop = null;
    samCurrentImagePath = null;
    samIsFreshSequence = true;
}
```

This collapses the only edge case where `samPrompts` could contain orphan negative points without any positive context. After cleanup, `samPrompts.length > 0` becomes equivalent to `samHasPositivePrompt()`, which simplifies reasoning even though the helper still uses the strict definition.

---

## Behavior Specification

### Prompt-state matrix

| State | Click | Shift+Click | Drag / Long-press | Shift+Drag / Shift+Long-press |
|-------|-------|-------------|-------------------|-------------------------------|
| SAM, empty | + positive point → decode | start polygon eraser | start box (await 2nd click) | start rectangle eraser |
| SAM, has positive point(s), no box | + positive point | + negative point | start box | + negative point (long-press ignored) |
| SAM, has box, no points | + positive point | + negative point | start new box (replaces old) | + negative point |
| SAM, has box + points | + positive point | + negative point | start new box (replaces old, keeps points) | + negative point |
| SAM, awaiting box 2nd click | finalize box (Shift ignored) | finalize box (Shift ignored) | n/a | n/a |
| Non-SAM annotation | mode-specific | start polygon eraser | mode-specific drag | start rectangle eraser |
| Eraser active | extend eraser | extend eraser | extend eraser | extend eraser |

### Lock-at-mousedown semantics

The decision between eraser and SAM negative point is made at the mousedown event and does not change during the gesture. Specifically:

- If Shift is released after mousedown but before mouseup, the gesture continues as initially classified.
- If Shift is pressed mid-drag (no Shift at mousedown), the gesture continues as initially classified.

This matches the existing eraser semantics in non-SAM modes.

### `samHasPositivePrompt()` evaluation timing

The Shift routing decision evaluates `samHasPositivePrompt()` **at mousedown**, not at click time. This matters for the SAM box second-click flow: if the user starts a box (first corner placed), then before clicking the second corner pressed Shift — the second click is *not* a Shift gesture; it's a box completion. The existing `samBoxSecondClick` short-circuit in the SAM handler runs before the Shift check.

---

## Implementation Touch Points

| # | File:Line | Change |
|---|-----------|--------|
| 1 | [media/main.js:97-117](media/main.js#L97-L117) state declarations | Remove `samPromptType`; add `let shiftPressed = false;` and `let prevStatusBeforeShift = null;` |
| 2 | All references to `samPromptType` | Delete reads and writes (see grep below) |
| 3 | [media/main.js:6470](media/main.js#L6470) box finalize | Replace assignment with filter+concat preserving points |
| 4 | [media/main.js:6433](media/main.js#L6433) SAM mousedown capture | Early return without stopPropagation when Shift && !samHasPositivePrompt |
| 5 | [media/main.js:6568](media/main.js#L6568) negative point handler | Remove the `if (samPromptType === 'box') samPrompts = []` block |
| 6 | [media/main.js:1749](media/main.js#L1749) eraser gate | Loosen `currentMode !== 'sam'` to `(currentMode !== 'sam' \|\| !samHasPositivePrompt())` |
| 7 | [media/main.js:6376](media/main.js#L6376) `samUndoLastPrompt` | Add orphan-negative cleanup after pop |
| 8 | New: anywhere in initialization | Add `samHasPositivePrompt()` helper |
| 9 | New: document keydown/keyup listeners | Track `shiftPressed`; call `updateShiftFeedback()` |
| 10 | New: `updateShiftFeedback()` | Reads state, sets cursor + status bar |
| 11 | New: cursor SVG data URI constant | Eraser cursor (24×24 SVG) |
| 12 | Hook `samDecode`/`samUndoLastPrompt`/box-finalize | Call `updateShiftFeedback()` after state mutations |

### Grep targets

Before editing, grep `samPromptType` in `media/main.js` to enumerate every occurrence (init, save state, restore state, samConfirmAnnotation, samClearState, etc.) and remove each. The known set:

- Declaration ([media/main.js:102](media/main.js#L102))
- Reset/clear sites: `samClearState`, `samConfirmAnnotation`, `samUndoLastPrompt`, `_samOnImageUpdate`
- Read+write in box finalize, point click handler, and any state save/restore

---

## Testing Strategy

### Automated (pure helper extraction)

Extract `samHasPositivePrompt` and the box-merge helper into a new file `media/samPromptHelpers.js` with both browser-script and CommonJS export shims:

```js
// At end of media/samPromptHelpers.js:
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { samHasPositivePrompt, mergeBoxIntoPrompts };
}
```

Add `test/samPromptHelpers.test.ts` covering:

1. `samHasPositivePrompt`:
   - empty array → false
   - single negative point → false
   - single positive point → true
   - single rectangle → true
   - mixed positive + negative + rectangle → true
2. `mergeBoxIntoPrompts`:
   - empty → returns `[box]`
   - one positive point → returns `[point, box]`
   - one box → returns `[newBox]` (replaced)
   - one box + two points → returns `[point, point, newBox]` (points preserved, box replaced)
3. Undo orphan-cleanup logic — extract `cleanupOrphanNegatives(prompts)` returning empty array if no positive remains, else identity.

### Manual UI verification

Test the extension in a VSCode dev host with the SAM service running:

- **Combination flow**: in SAM mode, draw a box, then add 2 positive points and 1 negative point. Verify mask updates after each prompt and the visualization shows all three prompts plus the box.
- **Box replacement**: with a box and points present, drag a new box. Verify the old box visually disappears, the new one appears, and the points are still rendered.
- **Eraser activation**: enter SAM mode with no prompts. Hold Shift; cursor changes to eraser cursor and status reads "SAM: Eraser mode". Click → polygon eraser starts. Cancel and try Shift+long-press+drag → rectangle eraser starts. Both work identically to polygon mode.
- **Negative point activation**: add a positive point first. Hold Shift; cursor stays crosshair, status reads "SAM: Negative point". Shift+click adds a negative point. Mask updates.
- **Boundary transition**: with positive point + negative point, undo twice. After first undo, status remains "Negative point" while Shift held. After second undo (back to empty), status flips to "Eraser mode" and cursor changes — confirms `updateShiftFeedback` re-runs after `samUndoLastPrompt`.
- **Orphan cleanup**: positive point → negative point → undo positive. Verify `samPrompts` is empty (mask cleared, no stray negative on canvas).
- **Lock-at-mousedown**: hold Shift, mousedown to start polygon eraser, release Shift while drawing additional points. Eraser continues normally.
- **Box 2nd-click ignores Shift**: long-press to start box, release, hold Shift, click for second corner. Box should finalize normally (not negative point, not eraser).

---

## Edge Cases

- **Pending click timer**: SAM uses a 200ms timer ([media/main.js:6566](media/main.js#L6566)) to disambiguate single-click from double-click. The Shift state captured at mouseup is the one used when the timer fires. No change needed here, but verify that an Esc-cancel during the pending window still clears the timer.
- **Modal / input focus**: existing keydown handler ([media/main.js:1316-1328](media/main.js#L1316-L1328)) ignores keys when modals are open. Apply the same gating to the new Shift keydown/keyup so we don't overwrite the status bar while a modal is showing.
- **Encoding latency**: if the user holds Shift and clicks before SAM has finished encoding the first time, the negative-point branch wouldn't fire (no positive prompt yet), so Shift+click correctly routes to eraser. The pre-encode window does not introduce a false negative-point case.
- **Cursor persistence after mode switch**: when leaving SAM mode while Shift is held, the cursor must reset. `setMode('view')` (and friends) calls `updateModeButtons` and re-derives cursor; we add an `updateShiftFeedback()` call there as well.

---

## Compatibility / Migration

- **No persisted state changes.** `samPromptType` is not part of the saved annotation format (it's purely runtime state); removing it requires no migration.
- **No backend changes.** `scripts/sam_service.py` already accepts mixed prompts.
- **No keybinding changes.** Shift is the only key reused; its semantics widen but never narrow.

---

## Risks

- **Shift-state desync**: keyboard focus loss (e.g., user Alt-Tabs out while Shift held) can leave `shiftPressed=true` stale. Mitigation: also listen to `window` `blur` and reset `shiftPressed` + restore feedback.
- **Status bar fight**: the feedback restoration assumes the status bar has not been written by other code while Shift was held. If `samEncode` fires during Shift-hold and writes to `statusSpan`, restoring on Shift-up would clobber the encode message. Mitigation: stash the *most recent non-feedback* status text rather than a fixed snapshot, and only restore if `statusSpan.textContent` still matches the feedback string at Shift-up time.
- **Custom cursor visibility**: a 24×24 SVG eraser may render poorly on high-DPI displays. Mitigation: include `2x` resolution in the data URI and provide a `crosshair` fallback on errors.
