import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';

export class LabelMePanel {
    public static currentPanel: LabelMePanel | undefined;
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

    private readonly _globalState: vscode.Memento;

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

        // Check if we have an existing panel
        if (LabelMePanel.currentPanel) {
            const panel = LabelMePanel.currentPanel;
            panel._panel.reveal(column);

            // Update to show only the single image
            panel._rootPath = rootPath;
            panel._imageUri = imageUri;
            panel._workspaceImages = workspaceImages;
            // Invalidate any in-flight folder scan so it won't overwrite our single-image list
            panel._scanGeneration++;
            panel._isScanFinished = true; // Mark as scan-complete for single-image mode
            // Update title to image filename for single-image mode
            panel._panelTitle = path.basename(imageUri.fsPath);
            panel._panel.title = panel._panelTitle;
            panel.updateWebviewOptions();
            await panel._update();
            return;
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

        LabelMePanel.currentPanel = new LabelMePanel(panel, context.extensionUri, imageUri, context.globalState, rootPath, workspaceImages, panelTitle);
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

        // Check if we have an existing panel
        if (LabelMePanel.currentPanel) {
            const panel = LabelMePanel.currentPanel;
            panel._panel.reveal(column);

            // Update root path and trigger async scan
            const rootChanged = panel._rootPath !== rootPath;
            panel._rootPath = rootPath;
            // Apply initial image or dummy if no image found
            panel._imageUri = initialImageUri || vscode.Uri.file(path.join(rootPath, '__no_image__'));
            panel._workspaceImages = []; // Clear - will be populated by async scan
            panel._isScanFinished = false; // Reset scan status for new root
            // Update title to folder basename for folder mode
            panel._panelTitle = path.basename(rootPath);
            panel._panel.title = panel._panelTitle;
            panel.updateWebviewOptions();
            
            // Clear sidebar immediately to avoid stale residue while scanning
            panel._sendImageListUpdate();

            if (rootChanged) {
                // Force full HTML regeneration for new root
                await panel._update();
            } else {
                // Send immediate image update
                await panel._sendImageUpdate();
            }

            // Scan in background and send file list
            panel._scanAndSendImageList();
            return;
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
        LabelMePanel.currentPanel = new LabelMePanel(panel, context.extensionUri, imageToShow, context.globalState, rootPath, [], panelTitle);
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
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'next':
                        await this.navigateImage(1);
                        return;
                    case 'prev':
                        await this.navigateImage(-1);
                        return;
                    case 'webviewReady':
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
                            this._panel.webview.postMessage({
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
                            this._panel.webview.postMessage({
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
                            this._panel.webview.postMessage({
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
                            this._panel.webview.postMessage({
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
                            this._panel.webview.postMessage({
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
                this._panel.webview.postMessage({
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
                this._panel.webview.postMessage({ command: 'requestSave' });
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
                this._panel.webview.postMessage({ command: 'requestSave' });
                return;
            }

            this._isDirty = false;
        }

        const absolutePath = path.join(this._rootPath, imagePath);
        this.updateImage(vscode.Uri.file(absolutePath));
    }

    private async _scanWorkspaceImages(): Promise<string[]> {
        const rootPath = this._rootPath;

        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp'];
        const images: string[] = [];

        const scanDirectory = async (dirPath: string): Promise<void> => {
            try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        // Skip hidden directories and common non-image directories
                        if (!entry.name.startsWith('.') &&
                            entry.name !== 'node_modules' &&
                            entry.name !== 'out') {
                            await scanDirectory(fullPath);
                        }
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (imageExtensions.includes(ext)) {
                            // Store relative path
                            const relativePath = path.relative(rootPath, fullPath);
                            images.push(relativePath);
                        }
                    }
                }
            } catch (e) {
                // Ignore directories we can't access
            }
        };

        await scanDirectory(rootPath);
        // Sort images (VS Code style: hierarchical natural sort)
        // Compare path segments individually to ensure folders are also naturally sorted
        images.sort((a, b) => {
            const partsA = a.split(/[\\/]/);
            const partsB = b.split(/[\\/]/);
            const minLen = Math.min(partsA.length, partsB.length);
            for (let i = 0; i < minLen; i++) {
                const cmp = partsA[i].localeCompare(partsB[i], undefined, { numeric: true, sensitivity: 'base' });
                if (cmp !== 0) return cmp;
            }
            return partsA.length - partsB.length;
        });
        this._workspaceImages = images;
        return images;
    }

    private _sendImageListUpdate() {
        // Calculate current image relative path
        let currentImageRelativePath = '';
        currentImageRelativePath = path.relative(this._rootPath, this._imageUri.fsPath);

        // Send updated image list to webview
        this._panel.webview.postMessage({
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
        // Force rescan by clearing cached images
        this._workspaceImages = [];
        await this._scanWorkspaceImages();

        this._sendImageListUpdate();

        vscode.window.showInformationMessage(`Refreshed: Found ${this._workspaceImages.length} images`);
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


    private async _sendImageUpdate() {
        if (path.basename(this._imageUri.fsPath) === '__no_image__') {
            this._panel.webview.postMessage({
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


        // Load existing annotation if exists
        let existingData = null;
        const jsonPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, "") + ".json";
        if (existsSync(jsonPath)) {
            try {
                const jsonContent = await fs.readFile(jsonPath, 'utf8');
                existingData = JSON.parse(jsonContent);
            } catch (e) {
                console.error("Failed to load existing JSON", e);
                vscode.window.showWarningMessage(`Failed to load annotation file: ${(e as Error).message}`);
            }
        }

        // Send update message to webview
        this._panel.webview.postMessage({
            command: 'updateImage',
            imageUrl: imageUri.toString(),
            imageName: path.basename(this._imageUri.fsPath),
            imagePath: this._imageUri.fsPath,
            currentImageRelativePath: currentImageRelativePath,

            existingData: existingData
        });
    }

    public dispose() {
        LabelMePanel.currentPanel = undefined;

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
        this._panel.webview.html = await this._getHtmlForWebview(webview);
    }

    private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        // Polygon-clipping library for eraser feature
        const polyClipPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'polygon-clipping.umd.min.js');
        const polyClipUri = webview.asWebviewUri(polyClipPath);

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
                    vscode.window.showWarningMessage(`Failed to load annotation file: ${(e as Error).message}`);
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
                <div class="app-container">
                    <div id="imageBrowserSidebar" class="image-browser-sidebar collapsed">
                        <div class="image-browser-header">
                            <h3>Images</h3>
                            <span id="imageCount">(${workspaceImages.length})</span>
                            <button id="searchImagesBtn" class="header-btn" title="Search Images">🔍</button>
                            <button id="refreshImagesBtn" class="header-btn" title="Refresh Image List">🔄</button>
                        </div>
                        <div id="searchInputContainer" class="search-input-container" style="display: none;">
                            <input type="text" id="searchInput" placeholder="Search images..." />
                            <button id="searchCloseBtn" class="search-close-btn" title="Close Search">✕</button>
                        </div>
                        <ul id="imageBrowserList" class="image-browser-list"></ul>
                    </div>
                    <div id="imageBrowserResizer" class="image-browser-resizer"></div>
                    <div class="main-area">
                        <div class="toolbar">
                            <button id="imageBrowserToggleBtn" class="nav-btn" title="Toggle Image Browser">☰</button>
                            <button id="prevImageBtn" class="nav-btn" title="Previous Image (A)">◀</button>
                            <button id="nextImageBtn" class="nav-btn" title="Next Image (D)">▶</button>
                            <span id="fileName" style="margin-right: auto; font-weight: bold; cursor: pointer;" title="Left click: copy absolute path | Right click: copy filename">${isDummyImage ? '' : (currentImageRelativePath || path.basename(this._imageUri.fsPath))}</span>
                            <span id="status"></span>
                        </div>
                        <div class="canvas-container">
                            <div id="canvasWrapper" class="canvas-wrapper">
                                <canvas id="canvas"></canvas>
                                <svg id="svgOverlay" class="svg-overlay"></svg>
                                <div id="pixelGridOverlay" class="pixel-grid-overlay"></div>
                                <div id="shapeContextMenu" class="shape-context-menu" style="display: none;">
                                    <div class="context-menu-item" id="contextMenuEdit">Edit</div>
                                    <div class="context-menu-item" id="contextMenuRename">Rename</div>
                                    <div class="context-menu-item" id="contextMenuToggleVisible">Hide</div>
                                    <div class="context-menu-item context-menu-danger" id="contextMenuDelete">Delete</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="resizer" class="resizer"></div>
                    <div class="sidebar" id="sidebar">
                        <div class="sidebar-config-section">
                            <div class="sidebar-toolbar">
                                <div class="mode-toggle-group">
                                    <button id="viewModeBtn" class="mode-btn active" title="View Mode (V)">👁️</button>
                                    <button id="polygonModeBtn" class="mode-btn" title="Polygon Mode (P)">⬠</button>
                                    <button id="rectangleModeBtn" class="mode-btn" title="Rectangle Mode (R)">▭</button>
                                    <button id="lineModeBtn" class="mode-btn" title="Line Mode (L)">⟋</button>
                                    <button id="pointModeBtn" class="mode-btn" title="Point Mode (O)">•</button>
                                    <button id="samModeBtn" class="mode-btn" title="SAM AI Mode (I)">🧠</button>
                                </div>
                                <div class="sidebar-actions">
                                    <button id="settingsMenuBtn" class="sidebar-icon-btn" title="Settings">⚙️</button>
                                    <button id="toolsMenuBtn" class="sidebar-icon-btn" title="Tools">🛠️</button>
                                    <button id="saveBtn" class="sidebar-icon-btn" title="Save (Ctrl+S)" disabled>💾</button>
                                </div>
                                <div id="settingsMenuDropdown" class="sidebar-dropdown" style="display: none;">
                                    <div class="theme-control">
                                        <label>Theme</label>
                                        <div class="theme-toggle-group">
                                            <button id="themeLightBtn" class="theme-btn" title="Light">☀️</button>
                                            <button id="themeDarkBtn" class="theme-btn" title="Dark">🌙</button>
                                            <button id="themeAutoBtn" class="theme-btn" title="Follow VS Code">🔄</button>
                                        </div>
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Zoom: <span id="zoomPercentage">100%</span> <span id="zoomResetBtn" class="slider-reset-btn" title="Reset zoom to fit screen">&#8634;</span></label>
                                            <button id="zoomLockBtn" class="zoom-lock-btn" title="Lock: Keep zoom and position when switching images">🔓</button>
                                        </div>
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Brightness: <span id="brightnessValue">100</span>% <span id="brightnessResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                            <button id="brightnessLockBtn" class="zoom-lock-btn" title="Unlock: Reset on each image. Click to lock.">🔓</button>
                                        </div>
                                        <input type="range" id="brightnessSlider" min="10" max="300" value="100" step="5">
                                    </div>
                                    <div class="zoom-control">
                                        <div class="zoom-header">
                                            <label>Contrast: <span id="contrastValue">100</span>% <span id="contrastResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                            <button id="contrastLockBtn" class="zoom-lock-btn" title="Unlock: Reset on each image. Click to lock.">🔓</button>
                                        </div>
                                        <input type="range" id="contrastSlider" min="10" max="300" value="100" step="5">
                                    </div>
                                    <div class="slider-control">
                                        <label>Border Width: <span id="borderWidthValue">2</span>px <span id="borderWidthResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                        <input type="range" id="borderWidthSlider" min="1" max="5" value="2" step="0.5">
                                    </div>
                                    <div class="slider-control">
                                        <label>Fill Opacity: <span id="fillOpacityValue">30</span>% <span id="fillOpacityResetBtn" class="slider-reset-btn" title="Reset to default">&#8634;</span></label>
                                        <input type="range" id="fillOpacitySlider" min="0" max="100" value="30" step="5">
                                    </div>
                                </div>
                                <div id="toolsMenuDropdown" class="sidebar-dropdown" style="display: none;">
                                    <div class="sidebar-dropdown-item" id="exportSvgMenuItem">📐 Export SVG</div>
                                    <div class="sidebar-dropdown-item" id="onnxBatchInferMenuItem">🤖 ONNX Batch Infer</div>
                                </div>
                            </div>
                        </div>
                        <div class="sidebar-content">
                            <div class="sidebar-labels-section" id="sidebarLabelsSection">
                                <h3>Labels <span id="labelsCount" class="section-count"></span></h3>
                                <ul id="labelsList"></ul>
                            </div>
                            <div id="sidebarSectionResizer" class="sidebar-section-resizer"></div>
                            <div class="sidebar-instances-section" id="sidebarInstancesSection">
                                <h3>Instances <span id="instancesCount" class="section-count"></span></h3>
                                <ul id="shapeList"></ul>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Modal for Label Input -->
                <div id="labelModal" class="modal">
                    <div class="modal-content">
                        <h3>Enter Label</h3>
                        <input type="text" id="labelInput" placeholder="Enter label name">
                        <textarea id="descriptionInput" placeholder="Add description (optional)" rows="2"></textarea>
                        <div id="recentLabels"></div>
                        <div class="modal-buttons">
                            <button id="modalOkBtn">OK</button>
                            <button id="modalCancelBtn">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Modal for Color Picker -->
                <div id="colorPickerModal" class="modal">
                    <div class="modal-content color-picker-content">
                        <h3>Choose Color</h3>
                        <div class="color-palette"></div>
                        <div class="custom-color-input">
                            <label>Custom Color:</label>
                            <input type="text" id="customColorInput" placeholder="#xxxxxx" maxlength="7">
                        </div>
                        <div class="modal-buttons">
                            <button id="colorOkBtn">OK</button>
                            <button id="colorCancelBtn">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Modal for ONNX Batch Inference -->
                <div id="onnxInferModal" class="modal">
                    <div class="modal-content onnx-infer-content">
                        <h3>🤖 ONNX Batch Inference</h3>
                        <div class="onnx-note">Output: polygon only</div>
                        <div class="onnx-form-group">
                            <label>Model Directory <span class="onnx-hint" title='Requires .onnx model file and labels.json in the same directory.&#10;&#10;labels.json format:&#10;[&#10;  { &quot;value&quot;: 1, &quot;name&quot;: &quot;defect_A&quot; },&#10;  { &quot;value&quot;: 2, &quot;name&quot;: &quot;defect_B&quot; }&#10;]&#10;&#10;value: mask pixel value (skip 0 = background)&#10;name: label name for annotation'>ⓘ</span></label>
                            <div class="onnx-path-input">
                                <input type="text" id="onnxModelDir" placeholder="Path to directory with .onnx and labels.json" />
                                <button id="onnxModelDirBrowse" class="onnx-browse-btn" title="Browse">📂</button>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Python Interpreter</label>
                            <div class="onnx-path-input">
                                <input type="text" id="onnxPythonPath" placeholder="python" />
                                <button id="onnxPythonPathBrowse" class="onnx-browse-btn" title="Browse">📂</button>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Device</label>
                            <div class="onnx-radio-group">
                                <label class="onnx-radio"><input type="radio" name="onnxDevice" value="cpu" checked /> CPU</label>
                                <label class="onnx-radio"><input type="radio" name="onnxDevice" value="gpu" /> GPU</label>
                            </div>
                            <div id="onnxGpuIndexGroup" style="display:none; margin-top:6px">
                                <label style="font-size:0.9em">GPU</label>
                                <select id="onnxGpuIndex" style="margin-left:6px; min-width:180px"></select>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Color Format</label>
                            <div class="onnx-radio-group">
                                <label class="onnx-radio"><input type="radio" name="onnxColor" value="rgb" checked /> RGB</label>
                                <label class="onnx-radio"><input type="radio" name="onnxColor" value="bgr" /> BGR</label>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Scope</label>
                            <div class="onnx-radio-group">
                                <label class="onnx-radio"><input type="radio" name="onnxScope" value="all" checked /> All Images</label>
                                <label class="onnx-radio"><input type="radio" name="onnxScope" value="current" /> Current Image</label>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Existing Annotations</label>
                            <div class="onnx-radio-group">
                                <label class="onnx-radio"><input type="radio" name="onnxMode" value="skip" checked /> Skip</label>
                                <label class="onnx-radio"><input type="radio" name="onnxMode" value="merge" /> Merge</label>
                                <label class="onnx-radio"><input type="radio" name="onnxMode" value="overwrite" /> Overwrite</label>
                            </div>
                        </div>
                        <div class="onnx-image-count">Images to process: <strong id="onnxImageCount">0</strong></div>
                        <div class="modal-buttons">
                            <button id="onnxInferOkBtn">Run</button>
                            <button id="onnxInferCancelBtn">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Modal for SAM AI Service Config -->
                <div id="samConfigModal" class="modal">
                    <div class="modal-content onnx-infer-content">
                        <h3>🤖 SAM AI Annotation</h3>
                        <div class="onnx-note">Configure SAM service for interactive annotation</div>
                        <div class="onnx-form-group">
                            <label>Model Directory <span class="onnx-hint" title='Directory containing encoder and decoder ONNX model files.&#10;&#10;Expected files:&#10;- *encoder*.onnx&#10;- *decoder*.onnx&#10;&#10;Supports SAM1 and SAM2 models (auto-detected).'>ⓘ</span></label>
                            <div class="onnx-path-input">
                                <input type="text" id="samModelDir" placeholder="Path to directory with encoder.onnx and decoder.onnx" />
                                <button id="samModelDirBrowse" class="onnx-browse-btn" title="Browse">📂</button>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Python Interpreter</label>
                            <div class="onnx-path-input">
                                <input type="text" id="samPythonPath" placeholder="python" />
                                <button id="samPythonPathBrowse" class="onnx-browse-btn" title="Browse">📂</button>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Device</label>
                            <div class="onnx-radio-group">
                                <label class="onnx-radio"><input type="radio" name="samDevice" value="cpu" checked /> CPU</label>
                                <label class="onnx-radio"><input type="radio" name="samDevice" value="gpu" /> GPU</label>
                            </div>
                            <div id="samGpuIndexGroup" style="display:none; margin-top:6px">
                                <label style="font-size:0.9em">GPU</label>
                                <select id="samGpuIndex" style="margin-left:6px; min-width:180px"></select>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Encode Mode <span class="onnx-hint" title='Full Image: encode the entire image (default, works well for large targets).&#10;&#10;Local Crop: encode only the currently visible viewport region when zoomed in. Better accuracy for small targets in large images. Falls back to full image when not zoomed in.'>ⓘ</span></label>
                            <div class="onnx-radio-group">
                                <label class="onnx-radio"><input type="radio" name="samEncodeMode" value="full" checked /> Full Image</label>
                                <label class="onnx-radio"><input type="radio" name="samEncodeMode" value="local" /> Local Crop</label>
                            </div>
                        </div>
                        <div class="onnx-form-group">
                            <label>Port</label>
                            <input type="number" id="samPort" value="8765" min="1024" max="65535" style="width:80px" />
                        </div>
                        <div class="modal-buttons">
                            <button id="samConfigOkBtn">Start Service</button>
                            <button id="samConfigCancelBtn">Cancel</button>
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
                        samGpuIndex: ${this._globalState.get('samGpuIndex') ?? -1},
                        onnxGpuIndex: ${this._globalState.get('onnxGpuIndex') ?? -1}
                    };
                </script>
                <script src="${polyClipUri}"></script>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private async saveAnnotation(data: any) {
        const jsonPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, "") + ".json";

        // Construct LabelMe JSON format
        const labelMeData = {
            version: "5.0.1",
            flags: {},
            shapes: data.shapes,
            imagePath: path.basename(this._imageUri.fsPath),
            imageData: null, // We don't save image data to keep file size small, LabelMe supports null
            imageHeight: data.imageHeight,
            imageWidth: data.imageWidth
        };

        this._isSaving = true;
        try {
            await fs.writeFile(jsonPath, JSON.stringify(labelMeData, null, 2), 'utf8');
            vscode.window.showInformationMessage('Annotation saved to ' + path.basename(jsonPath));

            // Notify webview that save completed.
            // The webview will check if the confirmed save matches the current snapshot.
            // If clean, it posts 'navigateAfterSave' so we can safely navigate.
            // If dirty (user edited during save), it stays dirty and does NOT post navigate.
            this._panel.webview.postMessage({ command: 'saveComplete' });
        } catch (err) {
            vscode.window.showErrorMessage('Failed to save annotation: ' + (err as Error).message);
            // Clear pending navigation so a later unrelated save doesn't trigger it
            this._pendingNavigation = undefined;
            this._pendingNavigationPath = undefined;
            // Notify webview that save failed so dirty state is preserved
            this._panel.webview.postMessage({ command: 'saveFailed' });
        } finally {
            this._isSaving = false;
        }
    }

    private async exportSvg(data: any) {
        const svgPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, '') + '.svg';

        const shapes: any[] = data.shapes || [];
        const width = data.imageWidth;
        const height = data.imageHeight;
        const insertPoints = 3;

        const pathElements: string[] = [];

        for (let idx = 0; idx < shapes.length; idx++) {
            let points: number[][] = shapes[idx].points;
            const shapeType: string = shapes[idx].shape_type || 'polygon';
            const isClosed = shapeType === 'polygon' || shapeType === 'rectangle';

            // Rectangles are stored as 2 opposite corner points; expand to 4 corners
            if (shapeType === 'rectangle' && points.length === 2) {
                const [p1, p2] = points;
                points = [p1, [p2[0], p1[1]], p2, [p1[0], p2[1]]];
            }

            // Handle point annotations as circles
            if (shapeType === 'point' && points.length >= 1) {
                const px = points[0][0].toFixed(2);
                const py = points[0][1].toFixed(2);
                const pointElement = `  <circle id="point${idx}"
        cx="${px}" cy="${py}" r="5"
        fill="none" stroke="black" stroke-width="1" />`;
                pathElements.push(pointElement);
                continue;
            }

            if (points.length < 2) continue;

            // Insert interpolation points between consecutive vertices
            if (insertPoints > 0) {
                const n = points.length;
                const numSegments = isClosed ? n : n - 1;
                const expanded: number[][] = [];
                for (let i = 0; i < numSegments; i++) {
                    const p1 = points[i];
                    const p2 = isClosed ? points[(i + 1) % n] : points[i + 1];
                    expanded.push(p1);
                    for (let j = 1; j <= insertPoints; j++) {
                        const t = j / (insertPoints + 1);
                        const x = p1[0] + t * (p2[0] - p1[0]);
                        const y = p1[1] + t * (p2[1] - p1[1]);
                        expanded.push([x, y]);
                    }
                }
                if (!isClosed) {
                    expanded.push(points[points.length - 1]);
                }
                points = expanded;
            }

            // Build path data
            let pathData = `M ${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;

            let extendedPoints: number[][];
            let numSegs: number;
            if (isClosed) {
                extendedPoints = [...points, points[0], points[1]];
                numSegs = points.length;
            } else {
                extendedPoints = points;
                numSegs = points.length - 1;
            }

            const lines: string[] = [];
            for (let i = 0; i < numSegs; i++) {
                const prevPt = extendedPoints[i];
                const nextPt = extendedPoints[i + 1];
                const coords = `${prevPt[0].toFixed(2)},${prevPt[1].toFixed(2)} ${nextPt[0].toFixed(2)},${nextPt[1].toFixed(2)} ${nextPt[0].toFixed(2)},${nextPt[1].toFixed(2)}`;
                if (i === 0) {
                    lines.push(`           C ${coords}`);
                } else {
                    lines.push(`             ${coords}`);
                }
            }

            if (isClosed && lines.length > 0) {
                lines[lines.length - 1] = lines[lines.length - 1] + ' Z';
            }

            pathData = pathData + '\n' + lines.join('\n');

            const pathElement = `  <path id="path${idx}"
        fill="none" stroke="black" stroke-width="1"
        d="${pathData}" />`;
            pathElements.push(pathElement);
        }

        const svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:svg="http://www.w3.org/2000/svg"
     version="1.1"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}">
${pathElements.join('\n')}
</svg>`;

        try {
            await fs.writeFile(svgPath, svg, 'utf8');
            vscode.window.showInformationMessage('SVG exported to ' + path.basename(svgPath));
        } catch (err) {
            vscode.window.showErrorMessage('Failed to export SVG: ' + (err as Error).message);
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
            vscode.window.showErrorMessage('ONNX Batch Infer: Model directory does not exist.');
            return;
        }

        // Check for .onnx file
        const dirEntries = await fs.readdir(config.modelDir);
        const hasOnnx = dirEntries.some(f => f.endsWith('.onnx'));
        if (!hasOnnx) {
            vscode.window.showErrorMessage('ONNX Batch Infer: No .onnx file found in model directory.');
            return;
        }

        // Check for labels.json
        if (!existsSync(path.join(config.modelDir, 'labels.json'))) {
            vscode.window.showErrorMessage('ONNX Batch Infer: labels.json not found in model directory.');
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
                vscode.window.showWarningMessage('ONNX Batch Infer: No images found in workspace.');
                return;
            }
            absoluteImagePaths = this._workspaceImages.map(rel => path.join(this._rootPath, rel));
        }

        // Write image list to a temp JSON file
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `labeleditor_onnx_images_${Date.now()}.json`);
        await fs.writeFile(tmpFile, JSON.stringify(absoluteImagePaths, null, 2), 'utf8');

        // Locate the bundled Python script
        const scriptPath = path.join(this._extensionUri.fsPath, 'scripts', 'onnx_batch_infer.py');
        if (!existsSync(scriptPath)) {
            vscode.window.showErrorMessage('ONNX Batch Infer: Inference script not found at ' + scriptPath);
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

        vscode.window.showInformationMessage(
            `ONNX Batch Infer started: ${absoluteImagePaths.length} images. Check the terminal for progress.`
        );
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
            vscode.window.showErrorMessage('SAM Service: Model directory does not exist.');
            return;
        }

        // Check for encoder/decoder ONNX files
        const dirEntries = await fs.readdir(config.modelDir);
        const onnxFiles = dirEntries.filter(f => f.toLowerCase().endsWith('.onnx'));
        if (onnxFiles.length < 2) {
            vscode.window.showErrorMessage('SAM Service: Need at least 2 ONNX files (encoder + decoder) in model directory.');
            return;
        }

        // Locate the bundled Python script
        const scriptPath = path.join(this._extensionUri.fsPath, 'scripts', 'sam_service.py');
        if (!existsSync(scriptPath)) {
            vscode.window.showErrorMessage('SAM Service: Service script not found at ' + scriptPath);
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
        terminal.show();
        terminal.sendText(command);

        vscode.window.showInformationMessage(
            `SAM Service starting on port ${config.port}. Check the terminal for status.`
        );
    }
}
