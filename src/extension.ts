import * as vscode from 'vscode';
import { LabelMePanel } from './LabelMePanel';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('labelme-vscode.openLabelMe', (uri: vscode.Uri) => {
            LabelMePanel.createOrShow(context.extensionUri, uri);
        })
    );
}

export function deactivate() { }
