// Pure, DOM-free helpers for the advanced-search modal. Loaded as a <script>
// in the webview AND required from Node tests. No DOM access here.
(function (root) {
    // Build a normalized SearchQuery from the webview's condition model
    // (an array of { type, value, classes }). Trims name/description values,
    // drops empty conditions, and shapes class conditions as { values: [...] }.
    function buildQuery(conditions) {
        const out = [];
        for (const c of (conditions || [])) {
            if (!c) continue;
            if (c.type === 'class') {
                const values = Array.isArray(c.classes) ? c.classes.filter(v => v && v.trim()) : [];
                if (values.length) out.push({ type: 'class', values: values.slice() });
            } else if (c.type === 'name' || c.type === 'description') {
                const value = (c.value || '').trim();
                if (value) out.push({ type: c.type, value: value });
            }
        }
        return { conditions: out };
    }

    function hasActiveConditions(query) {
        return !!(query && query.conditions && query.conditions.length);
    }

    // Replace {count} in a banner template.
    function formatBanner(total, template) {
        return String(template).replace(/\{count\}/g, String(total));
    }

    const api = { buildQuery, hasActiveConditions, formatBanner };
    if (root) root.AdvancedSearchHelpers = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
