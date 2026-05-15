# Implementation Plan — Keyboard Shortcut Customization

**Spec:** [`2026-05-15-keyboard-shortcut-customization-design.md`](../specs/2026-05-15-keyboard-shortcut-customization-design.md)

## Step 1 — `media/keybindings.js` (new, pure)

```js
(function (root) {
    const DEFAULTS = {
        'mode.view':           { key: 'V' },
        'mode.polygon':        { key: 'P' },
        'mode.rectangle':      { key: 'R' },
        'mode.line':           { key: 'L' },
        'mode.point':          { key: 'O' },
        'mode.circle':         { key: 'C' },
        'mode.sam':            { key: 'I' },
        'edit.undo':           { key: 'Z', ctrl: true },
        'edit.redo':           { key: 'Z', ctrl: true, shift: true },
        'edit.save':           { key: 'S', ctrl: true },
        'edit.selectAll':      { key: 'A', ctrl: true },
        'edit.merge':          { key: 'G', ctrl: true },
        'edit.rename':         { key: 'R', ctrl: true },
        'edit.toggleVisible':  { key: 'H', ctrl: true },
        'edit.delete':         { key: 'Delete' },
        'edit.cancel':         { key: 'Escape' },
        'nav.prev':            { key: 'A' },
        'nav.next':            { key: 'D' },
        'browser.find':        { key: 'F', ctrl: true }
    };

    const ALT_BINDINGS = {
        'edit.redo':   [{ key: 'Y', ctrl: true }],
        'edit.delete': [{ key: 'Backspace' }]
    };

    function normKey(k) { return (k || '').length === 1 ? k.toUpperCase() : k; }

    function matches(event, b) {
        if (!b) return false;
        if (normKey(event.key) !== normKey(b.key)) return false;
        if (!!event.ctrlKey  !== !!b.ctrl)  return false;
        if (!!event.shiftKey !== !!b.shift) return false;
        if (!!event.altKey   !== !!b.alt)   return false;
        if (!!event.metaKey  !== !!b.meta)  return false;
        return true;
    }

    function matchAction(event, bindings, alts) {
        for (const id in bindings) if (matches(event, bindings[id])) return id;
        for (const id in alts) {
            for (const alt of alts[id]) if (matches(event, alt)) return id;
        }
        return null;
    }

    function display(b) {
        if (!b) return '';
        const parts = [];
        if (b.ctrl) parts.push('Ctrl');
        if (b.shift) parts.push('Shift');
        if (b.alt) parts.push('Alt');
        if (b.meta) parts.push('Meta');
        let k = b.key;
        if (k === ' ') k = 'Space';
        else if (k === 'ArrowUp')    k = '↑';
        else if (k === 'ArrowDown')  k = '↓';
        else if (k === 'ArrowLeft')  k = '←';
        else if (k === 'ArrowRight') k = '→';
        parts.push(k);
        return parts.join('+');
    }

    function findConflict(actionId, binding, bindings) {
        for (const id in bindings) {
            if (id === actionId) continue;
            const b = bindings[id];
            if (b.key.toUpperCase() === binding.key.toUpperCase()
                && !!b.ctrl === !!binding.ctrl
                && !!b.shift === !!binding.shift
                && !!b.alt === !!binding.alt
                && !!b.meta === !!binding.meta) {
                return id;
            }
        }
        return null;
    }

    function mergeWithDefaults(saved) {
        const out = {};
        for (const k in DEFAULTS) out[k] = { ...DEFAULTS[k], ...(saved && saved[k]) };
        return out;
    }

    const api = { DEFAULTS, ALT_BINDINGS, matches, matchAction, display, findConflict, mergeWithDefaults };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.keybindings = api;
})(typeof window !== 'undefined' ? window : null);
```

## Step 2 — `src/LabelMePanel.ts`

1. Add `keybindingsUri` script load before `scriptUri`.
2. Inject `initialGlobalSettings.keyboardBindings = ${JSON.stringify(this._globalState.get('keyboardBindings') || null)}`.
3. In `settingsMenuDropdown`, append:
   ```html
   <div class="settings-group-header">Keyboard Shortcuts</div>
   <div class="keybindings-list" id="keybindingsList"></div>
   <button id="keybindingsResetAllBtn" class="btn">Reset all to defaults</button>
   ```

## Step 3 — `media/main.js` refactor

1. Boot: `let currentBindings = window.keybindings.mergeWithDefaults(initialGlobalSettings.keyboardBindings);`
2. Replace the long `keydown` action chain (the second large handler around line 1411) with:
   ```js
   const action = window.keybindings.matchAction(e, currentBindings, window.keybindings.ALT_BINDINGS);
   if (action) { handleAction(action, e); return; }
   ```
3. Extract `function handleAction(id, e)` whose body is a `switch (id)` covering every existing branch. Preserve current behaviour exactly — `preventDefault()` is still called where the original code called it.
4. Replace bare-letter handlers (`V`, `P`, `R`, `L`, `O`, `C`, `I`, `A`, `D`) via the same dispatcher: their default bindings are the bare letters, so `matchAction` will return the right `mode.*` / `nav.*` action id and `handleAction` invokes `setMode(...)` etc.
5. The first `keydown` handler at line ~1383 (Shift tracking only) stays untouched — Shift is not remappable.
6. The third `keydown` handler at line ~3853 (label modal chip shortcuts) stays untouched.

## Step 4 — Settings UI rendering

In `media/main.js`:
- `renderKeybindingsList()` iterates `window.keybindings.DEFAULTS` in a fixed order, builds rows:
  ```
  <div class="kb-row" data-action="...">
    <span class="kb-name">View Mode</span>
    <span class="kb-current">V</span>
    <button class="kb-capture btn btn-icon">✎</button>
    <button class="kb-reset btn btn-icon">↺</button>
    <div class="kb-error" hidden></div>
  </div>
  ```
- Action display names — use a local map (`KB_ACTION_NAMES`) until i18n lands; the i18n PR will replace this with `t(...)`.
- `capture` listens for next `keydown`, builds a `binding`, runs `findConflict`, on success persists via `saveGlobalSettings('keyboardBindings', currentBindings)`, re-renders, and re-attaches tooltips so updated shortcuts display.
- ESC during capture aborts. Modifier-only keys (`Control`, `Shift`, `Alt`, `Meta`) are ignored.
- Conflict UI: inline `.kb-error` with text `Conflicts with <name>` and an `Override` button.

## Step 5 — Tooltips

Update `media/tooltip.js` (no API change required — it already reads a `shortcut` field):
- When a `data-tip-id` resolves to an entry with `shortcutAction`, look up `currentBindings[id]` and render via `keybindings.display`.
- After `currentBindings` updates, re-attach tooltips so the static `<kbd>` chip refreshes.

Update `media/tipsData.js`:
- Convert each `shortcut: 'X'` field to `shortcutAction: '<actionId>'`.

## Step 6 — Tests

`test/keybindingsHelpers.test.ts`:
- `matches` — exact, mismatched modifier, alt binding, case-insensitive letter, `Escape`, `Delete`.
- `matchAction` — finds primary; finds alt; no false positive.
- `findConflict` — same vs same actionId; different actions same combo; differing modifiers no conflict.
- `display` — modifiers ordered Ctrl-Shift-Alt-Meta-Key; arrows; space.
- `mergeWithDefaults` — partial saved overrides preserved; missing entries default-filled; unknown ids dropped.

## Step 7 — README + CHANGELOG

- Add Keyboard Customization to features.
- Note in Roadmap: ✓ Keyboard shortcuts customization.

## Smoke checklist

- [ ] Settings dropdown shows keybindings list.
- [ ] Remap `A` (prev image) to `Q`; image nav uses `Q` now.
- [ ] Reset row → `A` restored.
- [ ] Try to assign `P` to two actions → error inline; saving blocked unless Override clicked.
- [ ] Reset all → original layout.
- [ ] `Ctrl+Y` still redoes (alt binding) even if Redo is remapped to `Ctrl+Shift+Z` only.
- [ ] After remap, tooltip chip shows new combo.
