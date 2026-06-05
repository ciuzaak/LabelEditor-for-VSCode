import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { AnnotationRecord, SearchQuery, runAdvancedSearch } from '../src/searchEngine';

function rec(relPath: string, labels: Record<string, number> = {}, descriptions: string[] = []): AnnotationRecord {
    return { relPath, labels: new Map(Object.entries(labels)), descriptions };
}

function q(partial: Partial<SearchQuery>): SearchQuery {
    return { combinator: 'all', name: '', classes: [], description: '', ...partial };
}

describe('runAdvancedSearch — name criterion', () => {
    const index: AnnotationRecord[] = [
        rec('a/cat.jpg'),
        rec('b/cat_2.jpg'),
        rec('c/dog.jpg'),
    ];

    it('returns [] when no criteria are active', () => {
        assert.deepEqual(runAdvancedSearch(index, q({})), []);
    });

    it('ranks exact basename above prefix above plain substring', () => {
        const res = runAdvancedSearch(index, q({ name: 'cat' }));
        assert.deepEqual(res.map(r => r.relPath), ['a/cat.jpg', 'b/cat_2.jpg']);
        assert.equal(res[0].nameMatchKind, 'exact');   // basename "cat" === query
        assert.equal(res[1].nameMatchKind, 'prefix');  // "cat_2" startsWith "cat"
        assert.ok(res[0].score > res[1].score);
    });

    it('matches case-insensitively', () => {
        const res = runAdvancedSearch(index, q({ name: 'CAT' }));
        assert.equal(res.length, 2);
    });
});

describe('runAdvancedSearch — class criterion (multi-select OR)', () => {
    const index: AnnotationRecord[] = [
        rec('img1.jpg', { car: 2, tree: 1 }),
        rec('img2.jpg', { tree: 5 }),
        rec('img3.jpg', { person: 1 }),
    ];

    it('matches images containing ANY selected class', () => {
        const res = runAdvancedSearch(index, q({ classes: ['car', 'person'] }));
        assert.deepEqual(res.map(r => r.relPath).sort(), ['img1.jpg', 'img3.jpg']);
    });

    it('scores more distinct matched classes and more instances higher', () => {
        const res = runAdvancedSearch(index, q({ classes: ['car', 'tree'] }));
        // img1 has both car(2)+tree(1) => 2*100 + 3*10 = 230
        // img2 has tree(5)           => 1*100 + 5*10 = 150
        assert.deepEqual(res.map(r => r.relPath), ['img1.jpg', 'img2.jpg']);
        assert.equal(res[0].matchedClasses.sort().join(','), 'car,tree');
        assert.equal(res[0].classInstanceCount, 3);
    });
});

describe('runAdvancedSearch — description criterion (substring)', () => {
    const index: AnnotationRecord[] = [
        rec('d1.jpg', {}, ['blurry edge', 'occluded']),
        rec('d2.jpg', {}, ['sharp']),
    ];

    it('matches shapes whose description contains the query', () => {
        const res = runAdvancedSearch(index, q({ description: 'occl' }));
        assert.deepEqual(res.map(r => r.relPath), ['d1.jpg']);
        assert.equal(res[0].descMatchCount, 1);
    });
});

describe('runAdvancedSearch — combinator', () => {
    const index: AnnotationRecord[] = [
        rec('only_name_cat.jpg', { dog: 1 }),
        rec('has_car.jpg', { car: 1 }),
        rec('cat_and_car.jpg', { car: 1 }),
    ];

    it('ALL requires every active criterion', () => {
        const res = runAdvancedSearch(index, q({ combinator: 'all', name: 'cat', classes: ['car'] }));
        assert.deepEqual(res.map(r => r.relPath), ['cat_and_car.jpg']);
    });

    it('ANY requires at least one active criterion', () => {
        const res = runAdvancedSearch(index, q({ combinator: 'any', name: 'cat', classes: ['car'] }));
        assert.deepEqual(res.map(r => r.relPath).sort(), ['cat_and_car.jpg', 'has_car.jpg', 'only_name_cat.jpg']);
    });
});

describe('runAdvancedSearch — tie-break', () => {
    it('equal scores fall back to natural path order', () => {
        const index: AnnotationRecord[] = [
            rec('z/img10.jpg', { car: 1 }),
            rec('z/img2.jpg', { car: 1 }),
        ];
        const res = runAdvancedSearch(index, q({ classes: ['car'] }));
        assert.deepEqual(res.map(r => r.relPath), ['z/img2.jpg', 'z/img10.jpg']); // numeric-aware
    });
});
