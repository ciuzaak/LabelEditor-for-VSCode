// Pure helpers for the rebindable keyboard layer. The webview state lives in
// main.js (a module-scope `currentBindings`); this file only exposes a
// frozen-default table and the matchers/formatters used by both the keydown
// dispatcher and the settings UI. Wrapped in an IIFE to keep the top-level
// constants out of the shared classic-script lexical scope.

(function (root) {
    const DEFAULTS = {
        'mode.view':          { key: 'V' },
        'mode.polygon':       { key: 'P' },
        'mode.rectangle':     { key: 'R' },
        'mode.line':          { key: 'L' },
        'mode.point':         { key: 'O' },
        'mode.circle':        { key: 'C' },
        'mode.sam':           { key: 'I' },
        'edit.undo':          { key: 'Z', ctrl: true },
        'edit.redo':          { key: 'Z', ctrl: true, shift: true },
        'edit.save':          { key: 'S', ctrl: true },
        'edit.selectAll':     { key: 'A', ctrl: true },
        'edit.merge':         { key: 'G', ctrl: true },
        'edit.rename':        { key: 'R', ctrl: true },
        'edit.toggleVisible': { key: 'H', ctrl: true },
        'edit.delete':        { key: 'Delete' },
        'edit.cancel':        { key: 'Escape' },
        'nav.prev':           { key: 'A' },
        'nav.next':           { key: 'D' },
        'browser.find':       { key: 'F', ctrl: true }
    };

    // Backwards-compatibility alternates — these dispatch alongside the
    // primary binding, so users keep existing muscle memory (Ctrl+Y for
    // Redo, Backspace for Delete) even after remapping the primary. They
    // are suppressed when the primary is explicitly disabled via Override
    // (null) — matchAction() enforces that, see comment there.
    const ALT_BINDINGS = {
        'edit.redo':   [{ key: 'Y', ctrl: true }],
        'edit.delete': [{ key: 'Backspace' }]
    };

    // Human-readable labels for the settings UI (English fallback). main.js
    // prefers `kb.action.<id>` via i18n.t when the dictionary defines one, so
    // localised builds can override these without touching this module.
    const ACTION_NAMES = {
        'mode.view':          'View Mode',
        'mode.polygon':       'Polygon Mode',
        'mode.rectangle':     'Rectangle Mode',
        'mode.line':          'Line Mode',
        'mode.point':         'Point Mode',
        'mode.circle':        'Circle Mode',
        'mode.sam':           'SAM AI Mode',
        'edit.undo':          'Undo',
        'edit.redo':          'Redo',
        'edit.save':          'Save',
        'edit.selectAll':     'Select All',
        'edit.merge':         'Merge',
        'edit.rename':        'Rename',
        'edit.toggleVisible': 'Toggle Visibility',
        'edit.delete':        'Delete',
        'edit.cancel':        'Cancel / Clear Selection',
        'nav.prev':           'Previous Image',
        'nav.next':           'Next Image',
        'browser.find':       'Search Image Browser'
    };

    function normKey(k) {
        if (!k) return '';
        return k.length === 1 ? k.toUpperCase() : k;
    }

    function matches(event, b) {
        // A null/missing binding is treated as "disabled" — it must not match
        // any event. This is how Override and Reset propagate a cleared row.
        if (!b || typeof b.key !== 'string') return false;
        if (normKey(event.key) !== normKey(b.key)) return false;
        if (!!event.ctrlKey  !== !!b.ctrl)  return false;
        if (!!event.shiftKey !== !!b.shift) return false;
        if (!!event.altKey   !== !!b.alt)   return false;
        if (!!event.metaKey  !== !!b.meta)  return false;
        return true;
    }

    function matchAction(event, bindings, alts) {
        for (const id in bindings) {
            if (matches(event, bindings[id])) return id;
        }
        if (alts) {
            for (const id in alts) {
                // If the primary binding is explicitly disabled (null), the
                // alt must not dispatch either — otherwise Override clearing
                // edit.delete still leaves Backspace deleting, defeating the
                // whole point of the disabled sentinel.
                if (bindings && Object.prototype.hasOwnProperty.call(bindings, id) && bindings[id] === null) continue;
                for (const alt of alts[id]) {
                    if (matches(event, alt)) return id;
                }
            }
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

    function bindingsEqual(a, b) {
        if (a === null && b === null) return true; // both disabled
        if (!a || !b) return false;
        if (typeof a.key !== 'string' || typeof b.key !== 'string') return false;
        return normKey(a.key) === normKey(b.key)
            && !!a.ctrl === !!b.ctrl
            && !!a.shift === !!b.shift
            && !!a.alt === !!b.alt
            && !!a.meta === !!b.meta;
    }

    function findConflict(actionId, binding, bindings) {
        for (const id in bindings) {
            if (id === actionId) continue;
            const other = bindings[id];
            if (!other || typeof other.key !== 'string') continue; // disabled row
            if (bindingsEqual(binding, other)) return id;
        }
        return null;
    }

    function mergeWithDefaults(saved) {
        const out = {};
        for (const k in DEFAULTS) {
            const def = DEFAULTS[k];
            if (saved && Object.prototype.hasOwnProperty.call(saved, k)) {
                const s = saved[k];
                // Explicit null means the user disabled this action via the
                // override flow — keep it disabled, do not fall back to the
                // default (otherwise reload silently re-introduces the conflict
                // that the override resolved).
                if (s === null) { out[k] = null; continue; }
                if (s && typeof s.key === 'string') { out[k] = { ...s }; continue; }
            }
            out[k] = { ...def };
        }
        return out;
    }

    function isModifierOnly(event) {
        return event.key === 'Control' || event.key === 'Shift'
            || event.key === 'Alt' || event.key === 'Meta';
    }

    function eventToBinding(event) {
        if (isModifierOnly(event)) return null;
        const b = { key: normKey(event.key) };
        if (event.ctrlKey)  b.ctrl  = true;
        if (event.shiftKey) b.shift = true;
        if (event.altKey)   b.alt   = true;
        if (event.metaKey)  b.meta  = true;
        return b;
    }

    const api = {
        DEFAULTS, ALT_BINDINGS, ACTION_NAMES,
        matches, matchAction, display,
        bindingsEqual, findConflict,
        mergeWithDefaults, isModifierOnly, eventToBinding
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.keybindings = api;
    }
})(typeof window !== 'undefined' ? window : null);
