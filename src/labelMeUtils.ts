import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
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
    // Display dimensions: for JPEG / PNG images whose EXIF orientation rotates by 90°
    // (5–8) these are the stored dimensions swapped, matching what the
    // browser, OpenCV and YOLO/LabelMe tooling use for coordinates.
    width?: number;
    height?: number;
    orientation?: number; // EXIF orientation tag (1–8), JPEG APP1 or PNG eXIf
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'out']);

/**
 * Classify a directory entry as 'dir' | 'file' | 'other', FOLLOWING symbolic
 * links. `Dirent.isDirectory()/isFile()` describe the link itself, not its
 * target, so a symlinked directory/file would otherwise be missed during a
 * scan. Hard links need no special handling — they are indistinguishable from
 * regular files at the filesystem level. A broken/unreadable symlink → 'other'.
 */
export async function classifyEntry(fullPath: string, entry: Dirent): Promise<'dir' | 'file' | 'other'> {
    if (entry.isDirectory()) return 'dir';
    if (entry.isFile()) return 'file';
    if (entry.isSymbolicLink()) {
        try {
            const st = await fs.stat(fullPath); // stat() follows the link to its target
            if (st.isDirectory()) return 'dir';
            if (st.isFile()) return 'file';
        } catch {
            return 'other'; // dangling or unreadable link target
        }
    }
    return 'other';
}

export async function scanWorkspaceImages(rootPath: string): Promise<string[]> {
    const images: string[] = [];
    // Resolved real paths already visited — guards against symlink cycles
    // (a symlinked dir pointing back up the tree would otherwise loop forever).
    const visited = new Set<string>();

    const scanDirectory = async (dirPath: string): Promise<void> => {
        let real: string;
        try { real = await fs.realpath(dirPath); } catch { return; }
        if (visited.has(real)) return;
        visited.add(real);
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const kind = await classifyEntry(fullPath, entry);
                if (kind === 'dir') {
                    if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
                        await scanDirectory(fullPath);
                    }
                } else if (kind === 'file') {
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

        if (shapeType === 'circle' && points.length >= 2) {
            const cx = points[0][0];
            const cy = points[0][1];
            const r = Math.hypot(points[1][0] - cx, points[1][1] - cy);
            pathElements.push(`  <circle id="circle${idx}"
        cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}"
        fill="none" stroke="black" stroke-width="1" />`);
            continue;
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
                await readJpegMetadata(fd, stat.size, result);
            } else if (isBmp) {
                await readBmpMetadata(fd, result);
            }

            // Orientations 5–8 transpose the image: the displayed width is the stored height.
            if (result.orientation !== undefined && result.orientation >= 5
                && result.width !== undefined && result.height !== undefined) {
                [result.width, result.height] = [result.height, result.width];
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

export function comparePathsNaturally(a: string, b: string): number {
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
        result.width = header.readUInt32BE(16);
        result.height = header.readUInt32BE(20);
        result.bitDepth = header[24];
        const colorType = header[25];
        if (colorType === 2) result.bitDepth = header[24] * 3;
        else if (colorType === 4) result.bitDepth = header[24] * 2;
        else if (colorType === 6) result.bitDepth = header[24] * 4;
    }

    // Ancillary chunks before the image data: pHYs (DPI) and eXIf (orientation,
    // which Chromium and OpenCV both apply to PNGs as they do to JPEGs).
    let offset = 33;
    const chunkHeader = Buffer.alloc(8);
    for (let chunks = 0; chunks < 4096 && offset + 12 <= fileSize; chunks++) {
        const { bytesRead: chRead } = await fd.read(chunkHeader, 0, 8, offset);
        if (chRead < 8) break;
        const chunkLen = chunkHeader.readUInt32BE(0);
        if (chunkLen > 0x7FFFFFFF || offset + 12 + chunkLen > fileSize) break;
        const chunkType = chunkHeader.toString('ascii', 4, 8);
        if (chunkType === 'IDAT' || chunkType === 'IEND') break;
        if (chunkType === 'eXIf' && result.orientation === undefined && chunkLen <= 1 << 20) {
            const exif = Buffer.alloc(chunkLen);
            const { bytesRead: n } = await fd.read(exif, 0, chunkLen, offset + 8);
            // Raw TIFF per the PNG spec; some writers keep the JPEG "Exif\0\0" prefix.
            result.orientation = exif.toString('ascii', 0, 6) === 'Exif\0\0'
                ? parseExifOrientation(exif.subarray(0, n))
                : parseTiffOrientation(exif.subarray(0, n));
        }
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
        }
        offset += 12 + chunkLen;
    }
}

/**
 * Extract the EXIF orientation (tag 0x0112) from the payload of a JPEG APP1
 * segment (the bytes after the length field). Returns undefined when the
 * segment isn't EXIF, the tag is absent, or the value is out of range.
 */
export function parseExifOrientation(app1: Buffer): number | undefined {
    if (app1.length < 14 || app1.toString('ascii', 0, 6) !== 'Exif\0\0') return undefined;
    return parseTiffOrientation(app1.subarray(6));
}

/**
 * Orientation tag from raw TIFF-structured EXIF data (byte-order mark first),
 * as stored in a PNG eXIf chunk or after the "Exif\0\0" header of a JPEG APP1.
 */
export function parseTiffOrientation(tiffData: Buffer): number | undefined {
    const buf = tiffData;
    if (buf.length < 8) return undefined;
    const order = buf.toString('ascii', 0, 2);
    if (order !== 'II' && order !== 'MM') return undefined;
    const le = order === 'II';
    const u16 = (o: number) => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
    const u32 = (o: number) => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
    if (u16(2) !== 42) return undefined;
    const ifd0 = u32(4);
    if (ifd0 + 2 > buf.length) return undefined;
    const count = u16(ifd0);
    for (let e = 0; e < count; e++) {
        const entry = ifd0 + 2 + e * 12;
        if (entry + 12 > buf.length) return undefined;
        if (u16(entry) !== 0x0112) continue;
        // SHORT (type 3), count 1: the value sits in the first 2 bytes of the value field.
        if (u16(entry + 2) !== 3) return undefined;
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : undefined;
    }
    return undefined;
}

async function readJpegMetadata(fd: fs.FileHandle, fileSize: number, result: ImageMetadata): Promise<void> {
    // Walk the marker segments with positioned reads instead of scanning a fixed
    // prefix: EXIF thumbnails, XMP and ICC profiles routinely push the SOF
    // marker well past 64 KB, and missing dimensions make YOLO labels unloadable.
    const head = Buffer.alloc(4);
    const body = Buffer.alloc(14);
    let offset = 2; // skip SOI
    for (let segments = 0; segments < 4096 && offset + 4 <= fileSize; segments++) {
        const { bytesRead } = await fd.read(head, 0, 4, offset);
        if (bytesRead < 2 || head[0] !== 0xFF) break;
        const marker = head[1];
        // Fill bytes: a marker may be preceded by any number of 0xFF.
        if (marker === 0xFF) { offset += 1; continue; }
        // Standalone markers carry no length field.
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { offset += 2; continue; }
        if (marker === 0xD9 || marker === 0xDA || bytesRead < 4) break; // EOI / start of scan
        const segLen = head.readUInt16BE(2);
        if (segLen < 2 || offset + 2 + segLen > fileSize) break;

        if (marker === 0xE0 && segLen >= 14) {
            const { bytesRead: n } = await fd.read(body, 0, 14, offset + 4);
            // JFIF: "JFIF\0" (5) + version (2) + unit (1) + xDensity (2) + yDensity (2)
            if (n >= 12 && body.toString('ascii', 0, 4) === 'JFIF') {
                const unit = body[7];
                const xDen = body.readUInt16BE(8);
                const yDen = body.readUInt16BE(10);
                if (unit === 1) {
                    result.dpiX = xDen;
                    result.dpiY = yDen;
                } else if (unit === 2) {
                    result.dpiX = Math.round(xDen * 2.54);
                    result.dpiY = Math.round(yDen * 2.54);
                }
            }
        }

        // EXIF lives in APP1 ahead of SOF; XMP also uses APP1, hence the
        // header check inside parseExifOrientation.
        if (marker === 0xE1 && result.orientation === undefined) {
            const app1 = Buffer.alloc(segLen - 2);
            const { bytesRead: n } = await fd.read(app1, 0, app1.length, offset + 4);
            result.orientation = parseExifOrientation(app1.subarray(0, n));
        }

        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
            // SOF segment: precision (1) + height (2) + width (2) + components (1)
            const { bytesRead: n } = await fd.read(body, 0, 6, offset + 4);
            if (n >= 6) {
                result.height = body.readUInt16BE(1);
                result.width = body.readUInt16BE(3);
                result.bitDepth = body[0] * body[5];
            }
            break;
        }

        offset += 2 + segLen;
    }

    if (!result.bitDepth) result.bitDepth = 24;
}

async function readBmpMetadata(fd: fs.FileHandle, result: ImageMetadata): Promise<void> {
    const bmpHeader = Buffer.alloc(54);
    const { bytesRead: bmpRead } = await fd.read(bmpHeader, 0, 54, 0);
    const dibSize = bmpRead >= 18 ? bmpHeader.readUInt32LE(14) : 0;
    if (dibSize >= 40 && bmpRead >= 26) {
        result.width = bmpHeader.readInt32LE(18);
        // Height in BMP can be negative (top-down rows); we want the visual
        // dimension, so take the absolute value.
        result.height = Math.abs(bmpHeader.readInt32LE(22));
    }
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
