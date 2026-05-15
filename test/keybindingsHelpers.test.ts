import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// keybindings.js wraps its API in an IIFE that exports via module.exports for
// Node consumers, mirroring the other pure helpers in media/.
// tslint:disable-next-line: no-var-requires
const kb = require(path.resolve(__dirname, '..', '..', 'media', 'keybindings.js')) as {
    DEFAULTS: Record<string, any>;
    ALT_BINDINGS: Record<string, any[]>;
    ACTION_NAMES: Record<string, string>;
    matches(event: any, binding: any): boolean;
    matchAction(event: any, bindings: Record<string, any>, alts: Record<string, any[]>): string | null;
    display(binding: any): string;
    bindingsEqual(a: any, b: any): boolean;
    findConflict(actionId: string, binding: any, bindings: Record<string, any>): string | null;
    mergeWithDefaults(saved: Record<string, any> | null): Record<string, any>;
    isModifierOnly(event: any): boolean;
    eventToBinding(event: any): any;
};

function ev(key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
    return {
        key,
        ctrlKey: !!mods.ctrl,
        shiftKey: !!mods.shift,
        altKey: !!mods.alt,
        metaKey: !!mods.meta
    };
}

describe('keybindings.matches', () => {
    it('matches exact key + modifiers', () => {
        assert.equal(kb.matches(ev('S', { ctrl: true }), { key: 'S', ctrl: true }), true);
    });
    it('is case-insensitive for single-letter keys', () => {
        assert.equal(kb.matches(ev('s', { ctrl: true }), { key: 'S', ctrl: true }), true);
    });
    it('rejects when modifiers disagree', () => {
        assert.equal(kb.matches(ev('S', { ctrl: true, shift: true }), { key: 'S', ctrl: true }), false);
    });
    it('matches multi-character keys exactly (Escape)', () => {
        assert.equal(kb.matches(ev('Escape'), { key: 'Escape' }), true);
        assert.equal(kb.matches(ev('Esc'), { key: 'Escape' }), false);
    });
});

describe('keybindings.matchAction', () => {
    const bindings = { 'edit.save': { key: 'S', ctrl: true }, 'mode.view': { key: 'V' } };
    const alts = { 'edit.save': [{ key: 'F2' }] };

    it('returns the matched action id', () => {
        assert.equal(kb.matchAction(ev('S', { ctrl: true }), bindings, alts), 'edit.save');
        assert.equal(kb.matchAction(ev('V'), bindings, alts), 'mode.view');
    });
    it('honours alt bindings when primary does not match', () => {
        assert.equal(kb.matchAction(ev('F2'), bindings, alts), 'edit.save');
    });
    it('returns null when nothing matches', () => {
        assert.equal(kb.matchAction(ev('X'), bindings, alts), null);
    });
});

describe('keybindings.display', () => {
    it('orders modifiers Ctrl→Shift→Alt→Meta and uppercases letters', () => {
        assert.equal(kb.display({ key: 'Z', ctrl: true, shift: true }), 'Ctrl+Shift+Z');
    });
    it('renames Space and arrow keys', () => {
        assert.equal(kb.display({ key: ' ' }), 'Space');
        assert.equal(kb.display({ key: 'ArrowUp' }), '↑');
        assert.equal(kb.display({ key: 'ArrowLeft' }), '←');
    });
    it('returns empty for null binding', () => {
        assert.equal(kb.display(null), '');
    });
});

describe('keybindings.findConflict', () => {
    const bindings = {
        'mode.view': { key: 'V' },
        'mode.polygon': { key: 'P' }
    };
    it('returns the conflicting action id', () => {
        assert.equal(kb.findConflict('mode.polygon', { key: 'V' }, bindings), 'mode.view');
    });
    it('returns null when reassigning to its own value', () => {
        assert.equal(kb.findConflict('mode.view', { key: 'V' }, bindings), null);
    });
    it('different modifier flags do not conflict', () => {
        assert.equal(kb.findConflict('edit.foo', { key: 'V', ctrl: true }, bindings), null);
    });
});

describe('keybindings.mergeWithDefaults', () => {
    it('returns defaults when nothing is saved', () => {
        const out = kb.mergeWithDefaults(null);
        assert.deepEqual(out['mode.view'], { key: 'V' });
    });
    it('lets a saved entry fully replace the default', () => {
        const out = kb.mergeWithDefaults({ 'mode.view': { key: 'Q' } });
        assert.deepEqual(out['mode.view'], { key: 'Q' });
    });
    it('ignores entries without a key', () => {
        const out = kb.mergeWithDefaults({ 'mode.view': { ctrl: true } } as any);
        assert.deepEqual(out['mode.view'], { key: 'V' });
    });
    it('drops unknown saved actions', () => {
        const out = kb.mergeWithDefaults({ 'bogus.action': { key: 'X' } });
        assert.equal(out['bogus.action'], undefined);
    });
});

describe('keybindings.eventToBinding / isModifierOnly', () => {
    it('isModifierOnly recognises Control/Shift/Alt/Meta keys', () => {
        assert.equal(kb.isModifierOnly(ev('Control')), true);
        assert.equal(kb.isModifierOnly(ev('Shift', { ctrl: true })), true);
        assert.equal(kb.isModifierOnly(ev('Z', { ctrl: true })), false);
    });
    it('eventToBinding strips false modifiers', () => {
        assert.deepEqual(kb.eventToBinding(ev('Z', { ctrl: true })), { key: 'Z', ctrl: true });
        assert.deepEqual(kb.eventToBinding(ev('A')), { key: 'A' });
    });
    it('eventToBinding returns null for modifier-only presses', () => {
        assert.equal(kb.eventToBinding(ev('Shift')), null);
    });
});
