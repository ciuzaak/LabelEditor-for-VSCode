// ESLint flat config.
//
// - src/ and test/: TypeScript (typescript-eslint recommended).
// - media/: the webview's classic scripts. The editor files (media/editor/*)
//   are concatenated into one script and share a global scope, so each file
//   is given every top-level name declared by any webview script as a global;
//   no-undef then still catches genuine typos and undeclared names.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const root = path.dirname(fileURLToPath(import.meta.url));

function webviewSourceFiles() {
    const media = path.join(root, 'media');
    const list = (dir) => fs.readdirSync(path.join(media, dir))
        .filter(f => f.endsWith('.js') && !f.endsWith('.min.js') && !f.includes('.bundle.'))
        .map(f => path.join(media, dir, f));
    return [...list('.'), ...list('editor')];
}

// Globals the webview scripts define: top-level declarations (unindented;
// files wrapped in an IIFE declare nothing that way — mirrors
// test/webviewGlobals.test.ts) and namespaces assigned onto window.
function webviewGlobals() {
    const names = {};
    for (const file of webviewSourceFiles()) {
        const src = fs.readFileSync(file, 'utf8');
        // Namespaces published on window (IIFE helpers: `root.X = api`).
        for (const m of src.matchAll(/\b(?:root|window)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
            names[m[1]] ??= 'readonly';
        }
        if (/^\(function\s*\(/m.test(src)) continue;
        for (const m of src.matchAll(/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let|var|class)\s+([\w$]+)/gm)) {
            names[m[1] || m[2]] = m[2] && /^(?:let|var)/.test(m[0]) ? 'writable' : 'readonly';
        }
    }
    return names;
}

// Injected by the extension's inline boot script (src/LabelMePanel.ts) or by
// the vendored polygon-clipping UMD build.
const injectedGlobals = {
    vscode: 'readonly',
    acquireVsCodeApi: 'readonly',
    imageUrl: 'readonly',
    imageName: 'readonly',
    imagePath: 'readonly',
    existingData: 'readonly',
    workspaceImages: 'readonly',
    currentImageRelativePath: 'readonly',
    initialImageMetadata: 'readonly',
    initialGlobalSettings: 'readonly',
    polygonClipping: 'readonly',
};

export default tseslint.config(
    {
        ignores: [
            'out/**', 'out-test/**', 'node_modules/**', 'docs/**',
            'media/polygon-clipping.umd.min.js', 'media/editor.bundle.js',
        ],
    },

    // Extension host and tests.
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: { globals: globals.node },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
        },
    },
    {
        // Type-aware promise checks for the extension host: an un-awaited
        // promise there loses errors (and once let fast navigation race).
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: root },
        },
        rules: {
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
        },
    },
    {
        // Tests load the untyped webview helpers (plain JS in media/) by path.
        files: ['test/**/*.ts'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },

    // Webview scripts.
    {
        files: ['media/**/*.js'],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.commonjs, // the pure helpers also export via module.exports for tests
                ...webviewGlobals(),
                ...injectedGlobals,
            },
        },
        rules: {
            // Top-level names are shared across files, so "unused" is only
            // meaningful for locals.
            'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
            // Each file re-declares nothing; the shared-global lists above make
            // every top-level name look like a redeclared global.
            'no-redeclare': ['error', { builtinGlobals: false }],
        },
    },

    // Node tooling.
    {
        files: ['build/**/*.js', 'eslint.config.mjs'],
        extends: [js.configs.recommended],
        languageOptions: { globals: globals.node },
    },
);
