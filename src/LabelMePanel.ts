import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

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
        const panel = vscode.window.createWebviewPanel(
            LabelMePanel.viewType,
            'LabelMe',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: localResourceRoots
            }
        );

        LabelMePanel.currentPanel = new LabelMePanel(panel, context.extensionUri, imageUri, context.globalState, rootPath, workspaceImages);
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

        // Scan folder for images
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp'];
        const images: string[] = [];
        const rootPath = folderUri.fsPath;

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
                            // Only store absolute paths here for simplicity in sorting, later use relative if needed
                            images.push(fullPath);
                        }
                    }
                }
            } catch (e) {
                // Ignore directories we can't access
            }
        };

        await scanDirectory(rootPath);

        if (images.length === 0) {
            vscode.window.showWarningMessage('No images found in the selected folder.');
            return;
        }

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

        // Determine which image to show: targetImageUri if provided and valid, otherwise first image
        let initialImageUri: vscode.Uri;
        if (targetImageUri && images.includes(targetImageUri.fsPath)) {
            initialImageUri = targetImageUri;
        } else {
            initialImageUri = vscode.Uri.file(images[0]);
        }

        // Check if we have an existing panel
        if (LabelMePanel.currentPanel) {
            const panel = LabelMePanel.currentPanel;
            panel._panel.reveal(column);

            // If the root path has changed, we must force a full re-initialization
            // to ensure state consistency (especially workspaceImages const in HTML)
            if (panel._rootPath !== rootPath) {
                panel._rootPath = rootPath;
                panel._imageUri = initialImageUri;
                panel._workspaceImages = images.map(p => path.relative(rootPath, p)); // Use pre-scanned images


                // Update localResourceRoots to ensure the new image can be loaded
                panel.updateWebviewOptions();

                // Force full HTML regeneration
                await panel._update();
            } else {
                // Same root path - always refresh workspaceImages from the new scan
                // (handles transition from single-image mode to folder mode)
                panel._workspaceImages = images.map(p => path.relative(rootPath, p));
                panel._imageUri = initialImageUri;
                panel.updateWebviewOptions();

                // Send the updated image list and navigate to target image
                panel._sendImageListUpdate();
                await panel._sendImageUpdate();
            }
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

        // Create relative paths for the panel
        const workspaceImages = images.map(p => path.relative(rootPath, p));

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            LabelMePanel.viewType,
            'LabelMe',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: localResourceRoots
            }
        );

        LabelMePanel.currentPanel = new LabelMePanel(panel, context.extensionUri, initialImageUri, context.globalState, rootPath, workspaceImages);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, imageUri: vscode.Uri, globalState: vscode.Memento, rootPath: string, initialWorkspaceImages?: string[]) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._imageUri = imageUri;
        this._globalState = globalState;
        this._rootPath = rootPath;
        if (initialWorkspaceImages) {
            this._workspaceImages = initialWorkspaceImages;
        }

        // Set panel icon
        this._panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');

        // Set the webview's initial html content
        this._update();

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
                    case 'saveGlobalSettings':
                        await this._globalState.update(message.key, message.value);
                        return;
                    case 'exportSvg':
                        await this.exportSvg(message.data);
                        return;
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
            currentImageRelativePath: currentImageRelativePath
        });
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

        // Update panel title
        this._panel.title = path.basename(this._imageUri.fsPath);

        // Send incremental update via postMessage instead of full HTML regeneration
        await this._sendImageUpdate();
    }

    private async _sendImageUpdate() {
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
        this._panel.title = path.basename(this._imageUri.fsPath);
        this._panel.webview.html = await this._getHtmlForWebview(webview);
    }

    private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        // Local path to css styles
        const stylePathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css');
        const styleUri = webview.asWebviewUri(stylePathOnDisk);

        // Image URI
        const imageUri = webview.asWebviewUri(this._imageUri);

        // Use cached workspace images or scan if not available
        if (this._workspaceImages.length === 0) {
            await this._scanWorkspaceImages();
        }
        const workspaceImages = this._workspaceImages;

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

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
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
                            <span id="fileName" style="margin-right: auto; font-weight: bold; cursor: pointer;" title="Click to copy absolute path">${currentImageRelativePath || path.basename(this._imageUri.fsPath)}</span>
                            <span id="status"></span>
                        </div>
                        <div class="canvas-container">
                            <div id="canvasWrapper" class="canvas-wrapper">
                                <canvas id="canvas"></canvas>
                                <svg id="svgOverlay" class="svg-overlay"></svg>
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

                <script>
                    const vscode = acquireVsCodeApi();
                    const imageUrl = "${imageUri}";
                    const imageName = "${path.basename(this._imageUri.fsPath)}";
                    const imagePath = "${this._imageUri.fsPath.replace(/\\/g, '\\\\')}";
                    const existingData = ${JSON.stringify(existingData)};
                    const workspaceImages = ${JSON.stringify(workspaceImages)};
                    const currentImageRelativePath = "${currentImageRelativePath.replace(/\\/g, '\\\\')}";
                    const initialGlobalSettings = {
                        customColors: ${JSON.stringify(this._globalState.get('customColors') || {})},
                        borderWidth: ${this._globalState.get('borderWidth') ?? 2},
                        fillOpacity: ${this._globalState.get('fillOpacity') ?? 0.3},
                        recentLabels: ${JSON.stringify(this._globalState.get('recentLabels') || [])},
                        theme: "${this._globalState.get('theme') ?? 'auto'}",
                        lockViewEnabled: ${this._globalState.get('lockViewEnabled') ?? false},
                        vscodeThemeKind: ${vscode.window.activeColorTheme.kind}
                    };
                </script>
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
}
