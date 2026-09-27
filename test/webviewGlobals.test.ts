import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
});
