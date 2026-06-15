# YOLO Format Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete YOLO annotation workflow — open a YOLO `data.yaml` from the explorer context menu, import existing `.txt` labels, annotate with polygon/bbox/sam, and save back as YOLO `.txt` + update `data.yaml` class list.

**Architecture:** Reuse the existing `LabelMePanel` for both formats with a per-panel `_format` flag; branch only at three seams — read annotation, save annotation, add class. All YOLO logic lives in a new pure, unit-tested module `src/yoloDataset.ts` (mirrors `exportFormats.ts`). Class membership is enforced in the webview against the yaml class list injected at boot; adding a missing class round-trips to the extension, which writes the yaml.

**Tech Stack:** TypeScript (extension host), vanilla JS webview, `node:test` for unit tests, VS Code extension API.

---

## Reference facts (read before starting)

- Tests run via `npm test` → compiles with `tsconfig.test.json` to `out-test/`, then `node --test "out-test/test/**/*.test.js"`. Pure modules only (no VS Code / DOM).
- `src/exportFormats.ts` exports `ExportShape`, `shapeAabb`, `shapeToPolygonRing`, `polygonArea`. `clamp01` is currently **module-private** — Task 5 exports it.
- YOLO `.txt` line forms: detection `cls cx cy w h` (5 tokens, normalized); segmentation `cls x1 y1 x2 y2 …` (≥7 tokens, normalized polygon).
- Rectangle shapes store **2 diagonal corner points** (`points[0]`, `points[1]`); `shapeAabb` already handles this.
- The webview maps incoming shapes with `{...shape, visible}` ([main.js:1346](media/main.js#L1346)); shapes only need `label`, `points`, `shape_type`.
- The save message carries `{ shapes, imageWidth, imageHeight }` (see `saveAnnotation` → `buildLabelMeAnnotation`).
- Webview message dispatch is a `switch (message.command)` at [main.js:1115](media/main.js#L1115). Extension message dispatch is a `switch (message.command)` at [LabelMePanel.ts:291](src/LabelMePanel.ts#L291).
- Mode buttons wired at [main.js:6907-6935](media/main.js#L6907); `setMode` at [main.js:4918](media/main.js#L4918); `confirmLabel` at [main.js:4054](media/main.js#L4054); `renderRecentLabels` at [main.js:3963](media/main.js#L3963).
- Config injected into webview in the inline `<script>` near [LabelMePanel.ts:1366](src/LabelMePanel.ts#L1366).

---

## File Structure

- **Create** `src/yoloDataset.ts` — pure YOLO helpers (yaml parse, dir resolve, path map, txt↔shapes, class append).
- **Create** `test/yoloDataset.test.ts` — unit tests for every function above.
- **Modify** `src/exportFormats.ts` — `export` the existing `clamp01`.
- **Modify** `package.json` — new command + explorer context menu entry.
- **Modify** `src/extension.ts` — register the command.
- **Modify** `src/LabelMePanel.ts` — format flag, `createOrShowFromYaml`, read/save/add-class branches, config injection.
- **Modify** `media/main.js` — mode restriction, class chips, class-add flow, new message cases.

---

## Task 1: `parseDataYaml` + module scaffold

**Files:**
- Create: `src/yoloDataset.ts`
- Test: `test/yoloDataset.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/yoloDataset.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/yoloDataset` / `parseDataYaml is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/yoloDataset.ts`:

```ts
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
        if (indentOf(l) === 0) break;
        const dm = l.match(/^\s*(\d+)\s*:\s*(.+)$/);
        const sm = l.match(/^\s*-\s*(.+)$/);
        if (dm) { isDict = true; dict.set(Number(dm[1]), unquote(dm[2])); }
        else if (sm) { isSeq = true; seq.push(unquote(sm[1])); }
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
            (result as Record<string, unknown>)[key] = readBlockOrInlineList(lines, i, inline);
        } else if (key === 'names') {
            result.names = readNames(lines, i, inline);
        }
    }
    return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for all `parseDataYaml` cases.

- [ ] **Step 5: Commit**

```bash
git add src/yoloDataset.ts test/yoloDataset.test.ts
git commit -m "feat(yolo): parse data.yaml (path/train/val/test/names)"
```

---

## Task 2: `resolveImageDirs`

**Files:**
- Modify: `src/yoloDataset.ts`
- Test: `test/yoloDataset.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/yoloDataset.test.ts` (and add `resolveImageDirs` to the import from `../src/yoloDataset`, plus `import * as path from 'path'` at the top):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `resolveImageDirs is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/yoloDataset.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/yoloDataset.ts test/yoloDataset.test.ts
git commit -m "feat(yolo): resolve train/val/test image dirs from data.yaml"
```

---

## Task 3: `imageToLabelPath`

**Files:**
- Modify: `src/yoloDataset.ts`
- Test: `test/yoloDataset.test.ts`

- [ ] **Step 1: Write the failing test**

Append (add `imageToLabelPath` to the import):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `imageToLabelPath is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/yoloDataset.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/yoloDataset.ts test/yoloDataset.test.ts
git commit -m "feat(yolo): map image path to label .txt path"
```

---

## Task 4: `parseYoloTxt`

**Files:**
- Modify: `src/yoloDataset.ts`
- Test: `test/yoloDataset.test.ts`

- [ ] **Step 1: Write the failing test**

Append (add `parseYoloTxt` to the import):

```ts
describe('parseYoloTxt', () => {
    const names = ['person', 'car'];

    it('parses a bbox line into a rectangle with pixel corner points', () => {
        const { shapes } = parseYoloTxt('0 0.5 0.5 0.2 0.4\n', 100, 200, names);
        assert.equal(shapes.length, 1);
        assert.equal(shapes[0].label, 'person');
        assert.equal(shapes[0].shape_type, 'rectangle');
        // cx=0.5*100=50, w=0.2*100=20 -> x1=40,x2=60 ; cy=0.5*200=100,h=0.4*200=80 -> y1=60,y2=140
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseYoloTxt is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/yoloDataset.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/yoloDataset.ts test/yoloDataset.test.ts
git commit -m "feat(yolo): parse .txt labels into shapes (bbox + segmentation)"
```

---

## Task 5: export `clamp01` + `buildYoloTxt`

**Files:**
- Modify: `src/exportFormats.ts:221` (export `clamp01`)
- Modify: `src/yoloDataset.ts`
- Test: `test/yoloDataset.test.ts`

- [ ] **Step 1: Write the failing test**

Append (add `buildYoloTxt` to the import):

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildYoloTxt is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/exportFormats.ts`, change the `clamp01` declaration (currently `function clamp01(v: number): number {` at line ~221) to:

```ts
export function clamp01(v: number): number {
```

Append to `src/yoloDataset.ts` (add this import near the top, after the existing `import * as path`):

```ts
import {
    ExportShape,
    shapeAabb,
    shapeToPolygonRing,
    polygonArea,
    clamp01
} from './exportFormats';
```

Then append the function:

```ts
// Serialize shapes to a YOLO .txt, choosing the line form per shape:
//   rectangle -> bbox line (cls cx cy w h)
//   polygon (and any non-rectangle ring) -> segmentation line
// Labels not in `classes` are skipped with a warning. Degenerate geometry skipped.
export function buildYoloTxt(
    shapes: ExportShape[], imgW: number, imgH: number, classes: string[]
): { text: string; warnings: string[] } {
    const warnings: string[] = [];
    if (imgW <= 0 || imgH <= 0) {
        return { text: '', warnings: ['image has no dimensions'] };
    }
    const classIndex = new Map<string, number>();
    classes.forEach((n, i) => classIndex.set(n, i));
    const lines: string[] = [];
    for (const shape of shapes) {
        const label = shape.label || '';
        const idx = classIndex.get(label);
        if (idx === undefined) {
            warnings.push(`label not in classes: ${label}`);
            continue;
        }
        const t = shape.shape_type || 'polygon';
        if (t === 'rectangle') {
            const box = shapeAabb(shape);
            if (!box || box.w <= 0 || box.h <= 0) {
                warnings.push(`degenerate rectangle: ${label}`);
                continue;
            }
            const cx = clamp01((box.x + box.w / 2) / imgW);
            const cy = clamp01((box.y + box.h / 2) / imgH);
            const w = clamp01(box.w / imgW);
            const h = clamp01(box.h / imgH);
            lines.push(`${idx} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`);
        } else {
            const ring = shapeToPolygonRing(shape);
            if (!ring || ring.length < 3 || polygonArea(ring) <= 0) {
                warnings.push(`degenerate polygon: ${label}`);
                continue;
            }
            const parts = [String(idx)];
            for (const p of ring) {
                parts.push(clamp01(p[0] / imgW).toFixed(6));
                parts.push(clamp01(p[1] / imgH).toFixed(6));
            }
            lines.push(parts.join(' '));
        }
    }
    return { text: lines.join('\n') + (lines.length > 0 ? '\n' : ''), warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (including the round-trip test).

- [ ] **Step 5: Commit**

```bash
git add src/exportFormats.ts src/yoloDataset.ts test/yoloDataset.test.ts
git commit -m "feat(yolo): build .txt from shapes (auto bbox/seg per shape)"
```

---

## Task 6: `appendClassToYaml`

**Files:**
- Modify: `src/yoloDataset.ts`
- Test: `test/yoloDataset.test.ts`

- [ ] **Step 1: Write the failing test**

Append (add `appendClassToYaml` to the import):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `appendClassToYaml is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/yoloDataset.ts`:

```ts
// Append a new class to the yaml's `names` (preserving list/dict/sequence style)
// and bump `nc` if present. Returns the new yaml text and the new class index
// (= the number of classes before the append — "the last index").
export function appendClassToYaml(text: string, newName: string): { text: string; index: number } {
    const index = parseDataYaml(text).names.length;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);

    let namesLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (indentOf(lines[i]) === 0 && /^names\s*:/.test(stripComment(lines[i]))) { namesLine = i; break; }
    }

    const out = lines.slice();
    if (namesLine === -1) {
        out.push('names:', `  ${index}: ${newName}`);
    } else {
        const inline = stripComment(lines[namesLine]).replace(/^names\s*:\s*/, '').trim();
        if (inline.startsWith('[')) {
            const close = lines[namesLine].lastIndexOf(']');
            const before = lines[namesLine].slice(0, close);
            const after = lines[namesLine].slice(close);
            const sep = /\[\s*$/.test(before) ? '' : ', ';
            out[namesLine] = `${before}${sep}'${newName}'${after}`;
        } else if (inline.startsWith('{')) {
            const close = lines[namesLine].lastIndexOf('}');
            const before = lines[namesLine].slice(0, close);
            const after = lines[namesLine].slice(close);
            const sep = /\{\s*$/.test(before) ? '' : ', ';
            out[namesLine] = `${before}${sep}${index}: ${newName}${after}`;
        } else {
            // Block form: append after the last indented child line.
            let lastChild = namesLine;
            let childIndent = '  ';
            let isSeq = false;
            for (let j = namesLine + 1; j < lines.length; j++) {
                const l = lines[j];
                if (!l.trim()) continue;
                if (indentOf(l) === 0) break;
                lastChild = j;
                childIndent = (l.match(/^(\s*)/) as RegExpMatchArray)[1];
                if (/^\s*-\s*/.test(l)) isSeq = true;
            }
            const newLine = isSeq ? `${childIndent}- ${newName}` : `${childIndent}${index}: ${newName}`;
            out.splice(lastChild + 1, 0, newLine);
        }
    }

    for (let i = 0; i < out.length; i++) {
        if (/^nc\s*:\s*\d+\s*$/.test(stripComment(out[i]))) {
            out[i] = out[i].replace(/(\bnc\s*:\s*)\d+/, `$1${index + 1}`);
            break;
        }
    }
    return { text: out.join(eol), index };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/yoloDataset.ts test/yoloDataset.test.ts
git commit -m "feat(yolo): append a new class to data.yaml preserving style"
```

---

## Task 7: Command + explorer context menu

**Files:**
- Modify: `package.json:40-63`
- Modify: `src/extension.ts`

- [ ] **Step 1: Add the command + menu to `package.json`**

In `contributes.commands`, add a third entry (after `openFromFolder`):

```json
      {
        "command": "labeleditor-vscode.openYoloDataset",
        "title": "LabelEditor: Open as YOLO Dataset"
      }
```

In `contributes.menus.explorer/context`, add a third entry:

```json
        {
          "command": "labeleditor-vscode.openYoloDataset",
          "when": "resourceExtname =~ /\\.(ya?ml)$/i",
          "group": "navigation"
        }
```

- [ ] **Step 2: Register the command in `src/extension.ts`**

Replace the body of `activate` so it also registers the YOLO command:

```ts
export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('labeleditor-vscode.openEditor', (uri: vscode.Uri) => {
        LabelMePanel.createOrShow(context, uri);
    });

    let folderDisposable = vscode.commands.registerCommand('labeleditor-vscode.openFromFolder', (uri: vscode.Uri) => {
        LabelMePanel.createOrShowFromFolder(context, uri);
    });

    let yoloDisposable = vscode.commands.registerCommand('labeleditor-vscode.openYoloDataset', (uri: vscode.Uri) => {
        LabelMePanel.createOrShowFromYaml(context, uri);
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(folderDisposable);
    context.subscriptions.push(yoloDisposable);
}
```

- [ ] **Step 3: Compile to verify (will fail until Task 8 adds the method)**

Run: `npm run compile`
Expected: FAIL — `Property 'createOrShowFromYaml' does not exist`. This is expected; it is implemented in Task 8. Do **not** commit yet — proceed to Task 8 and commit them together.

---

## Task 8: Panel format flag + `createOrShowFromYaml` + image scan

**Files:**
- Modify: `src/LabelMePanel.ts` (imports, fields, constructor, new static methods)

- [ ] **Step 1: Add imports**

At the top of `src/LabelMePanel.ts`, extend the `labelMeUtils` import to include `comparePathsNaturally` and `ImageMetadata`, and add a `yoloDataset` import:

```ts
import {
    buildLabelMeAnnotation,
    buildSvg,
    getImageMetadata,
    scanWorkspaceImages,
    comparePathsNaturally,
    ImageMetadata
} from './labelMeUtils';
import {
    parseDataYaml,
    resolveImageDirs,
    imageToLabelPath,
    parseYoloTxt,
    buildYoloTxt,
    appendClassToYaml
} from './yoloDataset';
```

- [ ] **Step 2: Add fields**

After `private _imageUri: vscode.Uri;` (line ~29) add:

```ts
    private _format: 'labelme' | 'yolo' = 'labelme';
    private _yamlUri: vscode.Uri | undefined;
    private _yoloClasses: string[] = [];
```

- [ ] **Step 3: Extend the constructor signature + initialize fields**

Change the constructor signature to accept the format/yaml/classes (append three optional params):

```ts
    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, imageUri: vscode.Uri, globalState: vscode.Memento, rootPath: string, initialWorkspaceImages?: string[], panelTitle?: string, format: 'labelme' | 'yolo' = 'labelme', yamlUri?: vscode.Uri, yoloClasses: string[] = []) {
```

Immediately after `this._imageUri = imageUri;` inside the constructor add:

```ts
        this._format = format;
        this._yamlUri = yamlUri;
        this._yoloClasses = yoloClasses;
```

(These must be set before `this._update()` is called, which they are — `_update()` is near the end of the constructor.)

- [ ] **Step 4: Add the static factory + scan helper**

Add these methods to the class (e.g. right after `createOrShowFromFolder`):

```ts
    /**
     * Open the annotator in YOLO mode from a data.yaml. Resolves the dataset's
     * train/val/test image dirs, scans them, and loads/saves YOLO .txt labels.
     */
    public static async createOrShowFromYaml(context: vscode.ExtensionContext, yamlUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        let text: string;
        try {
            text = await fs.readFile(yamlUri.fsPath, 'utf8');
        } catch (e) {
            vscode.window.showErrorMessage('Cannot read data.yaml: ' + (e as Error).message);
            return;
        }

        const parsed = parseDataYaml(text);
        const { dirs } = resolveImageDirs(yamlUri.fsPath, parsed);
        const yamlDir = path.dirname(yamlUri.fsPath);
        const rootPath = parsed.path
            ? (path.isAbsolute(parsed.path) ? parsed.path : path.resolve(yamlDir, parsed.path))
            : yamlDir;

        const images = await LabelMePanel._scanYoloImages(dirs, rootPath);
        if (images.length === 0) {
            vscode.window.showErrorMessage('No images found for this YOLO dataset (check path/train/val in data.yaml).');
            return;
        }

        // Reveal an existing panel for this yaml instead of duplicating.
        for (const existing of LabelMePanel.panels) {
            if (existing._yamlUri && existing._yamlUri.fsPath === yamlUri.fsPath) {
                existing._panel.reveal(column);
                return;
            }
        }

        const firstImageUri = vscode.Uri.file(path.join(rootPath, images[0]));

        const localResourceRoots: vscode.Uri[] = [
            vscode.Uri.joinPath(context.extensionUri, 'media'),
            vscode.Uri.file(rootPath)
        ];
        dirs.forEach(d => localResourceRoots.push(vscode.Uri.file(d)));
        (vscode.workspace.workspaceFolders || []).forEach(folder => localResourceRoots.push(folder.uri));

        const panelTitle = path.basename(yamlDir) || 'YOLO Dataset';
        const panel = vscode.window.createWebviewPanel(
            LabelMePanel.viewType,
            panelTitle,
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots }
        );

        LabelMePanel.panels.add(new LabelMePanel(
            panel, context.extensionUri, firstImageUri, context.globalState,
            rootPath, images, panelTitle, 'yolo', yamlUri, parsed.names
        ));
    }

    /** Recursively scan the resolved YOLO image dirs; returns rootPath-relative, sorted, deduped. */
    private static async _scanYoloImages(dirs: string[], rootPath: string): Promise<string[]> {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp'];
        const out: string[] = [];
        const walk = async (d: string): Promise<void> => {
            let entries;
            try {
                entries = await fs.readdir(d, { withFileTypes: true });
            } catch {
                return;
            }
            for (const e of entries) {
                const full = path.join(d, e.name);
                if (e.isDirectory()) {
                    if (!e.name.startsWith('.')) await walk(full);
                } else if (imageExtensions.includes(path.extname(e.name).toLowerCase())) {
                    out.push(path.relative(rootPath, full));
                }
            }
        };
        for (const d of dirs) await walk(d);
        const deduped = Array.from(new Set(out));
        deduped.sort(comparePathsNaturally);
        return deduped;
    }
```

- [ ] **Step 5: Compile (still fails — read/save branches not added yet)**

Run: `npm run compile`
Expected: still FAILS later (config injection in Task 11 references nothing yet, but this task alone should compile). If `comparePathsNaturally`/`ImageMetadata` import errors appear, confirm they are exported by `labelMeUtils.ts` (they are). At this point the project should compile clean — verify:

Run: `npm run compile`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit (Tasks 7 + 8 together)**

```bash
git add package.json src/extension.ts src/LabelMePanel.ts
git commit -m "feat(yolo): add openYoloDataset command and YOLO panel entry"
```

---

## Task 9: Panel read branch — load .txt as shapes

**Files:**
- Modify: `src/LabelMePanel.ts` (`_sendImageUpdate` and the HTML-boot annotation load → unify into `_loadExistingAnnotation`)

- [ ] **Step 1: Add a shared loader method**

Add this method to the class (e.g. just above `_sendImageUpdate`):

```ts
    /**
     * Load the existing annotation for the current image as a webview-ready
     * `{ shapes, imageWidth, imageHeight }` object, or null if none. Branches by
     * format: LabelMe reads the .json sidecar; YOLO reads the .txt label file and
     * converts normalized coords to pixels using image dimensions.
     */
    private async _loadExistingAnnotation(meta?: ImageMetadata): Promise<any> {
        if (this._format === 'yolo') {
            let w = meta?.width || 0;
            let h = meta?.height || 0;
            if (!w || !h) {
                const m = await getImageMetadata(this._imageUri.fsPath);
                w = m.width || 0;
                h = m.height || 0;
            }
            if (!w || !h) {
                this._notify('warn', 'Cannot read image dimensions; YOLO labels not loaded', { key: 'yolo.noDims' });
                return null;
            }
            const labelPath = imageToLabelPath(this._imageUri.fsPath);
            if (!existsSync(labelPath)) {
                return { shapes: [], imageWidth: w, imageHeight: h };
            }
            try {
                const txt = await fs.readFile(labelPath, 'utf8');
                const { shapes, warnings } = parseYoloTxt(txt, w, h, this._yoloClasses);
                if (warnings.length) {
                    this._notify('warn', `YOLO import: ${warnings.length} issue(s) in ${path.basename(labelPath)}`, { key: 'yolo.importWarn' });
                }
                return { shapes, imageWidth: w, imageHeight: h };
            } catch (e) {
                this._notify('warn', `Failed to read ${path.basename(labelPath)}: ${(e as Error).message}`);
                return { shapes: [], imageWidth: w, imageHeight: h };
            }
        }

        // LabelMe
        const jsonPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, "") + ".json";
        if (existsSync(jsonPath)) {
            try {
                const jsonContent = await fs.readFile(jsonPath, 'utf8');
                return JSON.parse(jsonContent);
            } catch (e) {
                this._notify('warn', `Failed to load annotation file: ${(e as Error).message}`,
                    { i18nKey: 'status.loadJsonFailed', i18nParams: { err: (e as Error).message } });
            }
        }
        return null;
    }
```

- [ ] **Step 2: Use it in `_sendImageUpdate`**

In `_sendImageUpdate` ([LabelMePanel.ts:709](src/LabelMePanel.ts#L709)), replace the block that builds `existingData` from the json sidecar (the `let existingData = null; const jsonPath = …; if (existsSync(jsonPath)) { … }` section, lines ~735-749) with:

```ts
        // Load existing annotation (format-aware: .json for LabelMe, .txt for YOLO)
        const existingData = await this._loadExistingAnnotation(imageMetadata);
```

(`imageMetadata` is already computed just above in that method.)

- [ ] **Step 3: Use it in `_getHtmlForWebview`**

In `_getHtmlForWebview` ([LabelMePanel.ts:907](src/LabelMePanel.ts#L907)), replace the `let existingData = null; if (!isDummyImage) { const jsonPath = …; … }` block (lines ~907-923) with:

```ts
        let existingData = null;
        if (!isDummyImage) {
            existingData = await this._loadExistingAnnotation(imageMetadata || undefined);
        }
```

(`imageMetadata` is computed just above as `isDummyImage ? null : await this._getImageMetadata(...)`.)

- [ ] **Step 4: Compile**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/LabelMePanel.ts
git commit -m "feat(yolo): load .txt labels as shapes when opening images"
```

---

## Task 10: Panel save branch — shapes to .txt

**Files:**
- Modify: `src/LabelMePanel.ts` (`saveAnnotation`)

- [ ] **Step 1: Branch `saveAnnotation` by format**

At the very top of `saveAnnotation` ([LabelMePanel.ts:1613](src/LabelMePanel.ts#L1613)), before `const jsonPath = …`, add:

```ts
        if (this._format === 'yolo') {
            return this._saveYoloAnnotation(data);
        }
```

- [ ] **Step 2: Add the YOLO save method**

Add this method right after `saveAnnotation`:

```ts
    private async _saveYoloAnnotation(data: any) {
        const labelPath = imageToLabelPath(this._imageUri.fsPath);
        const { text, warnings } = buildYoloTxt(
            data.shapes || [], data.imageWidth, data.imageHeight, this._yoloClasses
        );
        this._isSaving = true;
        try {
            await fs.mkdir(path.dirname(labelPath), { recursive: true });
            await fs.writeFile(labelPath, text, 'utf8');
            // Keep the class search index fresh without a full rescan.
            this._updateIndexForCurrentImage(data.shapes || []);
            this._notify('success', 'Annotation saved to ' + path.basename(labelPath),
                { i18nKey: 'status.savedTo', i18nParams: { file: path.basename(labelPath) } });
            if (warnings.length) {
                this._notify('warn', `YOLO save: ${warnings.length} shape(s) skipped`, { key: 'yolo.saveWarn' });
            }
            this._safePost({ command: 'saveComplete' });
        } catch (err) {
            this._notify('error', 'Failed to save annotation: ' + (err as Error).message,
                { i18nKey: 'status.saveFailed', i18nParams: { err: (err as Error).message } });
            this._pendingNavigation = undefined;
            this._pendingNavigationPath = undefined;
            this._safePost({ command: 'saveFailed' });
        } finally {
            this._isSaving = false;
        }
    }
```

- [ ] **Step 3: Compile**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/LabelMePanel.ts
git commit -m "feat(yolo): save shapes back to YOLO .txt labels"
```

---

## Task 11: Add-class handler + webview config injection

**Files:**
- Modify: `src/LabelMePanel.ts` (message switch, new handler, HTML config)

- [ ] **Step 1: Add the message case**

In the `onDidReceiveMessage` switch ([LabelMePanel.ts:291](src/LabelMePanel.ts#L291)), add a case (e.g. after `'advancedSearchCancelIndex'`):

```ts
                    case 'yoloConfirmAddClass':
                        await this._handleYoloConfirmAddClass(message.label);
                        return;
```

- [ ] **Step 2: Add the handler method**

Add to the class:

```ts
    /**
     * The webview asked to add a class missing from data.yaml. Confirm with a
     * native modal, append it to the yaml on disk (taking the last index), and
     * reply with the updated class list so the webview can finish creating the shape.
     */
    private async _handleYoloConfirmAddClass(label: string) {
        if (!this._yamlUri || !label) {
            this._safePost({ command: 'yoloAddClassCancelled', label });
            return;
        }
        if (this._yoloClasses.includes(label)) {
            this._safePost({
                command: 'yoloClassAdded',
                classes: this._yoloClasses,
                index: this._yoloClasses.indexOf(label),
                label
            });
            return;
        }
        const choice = await vscode.window.showWarningMessage(
            `Class "${label}" is not in data.yaml. Add it?`,
            { modal: true },
            'Add'
        );
        if (choice !== 'Add') {
            this._safePost({ command: 'yoloAddClassCancelled', label });
            return;
        }
        try {
            const text = await fs.readFile(this._yamlUri.fsPath, 'utf8');
            const { text: newText, index } = appendClassToYaml(text, label);
            await fs.writeFile(this._yamlUri.fsPath, newText, 'utf8');
            this._yoloClasses = [...this._yoloClasses, label];
            this._safePost({ command: 'yoloClassAdded', classes: this._yoloClasses, index, label });
        } catch (err) {
            this._notify('error', 'Failed to update data.yaml: ' + (err as Error).message);
            this._safePost({ command: 'yoloAddClassCancelled', label });
        }
    }
```

- [ ] **Step 3: Inject format + classes into the webview**

In `_getHtmlForWebview`, inside the inline `<script>` that defines `initialGlobalSettings` ([LabelMePanel.ts:1366](src/LabelMePanel.ts#L1366)), add immediately after the closing `};` of `initialGlobalSettings` (before `</script>`):

```ts
                    window.annotationFormat = ${JSON.stringify(this._format)};
                    window.yoloClasses = ${JSON.stringify(this._yoloClasses)};
```

- [ ] **Step 4: Compile**

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/LabelMePanel.ts
git commit -m "feat(yolo): add-class confirm handler and webview config injection"
```

---

## Task 12: Webview — mode restriction, class chips, add-class flow

**Files:**
- Modify: `media/main.js`

- [ ] **Step 1: Restrict modes in YOLO mode (hide buttons + coerce restored mode)**

Add right after the mode-button `const` declarations region — place it just before the `let img = new Image();` line ([main.js:104](media/main.js#L104)):

```js
// YOLO mode only allows view / sam / polygon / rectangle. Hide the others and
// coerce a restored mode that is no longer available.
if (window.annotationFormat === 'yolo') {
    [pointModeBtn, lineModeBtn, circleModeBtn].forEach(b => { if (b) b.style.display = 'none'; });
}
```

Then, after `let currentMode = 'view';` ([main.js:125](media/main.js#L125)) is restored from state (the restore happens later at line ~385), guard it. Add this guard at the end of `setMode`'s entry — modify the top of `function setMode(mode)` ([main.js:4918](media/main.js#L4918)) to start with:

```js
function setMode(mode) {
    // YOLO datasets only support view/sam/polygon/rectangle.
    if (window.annotationFormat === 'yolo' && (mode === 'point' || mode === 'line' || mode === 'circle')) {
        return;
    }
```

And coerce a restored-from-state mode: find where `currentMode = vscodeState.currentMode;` ([main.js:385](media/main.js#L385)) is set and add right after that line:

```js
        if (window.annotationFormat === 'yolo' && ['point', 'line', 'circle'].includes(currentMode)) {
            currentMode = 'view';
        }
```

- [ ] **Step 2: Show yaml classes as chips in the label modal**

In `renderRecentLabels` ([main.js:3963](media/main.js#L3963)), the function defines `buildChip` then renders sections. Add a YOLO classes section as the FIRST section. Insert this block immediately before the `// 渲染当前图片标签区域` comment (line ~4015), i.e. after `buildChip` is defined:

```js
    // YOLO: list the data.yaml classes as the primary selection source.
    if (window.annotationFormat === 'yolo' && Array.isArray(window.yoloClasses) && window.yoloClasses.length > 0) {
        const classSection = document.createElement('div');
        classSection.className = 'label-section yolo-classes';
        const classTitle = document.createElement('div');
        classTitle.className = 'label-section-title';
        classTitle.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('label.classes') : 'Classes';
        classSection.appendChild(classTitle);
        const classChips = document.createElement('div');
        classChips.className = 'label-chips';
        window.yoloClasses.forEach(label => classChips.appendChild(buildChip(label, '')));
        classSection.appendChild(classChips);
        recentLabelsDiv.appendChild(classSection);
    }
```

- [ ] **Step 3: Enforce class membership on confirm (the special OK flow)**

At the very top of `confirmLabel` ([main.js:4054](media/main.js#L4054)), before the `if (isMergePending)` block, add:

```js
function confirmLabel() {
    // YOLO: a label must be one of the data.yaml classes. If the typed label is
    // missing, ask the extension to confirm + add it; on success we re-enter
    // confirmLabel with the now-valid label (see 'yoloClassAdded' handler).
    if (window.annotationFormat === 'yolo') {
        const typed = labelInput.value.trim();
        if (typed && !window.yoloClasses.includes(typed)) {
            vscode.postMessage({ command: 'yoloConfirmAddClass', label: typed });
            return; // keep the modal open; wait for the reply
        }
    }
```

(Leave the rest of `confirmLabel` unchanged.)

- [ ] **Step 4: Handle the extension replies**

In the webview message `switch` ([main.js:1115](media/main.js#L1115)), add two cases (e.g. after `case 'saveFailed':`):

```js
        case 'yoloClassAdded':
            window.yoloClasses = message.classes || window.yoloClasses;
            // The label is now a valid class — re-run confirm to create/edit the shape.
            labelInput.value = message.label;
            confirmLabel();
            break;
        case 'yoloAddClassCancelled':
            // User declined; keep the modal open so they can pick an existing class.
            if (labelModal.style.display === 'flex') labelInput.focus();
            break;
```

- [ ] **Step 5: Manual smoke test (no automated test for webview)**

Build and launch the extension (press F5 in VS Code, or `npm run compile` then run the Extension Development Host). Prepare a tiny YOLO dataset:

```
smoke/
  data.yaml          # path: .  \n  train: images  \n  names:\n    0: cat
  images/a.jpg       # any small jpg
  labels/a.txt       # 0 0.5 0.5 0.3 0.3
```

Verify:
1. Right-click `data.yaml` → "LabelEditor: Open as YOLO Dataset" opens the panel showing `a.jpg`.
2. The existing bbox from `a.txt` appears as a rectangle labeled `cat`.
3. Mode bar shows only view/sam/polygon/rectangle (no point/line/circle).
4. Draw a polygon → label modal shows `cat` as a class chip. Pick it, save → `labels/a.txt` now has a polygon line.
5. Draw a rectangle → type a NEW label `dog` → confirm → native dialog asks to add; click Add → `data.yaml` gains `1: dog`; shape is created; save writes a bbox line with class index `1`.

- [ ] **Step 6: Commit**

```bash
git add media/main.js
git commit -m "feat(yolo): restrict modes, class chips, and add-class flow in webview"
```

---

## Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all `yoloDataset` tests plus the pre-existing suites green.

- [ ] **Step 2: Compile the extension**

Run: `npm run compile`
Expected: PASS — no type errors.

- [ ] **Step 3: Re-run the Task 12 manual smoke checklist end-to-end** if any code changed since.

- [ ] **Step 4: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore(yolo): final verification fixups"
```

---

## Self-Review notes

- **Spec coverage:** entry/command (Task 7), yoloDataset module incl. all six functions (Tasks 1-6), panel format flag + scan (Task 8), read branch (Task 9), save branch (Task 10), add-class handler + injection (Task 11), webview mode restriction + class chips + add-class OK flow (Task 12), edge cases (warnings in Tasks 4/5/9, no-dims in Task 9, no-images error in Task 8, missing .txt in Task 9), testing (Tasks 1-6 + Task 13). All spec sections map to a task.
- **Refinement vs spec §5:** the missing-class confirmation uses a **native** VS Code modal (consistent with the codebase's Save/Discard/Cancel decision dialogs) rather than an in-webview box; behavior (ask, then append at the last index, write yaml immediately) is unchanged. i18n: reuses existing keys (`label.classes`, `status.savedTo`, `status.saveFailed`); no new keys needed.
- **Type consistency:** `parseYoloTxt` returns `YoloLoadedShape[]`; `buildYoloTxt` takes `ExportShape[]` (loaded shapes are structurally compatible — `label`/`shape_type`/`points`). `appendClassToYaml`/`parseDataYaml`/`resolveImageDirs`/`imageToLabelPath` signatures match their call sites in `LabelMePanel.ts`. `comparePathsNaturally` and `ImageMetadata` are exported by `labelMeUtils.ts`.
