import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class LabelMePanel {
    public static currentPanel: LabelMePanel | undefined;
    public static readonly viewType = 'labelMe';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _imageUri: vscode.Uri;
    private _isDirty = false;
    private _pendingNavigation: number | undefined;

    public static createOrShow(extensionUri: vscode.Uri, imageUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (LabelMePanel.currentPanel) {
            LabelMePanel.currentPanel._panel.reveal(column);
            LabelMePanel.currentPanel.updateImage(imageUri);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            LabelMePanel.viewType,
            'LabelMe',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.file(path.dirname(imageUri.fsPath))
                ]
            }
        );

        LabelMePanel.currentPanel = new LabelMePanel(panel, extensionUri, imageUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, imageUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._imageUri = imageUri;

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
                }
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
        const dirPath = path.dirname(this._imageUri.fsPath);
        const files = await fs.promises.readdir(dirPath);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp'];

        const images = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
        }).sort();

        const currentFileName = path.basename(this._imageUri.fsPath);
        const currentIndex = images.indexOf(currentFileName);

        if (currentIndex === -1) return;

        let newIndex = currentIndex + direction;
        if (newIndex < 0) newIndex = images.length - 1;
        if (newIndex >= images.length) newIndex = 0;

        const newImageName = images[newIndex];
        const newImageUri = vscode.Uri.file(path.join(dirPath, newImageName));

        this.updateImage(newImageUri);
    }

    public updateImage(imageUri: vscode.Uri) {
        this._imageUri = imageUri;
        this._update();
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

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = path.basename(this._imageUri.fsPath);
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        // Local path to css styles
        const stylePathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css');
        const styleUri = webview.asWebviewUri(stylePathOnDisk);

        // Image URI
        const imageUri = webview.asWebviewUri(this._imageUri);

        // Load existing annotation if exists
        let existingData = null;
        const jsonPath = this._imageUri.fsPath.replace(/\.[^/.]+$/, "") + ".json";
        if (fs.existsSync(jsonPath)) {
            try {
                existingData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            } catch (e) {
                console.error("Failed to load existing JSON", e);
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
                    <div class="main-area">
                        <div class="toolbar">
                            <button id="prevImageBtn" class="nav-btn" title="Previous Image (A)">◀</button>
                            <button id="nextImageBtn" class="nav-btn" title="Next Image (D)">▶</button>
                            <span id="fileName" style="margin-right: auto; font-weight: bold;">${path.basename(this._imageUri.fsPath)}</span>
                            <div class="mode-toggle-group">
                                <button id="viewModeBtn" class="mode-btn active" title="View Mode (V)">👁️</button>
                                <button id="polygonModeBtn" class="mode-btn" title="Polygon Mode (P)">⬠</button>
                                <button id="rectangleModeBtn" class="mode-btn" title="Rectangle Mode (R)">▭</button>
                            </div>
                            <button id="saveBtn" disabled>Save (Ctrl+S)</button>
                            <span id="status"></span>
                        </div>
                        <div class="canvas-container">
                            <canvas id="canvas"></canvas>
                        </div>
                    </div>
                    <div id="resizer" class="resizer"></div>
                    <div class="sidebar" id="sidebar">
                        <div class="labels-section">
                            <div class="labels-header-row">
                                <h3>Labels</h3>
                                <button id="advancedOptionsBtn" class="advanced-options-btn" title="Advanced Options">⚙️</button>
                            </div>
                            <div id="advancedOptionsDropdown" class="advanced-options-dropdown" style="display: none;">
                                <div class="slider-control">
                                    <label>Border Width: <span id="borderWidthValue">2</span>px</label>
                                    <input type="range" id="borderWidthSlider" min="1" max="5" value="2" step="0.5">
                                </div>
                                <div class="slider-control">
                                    <label>Fill Opacity: <span id="fillOpacityValue">30</span>%</label>
                                    <input type="range" id="fillOpacitySlider" min="0" max="100" value="30" step="5">
                                </div>
                                <button id="resetAdvancedBtn" class="reset-advanced-btn">Reset</button>
                            </div>
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
                </script>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private saveAnnotation(data: any) {
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

        fs.writeFile(jsonPath, JSON.stringify(labelMeData, null, 2), 'utf8', err => {
            if (err) {
                vscode.window.showErrorMessage('Failed to save annotation: ' + err.message);
            } else {
                vscode.window.showInformationMessage('Annotation saved to ' + path.basename(jsonPath));
                this._isDirty = false;

                if (this._pendingNavigation !== undefined) {
                    this._performNavigation(this._pendingNavigation);
                    this._pendingNavigation = undefined;
                }
            }
        });
    }
}
