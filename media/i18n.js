// Minimal i18n layer for the webview. Strings live in the dictionaries
// below; consumers call window.i18n.t(key, params?) and listen via onChange.
// Pure logic — no DOM access, so it can be Node-required by unit tests.

(function (root) {
    const DICTS = {
        en: {
            // App / sections
            'app.title': 'LabelEditor',
            'section.images': 'Images',
            'section.labels': 'Labels',
            'section.instances': 'Instances',

            // Settings group headers
            'settings.annotationStyle': 'Annotation Style',
            'settings.imageAdjustment': 'Image Adjustment',
            'settings.keyboardShortcuts': 'Keyboard Shortcuts',

            // Generic form labels
            'label.theme': 'Theme',
            'label.zoom': 'Zoom',
            'label.brightness': 'Brightness',
            'label.contrast': 'Contrast',
            'label.borderWidth': 'Border Width',
            'label.fillOpacity': 'Fill Opacity',
            'label.channel': 'Channel',
            'label.clahe': 'CLAHE',
            'label.clipLimit': 'Clip Limit',
            'label.language': 'Language',
            'label.format': 'Format',
            'label.scope': 'Scope',
            'label.outputDir': 'Output Directory',
            'label.classes': 'Classes',
            'label.addClass': 'Add class name',
            'label.device': 'Device',
            'label.colorFormat': 'Color Format',
            'label.existingAnnotations': 'Existing Annotations',
            'label.modelDir': 'Model Directory',
            'label.pythonPath': 'Python Interpreter',
            'label.port': 'Port',
            'label.encodeMode': 'Encode Mode',
            'label.encodeSource': 'Encode Source',
            'label.customColor': 'Custom Color',
            'label.description': 'Description',
            'label.classOrderHint': 'order = class index',

            // Buttons
            'button.ok': 'OK',
            'button.cancel': 'Cancel',
            'button.run': 'Run',
            'button.save': 'Save',
            'button.add': 'Add',
            'button.startService': 'Start Service',
            'button.resetAllDefaults': 'Reset all to defaults',

            // Modals
            'modal.enterLabel': 'Enter Label',
            'modal.chooseColor': 'Choose Color',
            'modal.onnxBatchInfer': 'ONNX Batch Inference',
            'modal.samConfig': 'SAM AI Annotation',
            'modal.exportDataset': 'Export Dataset',

            // Tools menu
            'tools.exportSvg': 'Export SVG',
            'tools.exportDataset': 'Export Dataset',
            'tools.onnxBatchInfer': 'ONNX Batch Infer',

            // Context menu
            'context.edit': 'Edit',
            'context.rename': 'Rename',
            'context.renameCount': 'Rename ({count})',
            'context.merge': 'Merge',
            'context.mergeCount': 'Merge ({count})',
            'context.hide': 'Hide',
            'context.show': 'Show',
            'context.hideCount': 'Hide ({count})',
            'context.showCount': 'Show ({count})',
            'context.delete': 'Delete',
            'context.deleteCount': 'Delete ({count})',

            // Status / notifications
            'status.saved': 'Saved',
            'status.savedTo': 'Annotation saved to {file}',
            'status.refreshed': 'Refreshed: Found {count} images',
            'status.mergeNoOverlap': 'No overlapping shapes to merge',
            'status.mergePolyRectOnly': 'Merge supports polygon/rectangle only',
            'status.mergeUnavailable': 'Polygon clipping unavailable',
            'status.mergeNoGeometry': 'Merge produced no valid geometry',
            'status.circleTooSmall': 'Circle too small',
            'status.exportPickDir': 'Pick an output directory first',
            'status.exportNeedClass': 'Add at least one class',
            'status.exportClassDuplicate': 'Class "{name}" already in list',

            // Format radios
            'format.coco': 'COCO',
            'format.yoloBbox': 'YOLO bbox',
            'format.yoloSeg': 'YOLO seg',
            'scope.all': 'All Images',
            'scope.current': 'Current Image',

            // Image counts in export modal
            'export.imageCount': 'Images',
            'export.annotationCount': 'Annotations'
        },
        'zh-CN': {
            'app.title': '标注编辑器',
            'section.images': '图片',
            'section.labels': '标签',
            'section.instances': '实例',

            'settings.annotationStyle': '标注样式',
            'settings.imageAdjustment': '图像调整',
            'settings.keyboardShortcuts': '键盘快捷键',

            'label.theme': '主题',
            'label.zoom': '缩放',
            'label.brightness': '亮度',
            'label.contrast': '对比度',
            'label.borderWidth': '描边粗细',
            'label.fillOpacity': '填充透明度',
            'label.channel': '通道',
            'label.clahe': 'CLAHE',
            'label.clipLimit': '裁剪阈值',
            'label.language': '语言',
            'label.format': '格式',
            'label.scope': '范围',
            'label.outputDir': '输出目录',
            'label.classes': '类别',
            'label.addClass': '添加类别名',
            'label.device': '设备',
            'label.colorFormat': '颜色格式',
            'label.existingAnnotations': '已有标注',
            'label.modelDir': '模型目录',
            'label.pythonPath': 'Python 解释器',
            'label.port': '端口',
            'label.encodeMode': '编码模式',
            'label.encodeSource': '编码来源',
            'label.customColor': '自定义颜色',
            'label.description': '描述',
            'label.classOrderHint': '顺序即类别索引',

            'button.ok': '确定',
            'button.cancel': '取消',
            'button.run': '运行',
            'button.save': '保存',
            'button.add': '添加',
            'button.startService': '启动服务',
            'button.resetAllDefaults': '全部重置为默认',

            'modal.enterLabel': '输入标签',
            'modal.chooseColor': '选择颜色',
            'modal.onnxBatchInfer': 'ONNX 批量推理',
            'modal.samConfig': 'SAM AI 标注',
            'modal.exportDataset': '导出数据集',

            'tools.exportSvg': '导出 SVG',
            'tools.exportDataset': '导出数据集',
            'tools.onnxBatchInfer': 'ONNX 批量推理',

            'context.edit': '编辑',
            'context.rename': '重命名',
            'context.renameCount': '重命名 ({count})',
            'context.merge': '合并',
            'context.mergeCount': '合并 ({count})',
            'context.hide': '隐藏',
            'context.show': '显示',
            'context.hideCount': '隐藏 ({count})',
            'context.showCount': '显示 ({count})',
            'context.delete': '删除',
            'context.deleteCount': '删除 ({count})',

            'status.saved': '已保存',
            'status.savedTo': '已保存到 {file}',
            'status.refreshed': '已刷新：找到 {count} 张图片',
            'status.mergeNoOverlap': '没有可合并的重叠形状',
            'status.mergePolyRectOnly': '合并仅支持多边形/矩形',
            'status.mergeUnavailable': '多边形裁剪库不可用',
            'status.mergeNoGeometry': '合并未产生有效几何',
            'status.circleTooSmall': '圆形太小',
            'status.exportPickDir': '请先选择输出目录',
            'status.exportNeedClass': '请添加至少一个类别',
            'status.exportClassDuplicate': '类别 "{name}" 已存在',

            'format.coco': 'COCO',
            'format.yoloBbox': 'YOLO bbox',
            'format.yoloSeg': 'YOLO seg',
            'scope.all': '全部图片',
            'scope.current': '当前图片',

            'export.imageCount': '图片数',
            'export.annotationCount': '标注数'
        }
    };

    const KNOWN = Object.keys(DICTS);
    let current = 'en';
    const subscribers = [];

    function t(key, params) {
        const dict = DICTS[current] || DICTS.en;
        let msg = dict[key];
        if (msg === undefined && current !== 'en') msg = DICTS.en[key];
        if (msg === undefined) return key;
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
        for (const fn of subscribers.slice()) {
            try { fn(locale); } catch (e) { /* observers must not break each other */ }
        }
    }

    function getLocale() { return current; }

    function onChange(fn) {
        subscribers.push(fn);
        return function unsubscribe() {
            const i = subscribers.indexOf(fn);
            if (i >= 0) subscribers.splice(i, 1);
        };
    }

    const api = {
        get current() { return current; },
        t, setLocale, getLocale, onChange,
        knownLocales: KNOWN.slice(),
        localeDisplayName: { en: 'English', 'zh-CN': '中文' }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.i18n = api;
})(typeof window !== 'undefined' ? window : null);
