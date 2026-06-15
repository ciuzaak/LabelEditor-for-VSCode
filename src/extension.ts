import * as vscode from 'vscode';
import { LabelMePanel } from './LabelMePanel';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('labeleditor-vscode.openEditor', (uri: vscode.Uri) => {
        LabelMePanel.createOrShow(context, uri);
    });

    let folderDisposable = vscode.commands.registerCommand('labeleditor-vscode.openFromFolder', (uri: vscode.Uri) => {
        LabelMePanel.createOrShowFromFolder(context, uri);
    });

    let yoloDisposable = vscode.commands.registerCommand('labeleditor-vscode.openYoloDataset', (uri: vscode.Uri) => {
        LabelMePanel.createOrShowFromYaml(context, uri);
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(folderDisposable);
    context.subscriptions.push(yoloDisposable);
}

export function deactivate() { }
