import * as vscode from 'vscode';
import { LabelMePanel } from './LabelMePanel';
import { killAllPythonRuns } from './pythonProcess';

export function activate(context: vscode.ExtensionContext) {
    // Handlers return the panel's promise so VS Code reports a failed command.
    const disposable = vscode.commands.registerCommand('labeleditor-vscode.openEditor', (uri: vscode.Uri) =>
        LabelMePanel.createOrShow(context, uri)
    );

    const folderDisposable = vscode.commands.registerCommand('labeleditor-vscode.openFromFolder', (uri: vscode.Uri) =>
        LabelMePanel.createOrShowFromFolder(context, uri)
    );

    const yoloDisposable = vscode.commands.registerCommand('labeleditor-vscode.openYoloDataset', (uri: vscode.Uri) =>
        LabelMePanel.createOrShowFromYaml(context, uri)
    );

    context.subscriptions.push(disposable);
    context.subscriptions.push(folderDisposable);
    context.subscriptions.push(yoloDisposable);
}

export function deactivate() {
    // Don't leave SAM services / batch runs orphaned when VS Code shuts down.
    LabelMePanel.stopSamServices();
    killAllPythonRuns();
}
