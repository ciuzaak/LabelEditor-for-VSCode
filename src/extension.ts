import * as vscode from 'vscode';
import { LabelMePanel } from './LabelMePanel';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('labeleditor-vscode.openEditor', (uri: vscode.Uri) => {
        LabelMePanel.createOrShow(context, uri);
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }
