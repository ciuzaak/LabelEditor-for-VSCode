# Notifications and Tips Overhaul — Design Spec

Date: 2026-05-09
Branch: `feature/notifications-and-tips`

## Goals

1. Stop flooding the VS Code native notification area with non-actionable messages from this extension. Move every notification that does not require a user-button decision to an in-webview status bar.
2. Give every interactive control in the webview a discoverable, readable hint, including recently added features (merge, SAM prompt combination, eraser, box selection) that currently have no tooltip at all.

## Non-Goals

- A help/shortcut overview panel.
- First-launch onboarding tour or empty-state hints.
- A persistent notification history panel.
- Internationalization (English-only strings, same as today).
- Reworking the unsaved-changes dialog or any other notification that has decision buttons — those stay native.

## Scope of Migration

### Notifications that move to the in-webview status bar

All `vscode.window.showInformationMessage` / `showWarningMessage` / `showErrorMessage` calls in `src/LabelMePanel.ts` that do not have button options. As of branch creation:

| Location (line) | Current call | Migrated level |
| --- | --- | --- |
| 254 | `showErrorMessage(message.text)` (relayed `alert` from webview) | `error` |
| 556 | `showInformationMessage('Refreshed: Found N images')` | `success` |
| 631 | `showWarningMessage('Failed to load annotation file: …')` | `warn` |
| 720 | same, during initial render | `warn` |
| 1071 | `showInformationMessage('Annotation saved to …')` | `success` |
| 1079 | `showErrorMessage('Failed to save annotation: …')` | `error` |
| 1101 | `showInformationMessage('SVG exported to …')` | `success` |
| 1103 | `showErrorMessage('Failed to export SVG: …')` | `error` |
| 1138 | `showErrorMessage('ONNX Batch Infer: Model directory does not exist.')` | `error` |
| 1146 | `showErrorMessage('ONNX Batch Infer: No .onnx file found …')` | `error` |
| 1152 | `showErrorMessage('ONNX Batch Infer: labels.json not found …')` | `error` |
| 1166 | `showWarningMessage('ONNX Batch Infer: No images found …')` | `warn` |
| 1185 | `showErrorMessage('ONNX Batch Infer: Inference script not found …')` | `error` |
| 1223 | `showInformationMessage('ONNX Batch Infer started: …')` | `info` |
| 1240 | `showErrorMessage('SAM Service: Model directory does not exist.')` | `error` |
| 1248 | `showErrorMessage('SAM Service: Need at least 2 ONNX files …')` | `error` |
| 1255 | `showWarningMessage('SAM Service already running on port N …')` | `warn` |
| 1264 | `showErrorMessage('SAM Service: Service script not found …')` | `error` |
| 1310 | `showInformationMessage('SAM Service starting on port N …')` | `info` |

That is 19 sites. Sending them to the webview also lets the user see them at a glance instead of pulling them from the native notification queue.

### Notifications that stay native

Anything that asks the user to decide. Today this means the two unsaved-changes prompts that return Save / Discard / Cancel:

- `LabelMePanel.ts:403` (navigateImage)
- `LabelMePanel.ts:456` (\_navigateToImageByPath)

If new such prompts are added later, they continue to use `vscode.window.showWarningMessage` directly.

## Architecture

Two small subsystems, both webview-side, both backed by a single source of truth.

### 1. notifyBus — webview status bus

`media/notifyBus.js` (new) is the only writer of `#status`. Public surface:

```js
notifyBus.show(level, text, opts?)
//   level: 'info' | 'success' | 'warn' | 'error'
//   opts:  { sticky?: boolean, key?: string, minMs?: number }

notifyBus.clearSticky(key)
notifyBus.attach({ statusEl, getNow?: () => number })
```

Behavior:

- **Levels and durations.** `info` / `success` auto-dismiss after 3 s. `warn` after 5 s. `error` after 8 s.
- **Severity priority.** A higher-severity message can preempt a lower one. A new lower-severity message *cannot* overwrite a higher one until the higher one has been on screen for at least its `minMs`. Same severity overwrites freely.
- **Sticky channel.** Persistent state like SAM `Ready [Full] (123ms)` or Shift feedback uses `sticky: true, key: <channel>`. Sticky messages render only when no transient is showing. After a transient expires, the most recent sticky for any active channel is restored. Calling `notifyBus.show` with the same `key` and `sticky: true` replaces that channel's content; `clearSticky(key)` removes it.
- **Color.** Maps to existing CSS variables `--color-text-secondary` / `--color-success` / `--color-warning` / `--color-danger` so light/dark themes work without new tokens.
- **Pure logic separation.** All decisions about "should this message preempt the current one?" and "what should be displayed after a transient expires?" live in pure helpers in `notifyBusHelpers.js` (mirrors the existing `samPromptHelpers` / `mergeShapesHelpers` style) so they are unit-testable without a DOM.

### 2. tooltip — webview rich tooltip

`media/tooltip.js` (new) plus `media/tipsData.js` (new) plus a few CSS rules in `style.css`.

- `tipsData.js` exports a single object `TIPS = { [tipId]: { title, desc, shortcut? } }`. `tipId` is a stable string like `mode.polygon`, `merge.group`, `sam.eraser`. The values are short English strings; titles are 3–6 words, desc is one sentence, `shortcut` is rendered as a `<kbd>` chip.
- `tooltip.js` exports `attach(rootEl, tips)` which:
  1. Finds every element under `rootEl` with a `data-tip-id`.
  2. Removes the native `title=` attribute (so the OS bubble doesn't double up).
  3. Wires `mouseenter` / `mouseleave` / `focus` / `blur` to render a single shared `<div class="le-tooltip">` floating element.
- Position. The tooltip sits below the target by default; if it would clip the viewport bottom, flip above. If it would clip the right edge, anchor to the target's right edge instead of left. No JS animation — pure CSS opacity transition (120 ms).
- Show delay. 350 ms hover before showing, 0 ms hide (snappy dismiss).
- Keyboard. Showing on `focus` keeps tooltips reachable for keyboard users.
- Pure logic. Position math (anchor → flipped/clamped rect given a viewport rect) lives in `tooltipHelpers.js` and is unit-testable.

### Why webview, not extension host

The status bar lives in the webview. The tooltip mechanism has to position relative to webview DOM elements. Both subsystems are pure-JS modules under `media/` — no extension-host code touches them.

## Backend ↔ Webview Contract

Add one new postMessage command in both directions of the existing message channel:

### Extension → Webview

```ts
{ command: 'notify', level: 'info' | 'success' | 'warn' | 'error', text: string, key?: string, sticky?: boolean }
```

`key` and `sticky` are optional and always omitted by the migration sites. They exist so future sticky messages from the host (rare) have the same shape.

### Webview → Extension

No new commands. The existing `'alert'` command (currently relayed by the host as `showErrorMessage`) is replaced with a direct `notifyBus.show('error', text)` call inside the webview — i.e. the webview no longer round-trips error messages it raised itself. The `'alert'` case in `LabelMePanel.ts` is removed.

### Buffering before webview ready

`_safePost` already no-ops if the panel is disposed. For notifications generated *before* the webview signals `webviewReady` (notably the JSON-load warning at line 720), we add a small queue:

```ts
private _pendingNotifications: Array<{level, text, key?, sticky?}> = [];
private _notify(level, text, opts?) {
  if (!this._webviewReady) {
    this._pendingNotifications.push({ level, text, ...opts });
    return;
  }
  this._safePost({ command: 'notify', level, text, ...opts });
}
// On 'webviewReady': flush pending.
```

This avoids losing the early "Failed to load annotation file" warning. The queue is bounded (drop after 50 entries) but in practice never holds more than two.

## Tooltip Coverage

Every interactive control gets a `data-tip-id`. The full list (drafted from current HTML in `LabelMePanel.ts:733–1011` and dynamically rendered controls in `main.js`):

**Top toolbar / image browser**
- `nav.toggleBrowser`, `nav.prev`, `nav.next`, `nav.fileName`, `nav.imageInfo`
- `browser.search`, `browser.refresh`, `browser.searchClose`

**Mode toggles**
- `mode.view`, `mode.polygon`, `mode.rectangle`, `mode.line`, `mode.point`, `mode.sam`

**Sidebar actions**
- `actions.settings`, `actions.tools`, `actions.save`

**Theme / settings dropdown**
- `theme.light`, `theme.dark`, `theme.auto`
- `view.zoomReset`, `view.zoomLock`
- `style.borderWidth`, `style.borderWidthReset`, `style.fillOpacity`, `style.fillOpacityReset`
- `channel.lock`, `channel.rgb`, `channel.r`, `channel.g`, `channel.b`
- `image.brightness`, `image.brightnessReset`, `image.brightnessLock`
- `image.contrast`, `image.contrastReset`, `image.contrastLock`
- `image.claheToggle`, `image.claheReset`, `image.claheLock`, `image.claheClipLimit`

**Tools menu**
- `tools.exportSvg`, `tools.onnxBatchInfer`

**Shape context menu (rendered in `main.js`)**
- `context.edit`, `context.rename`, `context.merge`, `context.toggleVisible`, `context.delete`

**Recently added features (currently no tip)**
- `shortcut.merge` — Ctrl+G merges the selected shapes (union for overlapping polygons of the same type; otherwise grouped).
- `shortcut.rename` — Ctrl+R renames the selected shape(s).
- `shortcut.toggleVisible` — Ctrl+H toggles visibility of the selected shape(s).
- `sam.positivePoint` — Left-click adds a positive prompt point.
- `sam.negativePoint` — Right-click adds a negative prompt point.
- `sam.eraser` — Hold Shift in SAM mode to switch to eraser; click a point/region to remove it from prompts.
- `select.box` — In View mode, drag on empty space to box-select shapes; hold Shift to add to selection.
- `select.multi` — Ctrl-click in the instance list selects multiple shapes.

**Modal forms** (ONNX, SAM)
- All form fields and the existing `onnx-hint` ⓘ icons get migrated to the rich tooltip system. The current multi-line `title="…"` content (with `&#10;` line breaks) is replanted into `tipsData.js` `desc` strings.

The exact tip strings are drafted in the implementation step. The plan will include a checklist of every tipId so review is mechanical.

## Migration Plan (high level — full plan in writing-plans)

1. Add `notifyBus.js`, `notifyBusHelpers.js`, `tooltip.js`, `tooltipHelpers.js`, `tipsData.js`. Inline-load them like existing helpers in `_getHtmlForWebview`.
2. Add CSS for `.le-tooltip` and `#status` severity classes.
3. Replace every `statusSpan.textContent = …` / `statusSpan.style.color = …` site in `main.js` with a `notifyBus.show(...)` (or `notifyBus.show(..., {sticky:true,key:...})` for SAM/Shift feedback).
4. Replace the `'alert'` postMessage from webview to extension with direct `notifyBus.show('error', text)`. Remove the `'alert'` case in the host.
5. Add private `_notify(level, text, opts?)` to `LabelMePanel`. Replace each native call in the migration table with `_notify(...)`. Add buffering + flush on `webviewReady`.
6. Add `data-tip-id` attributes to every control listed under "Tooltip Coverage". Strip the redundant `title=`. Call `tooltip.attach(document, TIPS)` once on DOMContentLoaded and re-attach after dynamic node creation (context menu, instance list rows).
7. Tests in `test/`:
   - `notifyBusHelpers.test.ts` — preempt rules, sticky restore order, minMs gating, queue overflow.
   - `tooltipHelpers.test.ts` — flip-up, edge-clamp, default position.
   - Smoke tests for the `_notify` queue + flush in `extension`-shaped helpers if practical.

## Edge Cases and Failure Modes

- **Webview disposed mid-flight.** `_safePost` already handles this — no extra work. Pending notifications are dropped on dispose.
- **Two SAM panels open.** Each panel has its own webview; the bus is per-panel, so no cross-contamination.
- **Rapid burst of errors** (e.g. multiple ONNX validation errors). Each replaces the previous (same severity overwrites). Acceptable trade-off; alternative would be a queue, but errors here are sequential validation failures that all fire immediately, so the user reading the *last* one is fine because earlier failures imply the configuration is broken anyway. (If this proves bad in smoke we'll reconsider; otherwise YAGNI.)
- **Tooltip on dynamically created elements.** `attach()` is idempotent on the same element and is called again from the few places that render rows (instance list, label list, image browser list). Helpers track attached state via a WeakSet.
- **Tooltip in modals.** Modals are direct children of `<body>`; positioning math uses `getBoundingClientRect()` which works regardless of overlay z-index.
- **Color blindness.** Severity is conveyed by both color and a leading icon character (ℹ ✓ ⚠ ✕). The icon set is small enough to embed inline rather than load a font.
- **CSP.** No external resources, no inline event handlers, no new `unsafe-inline` requirements.

## Testing Strategy

- **Unit tests** under `test/` using the existing `node --test` setup:
  - `notifyBusHelpers.test.ts` — pure logic for level priority, sticky restore, dedupe.
  - `tooltipHelpers.test.ts` — rect math under varying viewports.
- **Manual smoke** (with user): see the smoke checklist below. We pause for the user before claiming done.

## Smoke Checklist (run with user)

1. Open a folder with images. Verify no native VS Code popup appears for "Refreshed: Found N images" — message shows in `#status` instead, green, fades after ~3 s.
2. Save an annotation. Verify "Annotation saved to …" appears in `#status`, not as a native popup.
3. Trigger a save error (e.g. read-only file). Verify a red message appears in `#status`, stays for ~8 s.
4. Open ONNX Batch Inference modal with no model dir. Click Run → red error in `#status`.
5. Start SAM service successfully. Verify "SAM Service starting on port …" in `#status`, then SAM `Ready` sticky message survives a "saved" success interruption.
6. Hover every mode button, settings, theme, and recent-feature button. Verify rich tooltip appears with title + description (+ shortcut where applicable). Confirm no double bubble from native `title=`.
7. Hover a button near the right edge → tooltip flips horizontally. Hover a button near the bottom → tooltip flips above.
8. Trigger an unsaved-changes dialog by navigating with unsaved edits — *this* still uses the native dialog. Confirm.
9. Light theme + dark theme: tooltip and status colors readable in both.

## Files to Add / Modify

**Add**
- `media/notifyBus.js`
- `media/notifyBusHelpers.js`
- `media/tooltip.js`
- `media/tooltipHelpers.js`
- `media/tipsData.js`
- `test/notifyBusHelpers.test.ts`
- `test/tooltipHelpers.test.ts`

**Modify**
- `src/LabelMePanel.ts` — add `_notify`, queue + flush, replace native calls, remove `'alert'` case, inline-load new media files in `_getHtmlForWebview`, add `data-tip-id` to every control in the embedded HTML, drop redundant `title=`.
- `media/main.js` — replace `statusSpan.textContent = …` / `style.color` writes with `notifyBus.show(...)`. Replace the two `vscode.postMessage({ command: 'alert', text })` with direct `notifyBus.show('error', text)`. Add `data-tip-id` to dynamically rendered nodes (context menu, instance/label list rows). Call `tooltip.attach` after rendering.
- `media/style.css` — `.le-tooltip` + variants, `#status` severity classes, `<kbd>` chip.

## Risk and Rollback

- All changes are additive plus call-site swaps. To roll back, revert the merge commit; nothing in storage or globalState changes.
- The native unsaved-changes dialogs are untouched, so the most behavior-critical UX (data-loss prevention) is unaffected.
