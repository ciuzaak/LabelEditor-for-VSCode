import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

// The webview loads media/*.js as classic <script>s that share one global
// scope, so a top-level declaration in one file silently replaces a
// same-named one in another (main.js's signed polygonArea once overrode
// shapeHelpers.js's absolute one). Guard against that.
describe('webview scripts', () => {
    it('declare no top-level name twice across files', () => {
        const mediaDir = path.resolve(__dirname, '..', '..', 'media');
        const files = fs.readdirSync(mediaDir).filter(f => f.endsWith('.js') && !f.endsWith('.min.js'));
        const owners = new Map<string, string[]>();
        for (const file of files) {
            const src = fs.readFileSync(path.join(mediaDir, file), 'utf8');
            // Files wrapped in a top-level IIFE declare nothing globally.
            if (/^\(function\s*\(/m.test(src)) continue;
            // Otherwise only unindented declarations are top-level.
            for (const m of src.matchAll(/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let|var|class)\s+([\w$]+)/gm)) {
                const name = m[1] || m[2];
                owners.set(name, [...(owners.get(name) || []), file]);
            }
        }
        const dupes = [...owners].filter(([, fs_]) => fs_.length > 1).map(([n, fs_]) => `${n}: ${fs_.join(', ')}`);
        assert.deepEqual(dupes, []);
    });

    it('never write shape points in place (the SVG render cache keys geometry by array identity)', () => {
        const mediaDir = path.resolve(__dirname, '..', '..', 'media');
        const offenders: string[] = [];
        for (const file of fs.readdirSync(mediaDir).filter(f => f.endsWith('.js') && !f.endsWith('.min.js'))) {
            const lines = fs.readFileSync(path.join(mediaDir, file), 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (/^\s*\/\//.test(line)) return;
                if (/\.points\[[^\]]+\](\[[^\]]+\])?\s*(=|\+=|-=)(?!=)|\.points\.(push|pop|splice|shift|unshift|reverse|sort|fill|copyWithin)\(/.test(line)) {
                    offenders.push(`${file}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        assert.deepEqual(offenders, []);
    });

    it('parse as valid JavaScript', () => {
        // The webview scripts are not compiled, so nothing else catches a syntax
        // error before the panel loads blank.
        const mediaDir = path.resolve(__dirname, '..', '..', 'media');
        for (const file of fs.readdirSync(mediaDir).filter(f => f.endsWith('.js'))) {
            assert.doesNotThrow(
                () => new vm.Script(fs.readFileSync(path.join(mediaDir, file), 'utf8'), { filename: file }),
                file
            );
        }
    });

    it('ship the same polygon-clipping build as the pinned npm package', () => {
        // media/polygon-clipping.umd.min.js is vendored (webviews cannot load
        // node_modules); `npm run vendor` refreshes it after a version bump.
        const root = path.resolve(__dirname, '..', '..');
        const vendored = fs.readFileSync(path.join(root, 'media', 'polygon-clipping.umd.min.js'));
        const upstream = fs.readFileSync(path.join(root, 'node_modules', 'polygon-clipping', 'dist', 'polygon-clipping.umd.min.js'));
        assert.ok(vendored.equals(upstream), 'media/polygon-clipping.umd.min.js differs from node_modules — run `npm run vendor`');
    });
});
