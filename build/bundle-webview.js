#!/usr/bin/env node
// Builds media/editor.bundle.js: the webview editor's sources (media/editor/*.js)
// concatenated, in EDITOR_SOURCES order, into ONE classic script, plus a
// line-accurate source map so devtools shows the original files.
//
// Why one script: the editor files share a single global scope and rely on
// function hoisting across all of them. Loaded as separate <script> tags, the
// browser may run queued events (image load, host messages, observers) between
// two scripts, before later files' functions exist. Concatenation keeps the
// original single-script semantics exactly.
//
// Usage: node build/bundle-webview.js [--watch]
//   --watch  rebuild on changes under media/editor/ and run `tsc -watch` too.

const fs = require('fs');
const path = require('path');

const MEDIA_DIR = path.join(__dirname, '..', 'media');
const BUNDLE = 'editor.bundle.js';

// Order matters: top-level statements run in this order (state first).
const EDITOR_SOURCES = [
    'editor/state.js',
    'editor/view.js',
    'editor/messages.js',
    'editor/shortcuts.js',
    'editor/selection.js',
    'editor/canvas.js',
    'editor/editMode.js',
    'editor/eraser.js',
    'editor/labelModal.js',
    'editor/sidebar.js',
    'editor/render.js',
    'editor/export.js',
    'editor/onnx.js',
    'editor/settings.js',
    'editor/imageBrowser.js',
    'editor/advancedSearch.js',
    'editor/sidebarLayout.js',
    'editor/sam.js',
];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(value) {
    let v = value < 0 ? ((-value) << 1) | 1 : value << 1;
    let out = '';
    do {
        let digit = v & 31;
        v >>>= 5;
        if (v > 0) digit |= 32;
        out += B64[digit];
    } while (v > 0);
    return out;
}

/**
 * Concatenate the sources. Returns { code, map } where every bundle line of a
 * source maps to the same line of that source (banner lines map nowhere).
 */
function bundleEditor(mediaDir = MEDIA_DIR, sources = EDITOR_SOURCES) {
    const codeLines = [];
    const mappings = [];
    const contents = [];
    let prevSource = 0;
    let prevLine = 0;
    sources.forEach((rel, sourceIndex) => {
        const text = fs.readFileSync(path.join(mediaDir, rel), 'utf8');
        contents.push(text);
        codeLines.push(`// ---- ${rel} ----`);
        mappings.push('');
        const lines = text.replace(/\n$/, '').split('\n');
        lines.forEach((line, lineIndex) => {
            codeLines.push(line);
            // Segment: generated column 0 -> (source, line, column 0), all
            // fields but the column relative to the previous segment.
            mappings.push('A' + vlq(sourceIndex - prevSource) + vlq(lineIndex - prevLine) + 'A');
            prevSource = sourceIndex;
            prevLine = lineIndex;
        });
    });
    codeLines.push(`//# sourceMappingURL=${BUNDLE}.map`);
    const map = {
        version: 3,
        file: BUNDLE,
        sources: sources,
        sourcesContent: contents,
        names: [],
        mappings: mappings.join(';'),
    };
    return { code: codeLines.join('\n') + '\n', map };
}

function writeBundle() {
    const { code, map } = bundleEditor();
    fs.writeFileSync(path.join(MEDIA_DIR, BUNDLE), code);
    fs.writeFileSync(path.join(MEDIA_DIR, BUNDLE + '.map'), JSON.stringify(map));
    return code.split('\n').length;
}

if (require.main === module) {
    const lines = writeBundle();
    console.log(`webview: wrote media/${BUNDLE} (${EDITOR_SOURCES.length} files, ${lines} lines)`);
    if (process.argv.includes('--watch')) {
        let timer = null;
        fs.watch(path.join(MEDIA_DIR, 'editor'), () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                try {
                    writeBundle();
                    console.log(`webview: rebuilt media/${BUNDLE}`);
                } catch (err) {
                    console.error('webview: bundle failed:', err.message);
                }
            }, 50);
        });
        const tsc = require.resolve('typescript/bin/tsc');
        require('child_process').spawn(process.execPath, [tsc, '-watch', '-p', path.join(__dirname, '..')], { stdio: 'inherit' });
    }
}

module.exports = { EDITOR_SOURCES, BUNDLE, bundleEditor };
