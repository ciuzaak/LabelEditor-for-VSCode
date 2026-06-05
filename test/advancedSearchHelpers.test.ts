import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'advancedSearchHelpers.js'));
const { normalizeQuery, hasActiveCriteria, filterClassNames, formatBanner } = helpers;

describe('normalizeQuery', () => {
    it('trims name/description and defaults combinator to all', () => {
        const q = normalizeQuery({ name: '  cat ', description: ' edge ', classes: ['car'] });
        assert.deepEqual(q, { combinator: 'all', name: 'cat', classes: ['car'], description: 'edge' });
    });
    it('passes through combinator any and empty arrays', () => {
        const q = normalizeQuery({ combinator: 'any' });
        assert.deepEqual(q, { combinator: 'any', name: '', classes: [], description: '' });
    });
});

describe('hasActiveCriteria', () => {
    it('is false when nothing is set', () => {
        assert.equal(hasActiveCriteria({ combinator: 'all', name: '', classes: [], description: '' }), false);
    });
    it('is true when any one criterion is set', () => {
        assert.equal(hasActiveCriteria({ combinator: 'all', name: 'a', classes: [], description: '' }), true);
        assert.equal(hasActiveCriteria({ combinator: 'all', name: '', classes: ['x'], description: '' }), true);
        assert.equal(hasActiveCriteria({ combinator: 'all', name: '', classes: [], description: 'd' }), true);
    });
});

describe('filterClassNames', () => {
    const classes = [{ name: 'car', count: 3 }, { name: 'cat', count: 1 }, { name: 'dog', count: 2 }];
    it('returns all when the filter is empty', () => {
        assert.equal(filterClassNames(classes, '').length, 3);
    });
    it('filters case-insensitively by substring', () => {
        assert.deepEqual(filterClassNames(classes, 'ca').map((c: any) => c.name), ['car', 'cat']);
        assert.deepEqual(filterClassNames(classes, 'O').map((c: any) => c.name), ['dog']);
    });
});

describe('formatBanner', () => {
    it('substitutes the count into the template', () => {
        assert.equal(formatBanner(7, 'Advanced filter active ({count})'), 'Advanced filter active (7)');
    });
});
