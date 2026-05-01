import * as fs from 'fs/promises';
import * as path from 'path';

export interface LabelMeShape {
    label?: string;
    points: number[][];
    shape_type?: string;
    [key: string]: unknown;
}

export interface AnnotationPayload {
    shapes: LabelMeShape[];
    imageHeight: number;
    imageWidth: number;
}

export interface ImageMetadata {
    fileSize: number;
    bitDepth?: number;
    dpiX?: number;
    dpiY?: number;
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'out']);

export async function scanWorkspaceImages(rootPath: string): Promise<string[]> {
    const images: string[] = [];

    const scanDirectory = async (dirPath: string): Promise<void> => {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
                        await scanDirectory(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (IMAGE_EXTENSIONS.includes(ext)) {
                        images.push(path.relative(rootPath, fullPath));
                    }
                }
            }
        } catch {
            // Ignore inaccessible directories so one bad folder does not block browsing.
        }
    };

    await scanDirectory(rootPath);
    images.sort(comparePathsNaturally);
    return images;
}

export function buildLabelMeAnnotation(imagePath: string, data: AnnotationPayload) {
    return {
        version: '5.0.1',
        flags: {},
        shapes: data.shapes,
        imagePath: path.basename(imagePath),
        imageData: null,
        imageHeight: data.imageHeight,
        imageWidth: data.imageWidth
    };
}

export function buildSvg(data: AnnotationPayload): string {
    const shapes = data.shapes || [];
    const width = data.imageWidth;
    const height = data.imageHeight;
    const insertPoints = 3;
    const pathElements: string[] = [];

    for (let idx = 0; idx < shapes.length; idx++) {
        let points = shapes[idx].points;
        const shapeType = shapes[idx].shape_type || 'polygon';
        const isClosed = shapeType === 'polygon' || shapeType === 'rectangle';

        if (shapeType === 'rectangle' && points.length === 2) {
            const [p1, p2] = points;
            points = [p1, [p2[0], p1[1]], p2, [p1[0], p2[1]]];
        }

        if (shapeType === 'point' && points.length >= 1) {
            const px = points[0][0].toFixed(2);
            const py = points[0][1].toFixed(2);
            pathElements.push(`  <circle id="point${idx}"
        cx="${px}" cy="${py}" r="5"
        fill="none" stroke="black" stroke-width="1" />`);
            continue;
        }

        if (points.length < 2) continue;

        if (insertPoints > 0) {
            const n = points.length;
            const numSegments = isClosed ? n : n - 1;
            const expanded: number[][] = [];
            for (let i = 0; i < numSegments; i++) {
                const p1 = points[i];
                const p2 = isClosed ? points[(i + 1) % n] : points[i + 1];
                expanded.push(p1);
                for (let j = 1; j <= insertPoints; j++) {
                    const t = j / (insertPoints + 1);
                    const x = p1[0] + t * (p2[0] - p1[0]);
                    const y = p1[1] + t * (p2[1] - p1[1]);
                    expanded.push([x, y]);
                }
            }
            if (!isClosed) {
                expanded.push(points[points.length - 1]);
            }
            points = expanded;
        }

        let pathData = `M ${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
        const extendedPoints = isClosed ? [...points, points[0], points[1]] : points;
        const numSegs = isClosed ? points.length : points.length - 1;

        const lines: string[] = [];
        for (let i = 0; i < numSegs; i++) {
            const prevPt = extendedPoints[i];
            const nextPt = extendedPoints[i + 1];
            const coords = `${prevPt[0].toFixed(2)},${prevPt[1].toFixed(2)} ${nextPt[0].toFixed(2)},${nextPt[1].toFixed(2)} ${nextPt[0].toFixed(2)},${nextPt[1].toFixed(2)}`;
            if (i === 0) {
                lines.push(`           C ${coords}`);
            } else {
                lines.push(`             ${coords}`);
            }
        }

        if (isClosed && lines.length > 0) {
            lines[lines.length - 1] = lines[lines.length - 1] + ' Z';
        }

        pathData = pathData + '\n' + lines.join('\n');
        pathElements.push(`  <path id="path${idx}"
        fill="none" stroke="black" stroke-width="1"
        d="${pathData}" />`);
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:svg="http://www.w3.org/2000/svg"
     version="1.1"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}">
${pathElements.join('\n')}
</svg>`;
}

export async function getImageMetadata(filePath: string): Promise<ImageMetadata> {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
        stat = await fs.stat(filePath);
    } catch {
        return { fileSize: 0 };
    }

    const result: ImageMetadata = { fileSize: stat.size };

    try {
        const fd = await fs.open(filePath, 'r');
        try {
            const magic = Buffer.alloc(8);
            const { bytesRead: magicRead } = await fd.read(magic, 0, 8, 0);
            const isPng = magicRead >= 8
                && magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47
                && magic[4] === 0x0D && magic[5] === 0x0A && magic[6] === 0x1A && magic[7] === 0x0A;
            const isJpeg = magicRead >= 3 && magic[0] === 0xFF && magic[1] === 0xD8 && magic[2] === 0xFF;
            const isBmp = magicRead >= 2 && magic[0] === 0x42 && magic[1] === 0x4D;

            if (isPng) {
                await readPngMetadata(fd, stat.size, result);
            } else if (isJpeg) {
                await readJpegMetadata(fd, result);
            } else if (isBmp) {
                await readBmpMetadata(fd, result);
            }

            if (isPng || isJpeg || isBmp) {
                if (result.dpiX === undefined) result.dpiX = 96;
                if (result.dpiY === undefined) result.dpiY = 96;
            }
        } finally {
            await fd.close();
        }
    } catch {
        // Metadata extraction is best-effort.
    }

    return result;
}

function comparePathsNaturally(a: string, b: string): number {
    const partsA = a.split(/[\\/]/);
    const partsB = b.split(/[\\/]/);
    const minLen = Math.min(partsA.length, partsB.length);
    for (let i = 0; i < minLen; i++) {
        const cmp = partsA[i].localeCompare(partsB[i], undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
    }
    return partsA.length - partsB.length;
}

async function readPngMetadata(fd: fs.FileHandle, fileSize: number, result: ImageMetadata): Promise<void> {
    const header = Buffer.alloc(33);
    const { bytesRead: headerRead } = await fd.read(header, 0, 33, 0);
    if (headerRead === 33
        && header.readUInt32BE(8) === 13
        && header.toString('ascii', 12, 16) === 'IHDR') {
        result.bitDepth = header[24];
        const colorType = header[25];
        if (colorType === 2) result.bitDepth = header[24] * 3;
        else if (colorType === 4) result.bitDepth = header[24] * 2;
        else if (colorType === 6) result.bitDepth = header[24] * 4;
    }

    let offset = 33;
    const chunkHeader = Buffer.alloc(8);
    while (offset < 65536 && offset + 12 <= fileSize) {
        const { bytesRead: chRead } = await fd.read(chunkHeader, 0, 8, offset);
        if (chRead < 8) break;
        const chunkLen = chunkHeader.readUInt32BE(0);
        if (chunkLen > 0x7FFFFFFF || offset + 12 + chunkLen > fileSize) break;
        const chunkType = chunkHeader.toString('ascii', 4, 8);
        if (chunkType === 'IDAT' || chunkType === 'IEND') break;
        if (chunkType === 'pHYs' && chunkLen === 9) {
            const phys = Buffer.alloc(9);
            const { bytesRead: phRead } = await fd.read(phys, 0, 9, offset + 8);
            if (phRead === 9) {
                const ppmX = phys.readUInt32BE(0);
                const ppmY = phys.readUInt32BE(4);
                const unit = phys[8];
                if (unit === 1) {
                    result.dpiX = Math.round(ppmX / 39.3701);
                    result.dpiY = Math.round(ppmY / 39.3701);
                }
            }
            break;
        }
        offset += 12 + chunkLen;
    }
}

async function readJpegMetadata(fd: fs.FileHandle, result: ImageMetadata): Promise<void> {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fd.read(buf, 0, 65536, 0);

    let i = 2;
    while (i < bytesRead - 1) {
        if (buf[i] !== 0xFF) {
            i++;
            continue;
        }
        while (i + 1 < bytesRead && buf[i + 1] === 0xFF) i++;
        if (i + 1 >= bytesRead) break;
        const marker = buf[i + 1];

        if (marker === 0xE0 && i + 16 < bytesRead) {
            const unit = buf[i + 11];
            const xDen = buf.readUInt16BE(i + 12);
            const yDen = buf.readUInt16BE(i + 14);
            if (unit === 1) {
                result.dpiX = xDen;
                result.dpiY = yDen;
            } else if (unit === 2) {
                result.dpiX = Math.round(xDen * 2.54);
                result.dpiY = Math.round(yDen * 2.54);
            }
        }

        if ((marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC)
            && i + 9 < bytesRead) {
            const precision = buf[i + 4];
            const numComponents = buf[i + 9];
            result.bitDepth = precision * numComponents;
            break;
        }

        if (marker === 0xD9 || marker === 0xDA) break;
        if (i + 3 < bytesRead) {
            const segLen = buf.readUInt16BE(i + 2);
            if (segLen < 2 || i + 2 + segLen > bytesRead) break;
            i += 2 + segLen;
        } else {
            break;
        }
    }

    if (!result.bitDepth) result.bitDepth = 24;
}

async function readBmpMetadata(fd: fs.FileHandle, result: ImageMetadata): Promise<void> {
    const bmpHeader = Buffer.alloc(54);
    const { bytesRead: bmpRead } = await fd.read(bmpHeader, 0, 54, 0);
    const dibSize = bmpRead >= 18 ? bmpHeader.readUInt32LE(14) : 0;
    if (dibSize >= 40 && bmpRead >= 30) {
        result.bitDepth = bmpHeader.readUInt16LE(28);
    }
    if (dibSize >= 40 && bmpRead >= 46) {
        const bmpPpmX = bmpHeader.readInt32LE(38);
        const bmpPpmY = bmpHeader.readInt32LE(42);
        if (bmpPpmX > 0) result.dpiX = Math.round(bmpPpmX / 39.3701);
        if (bmpPpmY > 0) result.dpiY = Math.round(bmpPpmY / 39.3701);
    }
}
