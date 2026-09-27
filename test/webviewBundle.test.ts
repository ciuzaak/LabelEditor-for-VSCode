import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { EDITOR_BUNDLE } from '../src/webviewScripts';

const root = path.resolve(__dirname, '..', '..');
const mediaDir = path.join(root, 'media');
const bundler = require(path.join(root, 'build', 'bundle-webview.js')) as {
    EDITOR_SOURCES: string[];
    BUNDLE: string;
    bundleEditor(mediaDir?: string, sources?: string[]): { code: string; map: { sources: string[]; sourcesContent: string[]; mappings: string } };
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeSegment(seg: string): number[] {
    const out: number[] = [];
    let value = 0, shift = 0;
    for (const ch of seg) {
        const digit = B64.indexOf(ch);
        value += (digit & 31) << shift;
        if (digit & 32) { shift += 5; continue; }
        out.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0; shift = 0;
    }
    return out;
}

describe('webview editor bundle', () => {
    it('lists every media/editor/*.js exactly once', () => {
        const onDisk = fs.readdirSync(path.join(mediaDir, 'editor')).filter(f => f.endsWith('.js')).map(f => 'editor/' + f).sort();
        assert.deepEqual([...bundler.EDITOR_SOURCES].sort(), onDisk);
        assert.equal(new Set(bundler.EDITOR_SOURCES).size, bundler.EDITOR_SOURCES.length);
    });

    it('is what the extension loads', () => {
        assert.equal(EDITOR_BUNDLE, bundler.BUNDLE);
    });

    it('concatenates the sources into one parseable script', () => {
        const { code } = bundler.bundleEditor();
        assert.doesNotThrow(() => new vm.Script(code, { filename: bundler.BUNDLE }));
        for (const rel of bundler.EDITOR_SOURCES) {
            assert.ok(code.includes(fs.readFileSync(path.join(mediaDir, rel), 'utf8').replace(/\n$/, '')), rel);
        }
    });

    it('source map points every bundle line back to its file and line', () => {
        const { code, map } = bundler.bundleEditor();
        const bundleLines = code.split('\n');
        let src = 0, line = 0, checked = 0;
        map.mappings.split(';').forEach((segment, generatedLine) => {
            if (!segment) return;
            const [col, dSrc, dLine] = decodeSegment(segment);
            assert.equal(col, 0);
            src += dSrc; line += dLine;
            const original = map.sourcesContent[src].split('\n')[line];
            assert.equal(bundleLines[generatedLine], original, `${map.sources[src]}:${line + 1}`);
            checked++;
        });
        const total = bundler.EDITOR_SOURCES.reduce((n, rel) =>
            n + fs.readFileSync(path.join(mediaDir, rel), 'utf8').replace(/\n$/, '').split('\n').length, 0);
        assert.equal(checked, total);
    });
});
