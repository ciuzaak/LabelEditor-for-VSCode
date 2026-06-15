import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { parseDataYaml, resolveImageDirs, imageToLabelPath, parseYoloTxt, buildYoloTxt, appendClassToYaml } from '../src/yoloDataset';

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

    it('parses a column-0 block sequence for train and keeps the next key separate', () => {
        const text = 'train:\n- images/a\n- images/b\nval:\n- images/c\nnames: [x]\n';
        const r = parseDataYaml(text);
        assert.deepEqual(r.train, ['images/a', 'images/b']);
        assert.deepEqual(r.val, ['images/c']);
        assert.deepEqual(r.names, ['x']);
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

describe('buildYoloTxt', () => {
    const classes = ['person', 'car'];

    it('writes a rectangle as a bbox line', () => {
        const shapes = [{ label: 'person', shape_type: 'rectangle', points: [[40, 60], [60, 140]] }];
        const { text } = buildYoloTxt(shapes, 100, 200, classes);
        assert.equal(text, '0 0.500000 0.500000 0.200000 0.400000\n');
    });

    it('writes a polygon as a segmentation line', () => {
        const shapes = [{ label: 'car', shape_type: 'polygon', points: [[0, 0], [100, 0], [100, 100]] }];
        const { text } = buildYoloTxt(shapes, 100, 100, classes);
        assert.equal(text, '1 0.000000 0.000000 1.000000 0.000000 1.000000 1.000000\n');
    });

    it('round-trips parse -> build for a mixed file', () => {
        const src = '0 0.500000 0.500000 0.200000 0.400000\n1 0.000000 0.000000 1.000000 0.000000 1.000000 1.000000\n';
        const { shapes } = parseYoloTxt(src, 100, 200, classes);
        const { text } = buildYoloTxt(shapes, 100, 200, classes);
        assert.equal(text, src);
    });

    it('skips a shape whose label is not in classes and warns', () => {
        const shapes = [{ label: 'tree', shape_type: 'rectangle', points: [[0, 0], [10, 10]] }];
        const { text, warnings } = buildYoloTxt(shapes, 100, 100, classes);
        assert.equal(text, '');
        assert.equal(warnings.length, 1);
    });

    it('preserves an out-of-range class_<n> label by writing index n', () => {
        const shapes = [{ label: 'class_5', shape_type: 'polygon', points: [[0, 0], [100, 0], [100, 100]] }];
        const { text, warnings } = buildYoloTxt(shapes, 100, 100, classes);
        assert.equal(text, '5 0.000000 0.000000 1.000000 0.000000 1.000000 1.000000\n');
        assert.equal(warnings.length, 0);
    });
});

describe('appendClassToYaml', () => {
    it('appends to a block-mapping names and returns the new index', () => {
        const text = 'names:\n  0: person\n  1: bicycle\n';
        const { text: out, index } = appendClassToYaml(text, 'car');
        assert.equal(index, 2);
        assert.deepEqual(parseDataYaml(out).names, ['person', 'bicycle', 'car']);
    });

    it('appends to a flow-list names', () => {
        const text = "names: ['person', 'bicycle']\n";
        const { text: out, index } = appendClassToYaml(text, 'car');
        assert.equal(index, 2);
        assert.deepEqual(parseDataYaml(out).names, ['person', 'bicycle', 'car']);
    });

    it('appends to a block-sequence names', () => {
        const text = 'names:\n- person\n- bicycle\n';
        const { text: out } = appendClassToYaml(text, 'car');
        assert.deepEqual(parseDataYaml(out).names, ['person', 'bicycle', 'car']);
    });

    it('bumps nc when present', () => {
        const text = 'nc: 2\nnames: [a, b]\n';
        const { text: out } = appendClassToYaml(text, 'c');
        assert.match(out, /nc:\s*3/);
    });
});
