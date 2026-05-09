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
    //   { level, text, shownAtMs, minMs, durationMs, timerId, token }
    // `token` is a monotonically increasing id captured by the scheduled
    // timeout callback. The callback only clears the transient if its token
    // still matches — preventing a stale timer (whose entry has already been
    // replaced or cleared) from wiping a newer message.
    let transient = null;
    let transientSeq = 0;

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

    // Called by a scheduled timeout. Only takes effect if the transient hasn't
    // been replaced or cleared since this timer was set.
    function expireTransientIfCurrent(token) {
        if (!transient || transient.token !== token) return;
        transient = null;
        rerender();
    }

    function show(level, text, opts) {
        opts = opts || {};
        const now = getNow();

        if (opts.sticky) {
            const key = opts.key || ('default-' + level);
            stickies[key] = { level, text, updatedAtMs: now };
            // A sticky update is only visible when no transient is showing.
            if (!transient) rerender();
            return;
        }

        const incoming = { level, text };
        if (!helpers.canPreempt(incoming, transient, now)) return;
        if (transient && transient.timerId) clearTimeout(transient.timerId);

        const durationMs = (opts.durationMs != null)
            ? opts.durationMs
            : helpers.DEFAULT_DURATIONS[level];
        const minMs = (opts.minMs != null) ? opts.minMs : durationMs;

        const token = ++transientSeq;
        transient = {
            level, text,
            shownAtMs: now,
            minMs,
            durationMs,
            token,
            timerId: setTimeout(() => { expireTransientIfCurrent(token); }, durationMs)
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
