// Pure helpers for the webview status bus. No DOM, no timers — just
// the rules deciding when one notification can replace another.
// Loaded as a <script> in the webview AND require()'d from Node tests.
//
// The body is wrapped in a function to keep top-level `const` declarations
// out of the shared classic-script lexical scope (otherwise two helper
// modules that both declare `const api = ...` collide with a SyntaxError).

(function (root) {
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
} else if (root) {
    root.notifyBusHelpers = api;
}
})(typeof window !== 'undefined' ? window : null);
