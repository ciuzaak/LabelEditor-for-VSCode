import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import { buildYoloTxt } from '../src/yoloDataset';
const { allowSelectByClick, resolveOverlapSelection } = require(path.resolve(__dirname, '../../media/shapeHelpers.js'));

// Execute the shipped webview functions/listeners, with DOM/rendering boundaries
// stubbed. These tests cover event routing and annotation persistence together.
function script(file: string, names: string[] = [], event?: string): string {
    const filename = path.resolve(__dirname, '../../media/editor', file + '.js');
    const text = fs.readFileSync(filename, 'utf8');
    const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    return ast.statements.filter(s => {
        if (ts.isFunctionDeclaration(s)) return !!s.name && names.includes(s.name.text);
        if (!event || !ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) return false;
        const call = s.expression;
        return call.expression.getText(ast).endsWith('.addEventListener') &&
            ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === event;
    }).map(s => s.getText(ast)).join('\n');
}

function categoryContext(format = 'yolo') {
    const requests: any[] = [];
    let confirms = 0;
    let renders = 0;
    let receive: (event: any) => void = () => {};
    const context = vm.createContext({
        shapes: [{ label: 'cat', shape_type: 'rectangle', points: [[10, 10], [90, 90]] }],
        managedLabels: ['cat'], customColors: new Map([['cat', '#ff0000']]),
        labelVisibilityState: new Map([['cat', false]]), recentLabels: ['cat'], activeLabel: 'cat',
        pendingLabelCategoryRename: null, labelCategoryRenameRequestId: 0, currentImageLoadId: 0,
        vscode: { postMessage: (message: any) => requests.push(message) },
        window: { annotationFormat: format, yoloClasses: ['cat'], addEventListener: (_: string, fn: any) => { receive = fn; } },
        labelInput: { value: '', focus() {} }, labelModal: { style: { display: 'none' } },
        saveGlobalSettings() {}, invalidateColorCache() {}, saveState() {}, markDirty() {}, saveHistory() {},
        renderShapeList() {}, renderLabelsList: () => { renders++; }, draw() {},
        confirmLabel: () => { confirms++; }
    });
    vm.runInContext(script('sidebar', ['renameLabelCategory', 'resolveLabelCategoryRename']), context);
    vm.runInContext(script('messages', [], 'message'), context);
    return { context, requests, reply: (message: any) => receive({ data: message }), confirms: () => confirms, renders: () => renders };
}

describe('YOLO category rename', () => {
    it('keeps annotations until class registration succeeds, then saves the new class', () => {
        const { context: c, requests, reply, confirms } = categoryContext();
        const original = buildYoloTxt(c.shapes, 100, 100, c.window.yoloClasses).text;
        c.renameLabelCategory('cat', ' dog ');
        assert.equal(c.shapes[0].label, 'cat');
        assert.equal(c.customColors.has('cat'), true);
        assert.equal(buildYoloTxt(c.shapes, 100, 100, c.window.yoloClasses).text, original);
        assert.equal(requests[0].label, 'dog');
        reply({ command: 'yoloClassAdded', label: 'dog', classes: ['cat', 'dog'], categoryRenameId: requests[0].categoryRenameId });
        assert.equal(c.shapes[0].label, 'dog');
        assert.equal(c.activeLabel, 'dog');
        assert.equal(c.customColors.get('dog'), '#ff0000');
        assert.equal(c.labelVisibilityState.get('dog'), false);
        const saved = buildYoloTxt(c.shapes, 100, 100, c.window.yoloClasses);
        assert.equal(saved.text, '1 0.500000 0.500000 0.800000 0.800000\n');
        assert.deepEqual(saved.warnings, []);
        assert.equal(confirms(), 0);
    });

    it('leaves shapes and category settings unchanged when registration is cancelled', () => {
        const { context: c, requests, reply, confirms } = categoryContext();
        c.renameLabelCategory('cat', 'dog');
        reply({ command: 'yoloAddClassCancelled', label: 'dog', categoryRenameId: requests[0].categoryRenameId });
        assert.equal(c.shapes[0].label, 'cat');
        assert.equal(c.activeLabel, 'cat');
        assert.equal(c.managedLabels[0], 'cat');
        assert.equal(c.pendingLabelCategoryRename, null);
        assert.equal(confirms(), 0);
    });

    it('consumes late replies after navigation without renaming or creating a shape', () => {
        const { context: c, requests, reply, confirms } = categoryContext();
        c.renameLabelCategory('cat', 'dog');
        c.currentImageLoadId++;
        reply({ command: 'yoloClassAdded', label: 'dog', classes: ['cat', 'dog'], categoryRenameId: requests[0].categoryRenameId });
        assert.equal(c.shapes[0].label, 'cat');
        assert.equal(c.shapes.length, 1);
        assert.equal(confirms(), 0);
        assert.equal(c.pendingLabelCategoryRename, null);
    });

    it('ignores an older request while a newer rename is awaiting approval', () => {
        const { context: c, requests, reply } = categoryContext();
        c.renameLabelCategory('cat', 'dog');
        c.renameLabelCategory('cat', 'bird');
        reply({ command: 'yoloClassAdded', label: 'dog', classes: ['cat', 'dog'], categoryRenameId: requests[0].categoryRenameId });
        assert.equal(c.shapes[0].label, 'cat');
        reply({ command: 'yoloClassAdded', label: 'bird', classes: ['cat', 'dog', 'bird'], categoryRenameId: requests[1].categoryRenameId });
        assert.equal(c.shapes[0].label, 'bird');
    });

    it('renames existing YOLO classes and LabelMe categories immediately', () => {
        for (const format of ['yolo', 'labelme']) {
            const { context: c, requests } = categoryContext(format);
            c.window.yoloClasses.push('dog');
            c.renameLabelCategory('cat', format === 'yolo' ? 'dog' : 'unregistered');
            assert.equal(c.shapes[0].label, format === 'yolo' ? 'dog' : 'unregistered');
            assert.equal(requests.length, 0);
        }
    });

    it('still routes ordinary class-registration replies to the shape dialog', () => {
        const { reply, confirms } = categoryContext();
        reply({ command: 'yoloClassAdded', label: 'dog', classes: ['cat', 'dog'] });
        assert.equal(confirms(), 1);
    });

    it('preserves source preferences for other images and existing destination preferences on merge', () => {
        const { context: c } = categoryContext('labelme');
        c.customColors.set('dog', '#00ff00');
        c.labelVisibilityState.set('dog', true);
        c.renameLabelCategory('cat', 'dog');
        assert.equal(c.shapes[0].label, 'dog');
        assert.equal(c.customColors.get('dog'), '#00ff00');
        assert.equal(c.labelVisibilityState.get('dog'), true);
        assert.equal(c.customColors.get('cat'), '#ff0000');
        assert.equal(c.labelVisibilityState.get('cat'), false);
    });
});

function canvasContext(candidates = [0]) {
    const listeners: { event: string; fn: (e: any) => void; capture: boolean }[] = [];
    const context = vm.createContext({
        canvasWrapper: { style: {}, addEventListener: (event: string, fn: any, capture = false) => listeners.push({ event, fn, capture }) },
        canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
        shapes: candidates.map(() => ({ shape_type: 'polygon', points: [[10, 10], [90, 10], [90, 90], [10, 90]] })),
        currentMode: 'view', zoomLevel: 1, shapeContextMenu: null, labelModal: null,
        isDrawing: false, eraserActive: false, eraserMouseDownPos: null,
        currentPoints: [], clampImageCoords: (x: number, y: number) => [x, y],
        selectedShapeIndex: -1, selectedShapeIndices: new Set(), overlapCycleState: { members: [], pos: -1 },
        lastClickX: 0, lastClickY: 0, lastClickTime: 0, drawClickThrough: false,
        CLICK_THRESHOLD_DISTANCE: 5, CLICK_THRESHOLD_TIME: 500,
        isEditingShape: false, shapeBeingEdited: -1, originalEditPoints: null, dragStartPoint: null,
        isDraggingVertex: false, isDraggingWholeShape: false, activeVertexIndex: -1, shiftPressed: false,
        findAllShapesAt: () => candidates, findShapeIndexAt: () => candidates[0], allowSelectByClick,
        resolveOverlapSelection,
        draw() {}, renderShapeList() {}, hideCycleBadge() {}, updateCycleBadge() {}, hideShapeContextMenu() {}
    });
    vm.runInContext(script('selection', ['clearSelection', 'selectShape', 'toggleShapeSelection', 'isShapeSelected']), context);
    context.showShapeContextMenu = (_x: number, _y: number, index: number) => { context.contextMenuTarget = index; };
    vm.runInContext(script('canvas', [], 'mousedown'), context);
    vm.runInContext(script('editMode', ['enterShapeEditMode', 'exitShapeEditMode', 'findVertexAt'], 'mousedown'), context);
    vm.runInContext(script('editMode', [], 'dblclick'), context);
    const dispatch = (event: string, options: any = {}) => {
        let stopped = false;
        const e = { button: 0, clientX: 50, clientY: 50, stopPropagation: () => { stopped = true; }, preventDefault() {}, ...options };
        for (const listener of listeners.filter(l => l.event === event).sort((a, b) => Number(b.capture) - Number(a.capture))) {
            if (!stopped) listener.fn(e);
        }
    };
    return { context, dispatch };
}

describe('canvas edit and modified clicks', () => {
    it('lets Ctrl/Cmd cancel the selection at the shape body and a vertex', () => {
        for (const modifier of ['ctrlKey', 'metaKey']) {
            for (const pos of [50, 10]) {
                const { context: c, dispatch } = canvasContext();
                dispatch('mousedown');
                c.enterShapeEditMode(0);
                assert.equal(c.isEditingShape, true);
                dispatch('mousedown', { [modifier]: true, clientX: pos, clientY: pos });
                assert.equal(c.selectedShapeIndices.size, 0);
                assert.equal(c.isEditingShape, false);
                assert.equal(c.isDraggingWholeShape, false);
                assert.equal(c.isDraggingVertex, false);
                dispatch('dblclick', { [modifier]: true });
                assert.equal(c.isEditingShape, false);
            }
        }
    });

    it('keeps ordinary dragging and Shift erasing available after selecting a shape', () => {
        const { context: c, dispatch } = canvasContext();
        dispatch('mousedown');
        c.enterShapeEditMode(0);
        dispatch('mousedown');
        assert.equal(c.isDraggingWholeShape, true);
        c.currentMode = 'polygon';
        dispatch('mousedown', { shiftKey: true });
        assert.equal(c.isEditingShape, false);
        assert.equal(c.isDraggingWholeShape, false);
        assert.equal(c.eraserMouseDownPos.x, 50);
    });

    it('cycles stacked instances in view mode regardless of click speed and small position changes', () => {
        const { context: c, dispatch } = canvasContext([0, 1]);
        for (const expected of [0, 1, 0, 1]) {
            c.lastClickTime = Date.now() - 1000;
            dispatch('mousedown', { clientX: expected ? 60 : 50 });
            dispatch('dblclick');
            assert.equal(c.selectedShapeIndex, expected);
            assert.equal(c.isEditingShape, false);
            assert.equal(c.isDraggingWholeShape, false);
        }
    });

    it('never enters edit mode from repeated canvas clicks or dblclick in view or drawing tools', () => {
        for (const mode of ['view', 'point', 'line', 'polygon', 'rectangle', 'circle', 'sam']) {
            const { context: c, dispatch } = canvasContext();
            c.currentMode = mode;
            dispatch('mousedown');
            dispatch('mousedown');
            dispatch('dblclick');
            assert.equal(c.selectedShapeIndex, 0);
            assert.equal(c.isEditingShape, false);
        }
        const stacked = canvasContext([0, 1]);
        stacked.context.currentMode = 'polygon';
        stacked.dispatch('mousedown');
        stacked.dispatch('mousedown');
        stacked.dispatch('dblclick');
        assert.equal(stacked.context.selectedShapeIndex, 1);
        assert.equal(stacked.context.isEditingShape, false);
    });

    it('draw-through starts drawing even over an explicitly edited vertex and ignores double-click editing', () => {
        const { context: c, dispatch } = canvasContext();
        c.currentMode = 'polygon';
        c.drawClickThrough = true;
        c.enterShapeEditMode(0);
        dispatch('mousedown', { clientX: 10, clientY: 10 });
        assert.equal(c.isDrawing, true);
        assert.equal(c.isEditingShape, false);
        assert.equal(c.currentPoints.length, 1);
        c.isDrawing = false; // A finish/confirmation must not enable the dblclick fallback.
        c.selectShape(0);
        dispatch('dblclick');
        assert.equal(c.isEditingShape, false);
    });

    it('does not treat the first click after a tool change as a double-click from the previous mode', () => {
        const { context: c, dispatch } = canvasContext();
        dispatch('mousedown');
        c.currentMode = 'polygon';
        c.overlapCycleState = { members: [], pos: -1 }; // setMode invalidates the click cycle.
        dispatch('mousedown');
        assert.equal(c.isEditingShape, false);
        dispatch('mousedown');
        dispatch('dblclick');
        assert.equal(c.isEditingShape, false);
    });

    it('still finishes a line by double-clicking its last point without entering edit mode', () => {
        const { context: c, dispatch } = canvasContext();
        c.currentMode = 'line';
        c.findAllShapesAt = () => [];
        c.window = { annotationFormat: 'labelme' };
        c.activeLabel = null;
        c.skipLabelDialog = false;
        let dialogs = 0;
        c.showLabelModal = () => { dialogs++; };
        vm.runInContext(script('editMode', ['finishPolygon']), c);
        dispatch('mousedown', { clientX: 20, clientY: 20 });
        dispatch('mousedown', { clientX: 80, clientY: 80 });
        dispatch('mousedown', { clientX: 80, clientY: 80 });
        dispatch('dblclick');
        assert.equal(c.isDrawing, false);
        assert.equal(c.currentPoints.length, 2);
        assert.equal(dialogs, 1);
        assert.equal(c.isEditingShape, false);
    });

    it('drags the explicitly edited larger instance instead of selecting an overlapping smaller one', () => {
        const { context: c, dispatch } = canvasContext([0, 1]);
        c.enterShapeEditMode(1);
        dispatch('mousedown');
        assert.equal(c.shapeBeingEdited, 1);
        assert.equal(c.selectedShapeIndex, 1);
        assert.equal(c.isDraggingWholeShape, true);
        c.enterShapeEditMode(0);
        assert.equal(c.isDraggingWholeShape, false);
        assert.equal(c.shapeBeingEdited, 0);
    });

    it('opens the context menu for the selected stacked instance without jumping to the smallest', () => {
        const { context: c, dispatch } = canvasContext([0, 1]);
        dispatch('mousedown');
        dispatch('mousedown');
        assert.equal(c.selectedShapeIndex, 1);
        dispatch('mousedown', { button: 2 });
        assert.equal(c.selectedShapeIndex, 1);
        assert.equal(c.contextMenuTarget, 1);
    });
});

function drawingContext() {
    const { context: c } = categoryContext('labelme');
    Object.assign(c, {
        skipLabelDialog: false, currentMode: 'polygon', isDrawing: true,
        currentPoints: [[20, 20], [80, 20], [50, 80]], isMergePending: false,
        isBatchRenaming: false, editingShapeIndex: -1, selectedShapeIndices: new Set([0]),
        descriptionInput: { value: '' }, renderRecentLabels() {}, cancelShortcutSequence() {}
    });
    c.labelInput.select = () => {};
    vm.runInContext(script('labelModal', ['showLabelModal', 'hideLabelModal', 'confirmLabel', 'cancelLabelInput']), c);
    vm.runInContext(script('editMode', ['finishPolygon']), c);
    return c;
}

describe('explicit default label and optional dialog skipping', () => {
    it('prefills the chosen default while preserving the confirmation and cancel flow', () => {
        const c = drawingContext();
        c.finishPolygon();
        assert.equal(c.labelModal.style.display, 'flex');
        assert.equal(c.labelInput.value, 'cat');
        assert.equal(c.shapes.length, 1);
        c.cancelLabelInput();
        assert.equal(c.isDrawing, true);
        assert.equal(c.shapes.length, 1);
        c.finishPolygon();
        c.labelInput.value = 'dog';
        c.confirmLabel();
        assert.equal(c.shapes[1].label, 'dog');
        assert.equal(c.activeLabel, 'cat');
    });

    it('does not implicitly set a default when creating or renaming an instance', () => {
        const c = drawingContext();
        c.activeLabel = null;
        c.finishPolygon();
        assert.equal(c.labelInput.value, '');
        c.labelInput.value = 'dog';
        c.confirmLabel();
        assert.equal(c.activeLabel, null);
        c.showLabelModal(0);
        c.labelInput.value = 'bird';
        c.confirmLabel();
        assert.equal(c.activeLabel, null);
        assert.equal(c.shapes[0].label, 'bird');
    });

    it('skips confirmation only with both opt-ins, excluding YOLO and SAM', () => {
        const c = drawingContext();
        c.skipLabelDialog = true;
        c.finishPolygon();
        assert.equal(c.shapes.length, 2);
        assert.equal(c.shapes[1].label, 'cat');
        assert.equal(c.labelModal.style.display, 'none');
        for (const config of [{ activeLabel: null }, { format: 'yolo' }, { mode: 'sam' }]) {
            const other = drawingContext();
            other.skipLabelDialog = true;
            if ('activeLabel' in config) other.activeLabel = config.activeLabel;
            if ('format' in config) other.window.annotationFormat = config.format;
            if ('mode' in config) other.currentMode = config.mode;
            other.finishPolygon();
            assert.equal(other.labelModal.style.display, 'flex');
            assert.equal(other.shapes.length, 1);
        }
    });
});

describe('inline category rename', () => {
    it('keeps text when clicking/selecting inside the input and commits on Enter', () => {
        const { context: c, renders } = categoryContext('labelme');
        const input: any = { focus() {}, select() {} };
        const row: any = { querySelector: (selector: string) => selector === '.label-name' ? { textContent: 'cat' } : null, classList: { add() {} }, appendChild() {}, onclick: () => c.renderLabelsList() };
        c.labelsList = { querySelectorAll: () => [row], contains: () => true };
        c.document = { createElement: () => input };
        c.hideLabelContextMenu = () => {};
        c.isImeEnter = (e: any) => e.isComposing || e.keyCode === 229;
        vm.runInContext(script('sidebar', ['startLabelRename']), c);
        c.startLabelRename('cat');
        input.value = 'dog';
        row.onclick({ stopPropagation() {} });
        row.ondblclick({ stopPropagation() {} });
        assert.equal(renders(), 0);
        assert.equal(input.value, 'dog');
        input.onkeydown({ key: 'Enter', isComposing: true, stopPropagation() {} });
        assert.equal(c.shapes[0].label, 'cat');
        input.onkeydown({ key: 'Enter', stopPropagation() {} });
        assert.equal(c.shapes[0].label, 'dog');
    });
});

describe('crosshair color', () => {
    it('matches brightness-before-contrast and refreshes the sample after a CLAHE clip change', () => {
        let reads = 0;
        const c = vm.createContext({
            CROSSHAIR_BUCKET: 16, crosshairColorCache: null, currentImageLoadId: 0,
            img: { width: 1, height: 1 }, brightness: 200, contrast: 200,
            selectedChannel: 'rgb', claheEnabled: true, claheClipLimit: 2,
            ctx: { getImageData: () => { reads++; return { data: [77, 77, 77, 255] }; } }
        });
        vm.runInContext(script('render', ['getCrosshairColor']), c);
        assert.equal(c.getCrosshairColor(0, 0), 'rgba(0, 110, 40, 0.95)');
        c.getCrosshairColor(0, 0);
        assert.equal(reads, 2);
        c.claheClipLimit = 3;
        c.getCrosshairColor(0, 0);
        assert.equal(reads, 4);
    });
});
