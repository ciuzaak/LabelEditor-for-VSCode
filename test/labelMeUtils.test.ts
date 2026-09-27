import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    buildLabelMeAnnotation,
    buildSvg,
    getImageMetadata,
    scanWorkspaceImages
} from '../src/labelMeUtils';

describe('scanWorkspaceImages', () => {
    it('recursively finds supported images, ignores generated folders, and sorts naturally by path segment', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labeleditor-scan-'));
        try {
            await fs.mkdir(path.join(root, 'set10'), { recursive: true });
            await fs.mkdir(path.join(root, 'set2'), { recursive: true });
            await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
            await fs.mkdir(path.join(root, '.hidden'), { recursive: true });
            await fs.mkdir(path.join(root, 'out'), { recursive: true });

            await fs.writeFile(path.join(root, 'image10.JPG'), '');
            await fs.writeFile(path.join(root, 'image2.png'), '');
            await fs.writeFile(path.join(root, 'notes.txt'), '');
            await fs.writeFile(path.join(root, 'set10', 'a.bmp'), '');
            await fs.writeFile(path.join(root, 'set2', 'b.jpeg'), '');
            await fs.writeFile(path.join(root, 'node_modules', 'ignored.png'), '');
            await fs.writeFile(path.join(root, '.hidden', 'ignored.jpg'), '');
            await fs.writeFile(path.join(root, 'out', 'ignored.bmp'), '');

            const images = await scanWorkspaceImages(root);

            assert.deepEqual(images, [
                'image2.png',
                'image10.JPG',
                path.join('set2', 'b.jpeg'),
                path.join('set10', 'a.bmp')
            ]);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});

describe('buildLabelMeAnnotation', () => {
    it('serializes annotations in LabelMe format with basename imagePath and null imageData', () => {
        const result = buildLabelMeAnnotation('/tmp/images/cat.png', {
            imageHeight: 480,
            imageWidth: 640,
            shapes: [
                {
                    label: 'cat',
                    points: [[1, 2], [3, 4]],
                    shape_type: 'rectangle'
                }
            ]
        });

        assert.deepEqual(result, {
            version: '5.0.1',
            flags: {},
            shapes: [
                {
                    label: 'cat',
                    points: [[1, 2], [3, 4]],
                    shape_type: 'rectangle'
                }
            ],
            imagePath: 'cat.png',
            imageData: null,
            imageHeight: 480,
            imageWidth: 640
        });
    });
});

describe('buildSvg', () => {
    it('expands rectangles, keeps lines open, and renders point annotations as circles', () => {
        const svg = buildSvg({
            imageWidth: 100,
            imageHeight: 80,
            shapes: [
                { shape_type: 'rectangle', points: [[10, 20], [30, 40]] },
                { shape_type: 'line', points: [[0, 0], [10, 0]] },
                { shape_type: 'point', points: [[5, 6]] }
            ]
        });

        assert.match(svg, /<svg[\s\S]*width="100" height="80"[\s\S]*viewBox="0 0 100 80"/);
        assert.match(svg, /<path id="path0"[\s\S]*M 10\.00,20\.00[\s\S]*Z"/);
        assert.match(svg, /<path id="path1"[\s\S]*M 0\.00,0\.00/);
        assert.doesNotMatch(svg.match(/<path id="path1"[\s\S]*?\/>/)?.[0] ?? '', / Z"/);
        assert.match(svg, /<circle id="point2"[\s\S]*cx="5\.00" cy="6\.00" r="5"/);
    });

    it('skips non-point shapes with fewer than two points', () => {
        const svg = buildSvg({
            imageWidth: 10,
            imageHeight: 10,
            shapes: [
                { shape_type: 'polygon', points: [[1, 1]] }
            ]
        });

        assert.doesNotMatch(svg, /<path id=/);
    });

    it('renders circle shapes as an SVG <circle> with the derived radius', () => {
        const svg = buildSvg({
            imageWidth: 100,
            imageHeight: 80,
            shapes: [
                // center = (50, 40), edge = (53, 44) -> radius = hypot(3, 4) = 5
                { shape_type: 'circle', points: [[50, 40], [53, 44]] }
            ]
        });

        assert.match(svg, /<circle id="circle0"[\s\S]*cx="50\.00" cy="40\.00" r="5\.00"/);
    });
});

describe('getImageMetadata', () => {
    it('reads PNG bit depth and DPI from signature, IHDR, and pHYs chunks', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labeleditor-meta-'));
        const pngPath = path.join(root, 'sample.png');
        try {
            await fs.writeFile(pngPath, makePngWithPhys({ bitDepth: 8, colorType: 2, ppmX: 3780, ppmY: 3780 }));

            const metadata = await getImageMetadata(pngPath);

            assert.equal(metadata.fileSize, (await fs.stat(pngPath)).size);
            assert.equal(metadata.bitDepth, 24);
            assert.equal(metadata.dpiX, 96);
            assert.equal(metadata.dpiY, 96);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    async function jpegMeta(bytes: Buffer) {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labeleditor-meta-'));
        try {
            const p = path.join(root, 'sample.jpg');
            await fs.writeFile(p, bytes);
            return await getImageMetadata(p);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    }

    it('reads JPEG dimensions and JFIF DPI', async () => {
        const meta = await jpegMeta(makeJpeg([jfifSegment(2, 118, 118)], 640, 480));
        assert.equal(meta.width, 640);
        assert.equal(meta.height, 480);
        assert.equal(meta.bitDepth, 24);
        assert.equal(meta.dpiX, 300);
    });

    it('finds the JPEG SOF marker past 64 KB of EXIF/XMP data', async () => {
        const big = [jpegSegment(0xE1, Buffer.alloc(60000, 0x41)), jpegSegment(0xE2, Buffer.alloc(60000, 0x42))];
        const meta = await jpegMeta(makeJpeg(big, 4032, 3024));
        assert.equal(meta.width, 4032);
        assert.equal(meta.height, 3024);
    });

    it('skips JPEG fill bytes between segments', async () => {
        const fill = Buffer.from([0xFF, 0xFF, 0xFF]);
        const meta = await jpegMeta(makeJpeg([jfifSegment(1, 72, 72), fill], 10, 20));
        assert.equal(meta.width, 10);
        assert.equal(meta.height, 20);
    });

    it('leaves JPEG dimensions undefined for a truncated file', async () => {
        const full = makeJpeg([jpegSegment(0xE1, Buffer.alloc(1000))], 10, 20);
        const meta = await jpegMeta(full.subarray(0, 600));
        assert.equal(meta.width, undefined);
        assert.equal(meta.height, undefined);
    });
});

function jpegSegment(marker: number, data: Buffer): Buffer {
    const head = Buffer.from([0xFF, marker, 0, 0]);
    head.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([head, data]);
}

function jfifSegment(unit: number, xDen: number, yDen: number): Buffer {
    const d = Buffer.alloc(14);
    d.write('JFIF\0', 0, 'ascii');
    d[5] = 1; d[6] = 1; d[7] = unit;
    d.writeUInt16BE(xDen, 8);
    d.writeUInt16BE(yDen, 10);
    return jpegSegment(0xE0, d);
}

function makeJpeg(segments: Buffer[], width: number, height: number): Buffer {
    const sof = Buffer.alloc(15);
    sof[0] = 8; // precision
    sof.writeUInt16BE(height, 1);
    sof.writeUInt16BE(width, 3);
    sof[5] = 3; // components
    return Buffer.concat([
        Buffer.from([0xFF, 0xD8]),
        ...segments,
        jpegSegment(0xC0, sof),
        Buffer.from([0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9])
    ]);
}

function makePngWithPhys(options: { bitDepth: number; colorType: number; ppmX: number; ppmY: number }): Buffer {
    const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(1, 0);
    ihdrData.writeUInt32BE(1, 4);
    ihdrData[8] = options.bitDepth;
    ihdrData[9] = options.colorType;

    const physData = Buffer.alloc(9);
    physData.writeUInt32BE(options.ppmX, 0);
    physData.writeUInt32BE(options.ppmY, 4);
    physData[8] = 1;

    return Buffer.concat([
        signature,
        pngChunk('IHDR', ihdrData),
        pngChunk('pHYs', physData),
        pngChunk('IDAT', Buffer.alloc(0)),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    return Buffer.concat([
        length,
        Buffer.from(type, 'ascii'),
        data,
        Buffer.alloc(4)
    ]);
}
