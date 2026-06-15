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
