// Pure, DOM-free helpers for the advanced-search modal. Loaded as a <script>
// in the webview AND required from Node tests. No DOM access here.
(function (root) {
    // Normalize a raw query object (trims strings, fills defaults).
    function normalizeQuery(raw) {
        raw = raw || {};
        return {
            combinator: raw.combinator === 'any' ? 'any' : 'all',
            name: (raw.name || '').trim(),
            classes: Array.isArray(raw.classes) ? raw.classes.slice() : [],
            description: (raw.description || '').trim(),
        };
    }

    function hasActiveCriteria(query) {
        return !!(query && (query.name || query.description || (query.classes && query.classes.length)));
    }

    // Filter [{name,count}] by a case-insensitive substring of the name.
    function filterClassNames(classes, filterText) {
        const f = (filterText || '').trim().toLowerCase();
        if (!f) return classes.slice();
        return classes.filter(c => c.name.toLowerCase().includes(f));
    }

    // Replace {count} in a banner template.
    function formatBanner(total, template) {
        return String(template).replace(/\{count\}/g, String(total));
    }

    const api = { normalizeQuery, hasActiveCriteria, filterClassNames, formatBanner };
    if (root) root.AdvancedSearchHelpers = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
