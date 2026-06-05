import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { AnnotationRecord, SearchQuery, runAdvancedSearch } from '../src/searchEngine';

function rec(relPath: string, labels: Record<string, number> = {}, descriptions: string[] = []): AnnotationRecord {
    return { relPath, labels: new Map(Object.entries(labels)), descriptions };
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

    it('returns [] when the only condition is empty', () => {
        assert.deepEqual(runAdvancedSearch(index, query({ type: 'name', value: '  ' })), []);
    });

    it('ranks exact stem above prefix above plain substring', () => {
        const res = runAdvancedSearch(index, query({ type: 'name', value: 'cat' }));
        assert.deepEqual(res.map(r => r.relPath), ['a/cat.jpg', 'b/cat_2.jpg']);
        assert.equal(res[0].nameMatchKind, 'exact');
        assert.equal(res[1].nameMatchKind, 'prefix');
        assert.ok(res[0].score > res[1].score);
    });

    it('matches case-insensitively', () => {
        assert.equal(runAdvancedSearch(index, query({ type: 'name', value: 'CAT' })).length, 2);
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
        assert.deepEqual(res.map(r => r.relPath).sort(), ['img1.jpg', 'img3.jpg']);
    });

    it('scores more distinct matched classes and more instances higher', () => {
        const res = runAdvancedSearch(index, query({ type: 'class', values: ['car', 'tree'] }));
        // img1: car(2)+tree(1) => 2*100 + 3*10 = 230 ; img2: tree(5) => 100 + 50 = 150
        assert.deepEqual(res.map(r => r.relPath), ['img1.jpg', 'img2.jpg']);
        assert.equal(res[0].matchedClasses.sort().join(','), 'car,tree');
        assert.equal(res[0].classInstanceCount, 3);
    });
});

describe('runAdvancedSearch — description condition', () => {
    const index: AnnotationRecord[] = [
        rec('d1.jpg', {}, ['blurry edge', 'occluded']),
        rec('d2.jpg', {}, ['sharp']),
    ];

    it('matches shapes whose description contains the query', () => {
        const res = runAdvancedSearch(index, query({ type: 'description', value: 'occl' }));
        assert.deepEqual(res.map(r => r.relPath), ['d1.jpg']);
        assert.equal(res[0].descMatchCount, 1);
    });
});

describe('runAdvancedSearch — multiple conditions are AND', () => {
    const index: AnnotationRecord[] = [
        rec('only_name_cat.jpg', { dog: 1 }),
        rec('has_car.jpg', { car: 1 }),
        rec('cat_and_car.jpg', { car: 1 }),
    ];

    it('requires every condition to be satisfied', () => {
        const res = runAdvancedSearch(index, query(
            { type: 'name', value: 'cat' },
            { type: 'class', values: ['car'] },
        ));
        assert.deepEqual(res.map(r => r.relPath), ['cat_and_car.jpg']);
    });

    it('two class conditions AND while each is OR internally — (car|person) AND tree', () => {
        const idx: AnnotationRecord[] = [
            rec('a.jpg', { car: 1, tree: 1 }),     // car AND tree -> qualifies
            rec('b.jpg', { person: 1, tree: 2 }),  // person AND tree -> qualifies
            rec('c.jpg', { car: 1 }),              // car but no tree -> out
            rec('d.jpg', { tree: 1 }),             // tree but neither car/person -> out
        ];
        const res = runAdvancedSearch(idx, query(
            { type: 'class', values: ['car', 'person'] },
            { type: 'class', values: ['tree'] },
        ));
        assert.deepEqual(res.map(r => r.relPath).sort(), ['a.jpg', 'b.jpg']);
    });
});

describe('runAdvancedSearch — tie-break', () => {
    it('equal scores fall back to natural path order', () => {
        const index: AnnotationRecord[] = [
            rec('z/img10.jpg', { car: 1 }),
            rec('z/img2.jpg', { car: 1 }),
        ];
        const res = runAdvancedSearch(index, query({ type: 'class', values: ['car'] }));
        assert.deepEqual(res.map(r => r.relPath), ['z/img2.jpg', 'z/img10.jpg']);
    });
});
