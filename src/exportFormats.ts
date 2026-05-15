// Pure conversion helpers for dataset export. No filesystem or VS Code
// dependency — callers (LabelMePanel) handle IO, and unit tests can exercise
// every branch without temp dirs.

export interface ExportShape {
    label?: string;
    shape_type?: string;
    points: number[][];
}

export interface ExportImage {
    fileName: string;       // relative path used as COCO file_name and YOLO basename source
    width: number;
    height: number;
    shapes: ExportShape[];
}

export interface ExportWarning {
    image: string;
    label?: string;
    shape_type?: string;
    reason: string;
}

const CIRCLE_SEGMENTS = 32;
// Below this, COCO segmentation rings and YOLO bboxes collapse to invalid
// zero-area annotations. Reject + warn rather than emit unparseable output.
const DEGENERATE_EPS = 1e-6;

export function polygonArea(points: number[][]): number {
    if (!points || points.length < 3) return 0;
    let s = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        s += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
    }
    return Math.abs(s) / 2;
}

export function polygonAabb(points: number[][]): { x: number; y: number; w: number; h: number } {
    if (!points || points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function polygonizeCircle(center: number[], edge: number[], segments: number = CIRCLE_SEGMENTS): number[][] {
    const cx = center[0], cy = center[1];
    const r = Math.hypot(edge[0] - cx, edge[1] - cy);
    const ring: number[][] = [];
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        ring.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return ring;
}

function rectToPolygon(points: number[][]): number[][] {
    if (points.length !== 2) return points;
    const [p1, p2] = points;
    return [p1, [p2[0], p1[1]], p2, [p1[0], p2[1]]];
}

// Returns the polygon ring used to represent a shape for export. Returns null
// for shapes that cannot be represented as a polygon (point, linestrip without
// area). The caller decides whether to skip or use a derived AABB only.
export function shapeToPolygonRing(shape: ExportShape): number[][] | null {
    const t = shape.shape_type || 'polygon';
    if (t === 'polygon') return shape.points;
    if (t === 'rectangle') return rectToPolygon(shape.points);
    if (t === 'circle' && shape.points.length >= 2) {
        return polygonizeCircle(shape.points[0], shape.points[1]);
    }
    return null;
}

// AABB usable for every shape including point/linestrip (caller decides when
// a bbox-only representation is acceptable).
export function shapeAabb(shape: ExportShape): { x: number; y: number; w: number; h: number } | null {
    const t = shape.shape_type || 'polygon';
    if (t === 'point') {
        if (shape.points.length < 1) return null;
        return { x: shape.points[0][0], y: shape.points[0][1], w: 1, h: 1 };
    }
    if (t === 'circle' && shape.points.length >= 2) {
        const cx = shape.points[0][0], cy = shape.points[0][1];
        const r = Math.hypot(shape.points[1][0] - cx, shape.points[1][1] - cy);
        return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
    }
    if (t === 'rectangle' && shape.points.length === 2) {
        const [p1, p2] = shape.points;
        const minX = Math.min(p1[0], p2[0]);
        const minY = Math.min(p1[1], p2[1]);
        const maxX = Math.max(p1[0], p2[0]);
        const maxY = Math.max(p1[1], p2[1]);
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (shape.points.length === 0) return null;
    return polygonAabb(shape.points);
}

function ringToFlat(points: number[][]): number[] {
    const flat: number[] = [];
    for (const p of points) { flat.push(p[0], p[1]); }
    return flat;
}

export function buildCocoDocument(images: ExportImage[], classes: string[]): {
    document: object;
    warnings: ExportWarning[];
} {
    const warnings: ExportWarning[] = [];
    const cocoImages: object[] = [];
    const annotations: object[] = [];
    const categoryIndex = new Map<string, number>();
    classes.forEach((name, i) => categoryIndex.set(name, i + 1));

    let nextAnnId = 1;

    images.forEach((image, idx) => {
        const imageId = idx + 1;
        cocoImages.push({
            id: imageId,
            file_name: image.fileName,
            width: image.width,
            height: image.height
        });

        for (const shape of image.shapes) {
            const label = shape.label || '';
            const catId = categoryIndex.get(label);
            if (catId === undefined) {
                warnings.push({ image: image.fileName, label, shape_type: shape.shape_type, reason: 'label not in class list' });
                continue;
            }
            const t = shape.shape_type || 'polygon';
            if (t === 'point' || t === 'linestrip') {
                warnings.push({ image: image.fileName, label, shape_type: t, reason: 'shape type not supported by COCO Instances' });
                continue;
            }
            const ring = shapeToPolygonRing(shape);
            if (!ring || ring.length < 3) {
                warnings.push({ image: image.fileName, label, shape_type: t, reason: 'degenerate geometry' });
                continue;
            }
            const bbox = polygonAabb(ring);
            const area = polygonArea(ring);
            if (area <= DEGENERATE_EPS || bbox.w <= DEGENERATE_EPS || bbox.h <= DEGENERATE_EPS) {
                warnings.push({ image: image.fileName, label, shape_type: t, reason: 'zero-area geometry' });
                continue;
            }
            annotations.push({
                id: nextAnnId++,
                image_id: imageId,
                category_id: catId,
                segmentation: [ringToFlat(ring)],
                bbox: [bbox.x, bbox.y, bbox.w, bbox.h],
                area,
                iscrowd: 0
            });
        }
    });

    const document = {
        info: {
            description: 'Exported by LabelEditor for VSCode',
            version: '1.0',
            date_created: new Date().toISOString()
        },
        licenses: [] as object[],
        images: cocoImages,
        categories: classes.map((name, i) => ({ id: i + 1, name, supercategory: 'none' })),
        annotations
    };

    return { document, warnings };
}

function clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

export function buildYoloBboxLines(image: ExportImage, classes: string[]): { text: string; warnings: ExportWarning[] } {
    const warnings: ExportWarning[] = [];
    const classIndex = new Map<string, number>();
    classes.forEach((name, i) => classIndex.set(name, i));

    const lines: string[] = [];
    for (const shape of image.shapes) {
        const label = shape.label || '';
        const idx = classIndex.get(label);
        if (idx === undefined) {
            warnings.push({ image: image.fileName, label, shape_type: shape.shape_type, reason: 'label not in class list' });
            continue;
        }
        const box = shapeAabb(shape);
        if (!box || image.width <= 0 || image.height <= 0) {
            warnings.push({ image: image.fileName, label, shape_type: shape.shape_type, reason: 'no bbox' });
            continue;
        }
        // Point shapes intentionally produce a 1x1 px bbox (handled in
        // shapeAabb); for every other shape, a zero-extent box would emit a
        // YOLO line with w=0/h=0 which most trainers reject. Skip + warn.
        if (shape.shape_type !== 'point'
            && (box.w <= DEGENERATE_EPS || box.h <= DEGENERATE_EPS)) {
            warnings.push({ image: image.fileName, label, shape_type: shape.shape_type, reason: 'zero-area bbox' });
            continue;
        }
        const cx = clamp01((box.x + box.w / 2) / image.width);
        const cy = clamp01((box.y + box.h / 2) / image.height);
        const w = clamp01(box.w / image.width);
        const h = clamp01(box.h / image.height);
        lines.push(`${idx} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`);
    }
    return { text: lines.join('\n') + (lines.length > 0 ? '\n' : ''), warnings };
}

export function buildYoloSegLines(image: ExportImage, classes: string[]): { text: string; warnings: ExportWarning[] } {
    const warnings: ExportWarning[] = [];
    const classIndex = new Map<string, number>();
    classes.forEach((name, i) => classIndex.set(name, i));

    const lines: string[] = [];
    for (const shape of image.shapes) {
        const label = shape.label || '';
        const idx = classIndex.get(label);
        if (idx === undefined) {
            warnings.push({ image: image.fileName, label, shape_type: shape.shape_type, reason: 'label not in class list' });
            continue;
        }
        const t = shape.shape_type || 'polygon';
        if (t === 'point' || t === 'linestrip') {
            warnings.push({ image: image.fileName, label, shape_type: t, reason: 'shape type not supported by YOLO seg' });
            continue;
        }
        const ring = shapeToPolygonRing(shape);
        if (!ring || ring.length < 3 || image.width <= 0 || image.height <= 0) {
            warnings.push({ image: image.fileName, label, shape_type: t, reason: 'degenerate geometry' });
            continue;
        }
        if (polygonArea(ring) <= DEGENERATE_EPS) {
            warnings.push({ image: image.fileName, label, shape_type: t, reason: 'zero-area geometry' });
            continue;
        }
        const parts: string[] = [String(idx)];
        for (const p of ring) {
            parts.push(clamp01(p[0] / image.width).toFixed(6));
            parts.push(clamp01(p[1] / image.height).toFixed(6));
        }
        lines.push(parts.join(' '));
    }
    return { text: lines.join('\n') + (lines.length > 0 ? '\n' : ''), warnings };
}

export function buildClassesTxt(classes: string[]): string {
    return classes.join('\n') + (classes.length > 0 ? '\n' : '');
}
