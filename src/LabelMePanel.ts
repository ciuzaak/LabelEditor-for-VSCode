import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import {
    buildLabelMeAnnotation,
    buildSvg,
    getImageMetadata,
    scanWorkspaceImages
} from './labelMeUtils';

export class LabelMePanel {
    public static readonly panels: Set<LabelMePanel> = new Set();
    public static readonly viewType = 'labelMe';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _imageUri: vscode.Uri;
    private _isDirty = false;
    private _isSaving = false;
    private _pendingNavigation: number | undefined;
    private _pendingNavigationPath: string | undefined;
    private _workspaceImages: string[] = [];
    private _rootPath: string; // The single source of truth for the image scanning root
    private _panelTitle: string; // Title set once at creation, never changed during navigation
    private _scanGeneration = 0; // Incremented on each scan start to detect stale results
    private _isScanFinished = false; // Tracks if the initial background scan has completed
    private _disposed = false; // Guards async callbacks from posting to a disposed webview
    private _webviewReady = false; // Set when the webview signals 'webviewReady'
    private _pendingNotifications: Array<{
        level: 'info' | 'success' | 'warn' | 'error';
        text: string;
        key?: string;
        sticky?: boolean;
    }> = [];

    // Tracks SAM-service ports already launched in this extension-host session,
    // so a second panel doesn't try to start a conflicting server on the same port.
    private static readonly _samServicePorts: Set<number> = new Set();

    private readonly _globalState: vscode.Memento;

    // NOTE: Global settings (customColors, recentLabels, etc.) are snapshotted into
    // each panel's webview at HTML creation. When multiple panels are open, a setting
    // changed in one panel is NOT pushed to the others' live webview state — only
    // persisted via _globalState.update. For object-shaped settings this can lose
    // writes if both panels edit the same key. Proper fix requires broadcasting a
    // `globalSettingChanged` message and handling it in the webview; deferred.
    private _safePost(message: any): void {
        if (this._disposed) return;
        // Call the raw webview API directly — do NOT route through _safePost.
        const webview = this._panel.webview;
        webview.postMessage(message);
    }

    /**
     * Send a non-actionable notification to the webview status bus. If the
     * webview has not signalled 'webviewReady' yet, queue the message and
     * flush it on ready. Native VS Code dialogs are reserved for prompts that
     * need a user-button decision (Save / Discard / Cancel).
     */
    private _notify(
        level: 'info' | 'success' | 'warn' | 'error',
        text: string,
        opts?: { key?: string; sticky?: boolean }
    ): void {
        if (!this._webviewReady) {
            if (this._pendingNotifications.length >= 50) {
                // Bound the queue; the oldest entry is the safest to drop.
                this._pendingNotifications.shift();
            }
            this._pendingNotifications.push({ level, text, ...(opts || {}) });
            return;
        }
        this._safePost({ command: 'notify', level, text, ...(opts || {}) });
    }

    private _flushPendingNotifications(): void {
        const queue = this._pendingNotifications;
        this._pendingNotifications = [];
        for (const n of queue) {
            this._safePost({ command: 'notify', ...n });
        }
    }

    /**
     * Open image annotator from a single image.
     * This delegates to createOrShowFromFolder using the workspace root as the folder.
     */
    public static async createOrShow(context: vscode.ExtensionContext, imageUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const imageDir = path.dirname(imageUri.fsPath);
        const rootPath = imageDir;
        const workspaceImages = [path.relative(rootPath, imageUri.fsPath)];

        // If a panel is already showing this exact image, just reveal it
        // instead of opening a duplicate.
        for (const existing of LabelMePanel.panels) {
            if (existing._imageUri.fsPath === imageUri.fsPath) {
                existing._panel.reveal(column);
                return;
            }
        }

        // Collect resource roots
        const localResourceRoots: vscode.Uri[] = [
            vscode.Uri.joinPath(context.extensionUri, 'media'),
            vscode.Uri.file(rootPath)
        ];
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        workspaceFolders.forEach(folder => {
            localResourceRoots.push(folder.uri);
        });

        // Create a new panel with only the single image
        // Title = image filename for single-image mode
        const panelTitle = path.basename(imageUri.fsPath);
        const panel = vscode.window.createWebviewPanel(
            LabelMePanel.viewType,
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: localResourceRoots
            }
        );

        LabelMePanel.panels.add(new LabelMePanel(panel, context.extensionUri, imageUri, context.globalState, rootPath, workspaceImages, panelTitle));
    }

    /**
     * Open image annotator from a folder.
     * @param context Extension context
     * @param folderUri Folder to scan for images
     * @param targetImageUri Optional specific image to navigate to after opening
     */
    public static async createOrShowFromFolder(context: vscode.ExtensionContext, folderUri: vscode.Uri, targetImageUri?: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const rootPath = folderUri.fsPath;

        // Quick-find first image for immediate display.
        // Uses DFS and stops at the first image found — much faster than a full recursive scan.
        // Note: the first found image may differ from the sorted list's first entry,
        // but this is acceptable — user sees a real image immediately while the full
        // sorted list loads asynchronously.
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp'];
        let initialImageUri: vscode.Uri | undefined = targetImageUri;

        if (!initialImageUri) {
            const findFirstImage = async (dirPath: string): Promise<string | undefined> => {
                try {
                    const entries = await fs.readdir(dirPath, { withFileTypes: true });
                    // Sort entries for deterministic ordering
                    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

                    // First pass: check files in current directory
                    for (const entry of entries) {
                        if (entry.isFile()) {
                            const ext = path.extname(entry.name).toLowerCase();
                            if (imageExtensions.includes(ext)) {
                                return path.join(dirPath, entry.name);
                            }
                        }
                    }

                    // Second pass: recurse into subdirectories (DFS with early exit)
                    for (const entry of entries) {
                        if (entry.isDirectory() &&
                            !entry.name.startsWith('.') &&
                            entry.name !== 'node_modules' &&
                            entry.name !== 'out') {
                            const found = await findFirstImage(path.join(dirPath, entry.name));
                            if (found) return found;
                        }
                    }
                } catch (e) {
                    // Ignore inaccessible directories
                }
                return undefined;
            };

            const firstImagePath = await findFirstImage(rootPath);
            if (firstImagePath) {
                initialImageUri = vscode.Uri.file(firstImagePath);
            }
        }

        // If a panel is already open on this exact folder, reveal it
        // (and navigate to the target image if one was supplied) instead
        // of opening a duplicate.
        for (const existing of LabelMePanel.panels) {
            if (existing._rootPath === rootPath) {
                existing._panel.reveal(column);
                if (targetImageUri && existing._imageUri.fsPath !== targetImageUri.fsPath) {
                    await existing.updateImage(targetImageUri);
                }
                return;
            }
        }

        // Collect all workspace folders for resource roots
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const localResourceRoots: vscode.Uri[] = [
            vscode.Uri.joinPath(context.extensionUri, 'media'),
            folderUri
        ];
        workspaceFolders.forEach(folder => {
            localResourceRoots.push(folder.uri);
        });

        // Create a new panel IMMEDIATELY
        // The file list will be sent asynchronously via postMessage after the panel opens
        // Title = folder basename for folder-open mode
        const panelTitle = path.basename(rootPath);
        const panel = vscode.window.createWebviewPanel(
            LabelMePanel.viewType,
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: localResourceRoots
            }
        );

        // If no image found at all, use a dummy URI — _scanAndSendImageList will
        // navigate to the first real image once the full scan completes
        const imageToShow = initialImageUri || vscode.Uri.file(path.join(rootPath, '__no_image__'));
        LabelMePanel.panels.add(new LabelMePanel(panel, context.extensionUri, imageToShow, context.globalState, rootPath, [], panelTitle));
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, imageUri: vscode.Uri, globalState: vscode.Memento, rootPath: string, initialWorkspaceImages?: string[], panelTitle?: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._imageUri = imageUri;
        this._globalState = globalState;
        this._rootPath = rootPath;
        this._panelTitle = panelTitle || path.basename(rootPath);
        if (initialWorkspaceImages) {
            this._workspaceImages = initialWorkspaceImages;
        }

        // Set panel title once — it stays fixed during image navigation
        this._panel.title = this._panelTitle;

        // Set panel icon
        this._panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');

        // Set the webview's initial html content (with empty image list for fast startup)
        this._update();

        // Only trigger async scan for folder mode (empty initial list).
        // Single-image mode (createOrShow) already has the exact list it needs.
        if (!initialWorkspaceImages || initialWorkspaceImages.length === 0) {
            this._scanAndSendImageList();
        } else {
            this._isScanFinished = true; // No scan needed for single-image mode
        }

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Note: retainContextWhenHidden is enabled, so the webview context survives
        // tab switches. No need for onDidChangeViewState to re-send data.

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'save':
                        if (this._isSaving) {
                            // Block concurrent saves — the webview should not send
                            // another save while one is in flight
                            return;
                        }
                        await this.saveAnnotation(message.data);
                        return;
                    case 'dirty':
                        this._isDirty = message.value;
                        return;
                    case 'next':
                        await this.navigateImage(1);
                        return;
                    case 'prev':
                        await this.navigateImage(-1);
                        return;
                    case 'webviewReady':
                        this._webviewReady = true;
                        this._flushPendingNotifications();
                        // The webview's JavaScript is now fully loaded and listening.
                        // Re-send the image list ONLY IF the scan has finished.
                        // This prevents the UI from incorrectly showing "(0)" for large folders
                        // that are still being scanned.
                        if (this._isScanFinished) {
                            this._sendImageListUpdate();
                        }
                        return;
                    case 'saveGlobalSettings':
                        await this._globalState.update(message.key, message.value);
                        return;
                    case 'exportSvg':
                        await this.exportSvg(message.data);
                        return;
                    case 'onnxBatchInfer':
                        await this._runOnnxBatchInfer(message.config);
                        return;
                    case 'browseOnnxModelDir': {
                        const folderUris = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: 'Select Model Directory',
                            defaultUri: message.currentValue ? vscode.Uri.file(message.currentValue) : undefined
                        });
                        if (folderUris && folderUris.length > 0) {
                            this._safePost({
                                command: 'onnxBrowseResult',
                                field: 'modelDir',
                                value: folderUris[0].fsPath
                            });
                        }
                        return;
                    }
                    case 'browseOnnxPythonPath': {
                        const fileUris = await vscode.window.showOpenDialog({
                            canSelectFolders: false,
                            canSelectFiles: true,
                            canSelectMany: false,
                            openLabel: 'Select Python Interpreter',
                            filters: process.platform === 'win32'
                                ? { 'Executable': ['exe'] }
                                : undefined,
                            defaultUri: message.currentValue ? vscode.Uri.file(message.currentValue) : undefined
                        });
                        if (fileUris && fileUris.length > 0) {
                            this._safePost({
                                command: 'onnxBrowseResult',
                                field: 'pythonPath',
                                value: fileUris[0].fsPath
                            });
                        }
                        return;
                    }
                    case 'navigateToImage':
                        await this._navigateToImageByPath(message.imagePath);
                        return;
                    case 'refreshImages':
                        await this._refreshWorkspaceImages();
                        return;
                    case 'navigateAfterSave':
                        // Webview confirmed it is clean after save — now safe to navigate
                        this._executePendingNavigation();
                        return;
                    case 'samStartService':
                        await this._runSamService(message.config);
                        return;
                    case 'detectGpuCount': {
                        // Run nvidia-smi -L to detect GPU list (async to avoid blocking extension host)
                        const { exec } = require('child_process');
                        exec('nvidia-smi -L', { encoding: 'utf-8', timeout: 5000 }, (err: any, stdout: string) => {
                            let gpuList: string[] = [];
                            if (!err && stdout) {
                                gpuList = stdout.trim().split('\n').filter((l: string) => l.startsWith('GPU '));
                            }
                            this._safePost({
                                command: 'gpuDetectResult',
                                gpus: gpuList
                            });
                        });
                        return;
                    }
                    case 'browseSamModelDir': {
                        const samFolderUris = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: 'Select SAM Model Directory',
                            defaultUri: message.currentValue ? vscode.Uri.file(message.currentValue) : undefined
                        });
                        if (samFolderUris && samFolderUris.length > 0) {
                            this._safePost({
                                command: 'samBrowseResult',
                                field: 'modelDir',
                                value: samFolderUris[0].fsPath
                            });
                        }
                        return;
                    }
                    case 'browseSamPythonPath': {
                        const samFileUris = await vscode.window.showOpenDialog({
                            canSelectFolders: false,
                            canSelectFiles: true,
                            canSelectMany: false,
                            openLabel: 'Select Python Interpreter',
                            filters: process.platform === 'win32'
                                ? { 'Executable': ['exe'] }
                                : undefined,
                            defaultUri: message.currentValue ? vscode.Uri.file(message.currentValue) : undefined
                        });
                        if (samFileUris && samFileUris.length > 0) {
                            this._safePost({
                                command: 'samBrowseResult',
                                field: 'pythonPath',
                                value: samFileUris[0].fsPath
                            });
                        }
                        return;
                    }
                }
            },
            null,
            this._disposables
        );

        // Listen for VS Code theme changes and notify webview
        vscode.window.onDidChangeActiveColorTheme(
            theme => {
                this._safePost({
                    command: 'vscodeThemeChanged',
                    themeKind: theme.kind
                });
            },
            null,
            this._disposables
        );
    }

    private async navigateImage(direction: number) {
        if (this._isDirty) {
            const selection = await vscode.window.showWarningMessage(
                'You have unsaved changes. Do you want to save them?',
                'Save',
                'Discard',
                'Cancel'
            );

            if (selection === 'Cancel' || selection === undefined) {
                return;
            }

            if (selection === 'Save') {
                this._pendingNavigation = direction;
                this._safePost({ command: 'requestSave' });
                return;
            }

            this._isDirty = false;
        }

        this._performNavigation(direction);
    }

    private async _performNavigation(direction: number) {
        // Ensure workspace images are scanned
        if (this._workspaceImages.length === 0) {
            await this._scanWorkspaceImages();
        }

        if (this._workspaceImages.length === 0) {
            return;
        }

        // Get current image relative path
        const currentRelativePath = path.relative(this._rootPath, this._imageUri.fsPath);
        const currentIndex = this._workspaceImages.indexOf(currentRelativePath);

        if (currentIndex === -1) return;

        let newIndex = currentIndex + direction;
        if (newIndex < 0) newIndex = this._workspaceImages.length - 1;
        if (newIndex >= this._workspaceImages.length) newIndex = 0;

        const newRelativePath = this._workspaceImages[newIndex];
        const newImageUri = vscode.Uri.file(path.join(this._rootPath, newRelativePath));

        this.updateImage(newImageUri);
    }

    private async _navigateToImageByPath(imagePath: string) {

        // Handle dirty state
        if (this._isDirty) {
            const selection = await vscode.window.showWarningMessage(
                'You have unsaved changes. Do you want to save them?',
                'Save',
                'Discard',
                'Cancel'
            );

            if (selection === 'Cancel' || selection === undefined) {
                return;
            }

            if (selection === 'Save') {
                // Store the target path and request save; navigation will happen after save completes
                this._pendingNavigationPath = imagePath;
                this._safePost({ command: 'requestSave' });
                return;
            }

            this._isDirty = false;
        }

        const absolutePath = path.join(this._rootPath, imagePath);
        this.updateImage(vscode.Uri.file(absolutePath));
    }

    private async _scanWorkspaceImages(): Promise<string[]> {
        const images = await scanWorkspaceImages(this._rootPath);
        this._workspaceImages = images;
        return images;
    }

    private _sendImageListUpdate() {
        // Calculate current image relative path
        let currentImageRelativePath = '';
        currentImageRelativePath = path.relative(this._rootPath, this._imageUri.fsPath);

        // Send updated image list to webview
        this._safePost({
            command: 'updateImageList',
            workspaceImages: this._workspaceImages,
            currentImageRelativePath: currentImageRelativePath,
            isScanFinished: this._isScanFinished
        });
    }

    /**
     * Scan images in the background and send the file list to the webview.
     * This is the core async loading mechanism: the panel opens instantly,
     * and the file list arrives via postMessage once scanning is complete.
     */
    private async _scanAndSendImageList() {
        // Capture the generation at the start of this scan.
        const generation = ++this._scanGeneration;
        const scanRoot = this._rootPath;
        this._isScanFinished = false; // Mark scan as non-finished until complete

        await this._scanWorkspaceImages();

        // Discard results if the user switched folders while we were scanning
        if (generation !== this._scanGeneration || this._rootPath !== scanRoot) {
            return;
        }

        this._isScanFinished = true; // Scan is now complete

        if (this._workspaceImages.length === 0) {
            // Send empty list so the webview updates from "scanning..." to "(0)"
            this._sendImageListUpdate();
            return;
        }

        // If the initial image was a placeholder or not in the scanned list,
        // navigate to the first image
        const currentRel = path.relative(this._rootPath, this._imageUri.fsPath);
        if (!this._workspaceImages.includes(currentRel) && this._workspaceImages.length > 0) {
            const firstImage = vscode.Uri.file(path.join(this._rootPath, this._workspaceImages[0]));
            this._imageUri = firstImage;
            this.updateWebviewOptions();
            await this._sendImageUpdate();
        }

        this._sendImageListUpdate();
    }

    private async _refreshWorkspaceImages() {
        // Invalidate any in-flight scan so its results don't overwrite ours.
        const generation = ++this._scanGeneration;
        const scanRoot = this._rootPath;

        // Force rescan by clearing cached images
        this._workspaceImages = [];
        await this._scanWorkspaceImages();

        // Bail if a newer scan or a root change occurred during the await.
        if (generation !== this._scanGeneration || this._rootPath !== scanRoot) {
            return;
        }

        this._sendImageListUpdate();

        this._notify('success', `Refreshed: Found ${this._workspaceImages.length} images`);
    }

    public updateWebviewOptions() {
        // Update localResourceRoots to include root path and current image directory
        // This ensures images from all subdirectories can be accessed
        const roots: vscode.Uri[] = [
            vscode.Uri.joinPath(this._extensionUri, 'media'),
            vscode.Uri.file(this._rootPath)
        ];
        // Also add current image's directory in case it's outside rootPath
        const imageDir = path.dirname(this._imageUri.fsPath);
        if (!imageDir.startsWith(this._rootPath)) {
            roots.push(vscode.Uri.file(imageDir));
        }

        const newOptions = {
            enableScripts: true,
            localResourceRoots: roots
        };

        // Apply the updated options to the webview
        (this._panel.webview as any).options = newOptions;
    }

    public async updateImage(imageUri: vscode.Uri) {
        this._imageUri = imageUri;
        this.updateWebviewOptions();

        // Title is set once at creation and does NOT change during navigation

        // Send incremental update via postMessage instead of full HTML regeneration
        await this._sendImageUpdate();
    }


    /** Read image file metadata: file size, bit depth, DPI */
    private async _getImageMetadata(filePath: string): Promise<{ fileSize: number; bitDepth?: number; dpiX?: number; dpiY?: number }> {
        return getImageMetadata(filePath);
    }

    private async _sendImageUpdate() {
        if (path.basename(this._imageUri.fsPath) === '__no_image__') {
            this._safePost({
                command: 'updateImage',
                imageUrl: '',
                imageName: '',
                imagePath: '',
                currentImageRelativePath: '',
                shapes: [],
                labels: []
            });
            return; // No real image to send or load JSON for
        }
        const webview = this._panel.webview;

        // Image URI for webview
        const imageUri = webview.asWebviewUri(this._imageUri);

        // Calculate current image relative path
        let currentImageRelativePath = '';
        currentImageRelativePath = path.relative(this._rootPath, this._imageUri.fsPath);

        // Get image file metadata (size, bit depth, DPI)
        const imageMetadata = await this._getImageMetadata(this._imageUri.fsPath);

        // Load existing annotation if exists
        let existingData = null;
        const jsonPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, "") + ".json";
        if (existsSync(jsonPath)) {
            try {
                const jsonContent = await fs.readFile(jsonPath, 'utf8');
                existingData = JSON.parse(jsonContent);
            } catch (e) {
                console.error("Failed to load existing JSON", e);
                this._notify('warn', `Failed to load annotation file: ${(e as Error).message}`);
            }
        }

        // Send update message to webview
        this._safePost({
            command: 'updateImage',
            imageUrl: imageUri.toString(),
            imageName: path.basename(this._imageUri.fsPath),
            imagePath: this._imageUri.fsPath,
            currentImageRelativePath: currentImageRelativePath,
            imageMetadata: imageMetadata,
            existingData: existingData
        });
    }

    public dispose() {
        this._disposed = true;
        this._webviewReady = false;
        this._pendingNotifications = [];
        LabelMePanel.panels.delete(this);
        // Bump scan generation so any in-flight scan discards its results.
        this._scanGeneration++;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _update() {
        const webview = this._panel.webview;
        // Title is set once at creation, not updated on HTML regeneration
        const html = await this._getHtmlForWebview(webview);
        if (this._disposed) return;
        this._panel.webview.html = html;
    }

    private _getIconSprite(): string {
        const SW = 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"';
        return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
            <symbol id="icon-search" viewBox="0 0 24 24" ${SW}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></symbol>
            <symbol id="icon-refresh-cw" viewBox="0 0 24 24" ${SW}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></symbol>
            <symbol id="icon-x" viewBox="0 0 24 24" ${SW}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></symbol>
            <symbol id="icon-panel-left" viewBox="0 0 24 24" ${SW}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></symbol>
            <symbol id="icon-chevron-left" viewBox="0 0 24 24" ${SW}><polyline points="15 18 9 12 15 6"/></symbol>
            <symbol id="icon-chevron-right" viewBox="0 0 24 24" ${SW}><polyline points="9 18 15 12 9 6"/></symbol>
            <symbol id="icon-info" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></symbol>
            <symbol id="icon-eye" viewBox="0 0 24 24" ${SW}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></symbol>
            <symbol id="icon-eye-off" viewBox="0 0 24 24" ${SW}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.51 18.51 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></symbol>
            <symbol id="icon-pentagon" viewBox="0 0 24 24" ${SW}><polygon points="12,2 22,9.5 18,21.5 6,21.5 2,9.5"/></symbol>
            <symbol id="icon-square" viewBox="0 0 24 24" ${SW}><rect x="3" y="3" width="18" height="18" rx="1"/></symbol>
            <symbol id="icon-slash" viewBox="0 0 24 24" ${SW}><line x1="5" y1="19" x2="19" y2="5"/></symbol>
            <symbol id="icon-dot" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="4"/></symbol>
            <symbol id="icon-sparkles" viewBox="0 0 24 24" ${SW}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></symbol>
            <symbol id="icon-settings" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></symbol>
            <symbol id="icon-wrench" viewBox="0 0 24 24" ${SW}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></symbol>
            <symbol id="icon-save" viewBox="0 0 24 24" ${SW}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></symbol>
            <symbol id="icon-sun" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></symbol>
            <symbol id="icon-moon" viewBox="0 0 24 24" ${SW}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></symbol>
            <symbol id="icon-circle-half" viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></symbol>
            <symbol id="icon-lock" viewBox="0 0 24 24" ${SW}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></symbol>
            <symbol id="icon-lock-open" viewBox="0 0 24 24" ${SW}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></symbol>
            <symbol id="icon-folder-open" viewBox="0 0 24 24" ${SW}><path d="M6 14l-2 6h17l2-6H6z"/><path d="M22 13V6a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v14"/></symbol>
            <symbol id="icon-cpu" viewBox="0 0 24 24" ${SW}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></symbol>
            <symbol id="icon-download" viewBox="0 0 24 24" ${SW}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></symbol>
            <symbol id="icon-rotate-ccw" viewBox="0 0 24 24" ${SW}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></symbol>
            <symbol id="icon-check" viewBox="0 0 24 24" ${SW}><polyline points="20 6 9 17 4 12"/></symbol>
        </defs></svg>`;
    }

    private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        // Polygon-clipping library for eraser feature
        const polyClipPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'polygon-clipping.umd.min.js');
        const polyClipUri = webview.asWebviewUri(polyClipPath);

        // SAM prompt helpers (pure functions, must load before main.js)
        const samHelpersPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'samPromptHelpers.js');
        const samHelpersUri = webview.asWebviewUri(samHelpersPath);

        // Merge-shape helpers (pure functions, must load before main.js)
        const mergeHelpersPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'mergeShapesHelpers.js');
        const mergeHelpersUri = webview.asWebviewUri(mergeHelpersPath);

        // Notification bus (pure helpers + DOM wrapper, must load before main.js)
        const notifyHelpersUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'notifyBusHelpers.js')
        );
        const notifyBusUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'notifyBus.js')
        );

        // Rich tooltip (pure helpers + dictionary + DOM wrapper, must load before main.js)
        const tipsDataUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'tipsData.js')
        );
        const tooltipHelpersUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'tooltipHelpers.js')
        );
        const tooltipUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'tooltip.js')
        );

        // Popover dismiss helper (pure function, must load before main.js)
        const popoverDismissPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'popoverDismiss.js');
        const popoverDismissUri = webview.asWebviewUri(popoverDismissPath);

        // Read CSS file content and inline it to prevent race condition on Windows
        // where JS executes before CSS finishes loading via external <link>, causing
        // layout chaos (zero container dimensions, unstyled dropdowns visible, etc.)
        const stylePath = path.join(this._extensionUri.fsPath, 'media', 'style.css');
        const cssContent = await fs.readFile(stylePath, 'utf8');

        // Image URI — empty string if no image found yet (async scan will provide the first image)
        const isDummyImage = this._imageUri.fsPath.endsWith('__no_image__');
        const imageUri = isDummyImage ? '' : webview.asWebviewUri(this._imageUri).toString();

        // Always pass empty array - the real file list is sent asynchronously
        // via postMessage (updateImageList) after the panel opens.
        // This ensures the panel opens instantly even with large image sets.
        const workspaceImages: string[] = [];

        // Calculate current image relative path
        let currentImageRelativePath = isDummyImage ? '' : path.relative(this._rootPath, this._imageUri.fsPath);

        // Get image file metadata for info popup
        const imageMetadata = isDummyImage ? null : await this._getImageMetadata(this._imageUri.fsPath);

        // Skip loading annotation for dummy image
        let existingData = null;
        if (!isDummyImage) {
            const jsonPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, "") + ".json";
            if (existsSync(jsonPath)) {
                try {
                    const jsonContent = await fs.readFile(jsonPath, 'utf8');
                    existingData = JSON.parse(jsonContent);
                } catch (e) {
                    console.error("Failed to load existing JSON", e);
                    this._notify('warn', `Failed to load annotation file: ${(e as Error).message}`);
                }
            }
        }

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>${cssContent}</style>
                <title>LabelMe</title>
            </head>
            <body>
                ${this._getIconSprite()}
                <div class="app-container">
                    <div id="imageBrowserSidebar" class="image-browser-sidebar collapsed">
                        <div class="image-browser-header">
                            <h3>Images</h3>
                            <span id="imageCount">(${workspaceImages.length})</span>
                            <button id="searchImagesBtn" class="btn btn-icon header-btn" data-tip-id="browser.search"><svg class="icon" aria-hidden="true"><use href="#icon-search"/></svg></button>
                            <button id="refreshImagesBtn" class="btn btn-icon header-btn" data-tip-id="browser.refresh"><svg class="icon" aria-hidden="true"><use href="#icon-refresh-cw"/></svg></button>
                        </div>
                        <div id="searchInputContainer" class="search-input-container" style="display: none;">
                            <div class="search-field">
                                <svg class="icon icon-sm search-field__icon" aria-hidden="true"><use href="#icon-search"/></svg>
                                <input type="search" id="searchInput" placeholder="Search images…" />
                                <button id="searchCloseBtn" class="search-field__clear" data-tip-id="browser.searchClose" aria-label="Clear search"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                            </div>
                        </div>
                        <ul id="imageBrowserList" class="image-browser-list"></ul>
                    </div>
                    <div id="imageBrowserResizer" class="image-browser-resizer"></div>
                    <div class="main-area">
                        <div class="toolbar">
                            <button id="imageBrowserToggleBtn" class="btn btn-icon nav-btn" data-tip-id="nav.toggleBrowser"><svg class="icon" aria-hidden="true"><use href="#icon-panel-left"/></svg></button>
                            <button id="prevImageBtn" class="btn btn-icon nav-btn" data-tip-id="nav.prev"><svg class="icon" aria-hidden="true"><use href="#icon-chevron-left"/></svg></button>
                            <button id="nextImageBtn" class="btn btn-icon nav-btn" data-tip-id="nav.next"><svg class="icon" aria-hidden="true"><use href="#icon-chevron-right"/></svg></button>
                            <span id="fileName" style="margin-right: auto; font-weight: bold; cursor: pointer;" data-tip-id="nav.fileName">${isDummyImage ? '' : (currentImageRelativePath || path.basename(this._imageUri.fsPath))}</span>
                            <span id="status"></span>
                            <span id="imageInfoBtn" class="image-info-btn" data-tip-id="nav.imageInfo"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-info"/></svg></span>
                            <div id="imageInfoPopup" class="image-info-popup hidden"></div>
                        </div>
                        <div class="canvas-container">
                            <div id="canvasWrapper" class="canvas-wrapper">
                                <canvas id="canvas"></canvas>
                                <svg id="svgOverlay" class="svg-overlay"></svg>
                                <div id="pixelGridOverlay" class="pixel-grid-overlay"></div>
                                <div id="shapeContextMenu" class="shape-context-menu" style="display: none;">
                                    <div class="context-menu-item" id="contextMenuEdit"          data-tip-id="context.edit">Edit</div>
                                    <div class="context-menu-item" id="contextMenuRename"        data-tip-id="context.rename">Rename</div>
                                    <div class="context-menu-item" id="contextMenuMerge"         data-tip-id="context.merge" style="display: none;">Merge</div>
                                    <div class="context-menu-item" id="contextMenuToggleVisible" data-tip-id="context.toggleVisible">Hide</div>
                                    <div class="context-menu-item context-menu-danger" id="contextMenuDelete" data-tip-id="context.delete">Delete</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="resizer" class="resizer"></div>
                    <div class="sidebar" id="sidebar">
                        <div class="sidebar-config-section">
                            <div class="sidebar-toolbar">
                                <div class="mode-toggle-group segmented-group">
                                    <button id="viewModeBtn" class="mode-btn segmented-item active" data-tip-id="mode.view"><svg class="icon" aria-hidden="true"><use href="#icon-eye"/></svg></button>
                                    <button id="polygonModeBtn" class="mode-btn segmented-item" data-tip-id="mode.polygon"><svg class="icon" aria-hidden="true"><use href="#icon-pentagon"/></svg></button>
                                    <button id="rectangleModeBtn" class="mode-btn segmented-item" data-tip-id="mode.rectangle"><svg class="icon" aria-hidden="true"><use href="#icon-square"/></svg></button>
                                    <button id="lineModeBtn" class="mode-btn segmented-item" data-tip-id="mode.line"><svg class="icon" aria-hidden="true"><use href="#icon-slash"/></svg></button>
                                    <button id="pointModeBtn" class="mode-btn segmented-item" data-tip-id="mode.point"><svg class="icon" aria-hidden="true"><use href="#icon-dot"/></svg></button>
                                    <button id="samModeBtn" class="mode-btn segmented-item" data-tip-id="mode.sam"><svg class="icon" aria-hidden="true"><use href="#icon-sparkles"/></svg></button>
                                </div>
                                <div class="sidebar-actions segmented-group">
                                    <button id="settingsMenuBtn" class="sidebar-icon-btn segmented-item" data-tip-id="actions.settings"><svg class="icon" aria-hidden="true"><use href="#icon-settings"/></svg></button>
                                    <button id="toolsMenuBtn" class="sidebar-icon-btn segmented-item" data-tip-id="actions.tools"><svg class="icon" aria-hidden="true"><use href="#icon-wrench"/></svg></button>
                                    <button id="saveBtn" class="sidebar-icon-btn segmented-item" data-tip-id="actions.save" disabled><svg class="icon" aria-hidden="true"><use href="#icon-save"/></svg></button>
                                </div>
                                <div id="settingsMenuDropdown" class="sidebar-dropdown" style="display: none;">
                                    <div class="theme-control">
                                        <label>Theme</label>
                                        <div class="theme-toggle-group segmented-group">
                                            <button id="themeLightBtn" class="theme-btn segmented-item" data-tip-id="theme.light"><svg class="icon" aria-hidden="true"><use href="#icon-sun"/></svg></button>
                                            <button id="themeDarkBtn" class="theme-btn segmented-item" data-tip-id="theme.dark"><svg class="icon" aria-hidden="true"><use href="#icon-moon"/></svg></button>
                                            <button id="themeAutoBtn" class="theme-btn segmented-item" data-tip-id="theme.auto"><svg class="icon" aria-hidden="true"><use href="#icon-circle-half"/></svg></button>
                                        </div>
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Zoom: <span id="zoomPercentage">100%</span> <span id="zoomResetBtn" class="slider-reset-btn" data-tip-id="view.zoomReset"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-rotate-ccw"/></svg></span></label>
                                            <button id="zoomLockBtn" class="btn btn-icon zoom-lock-btn" data-tip-id="view.zoomLock"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock-open"/></svg></button>
                                        </div>
                                    </div>
                                    <div class="settings-group-header">Annotation Style</div>
                                    <div class="slider-control">
                                        <label>Border Width: <span id="borderWidthValue">2</span>px <span id="borderWidthResetBtn" class="slider-reset-btn" data-tip-id="style.borderWidthReset"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-rotate-ccw"/></svg></span></label>
                                        <input type="range" id="borderWidthSlider" min="1" max="5" value="2" step="0.5" data-tip-id="style.borderWidth">
                                    </div>
                                    <div class="slider-control">
                                        <label>Fill Opacity: <span id="fillOpacityValue">30</span>% <span id="fillOpacityResetBtn" class="slider-reset-btn" data-tip-id="style.fillOpacityReset"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-rotate-ccw"/></svg></span></label>
                                        <input type="range" id="fillOpacitySlider" min="0" max="100" value="30" step="5" data-tip-id="style.fillOpacity">
                                    </div>
                                    <div class="settings-group-header">Image Adjustment</div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Channel:</label>
                                            <button id="channelLockBtn" class="btn btn-icon zoom-lock-btn" data-tip-id="channel.lock"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock-open"/></svg></button>
                                        </div>
                                        <div class="onnx-radio-group segmented-group">
                                            <label class="onnx-radio" data-tip-id="channel.rgb"><input type="radio" name="imageChannel" value="rgb" checked /> RGB</label>
                                            <label class="onnx-radio" data-tip-id="channel.r"><input type="radio" name="imageChannel" value="r" /> R</label>
                                            <label class="onnx-radio" data-tip-id="channel.g"><input type="radio" name="imageChannel" value="g" /> G</label>
                                            <label class="onnx-radio" data-tip-id="channel.b"><input type="radio" name="imageChannel" value="b" /> B</label>
                                        </div>
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Brightness: <span id="brightnessValue">100</span>% <span id="brightnessResetBtn" class="slider-reset-btn" data-tip-id="image.brightnessReset"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-rotate-ccw"/></svg></span></label>
                                            <button id="brightnessLockBtn" class="btn btn-icon zoom-lock-btn" data-tip-id="image.brightnessLock"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock-open"/></svg></button>
                                        </div>
                                        <input type="range" id="brightnessSlider" min="10" max="300" value="100" step="5" data-tip-id="image.brightness">
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Contrast: <span id="contrastValue">100</span>% <span id="contrastResetBtn" class="slider-reset-btn" data-tip-id="image.contrastReset"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-rotate-ccw"/></svg></span></label>
                                            <button id="contrastLockBtn" class="btn btn-icon zoom-lock-btn" data-tip-id="image.contrastLock"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock-open"/></svg></button>
                                        </div>
                                        <input type="range" id="contrastSlider" min="10" max="300" value="100" step="5" data-tip-id="image.contrast">
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>CLAHE:</label>
                                            <button id="claheToggleBtn" class="channel-btn" data-tip-id="image.claheToggle">Off</button>
                                            <span id="claheResetBtn" class="slider-reset-btn" data-tip-id="image.claheReset"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-rotate-ccw"/></svg></span>
                                            <button id="claheLockBtn" class="btn btn-icon zoom-lock-btn" data-tip-id="image.claheLock"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-lock-open"/></svg></button>
                                        </div>
                                        <div id="claheControls" style="display: none;">
                                            <div style="font-size: 0.8em; margin-top: 4px;">Clip Limit: <span id="claheClipLimitValue">2.0</span></div>
                                            <input type="range" id="claheClipLimitSlider" min="1" max="10" value="2" step="0.5" data-tip-id="image.claheClipLimit">
                                        </div>
                                    </div>
                                </div>
                                <div id="toolsMenuDropdown" class="sidebar-dropdown" style="display: none;">
                                    <div class="sidebar-dropdown-item" id="exportSvgMenuItem" data-tip-id="tools.exportSvg"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-download"/></svg> Export SVG</div>
                                    <div class="sidebar-dropdown-item" id="onnxBatchInferMenuItem" data-tip-id="tools.onnxBatchInfer"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-cpu"/></svg> ONNX Batch Infer</div>
                                </div>
                            </div>
                        </div>
                        <div class="sidebar-content">
                            <div class="sidebar-labels-section" id="sidebarLabelsSection">
                                <div class="sidebar-section-header">
                                    <h3>Labels</h3>
                                    <span id="labelsCount" class="section-count"></span>
                                </div>
                                <ul id="labelsList"></ul>
                            </div>
                            <div id="sidebarSectionResizer" class="sidebar-section-resizer"></div>
                            <div class="sidebar-instances-section" id="sidebarInstancesSection">
                                <div class="sidebar-section-header">
                                    <h3>Instances</h3>
                                    <span id="instancesCount" class="section-count"></span>
                                </div>
                                <ul id="shapeList"></ul>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Modal for Label Input -->
                <div id="labelModal" class="modal">
                    <div class="modal-content">
                        <button class="modal-close" data-modal-close="labelModal" aria-label="Close"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                        <h3>Enter Label</h3>
                        <input type="text" id="labelInput" placeholder="Enter label name">
                        <textarea id="descriptionInput" placeholder="Add description (optional)" rows="2"></textarea>
                        <div id="recentLabels"></div>
                        <div class="modal-buttons">
                            <button id="modalOkBtn" class="btn btn-primary">OK</button>
                            <button id="modalCancelBtn" class="btn">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Modal for Color Picker -->
                <div id="colorPickerModal" class="modal">
                    <div class="modal-content color-picker-content">
                        <button class="modal-close" data-modal-close="colorPickerModal" aria-label="Close"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                        <h3>Choose Color</h3>
                        <div class="color-palette"></div>
                        <div class="custom-color-input">
                            <label>Custom Color:</label>
                            <input type="text" id="customColorInput" placeholder="#xxxxxx" maxlength="7">
                        </div>
                        <div class="modal-buttons">
                            <button id="colorOkBtn" class="btn btn-primary">OK</button>
                            <button id="colorCancelBtn" class="btn">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Modal for ONNX Batch Inference -->
                <div id="onnxInferModal" class="modal">
                    <div class="modal-content onnx-infer-content">
                        <button class="modal-close" data-modal-close="onnxInferModal" aria-label="Close"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                        <h3><svg class="icon" aria-hidden="true"><use href="#icon-sparkles"/></svg> ONNX Batch Inference</h3>
                        <div class="onnx-note">Output: polygon only</div>
                        <div class="onnx-form-group">
                            <label data-tip-id="onnx.modelDir">Model Directory</label>
                            <div class="onnx-path-input">
                                <input type="text" id="onnxModelDir" placeholder="Path to directory with .onnx and labels.json" />
                                <button id="onnxModelDirBrowse" class="btn btn-icon onnx-browse-btn" data-tip-id="onnx.modelDirBrowse"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-folder-open"/></svg></button>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="onnx.pythonPath">Python Interpreter</label>
                            <div class="onnx-path-input">
                                <input type="text" id="onnxPythonPath" placeholder="python" />
                                <button id="onnxPythonPathBrowse" class="btn btn-icon onnx-browse-btn" data-tip-id="onnx.pythonBrowse"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-folder-open"/></svg></button>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="onnx.device">Device</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="onnxDevice" value="cpu" checked /> CPU</label>
                                <label class="onnx-radio"><input type="radio" name="onnxDevice" value="gpu" /> GPU</label>
                            </div>
                            <div id="onnxGpuIndexGroup" style="display:none; margin-top:6px">
                                <label style="font-size:0.9em" data-tip-id="onnx.gpuIndex">GPU</label>
                                <select id="onnxGpuIndex" style="margin-left:6px; min-width:180px"></select>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="onnx.colorFormat">Color Format</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="onnxColor" value="rgb" checked /> RGB</label>
                                <label class="onnx-radio"><input type="radio" name="onnxColor" value="bgr" /> BGR</label>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="onnx.scope">Scope</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="onnxScope" value="all" checked /> All Images</label>
                                <label class="onnx-radio"><input type="radio" name="onnxScope" value="current" /> Current Image</label>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="onnx.mode">Existing Annotations</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="onnxMode" value="skip" checked /> Skip</label>
                                <label class="onnx-radio"><input type="radio" name="onnxMode" value="merge" /> Merge</label>
                                <label class="onnx-radio"><input type="radio" name="onnxMode" value="overwrite" /> Overwrite</label>
                            </div>
                        </div>
                        <div class="onnx-image-count">Images to process: <strong id="onnxImageCount">0</strong></div>
                        <div class="modal-buttons">
                            <button id="onnxInferOkBtn" class="btn btn-primary">Run</button>
                            <button id="onnxInferCancelBtn" class="btn">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Modal for SAM AI Service Config -->
                <div id="samConfigModal" class="modal">
                    <div class="modal-content onnx-infer-content">
                        <button class="modal-close" data-modal-close="samConfigModal" aria-label="Close"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-x"/></svg></button>
                        <h3><svg class="icon" aria-hidden="true"><use href="#icon-sparkles"/></svg> SAM AI Annotation</h3>
                        <div class="onnx-note">Configure SAM service for interactive annotation</div>
                        <div class="onnx-form-group">
                            <label data-tip-id="sam.modelDir">Model Directory</label>
                            <div class="onnx-path-input">
                                <input type="text" id="samModelDir" placeholder="Path to directory with encoder.onnx and decoder.onnx" />
                                <button id="samModelDirBrowse" class="btn btn-icon onnx-browse-btn" data-tip-id="sam.modelDirBrowse"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-folder-open"/></svg></button>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="sam.pythonPath">Python Interpreter</label>
                            <div class="onnx-path-input">
                                <input type="text" id="samPythonPath" placeholder="python" />
                                <button id="samPythonPathBrowse" class="btn btn-icon onnx-browse-btn" data-tip-id="sam.pythonBrowse"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-folder-open"/></svg></button>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="sam.device">Device</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="samDevice" value="cpu" checked /> CPU</label>
                                <label class="onnx-radio"><input type="radio" name="samDevice" value="gpu" /> GPU</label>
                            </div>
                            <div id="samGpuIndexGroup" style="display:none; margin-top:6px">
                                <label style="font-size:0.9em" data-tip-id="sam.gpuIndex">GPU</label>
                                <select id="samGpuIndex" style="margin-left:6px; min-width:180px"></select>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="sam.encodeMode">Encode Mode</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="samEncodeMode" value="full" checked /> Full Image</label>
                                <label class="onnx-radio"><input type="radio" name="samEncodeMode" value="local" /> Local Crop</label>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="sam.encodeAdjusted">Encode Source</label>
                            <div class="onnx-radio-group segmented-group">
                                <label class="onnx-radio"><input type="radio" name="samEncodeSource" value="original" checked /> Original</label>
                                <label class="onnx-radio"><input type="radio" name="samEncodeSource" value="adjusted" /> Adjusted View</label>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label data-tip-id="sam.port">Port</label>
                            <input type="number" id="samPort" value="8765" min="1024" max="65535" style="width:80px" />
                        </div>
                        <div class="modal-buttons">
                            <button id="samConfigOkBtn" class="btn btn-primary">Start Service</button>
                            <button id="samConfigCancelBtn" class="btn">Cancel</button>
                        </div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const imageUrl = "${imageUri}";
                    const imageName = "${isDummyImage ? '' : path.basename(this._imageUri.fsPath)}";
                    const imagePath = "${isDummyImage ? '' : this._imageUri.fsPath.replace(/\\/g, '\\\\')}";
                    const existingData = ${JSON.stringify(existingData)};
                    const workspaceImages = ${JSON.stringify(workspaceImages)};
                    const currentImageRelativePath = "${currentImageRelativePath.replace(/\\/g, '\\\\')}";
                    const initialImageMetadata = ${JSON.stringify(imageMetadata)};

                    const initialGlobalSettings = {
                        customColors: ${JSON.stringify(this._globalState.get('customColors') || {})},
                        borderWidth: ${this._globalState.get('borderWidth') ?? 2},
                        fillOpacity: ${this._globalState.get('fillOpacity') ?? 0.3},
                        recentLabels: ${JSON.stringify(this._globalState.get('recentLabels') || [])},
                        theme: "${this._globalState.get('theme') ?? 'auto'}",
                        brightness: ${this._globalState.get('brightness') ?? 100},
                        contrast: ${this._globalState.get('contrast') ?? 100},
                        brightnessLocked: ${this._globalState.get('brightnessLocked') ?? false},
                        contrastLocked: ${this._globalState.get('contrastLocked') ?? false},
                        selectedChannel: ${JSON.stringify(this._globalState.get('selectedChannel') ?? 'rgb')},
                        channelLocked: ${this._globalState.get('channelLocked') ?? false},
                        claheEnabled: ${this._globalState.get('claheEnabled') ?? false},
                        claheClipLimit: ${this._globalState.get('claheClipLimit') ?? 2.0},
                        claheLocked: ${this._globalState.get('claheLocked') ?? false},
                        lockViewEnabled: ${this._globalState.get('lockViewEnabled') ?? false},
                        vscodeThemeKind: ${vscode.window.activeColorTheme.kind},
                        onnxModelDir: ${JSON.stringify(this._globalState.get('onnxModelDir') || '')},
                        onnxPythonPath: ${JSON.stringify(this._globalState.get('onnxPythonPath') || '')},
                        onnxDevice: ${JSON.stringify(this._globalState.get('onnxDevice') || 'cpu')},
                        onnxColor: ${JSON.stringify(this._globalState.get('onnxColor') || 'rgb')},
                        onnxScope: ${JSON.stringify(this._globalState.get('onnxScope') || 'all')},
                        onnxMode: ${JSON.stringify(this._globalState.get('onnxMode') || 'skip')},
                        samModelDir: ${JSON.stringify(this._globalState.get('samModelDir') || '')},
                        samPythonPath: ${JSON.stringify(this._globalState.get('samPythonPath') || '')},
                        samDevice: ${JSON.stringify(this._globalState.get('samDevice') || 'cpu')},
                        samPort: ${this._globalState.get('samPort') ?? 8765},
                        samEncodeMode: ${JSON.stringify(this._globalState.get('samEncodeMode') || 'full')},
                        samEncodeAdjusted: ${this._globalState.get('samEncodeAdjusted') ?? false},
                        samGpuIndex: ${this._globalState.get('samGpuIndex') ?? -1},
                        onnxGpuIndex: ${this._globalState.get('onnxGpuIndex') ?? -1}
                    };
                </script>
                <script src="${polyClipUri}"></script>
                <script src="${samHelpersUri}"></script>
                <script src="${mergeHelpersUri}"></script>
                <script src="${notifyHelpersUri}"></script>
                <script src="${notifyBusUri}"></script>
                <script src="${tipsDataUri}"></script>
                <script src="${tooltipHelpersUri}"></script>
                <script src="${tooltipUri}"></script>
                <script src="${popoverDismissUri}"></script>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private async saveAnnotation(data: any) {
        const jsonPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, "") + ".json";

        const labelMeData = buildLabelMeAnnotation(this._imageUri.fsPath, data);

        this._isSaving = true;
        try {
            await fs.writeFile(jsonPath, JSON.stringify(labelMeData, null, 2), 'utf8');
            this._notify('success', 'Annotation saved to ' + path.basename(jsonPath));

            // Notify webview that save completed.
            // The webview will check if the confirmed save matches the current snapshot.
            // If clean, it posts 'navigateAfterSave' so we can safely navigate.
            // If dirty (user edited during save), it stays dirty and does NOT post navigate.
            this._safePost({ command: 'saveComplete' });
        } catch (err) {
            this._notify('error', 'Failed to save annotation: ' + (err as Error).message);
            // Clear pending navigation so a later unrelated save doesn't trigger it
            this._pendingNavigation = undefined;
            this._pendingNavigationPath = undefined;
            // Notify webview that save failed so dirty state is preserved
            this._safePost({ command: 'saveFailed' });
        } finally {
            this._isSaving = false;
        }
    }

    private async exportSvg(data: any) {
        const svgPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, '') + '.svg';

        const svg = buildSvg({
            shapes: data.shapes || [],
            imageWidth: data.imageWidth,
            imageHeight: data.imageHeight
        });

        try {
            await fs.writeFile(svgPath, svg, 'utf8');
            this._notify('success', 'SVG exported to ' + path.basename(svgPath));
        } catch (err) {
            this._notify('error', 'Failed to export SVG: ' + (err as Error).message);
        }
    }

    /**
     * Execute any pending navigation that was deferred during save-and-navigate.
     * Called only when the webview confirms it is clean after a save.
     */
    private _executePendingNavigation() {
        if (this._pendingNavigation !== undefined) {
            this._performNavigation(this._pendingNavigation);
            this._pendingNavigation = undefined;
        }

        if (this._pendingNavigationPath !== undefined) {
            const absolutePath = path.join(this._rootPath, this._pendingNavigationPath);
            this.updateImage(vscode.Uri.file(absolutePath));
            this._pendingNavigationPath = undefined;
        }
    }

    /**
     * Run ONNX batch inference via external Python script in a VS Code terminal.
     */
    private async _runOnnxBatchInfer(config: {
        modelDir: string;
        pythonPath: string;
        device: string;
        colorFormat: string;
        mode: string;
        scope: string;
        gpuIndex?: number;
    }) {
        // Validate model directory
        if (!config.modelDir || !existsSync(config.modelDir)) {
            this._notify('error', 'ONNX Batch Infer: Model directory does not exist.');
            return;
        }

        // Check for .onnx file
        const dirEntries = await fs.readdir(config.modelDir);
        const hasOnnx = dirEntries.some(f => f.endsWith('.onnx'));
        if (!hasOnnx) {
            this._notify('error', 'ONNX Batch Infer: No .onnx file found in model directory.');
            return;
        }

        // Check for labels.json
        if (!existsSync(path.join(config.modelDir, 'labels.json'))) {
            this._notify('error', 'ONNX Batch Infer: labels.json not found in model directory.');
            return;
        }

        // Build image paths list based on scope
        let absoluteImagePaths: string[];
        if (config.scope === 'current') {
            absoluteImagePaths = [this._imageUri.fsPath];
        } else {
            // Ensure workspace images are scanned
            if (this._workspaceImages.length === 0) {
                await this._scanWorkspaceImages();
            }
            if (this._workspaceImages.length === 0) {
                this._notify('warn', 'ONNX Batch Infer: No images found in workspace.');
                return;
            }
            absoluteImagePaths = this._workspaceImages.map(rel => path.join(this._rootPath, rel));
        }

        // Write image list to a temp JSON file.
        // Include pid + random suffix so two panels starting inference
        // simultaneously can't collide on the same filename.
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(
            tmpDir,
            `labeleditor_onnx_images_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
        );
        await fs.writeFile(tmpFile, JSON.stringify(absoluteImagePaths, null, 2), 'utf8');

        // Locate the bundled Python script
        const scriptPath = path.join(this._extensionUri.fsPath, 'scripts', 'onnx_batch_infer.py');
        if (!existsSync(scriptPath)) {
            this._notify('error', 'ONNX Batch Infer: Inference script not found at ' + scriptPath);
            return;
        }

        // Determine Python interpreter
        const pythonPath = config.pythonPath || 'python';

        // Build command
        const args = [
            `"${scriptPath}"`,
            `--model_dir "${config.modelDir}"`,
            `--images_json "${tmpFile}"`,
            `--device ${config.device}`,
            `--color_format ${config.colorFormat}`,
            `--mode ${config.mode}`
        ];

        // PowerShell requires & (call operator) for quoted executable paths;
        // bash/zsh/cmd do not need it.
        const shell = vscode.env.shell.toLowerCase();
        const isPowerShell = shell.includes('powershell') || shell.includes('pwsh');
        const command = isPowerShell
            ? `& "${pythonPath}" ${args.join(' ')}`
            : `"${pythonPath}" ${args.join(' ')}`;

        // Create terminal and run
        const onnxEnv: { [key: string]: string } = {};
        if (config.device === 'gpu' && config.gpuIndex !== undefined && config.gpuIndex >= 0) {
            onnxEnv['CUDA_VISIBLE_DEVICES'] = String(config.gpuIndex);
        }
        const terminal = vscode.window.createTerminal({
            name: 'ONNX Batch Infer',
            hideFromUser: false,
            env: Object.keys(onnxEnv).length > 0 ? onnxEnv : undefined
        });
        terminal.show();
        terminal.sendText(command);

        this._notify('info', `ONNX Batch Infer started: ${absoluteImagePaths.length} images. Check the terminal for progress.`);
    }

    /**
     * Run SAM service via external Python script in a VS Code terminal.
     */
    private async _runSamService(config: {
        modelDir: string;
        pythonPath: string;
        device: string;
        port: number;
        gpuIndex?: number;
    }) {
        // Validate model directory
        if (!config.modelDir || !existsSync(config.modelDir)) {
            this._notify('error', 'SAM Service: Model directory does not exist.');
            return;
        }

        // Check for encoder/decoder ONNX files
        const dirEntries = await fs.readdir(config.modelDir);
        const onnxFiles = dirEntries.filter(f => f.toLowerCase().endsWith('.onnx'));
        if (onnxFiles.length < 2) {
            this._notify('error', 'SAM Service: Need at least 2 ONNX files (encoder + decoder) in model directory.');
            return;
        }

        // Avoid launching a second SAM service on a port we already started one on
        // in this extension-host session (e.g. from another panel).
        if (LabelMePanel._samServicePorts.has(config.port)) {
            this._notify('warn', `SAM Service already running on port ${config.port} from another panel. Reusing it; change the port in settings if you want a separate instance.`);
            return;
        }

        // Locate the bundled Python script
        const scriptPath = path.join(this._extensionUri.fsPath, 'scripts', 'sam_service.py');
        if (!existsSync(scriptPath)) {
            this._notify('error', 'SAM Service: Service script not found at ' + scriptPath);
            return;
        }

        // Determine Python interpreter
        const pythonPath = config.pythonPath || 'python';

        // Build command
        const args = [
            `"${scriptPath}"`,
            `--model_dir "${config.modelDir}"`,
            `--device ${config.device}`,
            `--port ${config.port}`
        ];

        // PowerShell requires & (call operator) for quoted executable paths
        const shell = vscode.env.shell.toLowerCase();
        const isPowerShell = shell.includes('powershell') || shell.includes('pwsh');
        const command = isPowerShell
            ? `& "${pythonPath}" ${args.join(' ')}`
            : `"${pythonPath}" ${args.join(' ')}`;

        // Create terminal and run
        const env: { [key: string]: string } = {};
        if (config.device === 'gpu' && config.gpuIndex !== undefined && config.gpuIndex >= 0) {
            env['CUDA_VISIBLE_DEVICES'] = String(config.gpuIndex);
        }
        const terminal = vscode.window.createTerminal({
            name: 'SAM Service',
            hideFromUser: false,
            env: Object.keys(env).length > 0 ? env : undefined
        });

        // Reserve the port and attach the close listener BEFORE launching so a
        // terminal that exits immediately still releases its port.
        LabelMePanel._samServicePorts.add(config.port);
        const disposeListener = vscode.window.onDidCloseTerminal(closed => {
            if (closed === terminal) {
                LabelMePanel._samServicePorts.delete(config.port);
                disposeListener.dispose();
            }
        });

        terminal.show();
        terminal.sendText(command);

        this._notify('info', `SAM Service starting on port ${config.port}. Check the terminal for status.`);
    }
}
