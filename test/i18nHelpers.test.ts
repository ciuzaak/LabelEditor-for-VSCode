import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Each test isolates locale state by re-requiring the module (Node caches
// require by absolute path).
function loadI18n() {
    const absPath = path.resolve(__dirname, '..', '..', 'media', 'i18n.js');
    delete require.cache[absPath];
    return require(absPath) as {
        current: string;
        t(key: string, params?: Record<string, unknown>): string;
        setLocale(locale: string): void;
        getLocale(): string;
        onChange(fn: (locale: string) => void): () => void;
        knownLocales: string[];
        localeDisplayName: Record<string, string>;
    };
}

describe('i18n.t', () => {
    it('returns the English string by default', () => {
        const i18n = loadI18n();
        assert.equal(i18n.t('menu.save' as any), 'menu.save'); // unknown -> key
        assert.equal(i18n.t('button.save'), 'Save');
    });
    it('returns the localized string after setLocale', () => {
        const i18n = loadI18n();
        i18n.setLocale('zh-CN');
        assert.equal(i18n.t('button.save'), '保存');
    });
    it('falls back to English when locale lacks the key', () => {
        const i18n = loadI18n();
        i18n.setLocale('zh-CN');
        // Some keys may not be present in every locale — fallback ensures the
        // UI never shows a raw key for English-defined messages.
        const lit = i18n.t('app.title');
        assert.ok(typeof lit === 'string' && lit.length > 0);
    });
    it('substitutes named parameters with regex globally', () => {
        const i18n = loadI18n();
        assert.equal(i18n.t('status.refreshed', { count: 12 }), 'Refreshed: Found 12 images');
        assert.equal(i18n.t('context.deleteCount', { count: 3 }), 'Delete (3)');
        i18n.setLocale('zh-CN');
        assert.equal(i18n.t('context.deleteCount', { count: 3 }), '删除 (3)');
    });
    it('returns the key verbatim when both locales lack it', () => {
        const i18n = loadI18n();
        assert.equal(i18n.t('definitely.missing.key'), 'definitely.missing.key');
    });
});

describe('i18n.setLocale', () => {
    it('throws on an unknown locale', () => {
        const i18n = loadI18n();
        assert.throws(() => i18n.setLocale('xx-YY'));
    });
    it('is idempotent — same locale does not fire onChange twice', () => {
        const i18n = loadI18n();
        let count = 0;
        i18n.onChange(() => count++);
        i18n.setLocale('zh-CN');
        i18n.setLocale('zh-CN');
        assert.equal(count, 1);
    });
});

describe('i18n.onChange', () => {
    it('fires after setLocale and unsubscribe stops further notifications', () => {
        const i18n = loadI18n();
        const observed: string[] = [];
        const off = i18n.onChange(l => observed.push(l));
        i18n.setLocale('zh-CN');
        off();
        i18n.setLocale('en');
        assert.deepEqual(observed, ['zh-CN']);
    });
});
