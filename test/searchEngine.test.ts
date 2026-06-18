import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { AnnotationRecord, SearchQuery, runAdvancedSearch } from '../src/searchEngine';

function rec(relPath: string, labels: Record<string, number> = {}): AnnotationRecord {
    return { relPath, labels: new Map(Object.entries(labels)), descriptions: [] };
}

function query(...conditions: SearchQuery['conditions']): SearchQuery {
    return { conditions };
}

describe('runAdvancedSearch — name condition', () => {
    const index: AnnotationRecord[] = [
        rec('a/cat.jpg'),
        rec('b/cat_2.jpg'),
        rec('c/dog.jpg'),
    ];

    it('returns [] when there are no conditions', () => {
        assert.deepEqual(runAdvancedSearch(index, query()), []);
    });

    it('matches every filename containing the value, in natural path order', () => {
        const res = runAdvancedSearch(index, query({ type: 'name', value: 'cat' }));
        assert.deepEqual(res, ['a/cat.jpg', 'b/cat_2.jpg']);
    });

    it('matches case-insensitively', () => {
        assert.equal(runAdvancedSearch(index, query({ type: 'name', value: 'CAT' })).length, 2);
    });
});

describe('runAdvancedSearch — nameRegex condition', () => {
    const index: AnnotationRecord[] = [
        rec('a/IMG_001.jpg'),
        rec('b/IMG_002.png'),
        rec('c/photo.jpg'),
    ];

    it('matches filenames against the pattern (case-insensitive)', () => {
        const res = runAdvancedSearch(index, query({ type: 'nameRegex', value: '^img_\\d+' }));
        assert.deepEqual(res, ['a/IMG_001.jpg', 'b/IMG_002.png']);
    });

    it('an invalid pattern matches nothing instead of throwing', () => {
        const res = runAdvancedSearch(index, query({ type: 'nameRegex', value: '[unclosed' }));
        assert.deepEqual(res, []);
    });

    it('combines with a class condition via AND', () => {
        const idx: AnnotationRecord[] = [
            rec('IMG_1.jpg', { car: 1 }),
            rec('IMG_2.jpg', { tree: 1 }),
            rec('other.jpg', { car: 1 }),
        ];
        const res = runAdvancedSearch(idx, query(
            { type: 'nameRegex', value: '^img_' },
            { type: 'class', values: ['car'] },
        ));
        assert.deepEqual(res, ['IMG_1.jpg']);
    });
});

describe('runAdvancedSearch — class condition (OR within one condition)', () => {
    const index: AnnotationRecord[] = [
        rec('img1.jpg', { car: 2, tree: 1 }),
        rec('img2.jpg', { tree: 5 }),
        rec('img3.jpg', { person: 1 }),
    ];

    it('matches images containing ANY of the selected classes', () => {
        const res = runAdvancedSearch(index, query({ type: 'class', values: ['car', 'person'] }));
        assert.deepEqual(res, ['img1.jpg', 'img3.jpg']);
    });

    it('matches images carrying any selected class, in natural path order', () => {
        const res = runAdvancedSearch(index, query({ type: 'class', values: ['car', 'tree'] }));
        assert.deepEqual(res, ['img1.jpg', 'img2.jpg']);
    });
});

describe('runAdvancedSearch — multiple conditions are AND', () => {
    it('requires every condition; two class conditions AND while each is OR internally', () => {
        const idx: AnnotationRecord[] = [
            rec('a.jpg', { car: 1, tree: 1 }),
            rec('b.jpg', { person: 1, tree: 2 }),
            rec('c.jpg', { car: 1 }),
            rec('d.jpg', { tree: 1 }),
        ];
        const res = runAdvancedSearch(idx, query(
            { type: 'class', values: ['car', 'person'] },
            { type: 'class', values: ['tree'] },
        ));
        assert.deepEqual(res, ['a.jpg', 'b.jpg']);
    });
});

describe('runAdvancedSearch — result order', () => {
    it('returns natural path order, regardless of how strongly each file matches', () => {
        const index: AnnotationRecord[] = [
            rec('z/img10.jpg', { car: 1 }),
            rec('z/img2.jpg', { car: 1 }),
        ];
        const res = runAdvancedSearch(index, query({ type: 'class', values: ['car'] }));
        assert.deepEqual(res, ['z/img2.jpg', 'z/img10.jpg']);
    });

    it('does not let an exact match jump ahead of an earlier substring match', () => {
        const index: AnnotationRecord[] = [
            rec('a/scattered.jpg'), // substring match on "cat"
            rec('z/cat.jpg'),       // exact stem match on "cat"
        ];
        const res = runAdvancedSearch(index, query({ type: 'name', value: 'cat' }));
        // Output preserves gallery order, so the exact match stays after the earlier file.
        assert.deepEqual(res, ['a/scattered.jpg', 'z/cat.jpg']);
    });
});
