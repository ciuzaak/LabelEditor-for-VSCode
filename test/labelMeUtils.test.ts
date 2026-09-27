import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    buildLabelMeAnnotation,
    buildSvg,
    getImageMetadata,
    parseExifOrientation,
    parseTiffOrientation,
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

    it('swaps JPEG dimensions for EXIF orientations that rotate 90°', async () => {
        for (const o of [5, 6, 7, 8]) {
            const meta = await jpegMeta(makeJpeg([exifSegment(o, 'MM')], 4032, 3024));
            assert.equal(meta.orientation, o);
            assert.deepEqual([meta.width, meta.height], [3024, 4032], `orientation ${o}`);
        }
    });

    it('keeps JPEG dimensions for orientations 1–4', async () => {
        for (const o of [1, 2, 3, 4]) {
            const meta = await jpegMeta(makeJpeg([exifSegment(o, 'II')], 4032, 3024));
            assert.equal(meta.orientation, o);
            assert.deepEqual([meta.width, meta.height], [4032, 3024], `orientation ${o}`);
        }
    });

    it('reads EXIF orientation after an XMP APP1 segment', async () => {
        const xmp = jpegSegment(0xE1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>', 'latin1'));
        const meta = await jpegMeta(makeJpeg([xmp, exifSegment(6, 'II')], 640, 480));
        assert.deepEqual([meta.width, meta.height], [480, 640]);
    });

    async function pngMeta(bytes: Buffer) {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labeleditor-meta-'));
        try {
            const p = path.join(root, 'sample.png');
            await fs.writeFile(p, bytes);
            return await getImageMetadata(p);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    }

    it('applies a PNG eXIf orientation (raw TIFF payload) after pHYs', async () => {
        const meta = await pngMeta(makePng(400, 200, [
            physChunk(3780),
            pngChunk('eXIf', exifPayload(6, 'MM').subarray(6)),
        ]));
        assert.equal(meta.orientation, 6);
        assert.deepEqual([meta.width, meta.height], [200, 400]);
        assert.equal(meta.dpiX, 96);
    });

    it('accepts a PNG eXIf payload that keeps the "Exif\\0\\0" prefix', async () => {
        const meta = await pngMeta(makePng(400, 200, [pngChunk('eXIf', exifPayload(8, 'II'))]));
        assert.deepEqual([meta.width, meta.height], [200, 400]);
    });

    it('ignores a PNG eXIf chunk after the image data', async () => {
        const meta = await pngMeta(makePng(400, 200, [], [pngChunk('eXIf', exifPayload(6, 'II').subarray(6))]));
        assert.equal(meta.orientation, undefined);
        assert.deepEqual([meta.width, meta.height], [400, 200]);
    });

    it('leaves JPEG dimensions undefined for a truncated file', async () => {
        const full = makeJpeg([jpegSegment(0xE1, Buffer.alloc(1000))], 10, 20);
        const meta = await jpegMeta(full.subarray(0, 600));
        assert.equal(meta.width, undefined);
        assert.equal(meta.height, undefined);
    });
});

describe('parseExifOrientation', () => {
    it('reads the tag in either byte order', () => {
        assert.equal(parseExifOrientation(exifPayload(6, 'II')), 6);
        assert.equal(parseExifOrientation(exifPayload(8, 'MM')), 8);
    });

    it('finds the tag after other IFD0 entries', () => {
        assert.equal(parseExifOrientation(exifPayload(3, 'II', 4)), 3);
    });

    it('parseTiffOrientation reads a payload without the Exif header', () => {
        assert.equal(parseTiffOrientation(exifPayload(5, 'MM').subarray(6)), 5);
        assert.equal(parseTiffOrientation(Buffer.from('Exif\0\0')), undefined);
    });

    it('rejects non-EXIF, malformed or out-of-range data', () => {
        assert.equal(parseExifOrientation(Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1')), undefined);
        assert.equal(parseExifOrientation(exifPayload(9, 'II')), undefined);
        assert.equal(parseExifOrientation(exifPayload(6, 'II').subarray(0, 20)), undefined);
        const noTag = exifPayload(6, 'II');
        noTag.writeUInt16LE(0x010F, 6 + 8 + 2); // retag the entry as Make
        assert.equal(parseExifOrientation(noTag), undefined);
    });
});

// APP1 payload: "Exif\0\0" + TIFF header + IFD0 with `before` filler entries
// followed by the Orientation entry.
function exifPayload(orientation: number, order: 'II' | 'MM', before = 0): Buffer {
    const le = order === 'II';
    const entries = before + 1;
    const tiff = Buffer.alloc(8 + 2 + entries * 12 + 4);
    const w16 = (v: number, o: number) => le ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o);
    const w32 = (v: number, o: number) => le ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o);
    tiff.write(order, 0, 'ascii');
    w16(42, 2);
    w32(8, 4);
    w16(entries, 8);
    for (let e = 0; e < entries; e++) {
        const at = 10 + e * 12;
        const isOrientation = e === entries - 1;
        w16(isOrientation ? 0x0112 : 0x0100 + e, at); // filler tags: ImageWidth, ImageLength, ...
        w16(3, at + 2);
        w32(1, at + 4);
        w16(isOrientation ? orientation : 0, at + 8);
    }
    return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
}

function exifSegment(orientation: number, order: 'II' | 'MM'): Buffer {
    return jpegSegment(0xE1, exifPayload(orientation, order));
}

function makePng(width: number, height: number, before: Buffer[], after: Buffer[] = []): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        pngChunk('IHDR', ihdr),
        ...before,
        pngChunk('IDAT', Buffer.alloc(4)),
        ...after,
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function physChunk(ppm: number): Buffer {
    const d = Buffer.alloc(9);
    d.writeUInt32BE(ppm, 0);
    d.writeUInt32BE(ppm, 4);
    d[8] = 1;
    return pngChunk('pHYs', d);
}

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
