import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
    polygonAabb,
    polygonArea,
    polygonizeCircle,
    shapeToPolygonRing,
    shapeAabb,
    buildCocoDocument,
    buildYoloBboxLines,
    buildYoloSegLines,
    buildClassesTxt,
    ExportImage
} from '../src/exportFormats';

describe('polygonAabb', () => {
    it('returns zero box for an empty point list', () => {
        const box = polygonAabb([]);
        assert.deepEqual(box, { x: 0, y: 0, w: 0, h: 0 });
    });
    it('returns the tight box for a triangle', () => {
        const box = polygonAabb([[0, 0], [10, 0], [5, 8]]);
        assert.deepEqual(box, { x: 0, y: 0, w: 10, h: 8 });
    });
});

describe('polygonArea', () => {
    it('returns 0 for fewer than three points', () => {
        assert.equal(polygonArea([[0, 0], [1, 1]]), 0);
    });
    it('returns 100 for the 10x10 axis-aligned square', () => {
        assert.equal(polygonArea([[0, 0], [10, 0], [10, 10], [0, 10]]), 100);
    });
    it('is sign-insensitive (clockwise input still positive)', () => {
        assert.equal(polygonArea([[0, 0], [0, 10], [10, 10], [10, 0]]), 100);
    });
});

describe('polygonizeCircle', () => {
    it('emits the requested number of vertices', () => {
        const ring = polygonizeCircle([0, 0], [5, 0], 8);
        assert.equal(ring.length, 8);
    });
    it('every vertex sits at hypot(edge - center) from the center', () => {
        const ring = polygonizeCircle([10, 10], [13, 14], 32);
        const r = Math.hypot(13 - 10, 14 - 10);
        for (const [x, y] of ring) {
            const d = Math.hypot(x - 10, y - 10);
            assert.ok(Math.abs(d - r) < 1e-9, `vertex distance ${d} ≠ ${r}`);
        }
    });
});

describe('shapeToPolygonRing', () => {
    it('returns polygon points unchanged', () => {
        const pts = [[0, 0], [1, 0], [1, 1]];
        assert.deepEqual(shapeToPolygonRing({ shape_type: 'polygon', points: pts }), pts);
    });
    it('expands a rectangle to four corners (CCW order from spec)', () => {
        const ring = shapeToPolygonRing({ shape_type: 'rectangle', points: [[0, 0], [10, 5]] });
        assert.deepEqual(ring, [[0, 0], [10, 0], [10, 5], [0, 5]]);
    });
    it('polygonizes a circle to 32 segments', () => {
        const ring = shapeToPolygonRing({ shape_type: 'circle', points: [[10, 10], [12, 10]] });
        assert.equal(ring?.length, 32);
    });
    it('returns null for non-areal shape types', () => {
        assert.equal(shapeToPolygonRing({ shape_type: 'point', points: [[0, 0]] }), null);
        assert.equal(shapeToPolygonRing({ shape_type: 'linestrip', points: [[0, 0], [1, 1]] }), null);
    });
});

describe('shapeAabb', () => {
    it('returns a 1×1 box for a point', () => {
        assert.deepEqual(shapeAabb({ shape_type: 'point', points: [[3, 4]] }), { x: 3, y: 4, w: 1, h: 1 });
    });
    it('returns 2r×2r centered on a circle', () => {
        assert.deepEqual(shapeAabb({ shape_type: 'circle', points: [[10, 10], [13, 14]] }), { x: 5, y: 5, w: 10, h: 10 });
    });
    it('handles rectangle with reversed corner ordering', () => {
        assert.deepEqual(shapeAabb({ shape_type: 'rectangle', points: [[20, 30], [10, 10]] }), { x: 10, y: 10, w: 10, h: 20 });
    });
});

describe('buildCocoDocument', () => {
    const images: ExportImage[] = [
        {
            fileName: 'img1.png',
            width: 100,
            height: 80,
            shapes: [
                { label: 'cat', shape_type: 'polygon', points: [[10, 10], [20, 10], [20, 20]] },
                { label: 'dog', shape_type: 'rectangle', points: [[0, 0], [10, 10]] },
                { label: 'cat', shape_type: 'circle', points: [[50, 40], [55, 40]] },
                { label: 'mouse', shape_type: 'point', points: [[5, 5]] },
                { label: 'mouse', shape_type: 'linestrip', points: [[1, 1], [2, 2]] }
            ]
        }
    ];

    it('builds image, category, and annotation arrays with 1-based category IDs', () => {
        const { document, warnings } = buildCocoDocument(images, ['cat', 'dog']);
        const doc = document as any;
        assert.equal(doc.images.length, 1);
        assert.deepEqual(doc.categories.map((c: any) => c.id), [1, 2]);
        assert.deepEqual(doc.categories.map((c: any) => c.name), ['cat', 'dog']);
        // 3 convertible: poly(cat), rect(dog), circle(cat). mouse: not in classes; point/linestrip: unsupported.
        assert.equal(doc.annotations.length, 3);
        assert.equal(doc.annotations[0].category_id, 1);
        assert.equal(doc.annotations[1].category_id, 2);
        assert.equal(doc.annotations[2].category_id, 1);
        // Each annotation has a flat-ring segmentation array.
        for (const ann of doc.annotations) {
            assert.ok(Array.isArray(ann.segmentation) && Array.isArray(ann.segmentation[0]));
            assert.ok(ann.segmentation[0].length >= 6);
            assert.ok(ann.bbox.length === 4);
            assert.ok(typeof ann.area === 'number' && ann.area > 0);
        }
        // Warnings cover the mouse shapes (both filtered by class list lookup first).
        assert.ok(warnings.length >= 2);
    });
});

describe('buildYoloBboxLines', () => {
    const image: ExportImage = {
        fileName: 'sample.jpg',
        width: 100,
        height: 50,
        shapes: [
            { label: 'cat', shape_type: 'rectangle', points: [[20, 10], [60, 30]] },
            { label: 'unknown', shape_type: 'polygon', points: [[0, 0], [1, 0], [1, 1]] }
        ]
    };

    it('normalises bbox to 0..1 and uses 0-based class index', () => {
        const { text, warnings } = buildYoloBboxLines(image, ['cat']);
        const line = text.trim().split('\n')[0].split(' ');
        assert.equal(line[0], '0');
        assert.equal(Number(line[1]).toFixed(2), '0.40');
        assert.equal(Number(line[2]).toFixed(2), '0.40');
        assert.equal(Number(line[3]).toFixed(2), '0.40');
        assert.equal(Number(line[4]).toFixed(2), '0.40');
        assert.ok(warnings.length === 1 && warnings[0].label === 'unknown');
    });

    it('emits a 1×1 bbox for point shapes', () => {
        const img: ExportImage = {
            fileName: 'pt.jpg', width: 100, height: 100,
            shapes: [{ label: 'kp', shape_type: 'point', points: [[50, 50]] }]
        };
        const { text } = buildYoloBboxLines(img, ['kp']);
        const parts = text.trim().split(' ');
        assert.equal(parts[0], '0');
        // 1px in 100px image -> 0.01 normalized
        assert.equal(Number(parts[3]).toFixed(4), '0.0100');
        assert.equal(Number(parts[4]).toFixed(4), '0.0100');
    });
});

describe('buildYoloSegLines', () => {
    it('expands rectangle to 4 normalised corners and skips unsupported shapes', () => {
        const image: ExportImage = {
            fileName: 'seg.jpg', width: 100, height: 100,
            shapes: [
                { label: 'cat', shape_type: 'rectangle', points: [[20, 20], [80, 80]] },
                { label: 'cat', shape_type: 'linestrip', points: [[0, 0], [1, 1]] }
            ]
        };
        const { text, warnings } = buildYoloSegLines(image, ['cat']);
        const lines = text.trim().split('\n');
        assert.equal(lines.length, 1);
        const parts = lines[0].split(' ');
        assert.equal(parts[0], '0');
        // 4 vertices * 2 coords + 1 class index = 9 tokens
        assert.equal(parts.length, 9);
        assert.equal(Number(parts[1]).toFixed(2), '0.20');
        assert.ok(warnings.some(w => w.shape_type === 'linestrip'));
    });
});

describe('buildClassesTxt', () => {
    it('joins classes with newlines and trailing newline', () => {
        assert.equal(buildClassesTxt(['cat', 'dog']), 'cat\ndog\n');
    });
    it('returns empty string for empty list', () => {
        assert.equal(buildClassesTxt([]), '');
    });
});

describe('degenerate geometry rejection', () => {
    it('COCO drops a zero-radius circle with a zero-area warning', () => {
        const images: ExportImage[] = [{
            fileName: 'tiny.png', width: 100, height: 100,
            shapes: [
                { label: 'cat', shape_type: 'circle', points: [[50, 50], [50, 50]] }, // r = 0
                { label: 'cat', shape_type: 'polygon', points: [[10, 10], [20, 10], [30, 10]] } // collinear
            ]
        }];
        const { document, warnings } = buildCocoDocument(images, ['cat']);
        assert.equal((document as any).annotations.length, 0);
        assert.equal(warnings.length, 2);
        assert.ok(warnings.every(w => w.reason === 'zero-area geometry'));
    });

    it('YOLO bbox drops a zero-extent polygon but keeps point shapes', () => {
        const image: ExportImage = {
            fileName: 'mixed.png', width: 100, height: 100,
            shapes: [
                { label: 'cat', shape_type: 'polygon', points: [[10, 10], [10, 10], [10, 10]] }, // 0×0
                { label: 'kp', shape_type: 'point', points: [[5, 5]] }
            ]
        };
        const { text, warnings } = buildYoloBboxLines(image, ['cat', 'kp']);
        // Only the point shape should be present in the output.
        const lines = text.trim().split('\n').filter(s => s.length > 0);
        assert.equal(lines.length, 1);
        assert.equal(lines[0].split(' ')[0], '1');
        assert.ok(warnings.some(w => w.reason === 'zero-area bbox'));
    });

    it('YOLO bbox drops a collinear polygon even when its bbox has positive extent', () => {
        const image: ExportImage = {
            fileName: 'diag.png', width: 100, height: 100,
            shapes: [
                // Diagonal collinear polygon: bbox is 40x40 (positive) but polygon area is 0.
                { label: 'cat', shape_type: 'polygon', points: [[10, 10], [30, 30], [50, 50]] }
            ]
        };
        const { text, warnings } = buildYoloBboxLines(image, ['cat']);
        assert.equal(text, '');
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].reason, 'zero-area geometry');
    });

    it('YOLO seg drops a zero-area polygon', () => {
        const image: ExportImage = {
            fileName: 'flat.png', width: 100, height: 100,
            shapes: [
                { label: 'cat', shape_type: 'polygon', points: [[10, 10], [30, 10], [50, 10]] } // collinear
            ]
        };
        const { text, warnings } = buildYoloSegLines(image, ['cat']);
        assert.equal(text, '');
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].reason, 'zero-area geometry');
    });
});
