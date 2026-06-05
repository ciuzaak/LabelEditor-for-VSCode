import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helpers = require(path.resolve(__dirname, '..', '..', 'media', 'advancedSearchHelpers.js'));
const { buildQuery, hasActiveConditions, formatBanner } = helpers;

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
