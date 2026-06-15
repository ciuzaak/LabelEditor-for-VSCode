import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { parseDataYaml, resolveImageDirs } from '../src/yoloDataset';

describe('parseDataYaml', () => {
    it('parses a block-mapping names form', () => {
        const text = [
            'path: ../datasets/coco8',
            'train: images/train',
            'val: images/val',
            'names:',
            '  0: person',
            '  1: bicycle',
        ].join('\n');
        const r = parseDataYaml(text);
        assert.equal(r.path, '../datasets/coco8');
        assert.deepEqual(r.train, ['images/train']);
        assert.deepEqual(r.val, ['images/val']);
        assert.deepEqual(r.names, ['person', 'bicycle']);
    });

    it('parses a flow-list names form and strips quotes/comments', () => {
        const text = "names: ['person', \"bicycle\"]  # 2 classes\nnc: 2\n";
        const r = parseDataYaml(text);
        assert.deepEqual(r.names, ['person', 'bicycle']);
    });

    it('parses a block-sequence names form', () => {
        const text = 'names:\n- person\n- bicycle\n';
        const r = parseDataYaml(text);
        assert.deepEqual(r.names, ['person', 'bicycle']);
    });

    it('parses list-valued train', () => {
        const text = 'train: [images/a, images/b]\nnames: [x]\n';
        const r = parseDataYaml(text);
        assert.deepEqual(r.train, ['images/a', 'images/b']);
    });

    it('returns empty defaults for missing keys', () => {
        const r = parseDataYaml('foo: bar\n');
        assert.equal(r.path, null);
        assert.deepEqual(r.names, []);
        assert.deepEqual(r.train, []);
    });
});

describe('resolveImageDirs', () => {
    it('resolves train/val relative to path, relative to the yaml dir', () => {
        const yaml = path.resolve('/ds/data.yaml');
        const parsed = { path: '.', train: ['images/train'], val: ['images/val'], test: [], names: [] };
        const { dirs } = resolveImageDirs(yaml, parsed);
        assert.deepEqual(dirs, [
            path.resolve('/ds/images/train'),
            path.resolve('/ds/images/val'),
        ]);
    });

    it('respects an absolute entry and dedupes', () => {
        const yaml = path.resolve('/ds/data.yaml');
        const abs = path.resolve('/other/imgs');
        const parsed = { path: null, train: [abs], val: [abs], test: [], names: [] };
        const { dirs } = resolveImageDirs(yaml, parsed);
        assert.deepEqual(dirs, [path.normalize(abs)]);
    });

    it('warns and skips a .txt list-file entry', () => {
        const yaml = path.resolve('/ds/data.yaml');
        const parsed = { path: null, train: ['train.txt'], val: [], test: [], names: [] };
        const { dirs, warnings } = resolveImageDirs(yaml, parsed);
        assert.deepEqual(dirs, []);
        assert.equal(warnings.length, 1);
    });
});
