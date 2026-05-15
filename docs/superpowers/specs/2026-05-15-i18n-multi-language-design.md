# Multi-Language Support (i18n) — Design

**Date:** 2026-05-15
**Roadmap item:** Multi-language support

## Goals

1. All user-visible webview strings are funnelled through a `t('key')` lookup.
2. Ship two locales: **English (`en`)** (default) and **Simplified Chinese (`zh-CN`)**.
3. Settings dropdown gains a Language picker (segmented or `<select>`).
4. Selected locale persists in `globalState` and applies immediately without reload (UI re-renders).
5. The tooltip dictionary (`tipsData.js`) is converted to key-based, with translations layered on top.

Non-goals: localising VS Code-side dialog text (the `showWarningMessage` calls in `LabelMePanel.ts` stay English — those are short and infrequent), date/number formatting, RTL layout, plural rules (zh-CN doesn't need them).

## Scope of strings

The complete catalog comes from grepping the existing surface:

1. **HTML labels in `LabelMePanel.ts`** — section headers (Images, Labels, Instances), modal titles ("Enter Label", "Choose Color", "ONNX Batch Inference", "SAM AI Annotation", "Export Dataset"), modal form labels, buttons (OK/Cancel/Run/Save/Start Service).
2. **`tipsData.js`** — every `title` and `desc`. Converted to key references; the human-readable strings live in `i18n.js`.
3. **`media/main.js` runtime strings**:
   - status bar / notifyBus messages: "Saved", "Refreshed: Found N images", "Merge supports polygon/rectangle only", "No overlapping shapes to merge", "Polygon clipping unavailable", "Circle too small", etc.
   - context menu items rendered with selection counts: "Hide (3)", "Rename (3)", etc. — template strings with `t('context.hide', { count: 3 })`.
   - keyboard-driven prompts.
4. **`LabelMePanel.ts` notification calls** routed via `_notify` to the webview — pass key + params, translate on the webview side.

Out of scope (intentionally English):
- VS Code native warning dialogs (`'You have unsaved changes...'`) — these are short and rarely seen; saved for v2.
- Browse-dialog `openLabel` strings ("Select Model Directory" etc.) — VS Code native UI.
- Console error messages.

## File layout

```
media/
  i18n.js              # public API + dictionaries (en, zh-CN) + locale state
  tipsData.js          # converted to map data-tip-id → { titleKey, descKey, shortcutAction }
src/
  (no change to source/strings — strings live in webview)
```

Single-file dictionary keeps the loader simple; the file is ~500 lines but that's still smaller than tipsData was.

## API

```js
window.i18n = {
  current: 'en',
  setLocale(locale),                 // throws if unknown
  getLocale(),
  t(key, params?),                   // 'menu.save' → 'Save', 'context.hide' with {count:3} → 'Hide (3)'
  onChange(callback),                // observer for re-rendering
  knownLocales: ['en', 'zh-CN'],
  localeDisplayName: { en: 'English', 'zh-CN': '中文' }
};
```

### Key naming

```
menu.<id>       buttons in menus and modals
modal.<id>      modal titles
label.<id>      form labels
mode.<id>       mode names (also tied to mode buttons' tip titles)
tip.<tip-id>    tooltip title/desc (auto-namespaced from data-tip-id)
status.<id>     status bar + notifyBus messages
context.<id>    shape context menu items
```

Tooltip keys are derived from `data-tip-id`: `nav.toggleBrowser` → tip title at `tip.nav.toggleBrowser.title`, desc at `.desc`.

### Param substitution
`{name}` placeholder syntax. Numeric counts use `{count}`.

```
'context.delete': { en: 'Delete ({count})', 'zh-CN': '删除 ({count})' }
```

## Behaviour at boot

1. `LabelMePanel.ts` injects `initialGlobalSettings.locale ?? 'en'`.
2. `i18n.js` (loaded as `<script>` before `main.js`) sets `current = locale`.
3. `main.js` runs `applyI18n()` after DOM setup:
   - Walks every element with `data-i18n="key"` and sets `textContent`.
   - Re-attaches tooltips (which now consult `i18n.t` per render).
   - Renders settings labels.
4. Language change handler calls `setLocale`, re-runs `applyI18n()`, persists via `saveGlobalSettings('locale', newLocale)`.

## Settings UI

New row in `settingsMenuDropdown`, between Theme and Zoom:

```html
<div class="language-control">
    <label data-i18n="label.language">Language</label>
    <select id="languageSelect">
        <option value="en">English</option>
        <option value="zh-CN">中文</option>
    </select>
</div>
```

## Architecture details

### `data-i18n` attribute
Every static text node in the HTML scaffold gains `data-i18n="some.key"`. The English fallback text stays in-place so the document renders correctly even before `applyI18n` runs (defence against missing key in dictionary). Example:

```html
<h3 data-i18n="section.images">Images</h3>
```

### Dynamic strings in `main.js`
Wrap inline strings:
```js
statusSpan.textContent = `Refreshed: Found ${n} images`;
// becomes
window.notifyBus.show('success', window.i18n.t('status.refreshed', { count: n }));
```

A grep checklist of every literal string to convert lives in the plan.

### Tooltips
- `tipsData.js` becomes a thin map:
  ```js
  window.TIPS = {
    'nav.toggleBrowser': { titleKey: 'tip.nav.toggleBrowser.title', descKey: 'tip.nav.toggleBrowser.desc' },
    ...
  };
  ```
- `tooltip.js` resolves each render via `i18n.t(titleKey)` and `i18n.t(descKey)`.
- `shortcut` field becomes `shortcutAction: 'mode.view'` (key into keybindings.display) — already covered by the Keyboard Customization spec.

### VS Code-side notifications
`LabelMePanel.ts`'s `_notify(level, text)` keeps the raw string in English. The webview now also accepts `{ key, params }` form: `_notifyI18n(level, 'status.savedTo', { path })`. Translation happens in webview before display. For v1 we leave the legacy `text` form working too — existing call sites can be migrated incrementally.

## Translations

Initial Chinese translations cover roughly 120 keys. Style guidelines: terse imperatives, use mainland conventions (设置 / 工具 / 标签 / 实例 / 标注). The full list lives in the plan doc; only ambiguous cases are called out here:

| English | zh-CN | Note |
|---|---|---|
| Polygon | 多边形 | |
| Rectangle | 矩形 | |
| Line | 折线 | matches the existing "line/polyline" semantics |
| Point | 点 | |
| Circle | 圆形 | |
| SAM AI Mode | SAM AI | brand kept Latin |
| Brightness | 亮度 | |
| Contrast | 对比度 | |
| Border Width | 描边粗细 | |
| Fill Opacity | 填充透明度 | |
| Eraser | 橡皮 | |
| Merge | 合并 | |
| Rename | 重命名 | |
| Hide / Show | 隐藏 / 显示 | |
| Delete | 删除 | |
| Save | 保存 | |
| Export Dataset | 导出数据集 | |
| Keyboard Shortcuts | 键盘快捷键 | |
| Language | 语言 | |

## Tests

`test/i18nHelpers.test.ts`:
- `t` returns English for missing locale.
- `t` falls back to key when message missing in both locales.
- Param substitution: `t('context.delete', { count: 3 })` → `Delete (3)` in en, `删除 (3)` in zh-CN.
- `setLocale('xx')` throws.
- `onChange` fires after `setLocale`.

Manual smoke:
- Switch Language to 中文 — every visible button/menu/tooltip flips.
- Open Labels modal → title in zh-CN.
- Status bar messages localised after triggering (save, refresh, merge no-op).
- Reload → language persists.
- Switch back to English — restored.
- Open SAM modal and ONNX modal → all form labels localised.

## Sequencing inside this PR set

This is the **last** of the four roadmap items so that Circle / Export / Shortcuts can contribute their English text first; the i18n pass adds keys + Chinese translations for everything (including the new features) in one sweep. This avoids two rounds of dictionary churn.
