import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'advancedSearchHelpers.js'));
const { buildQuery, hasActiveConditions, formatBanner, filterClassNames } = helpers;

describe('buildQuery', () => {
    it('trims name/regex values and shapes class values', () => {
        const q = buildQuery([
            { type: 'name', value: '  cat ' },
            { type: 'class', classes: ['car', 'person'] },
            { type: 'nameRegex', value: ' ^img_\\d+ ' },
        ]);
        assert.deepEqual(q, {
            conditions: [
                { type: 'name', value: 'cat' },
                { type: 'class', values: ['car', 'person'] },
                { type: 'nameRegex', value: '^img_\\d+' },
            ],
        });
    });

    it('drops empty conditions (blank text, empty class set)', () => {
        const q = buildQuery([
            { type: 'name', value: '   ' },
            { type: 'class', classes: [] },
            { type: 'nameRegex', value: '' },
            { type: 'class', classes: ['', '  '] },
        ]);
        assert.deepEqual(q, { conditions: [] });
    });

    it('keeps multiple conditions of the same type', () => {
        const q = buildQuery([
            { type: 'class', classes: ['car', 'person'] },
            { type: 'class', classes: ['tree'] },
        ]);
        assert.equal(q.conditions.length, 2);
        assert.deepEqual(q.conditions[1], { type: 'class', values: ['tree'] });
    });
});

describe('hasActiveConditions', () => {
    it('is false for an empty query', () => {
        assert.equal(hasActiveConditions({ conditions: [] }), false);
        assert.equal(hasActiveConditions(buildQuery([{ type: 'name', value: ' ' }])), false);
    });
    it('is true when at least one condition survives', () => {
        assert.equal(hasActiveConditions(buildQuery([{ type: 'name', value: 'x' }])), true);
    });
});

describe('formatBanner', () => {
    it('substitutes the count into the template', () => {
        assert.equal(formatBanner(7, 'Advanced filter active ({count})'), 'Advanced filter active (7)');
    });
});

describe('filterClassNames', () => {
    const data = [
        { name: 'car', count: 5 },
        { name: 'cardoor', count: 2 },
        { name: 'person', count: 9 },
        { name: 'scarf', count: 1 },
    ];

    const names = (arr: any[]) => arr.map((c: any) => c.name);

    it('returns every item (original order) when the filter is blank', () => {
        assert.deepEqual(names(filterClassNames(data, '')), ['car', 'cardoor', 'person', 'scarf']);
        assert.deepEqual(names(filterClassNames(data, '   ')), ['car', 'cardoor', 'person', 'scarf']);
    });

    it('matches by case-insensitive substring', () => {
        assert.deepEqual(names(filterClassNames(data, 'CAR')), ['car', 'cardoor', 'scarf']);
    });

    it('ranks prefix matches before mid-string matches, stable within each group', () => {
        // "car"/"cardoor" start with "car"; "scarf" only contains it → ranked last.
        assert.deepEqual(names(filterClassNames(data, 'car')), ['car', 'cardoor', 'scarf']);
    });

    it('returns an empty array when nothing matches', () => {
        assert.deepEqual(filterClassNames(data, 'zzz'), []);
    });

    it('tolerates a missing/empty universe', () => {
        assert.deepEqual(filterClassNames(undefined as any, 'x'), []);
        assert.deepEqual(filterClassNames([], 'x'), []);
    });
});
