import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDataYaml } from '../src/yoloDataset';

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
