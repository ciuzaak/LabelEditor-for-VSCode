// Pure YOLO-dataset helpers. No filesystem or VS Code dependency (except the
// `path` module for pure path math) — LabelMePanel performs all IO, and unit
// tests exercise every branch without temp dirs. Mirrors exportFormats.ts.

import * as path from 'path';

export interface ParsedDataYaml {
    path: string | null;     // dataset root (may be relative to the yaml dir, or absolute)
    train: string[];
    val: string[];
    test: string[];
    names: string[];         // dict/list forms both normalized to an index-ordered array
}

function stripComment(s: string): string {
    let inS = false, inD = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "'" && !inD) inS = !inS;
        else if (c === '"' && !inS) inD = !inD;
        else if (c === '#' && !inS && !inD) return s.slice(0, i);
    }
    return s;
}

function unquote(s: string): string {
    const t = s.trim();
    if (t.length >= 2 &&
        ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
        return t.slice(1, -1);
    }
    return t;
}

function indentOf(line: string): number {
    let n = 0;
    while (n < line.length && line[n] === ' ') n++;
    return n;
}

function parseFlowList(s: string): string[] {
    const t = s.trim().replace(/^\[/, '').replace(/\]$/, '');
    if (!t.trim()) return [];
    return t.split(',').map(unquote).filter(x => x.length > 0);
}

function mapToArray(map: Map<number, string>): string[] {
    if (map.size === 0) return [];
    const max = Math.max(...map.keys());
    const out: string[] = [];
    for (let i = 0; i <= max; i++) out.push(map.get(i) ?? `class_${i}`);
    return out;
}

function readBlockOrInlineList(lines: string[], idx: number, inline: string): string[] {
    if (inline.startsWith('[')) return parseFlowList(inline);
    if (inline) return [unquote(inline)];
    const out: string[] = [];
    for (let j = idx + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim()) continue;
        if (indentOf(l) === 0) break;
        const m = l.match(/^\s*-\s*(.+)$/);
        if (!m) break;
        out.push(unquote(m[1]));
    }
    return out;
}

function readNames(lines: string[], idx: number, inline: string): string[] {
    if (inline.startsWith('[')) return parseFlowList(inline);
    if (inline.startsWith('{')) {
        const inner = inline.replace(/^\{/, '').replace(/\}$/, '');
        const map = new Map<number, string>();
        for (const p of inner.split(',').map(s => s.trim()).filter(Boolean)) {
            const m = p.match(/^(\d+)\s*:\s*(.+)$/);
            if (m) map.set(Number(m[1]), unquote(m[2]));
        }
        return mapToArray(map);
    }
    const dict = new Map<number, string>();
    const seq: string[] = [];
    let isDict = false, isSeq = false;
    for (let j = idx + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim()) continue;
        const dm = l.match(/^\s*(\d+)\s*:\s*(.+)$/);
        const sm = l.match(/^\s*-\s*(.+)$/);
        if (dm) { isDict = true; dict.set(Number(dm[1]), unquote(dm[2])); }
        else if (sm) { isSeq = true; seq.push(unquote(sm[1])); }
        else if (indentOf(l) === 0) break;
        else break;
    }
    if (isDict) return mapToArray(dict);
    if (isSeq) return seq;
    return [];
}

export function parseDataYaml(text: string): ParsedDataYaml {
    const result: ParsedDataYaml = { path: null, train: [], val: [], test: [], names: [] };
    const lines = text.split(/\r?\n/).map(stripComment);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (indentOf(line) !== 0) continue;
        const m = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        const inline = m[2].trim();
        if (key === 'path') {
            result.path = inline ? unquote(inline) : null;
        } else if (key === 'train' || key === 'val' || key === 'test') {
            (result as unknown as Record<string, unknown>)[key] = readBlockOrInlineList(lines, i, inline);
        } else if (key === 'names') {
            result.names = readNames(lines, i, inline);
        }
    }
    return result;
}

// Compute the absolute image directories referenced by train/val/test. Pure
// (no existence check — the panel filters to existing dirs). Each entry is
// resolved relative to `path` (itself relative to the yaml dir), unless absolute.
// A `.txt` entry is a YOLO image-list file (v1 limitation) — skipped with a warning.
export function resolveImageDirs(
    yamlPath: string,
    parsed: ParsedDataYaml
): { dirs: string[]; warnings: string[] } {
    const warnings: string[] = [];
    const yamlDir = path.dirname(yamlPath);
    const base = parsed.path
        ? (path.isAbsolute(parsed.path) ? parsed.path : path.resolve(yamlDir, parsed.path))
        : yamlDir;
    const dirs: string[] = [];
    const seen = new Set<string>();
    const add = (entry: string) => {
        if (/\.txt$/i.test(entry)) {
            warnings.push(`Skipped image-list file (not supported in v1): ${entry}`);
            return;
        }
        const abs = path.isAbsolute(entry) ? entry : path.resolve(base, entry);
        const norm = path.normalize(abs);
        if (!seen.has(norm)) { seen.add(norm); dirs.push(norm); }
    };
    for (const e of [...parsed.train, ...parsed.val, ...parsed.test]) add(e);
    return { dirs, warnings };
}

// Map an absolute image path to its YOLO label .txt path (Ultralytics convention):
// replace the LAST `/images/` (or `\images\`) segment with `/labels/`, ext → .txt.
// If there is no images segment, fall back to a sidecar .txt next to the image.
export function imageToLabelPath(imageAbsPath: string): string {
    const ext = path.extname(imageAbsPath);
    const base = imageAbsPath.slice(0, imageAbsPath.length - ext.length);
    const re = /[\\/]images[\\/]/g;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(base)) !== null) last = m;
    if (last) {
        const matched = last[0]; // "/images/" or "\images\"
        const replacement = matched[0] + 'labels' + matched[matched.length - 1];
        const newBase = base.slice(0, last.index) + replacement + base.slice(last.index + matched.length);
        return newBase + '.txt';
    }
    return base + '.txt';
}

// Shape object ready to hand to the webview (matches editor-created shapes).
export interface YoloLoadedShape {
    label: string;
    shape_type: string;
    points: number[][];
    group_id: null;
    flags: Record<string, unknown>;
}

function makeShape(label: string, shapeType: string, points: number[][]): YoloLoadedShape {
    return { label, shape_type: shapeType, points, group_id: null, flags: {} };
}

// Parse a YOLO .txt into shapes with ABSOLUTE pixel coordinates.
//   5 tokens (cls + 4)         -> rectangle (2 corner points)
//   >=7 tokens, cls + even N   -> polygon
// label = names[idx]; out-of-range idx -> "class_<idx>" + warning.
export function parseYoloTxt(
    text: string, imgW: number, imgH: number, names: string[]
): { shapes: YoloLoadedShape[]; warnings: string[] } {
    const warnings: string[] = [];
    const shapes: YoloLoadedShape[] = [];
    const lines = text.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li].trim();
        if (!line) continue;
        const tokens = line.split(/\s+/);
        const cls = Number(tokens[0]);
        if (!Number.isInteger(cls) || cls < 0) {
            warnings.push(`Line ${li + 1}: invalid class index "${tokens[0]}"`);
            continue;
        }
        const coords = tokens.slice(1).map(Number);
        if (coords.length === 0 || coords.some(n => !Number.isFinite(n))) {
            warnings.push(`Line ${li + 1}: non-numeric coordinates`);
            continue;
        }
        const label = cls < names.length ? names[cls] : `class_${cls}`;
        if (cls >= names.length) {
            warnings.push(`Line ${li + 1}: class index ${cls} has no name in data.yaml`);
        }
        if (coords.length === 4) {
            const [cx, cy, w, h] = coords;
            const x1 = (cx - w / 2) * imgW, y1 = (cy - h / 2) * imgH;
            const x2 = (cx + w / 2) * imgW, y2 = (cy + h / 2) * imgH;
            shapes.push(makeShape(label, 'rectangle', [[x1, y1], [x2, y2]]));
        } else if (coords.length >= 6 && coords.length % 2 === 0) {
            const pts: number[][] = [];
            for (let k = 0; k < coords.length; k += 2) {
                pts.push([coords[k] * imgW, coords[k + 1] * imgH]);
            }
            shapes.push(makeShape(label, 'polygon', pts));
        } else {
            warnings.push(`Line ${li + 1}: unexpected token count ${tokens.length}`);
        }
    }
    return { shapes, warnings };
}
