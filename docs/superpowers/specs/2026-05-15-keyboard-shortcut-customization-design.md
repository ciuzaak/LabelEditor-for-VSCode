# Keyboard Shortcut Customization — Design

**Date:** 2026-05-15
**Roadmap item:** Keyboard shortcuts customization

## Goals

1. Users can remap every documented keyboard shortcut to a different key/modifier combo.
2. Defaults match the current README table.
3. New "Keyboard Shortcuts" group inside the Settings dropdown with rows for each action: name, current binding, [✎] capture, [↺] reset.
4. Bindings persist in `globalState` and survive reloads.
5. Conflict detection: assigning a combo already used by another action shows an inline error and prevents save.
6. The existing keydown logic in `media/main.js` is refactored from hardcoded `e.key === 'a'` checks to a table-driven dispatcher.

Non-goals: per-workspace overrides, import/export of bindings as a file, modifier-only bindings (e.g. just Shift), key-up actions, chord bindings (e.g. `Ctrl+K, V`), exposing OS-level VS Code keybindings.

## Action catalog

The complete set of remappable actions, listed by `actionId`:

| actionId | Default | Description |
|---|---|---|
| `mode.view` | `V` | Switch to View Mode |
| `mode.polygon` | `P` | Switch to Polygon Mode |
| `mode.rectangle` | `R` | Switch to Rectangle Mode |
| `mode.line` | `L` | Switch to Line Mode |
| `mode.point` | `O` | Switch to Point Mode |
| `mode.circle` | `C` | Switch to Circle Mode (added by the Circle spec) |
| `mode.sam` | `I` | Switch to SAM AI Mode |
| `edit.undo` | `Ctrl+Z` | Undo |
| `edit.redo` | `Ctrl+Shift+Z` *(also `Ctrl+Y`)* | Redo |
| `edit.save` | `Ctrl+S` | Save annotations |
| `edit.selectAll` | `Ctrl+A` | Select all instances |
| `edit.merge` | `Ctrl+G` | Merge overlapping selection |
| `edit.rename` | `Ctrl+R` | Rename selected shape(s) |
| `edit.toggleVisible` | `Ctrl+H` | Toggle visibility |
| `edit.delete` | `Delete` *(also `Backspace`)* | Delete selected |
| `edit.cancel` | `Escape` | Cancel current drawing / clear selection |
| `nav.prev` | `A` | Previous image |
| `nav.next` | `D` | Next image |
| `browser.find` | `Ctrl+F` | Toggle browser search |

**Special: dual defaults.** `Ctrl+Y` and `Backspace` are *implicit aliases* shipped with the defaults. The settings UI shows one canonical binding per action; the alias is exposed as a separate optional secondary slot (`edit.redo.alt`, `edit.delete.alt`). For v1 we expose only the primary; the alt stays hardcoded as backwards compatibility (`Ctrl+Y` and `Backspace` still work regardless of user config). This avoids forcing existing muscle memory to break.

## UX

### Settings panel section
Inside `settingsMenuDropdown`, after the Image Adjustment group:

```
─── Keyboard Shortcuts ───
View Mode             V       [✎] [↺]
Polygon Mode          P       [✎] [↺]
…
[Reset all to defaults]
```

- Click [✎] → row enters capture mode: input listens for one keydown, captures `{ key, ctrl, shift, alt, meta }`. Esc cancels capture.
- Captured combo replaces existing if no conflict; conflict shows red inline message "Conflicts with `Polygon Mode` (P). [Override]" — Override reassigns and clears the other row to "(none)".
- [↺] restores the row's default.
- [Reset all to defaults] confirms then clears every user override.

### Tooltip rewrite
Each rich tooltip currently has a `shortcut:` field with the hardcoded string. After this change tooltips display the **current** binding, not the default. Implementation: `tipsData.js` provides `shortcutAction: '<actionId>'`; `tooltip.js` resolves at render time via `bindings.getDisplayString(actionId)`.

## Architecture

### New file: `media/keybindings.js` (pure helpers, namespaced)

```js
window.keybindings = {
  DEFAULTS: { 'mode.view': { key: 'V' }, ... },
  ALT_BINDINGS: {                             // hardcoded, not user-editable
    'edit.redo':   [{ key: 'Y', ctrl: true }],
    'edit.delete': [{ key: 'Backspace' }]
  },

  // Comparators
  matches(event, binding): boolean,
  matchAction(event, bindings, alts): string|null,   // returns matched actionId

  // Display
  display(binding): string,           // 'Ctrl+Shift+Z' style

  // Conflict check
  findConflict(actionId, binding, bindings): string|null  // returns conflicting actionId or null
};
```

`binding` is the simple shape `{ key: string, ctrl?: boolean, shift?: boolean, alt?: boolean, meta?: boolean }`.

### `media/main.js` — keydown refactor

Replace the long `if (e.ctrlKey && e.key === 's')` chain inside the main `keydown` handler with:

```js
const action = window.keybindings.matchAction(e, currentBindings, ALT_BINDINGS);
if (action) {
    handleAction(action, e);
    return;
}
```

`handleAction(actionId, event)` is a switch with one case per action — pulls the body of each existing branch. Mode-switch actions still check `currentMode === 'sam'` etc. as today.

### Settings UI
- New section in `LabelMePanel.ts` HTML inside `settingsMenuDropdown` with a container `<div id="keybindingsList"></div>` plus a "Reset all" button.
- `media/main.js` renders the list from `currentBindings` and wires capture / reset / "reset all".
- Persist via existing `saveGlobalSettings(key, value)` with key `keyboardBindings`.

### Initial bindings boot order
1. `_getHtmlForWebview` injects `initialGlobalSettings.keyboardBindings ?? null`.
2. `media/main.js` startup: `currentBindings = mergeDefaults(initialBindings, DEFAULTS)` — missing entries fall back to defaults so a saved partial map (e.g. older session before a new action was added) still works.
3. Tooltips re-attached after binding change to refresh shortcut strings.

## Edge cases

| Case | Handling |
|---|---|
| Binding `{key: ' '}` (Space) | Allowed; rendered as `Space`. |
| Modifier-only press during capture (e.g. user pressed only Ctrl) | Capture ignores; show hint "Press a key". |
| Browser-reserved combos (e.g. `Ctrl+W`, `Ctrl+T`) | Capture allows but Run-time match is suppressed inside the webview (preventDefault doesn't reliably block VS Code). Show inline warning on capture. |
| User assigns same combo to two rows via direct edits | Conflict detector blocks save; "Override" button explicitly clears the other row. |
| Saved bindings include an unknown actionId (after a downgrade/upgrade) | Ignored silently. |
| Saved bindings missing for a known actionId | Falls back to default. |
| Capture invoked while typing in label modal text input | Settings dropdown should be closed there; if open, capture still binds — acceptable. |

## Tests

`test/keybindingsHelpers.test.ts`:
- `matches` — exact match, mismatched modifier (`Ctrl` required but Shift held), case-insensitive key, multi-key like `ArrowLeft`.
- `matchAction` — picks correct action; alt bindings work (`Ctrl+Y` for redo); no false match across actions.
- `findConflict` — same combo two actions = conflict; differing modifiers = no conflict; binding equal to its own action's current = no conflict.
- `display` — `Ctrl+Shift+Z`, `Space`, `↑`/`↓`/`←`/`→` arrow rendering.

Manual smoke:
- Remap `A` (prev image) to `Q`. Switch images with Q; A no longer navigates.
- Click [↺] → A works again, Q does not.
- Try to assign `S` to Save (it already isn't `Ctrl+S`) — distinct bindings.
- Assign `P` to two rows → conflict error, save blocked.
- Reset all → original behaviour restored.
- After remap, tooltips show new shortcut chip.
- `Ctrl+Y` still works as Redo even after Redo is remapped to e.g. `Ctrl+Shift+Z` only (alt binding hardcoded).
