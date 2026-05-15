# Implementation Plan — Multi-Language Support (i18n)

**Spec:** [`2026-05-15-i18n-multi-language-design.md`](../specs/2026-05-15-i18n-multi-language-design.md)

Executed **after** Circle, Export, and Keyboard plans so every English string in this codebase — including the three new features — is captured in a single dictionary pass.

## Step 1 — `media/i18n.js` (new, pure)

```js
(function (root) {
    const DICTS = {
        en: { /* English messages */ },
        'zh-CN': { /* Simplified Chinese messages */ }
    };

    const KNOWN = Object.keys(DICTS);
    let current = 'en';
    const subscribers = [];

    function t(key, params) {
        const dict = DICTS[current] || DICTS.en;
        let msg = dict[key];
        if (msg === undefined) msg = DICTS.en[key];
        if (msg === undefined) return key;          // fallback to key
        if (params) {
            for (const k in params) {
                msg = msg.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
            }
        }
        return msg;
    }

    function setLocale(locale) {
        if (!KNOWN.includes(locale)) throw new Error('Unknown locale: ' + locale);
        if (current === locale) return;
        current = locale;
        subscribers.forEach(fn => { try { fn(locale); } catch {} });
    }

    function getLocale() { return current; }
    function onChange(fn) { subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); }; }

    const api = {
        get current() { return current; },
        t, setLocale, getLocale, onChange,
        knownLocales: KNOWN,
        localeDisplayName: { en: 'English', 'zh-CN': '中文' }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.i18n = api;
})(typeof window !== 'undefined' ? window : null);
```

The dictionary covers (full key list catalogued during implementation; representative slice):

```
'app.title': { en: 'LabelEditor', 'zh-CN': '标注编辑器' }
'section.images': { en: 'Images', 'zh-CN': '图片' }
'section.labels': { en: 'Labels', 'zh-CN': '标签' }
'section.instances': { en: 'Instances', 'zh-CN': '实例' }
'menu.save': { en: 'Save', 'zh-CN': '保存' }
'menu.ok': { en: 'OK', 'zh-CN': '确定' }
'menu.cancel': { en: 'Cancel', 'zh-CN': '取消' }
'menu.run': { en: 'Run', 'zh-CN': '运行' }
'mode.view.title': { en: 'View Mode', 'zh-CN': '查看模式' }
'mode.polygon.title': { en: 'Polygon Mode', 'zh-CN': '多边形模式' }
'mode.rectangle.title': { en: 'Rectangle Mode', 'zh-CN': '矩形模式' }
'mode.line.title': { en: 'Line Mode', 'zh-CN': '折线模式' }
'mode.point.title': { en: 'Point Mode', 'zh-CN': '点模式' }
'mode.circle.title': { en: 'Circle Mode', 'zh-CN': '圆形模式' }
'mode.sam.title': { en: 'SAM AI Mode', 'zh-CN': 'SAM AI 模式' }
'label.theme': { en: 'Theme', 'zh-CN': '主题' }
'label.zoom': { en: 'Zoom', 'zh-CN': '缩放' }
'label.brightness': { en: 'Brightness', 'zh-CN': '亮度' }
'label.contrast': { en: 'Contrast', 'zh-CN': '对比度' }
'label.borderWidth': { en: 'Border Width', 'zh-CN': '描边粗细' }
'label.fillOpacity': { en: 'Fill Opacity', 'zh-CN': '填充透明度' }
'label.channel': { en: 'Channel', 'zh-CN': '通道' }
'label.clahe': { en: 'CLAHE', 'zh-CN': 'CLAHE' }
'label.clipLimit': { en: 'Clip Limit', 'zh-CN': '裁剪阈值' }
'label.language': { en: 'Language', 'zh-CN': '语言' }
'label.keyboardShortcuts': { en: 'Keyboard Shortcuts', 'zh-CN': '键盘快捷键' }
'label.annotationStyle': { en: 'Annotation Style', 'zh-CN': '标注样式' }
'label.imageAdjustment': { en: 'Image Adjustment', 'zh-CN': '图像调整' }
'context.edit': { en: 'Edit', 'zh-CN': '编辑' }
'context.rename': { en: 'Rename', 'zh-CN': '重命名' }
'context.rename.count': { en: 'Rename ({count})', 'zh-CN': '重命名 ({count})' }
'context.merge': { en: 'Merge', 'zh-CN': '合并' }
'context.merge.count': { en: 'Merge ({count})', 'zh-CN': '合并 ({count})' }
'context.hide': { en: 'Hide', 'zh-CN': '隐藏' }
'context.show': { en: 'Show', 'zh-CN': '显示' }
'context.hide.count': { en: 'Hide ({count})', 'zh-CN': '隐藏 ({count})' }
'context.show.count': { en: 'Show ({count})', 'zh-CN': '显示 ({count})' }
'context.delete': { en: 'Delete', 'zh-CN': '删除' }
'context.delete.count': { en: 'Delete ({count})', 'zh-CN': '删除 ({count})' }
'modal.enterLabel': { en: 'Enter Label', 'zh-CN': '输入标签' }
'modal.chooseColor': { en: 'Choose Color', 'zh-CN': '选择颜色' }
'modal.onnxBatchInfer': { en: 'ONNX Batch Inference', 'zh-CN': 'ONNX 批量推理' }
'modal.samConfig': { en: 'SAM AI Annotation', 'zh-CN': 'SAM AI 标注' }
'modal.exportDataset': { en: 'Export Dataset', 'zh-CN': '导出数据集' }
'tools.exportSvg': { en: 'Export SVG', 'zh-CN': '导出 SVG' }
'tools.onnxBatchInfer': { en: 'ONNX Batch Infer', 'zh-CN': 'ONNX 批量推理' }
'tools.exportDataset': { en: 'Export Dataset', 'zh-CN': '导出数据集' }
'status.saved': { en: 'Saved', 'zh-CN': '已保存' }
'status.refreshed': { en: 'Refreshed: Found {count} images', 'zh-CN': '已刷新：找到 {count} 张图片' }
'status.mergeNoOverlap': { en: 'No overlapping shapes to merge', 'zh-CN': '没有可合并的重叠形状' }
'status.mergePolyRectOnly': { en: 'Merge supports polygon/rectangle only', 'zh-CN': '合并仅支持多边形/矩形' }
'status.circleTooSmall': { en: 'Circle too small', 'zh-CN': '圆形太小' }
'status.exportDone': { en: 'Exported {count} images to {path}', 'zh-CN': '已导出 {count} 张图片到 {path}' }
```

…and so on for every key.

## Step 2 — `tipsData.js` rewrite

Each entry becomes `{ titleKey, descKey, shortcutAction? }`. Dictionary holds the actual strings under `tip.<id>.title` / `tip.<id>.desc`.

## Step 3 — `tooltip.js` adjustments

- Resolve `titleKey`/`descKey` via `window.i18n.t(...)` on every render.
- On `i18n.onChange`, re-render any attached tooltips (re-attach is idempotent).

## Step 4 — `data-i18n` attribute pass through `LabelMePanel.ts`

Add `data-i18n="<key>"` to every static label/title/button in:
- Sidebar headers (Images, Labels, Instances)
- Mode buttons aria/text (mostly icon-only; tooltips already cover names)
- Settings dropdown — every `<label>` and group header
- Tools dropdown items
- Modal titles
- Modal form labels
- Modal buttons (OK / Cancel / Run / Start Service)
- Eye/visibility/section count placeholders not necessary (dynamic)

Default English text remains in the HTML so first paint is correct.

## Step 5 — `media/main.js` runtime strings

Replace every literal status / notify string with `window.i18n.t(...)`. Key list assembled during impl by greppping `notifyBus.show`, `showStatus`, `statusSpan.textContent`, `setMergeStatus`, `textContent =`. Examples already in Step 1.

Dynamic content menu labels:
```js
contextMenuRename.textContent = multi
    ? window.i18n.t('context.rename.count', { count: selectedShapeIndices.size })
    : window.i18n.t('context.rename');
```

## Step 6 — `LabelMePanel.ts` boot wiring

- Inject `initialGlobalSettings.locale = ${JSON.stringify(this._globalState.get('locale') || 'en')}`.
- Add `i18nUri` script tag loaded **before** any other media script so `window.i18n.t` is available immediately.
- `main.js` startup:
  ```js
  if (initialGlobalSettings.locale && window.i18n.knownLocales.includes(initialGlobalSettings.locale)) {
      window.i18n.setLocale(initialGlobalSettings.locale);
  }
  applyI18n();              // walks data-i18n elements; renders settings text
  window.i18n.onChange(() => { applyI18n(); reRenderEverything(); });
  ```

## Step 7 — Language picker in Settings

In `settingsMenuDropdown`, insert between Theme and Zoom:
```html
<div class="language-control">
    <label data-i18n="label.language">Language</label>
    <select id="languageSelect">
        <option value="en">English</option>
        <option value="zh-CN">中文</option>
    </select>
</div>
```

Handler:
```js
languageSelect.value = window.i18n.getLocale();
languageSelect.addEventListener('change', e => {
    window.i18n.setLocale(e.target.value);
    vscode.postMessage({ command: 'saveGlobalSettings', key: 'locale', value: e.target.value });
});
```

## Step 8 — Refresh after locale change

`reRenderEverything()` re-invokes:
- `renderShapeList()`
- `renderLabelsList()`
- `renderImageBrowserList()`
- `renderKeybindingsList()` (if Keyboard PR landed)
- `updateContextMenuLabels()` (existing helper renamed if needed)
- Any modal currently visible: rebuild its text — easier to close on locale switch and reopen.

## Step 9 — Tests

`test/i18nHelpers.test.ts`:
- `t('menu.save')` returns 'Save' for en, '保存' for zh-CN.
- `t('status.refreshed', { count: 12 })` performs substitution.
- Missing key → returns key verbatim.
- `setLocale('xx')` throws.
- `onChange` fires; unsubscribe works.

## Step 10 — README + CHANGELOG

- Settings → Language entry described.
- Roadmap: ✓ Multi-language support.
- Note: Chinese (Simplified) shipped; community PRs welcome for additional locales.

## Smoke checklist

- [ ] Switch to 中文 → every visible text changes.
- [ ] Tooltip chips also translated.
- [ ] Save → status shows 已保存.
- [ ] Open Export Dataset modal — labels in 中文.
- [ ] Reload — language persists.
- [ ] Switch back to English — all restored.
- [ ] Selecting 3 shapes → context menu shows "删除 (3)" in zh-CN, "Delete (3)" in en.
