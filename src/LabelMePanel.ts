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
    private _pendingNavigation: number | undefined;
    private _workspaceImages: string[] = [];
    private _workspaceRoot: vscode.Uri | undefined;
    private _filterFolderPath: string | undefined; // Optional folder path to filter images

    private readonly _globalState: vscode.Memento;

    public static createOrShow(context: vscode.ExtensionContext, imageUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (LabelMePanel.currentPanel) {
            LabelMePanel.currentPanel._panel.reveal(column);
            const hadFolderFilter = LabelMePanel.currentPanel._filterFolderPath !== undefined;
            LabelMePanel.currentPanel._filterFolderPath = undefined; // Clear folder filter when opening single image
            LabelMePanel.currentPanel._workspaceImages = []; // Force rescan
            // If we had a folder filter before, rescan workspace and update the image list
            if (hadFolderFilter) {
                LabelMePanel.currentPanel._scanWorkspaceImages().then(() => {
                    LabelMePanel.currentPanel!._sendImageListUpdate();
                });
            }
            LabelMePanel.currentPanel.updateImage(imageUri);
            return;
        }

        // Collect all workspace folders for resource roots
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const localResourceRoots: vscode.Uri[] = [
            vscode.Uri.joinPath(context.extensionUri, 'media'),
            vscode.Uri.file(path.dirname(imageUri.fsPath))
        ];
        workspaceFolders.forEach(folder => {
            localResourceRoots.push(folder.uri);
        });

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            LabelMePanel.viewType,
            'LabelMe',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: localResourceRoots
            }
        );

        LabelMePanel.currentPanel = new LabelMePanel(panel, context.extensionUri, imageUri, context.globalState);
    }

    public static async createOrShowFromFolder(context: vscode.ExtensionContext, folderUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Scan folder for images
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp'];
        const images: string[] = [];

        const scanDirectory = async (dirPath: string): Promise<void> => {
            try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        // Skip hidden directories
                        if (!entry.name.startsWith('.')) {
                            await scanDirectory(fullPath);
                        }
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (imageExtensions.includes(ext)) {
                            images.push(fullPath);
                        }
                    }
                }
            } catch (e) {
                // Ignore directories we can't access
            }
        };

        await scanDirectory(folderUri.fsPath);

        if (images.length === 0) {
            vscode.window.showWarningMessage('No images found in the selected folder.');
            return;
        }

        // Sort images
        images.sort((a, b) => {
            const depthA = (a.match(/[\\/]/g) || []).length;
            const depthB = (b.match(/[\\/]/g) || []).length;
            if (depthA !== depthB) {
                return depthA - depthB;
            }
            return a.localeCompare(b);
        });

        const firstImageUri = vscode.Uri.file(images[0]);

        // If we already have a panel, update it with folder filter
        if (LabelMePanel.currentPanel) {
            LabelMePanel.currentPanel._panel.reveal(column);
            LabelMePanel.currentPanel._filterFolderPath = folderUri.fsPath;
            LabelMePanel.currentPanel._workspaceImages = []; // Force rescan with new filter
            // Rescan first to update _workspaceRoot before sending image update
            await LabelMePanel.currentPanel._scanWorkspaceImages();
            // Now update the image (will use correct _workspaceRoot for relative path)
            LabelMePanel.currentPanel.updateImage(firstImageUri);
            // Send updated image list to webview
            LabelMePanel.currentPanel._sendImageListUpdate();
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

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            LabelMePanel.viewType,
            'LabelMe',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: localResourceRoots
            }
        );

        LabelMePanel.currentPanel = new LabelMePanel(panel, context.extensionUri, firstImageUri, context.globalState, folderUri.fsPath);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, imageUri: vscode.Uri, globalState: vscode.Memento, filterFolderPath?: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._imageUri = imageUri;
        this._globalState = globalState;
        this._filterFolderPath = filterFolderPath;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'save':
                        this.saveAnnotation(message.data);
                        return;
                    case 'dirty':
                        this._isDirty = message.value;
                        return;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'next':
                        this.navigateImage(1);
                        return;
                    case 'prev':
                        this.navigateImage(-1);
                        return;
                    case 'saveGlobalSettings':
                        this._globalState.update(message.key, message.value);
                        return;
                    case 'navigateToImage':
                        this._navigateToImageByPath(message.imagePath);
                        return;
                    case 'refreshImages':
                        this._refreshWorkspaceImages();
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

        if (!this._workspaceRoot || this._workspaceImages.length === 0) {
            return;
        }

        // Get current image relative path
        const currentRelativePath = path.relative(this._workspaceRoot.fsPath, this._imageUri.fsPath);
        const currentIndex = this._workspaceImages.indexOf(currentRelativePath);

        if (currentIndex === -1) return;

        let newIndex = currentIndex + direction;
        if (newIndex < 0) newIndex = this._workspaceImages.length - 1;
        if (newIndex >= this._workspaceImages.length) newIndex = 0;

        const newRelativePath = this._workspaceImages[newIndex];
        const newImageUri = vscode.Uri.file(path.join(this._workspaceRoot.fsPath, newRelativePath));

        this.updateImage(newImageUri);
    }

    private async _navigateToImageByPath(imagePath: string) {
        if (!this._workspaceRoot) {
            return;
        }

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
                // Store the target path and request save
                this._panel.webview.postMessage({ command: 'requestSave' });
                // After save, navigate to the image
                setTimeout(() => {
                    const absolutePath = path.join(this._workspaceRoot!.fsPath, imagePath);
                    this.updateImage(vscode.Uri.file(absolutePath));
                }, 100);
                return;
            }

            this._isDirty = false;
        }

        const absolutePath = path.join(this._workspaceRoot.fsPath, imagePath);
        this.updateImage(vscode.Uri.file(absolutePath));
    }

    private async _scanWorkspaceImages(): Promise<string[]> {
        // Determine the root path for scanning
        let rootPath: string;

        if (this._filterFolderPath) {
            // Use the filter folder as the root
            rootPath = this._filterFolderPath;
            this._workspaceRoot = vscode.Uri.file(this._filterFolderPath);
        } else {
            // Use the workspace root
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return [];
            }
            this._workspaceRoot = workspaceFolders[0].uri;
            rootPath = this._workspaceRoot.fsPath;
        }

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
        // Sort: outer directories first (fewer separators), then by name within same level
        images.sort((a, b) => {
            const depthA = (a.match(/[\\/]/g) || []).length;
            const depthB = (b.match(/[\\/]/g) || []).length;
            if (depthA !== depthB) {
                return depthA - depthB;
            }
            return a.localeCompare(b);
        });
        this._workspaceImages = images;
        return images;
    }

    private _sendImageListUpdate() {
        // Calculate current image relative path
        let currentImageRelativePath = '';
        if (this._workspaceRoot) {
            currentImageRelativePath = path.relative(this._workspaceRoot.fsPath, this._imageUri.fsPath);
        }

        // Send updated image list to webview
        this._panel.webview.postMessage({
            command: 'updateImageList',
            workspaceImages: this._workspaceImages,
            currentImageRelativePath: currentImageRelativePath.replace(/\\/g, '\\\\')
        });
    }

    private async _refreshWorkspaceImages() {
        // Force rescan by clearing cached images
        this._workspaceImages = [];
        await this._scanWorkspaceImages();

        this._sendImageListUpdate();

        vscode.window.showInformationMessage(`Refreshed: Found ${this._workspaceImages.length} images`);
    }

    public async updateImage(imageUri: vscode.Uri) {
        this._imageUri = imageUri;

        // Update localResourceRoots to include the new image directory
        // This ensures images from different folders can be accessed
        const newOptions = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.file(path.dirname(imageUri.fsPath))
            ]
        };

        // Apply the updated options to the webview
        (this._panel.webview as any).options = newOptions;

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
        if (this._workspaceRoot) {
            currentImageRelativePath = path.relative(this._workspaceRoot.fsPath, this._imageUri.fsPath);
        }

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
        if (this._workspaceRoot) {
            currentImageRelativePath = path.relative(this._workspaceRoot.fsPath, this._imageUri.fsPath);
        }

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
                            <button id="refreshImagesBtn" class="refresh-btn" title="Refresh Image List">🔄</button>
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
                            </div>
                        </div>
                    </div>
                    <div id="resizer" class="resizer"></div>
                    <div class="sidebar" id="sidebar">
                        <div class="sidebar-toolbar">
                            <div class="mode-toggle-group">
                                <button id="viewModeBtn" class="mode-btn active" title="View Mode (V)">👁️</button>
                                <button id="polygonModeBtn" class="mode-btn" title="Polygon Mode (P)">⬠</button>
                                <button id="rectangleModeBtn" class="mode-btn" title="Rectangle Mode (R)">▭</button>
                            </div>
                            <div class="sidebar-actions">
                                <button id="advancedOptionsBtn" class="sidebar-icon-btn" title="Advanced Options">⚙️</button>
                                <button id="saveBtn" class="sidebar-icon-btn" title="Save (Ctrl+S)" disabled>💾</button>
                            </div>
                        </div>
                        <div id="advancedOptionsDropdown" class="advanced-options-dropdown" style="display: none;">
                            <div class="theme-control">
                                <label>Theme</label>
                                <div class="theme-toggle-group">
                                    <button id="themeLightBtn" class="theme-btn" title="Light">☀️</button>
                                    <button id="themeDarkBtn" class="theme-btn" title="Dark">🌙</button>
                                    <button id="themeAutoBtn" class="theme-btn" title="Follow VS Code">🔄</button>
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
                        <div class="labels-section">
                            <h3>Labels</h3>
                            <ul id="labelsList"></ul>
                        </div>
                        <h3>Instances</h3>
                        <ul id="shapeList"></ul>
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

        try {
            await fs.writeFile(jsonPath, JSON.stringify(labelMeData, null, 2), 'utf8');
            vscode.window.showInformationMessage('Annotation saved to ' + path.basename(jsonPath));
            this._isDirty = false;

            if (this._pendingNavigation !== undefined) {
                this._performNavigation(this._pendingNavigation);
                this._pendingNavigation = undefined;
            }
        } catch (err) {
            vscode.window.showErrorMessage('Failed to save annotation: ' + (err as Error).message);
        }
    }
}
