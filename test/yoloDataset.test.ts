import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { parseDataYaml, resolveImageDirs, imageToLabelPath, parseYoloTxt } from '../src/yoloDataset';

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

describe('imageToLabelPath', () => {
    it('swaps the last /images/ segment for /labels/ and ext for .txt (posix)', () => {
        assert.equal(
            imageToLabelPath('/ds/images/train/img1.jpg'),
            '/ds/labels/train/img1.txt'
        );
    });
    it('swaps a \\images\\ segment on Windows-style paths', () => {
        assert.equal(
            imageToLabelPath('C:\\ds\\images\\train\\img1.png'),
            'C:\\ds\\labels\\train\\img1.txt'
        );
    });
    it('only replaces the LAST images segment', () => {
        assert.equal(
            imageToLabelPath('/images/ds/images/a.jpg'),
            '/images/ds/labels/a.txt'
        );
    });
    it('falls back to a sidecar .txt when there is no images segment', () => {
        assert.equal(imageToLabelPath('/ds/train/img1.jpeg'), '/ds/train/img1.txt');
    });
});

describe('parseYoloTxt', () => {
    const names = ['person', 'car'];

    it('parses a bbox line into a rectangle with pixel corner points', () => {
        const { shapes } = parseYoloTxt('0 0.5 0.5 0.2 0.4\n', 100, 200, names);
        assert.equal(shapes.length, 1);
        assert.equal(shapes[0].label, 'person');
        assert.equal(shapes[0].shape_type, 'rectangle');
        assert.deepEqual(shapes[0].points, [[40, 60], [60, 140]]);
    });

    it('parses a segmentation line into a polygon', () => {
        const { shapes } = parseYoloTxt('1 0 0 1 0 1 1\n', 100, 100, names);
        assert.equal(shapes[0].shape_type, 'polygon');
        assert.equal(shapes[0].label, 'car');
        assert.deepEqual(shapes[0].points, [[0, 0], [100, 0], [100, 100]]);
    });

    it('synthesizes a name and warns for an out-of-range class index', () => {
        const { shapes, warnings } = parseYoloTxt('5 0.5 0.5 0.1 0.1\n', 10, 10, names);
        assert.equal(shapes[0].label, 'class_5');
        assert.ok(warnings.length >= 1);
    });

    it('skips blank lines and warns on malformed token counts', () => {
        const { shapes, warnings } = parseYoloTxt('\n0 0.5 0.5\n', 10, 10, names);
        assert.equal(shapes.length, 0);
        assert.equal(warnings.length, 1);
    });
});
