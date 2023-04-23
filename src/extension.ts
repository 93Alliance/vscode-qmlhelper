import * as vscode from 'vscode';
import { Log, LogLevel } from "./log";
import { QmlDebugAdapterFactory } from "./debug-adapter";
import { Qmlformat } from './qml-format';
import { Qmllint } from './qml-lint';
import { QmllsContext } from './qmlls';

// https://github.com/seanwu1105/vscode-qt-for-python

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('qmlhelper');

    Log.trace("extension.activate", [context]);
    Log.instance().level = LogLevel.Debug;

    // 设置上下文参数
    vscode.workspace.onDidChangeConfiguration(() => {
        const configuration = vscode.workspace.getConfiguration("qmlhelper");
        vscode.commands.executeCommand("setContext", "qmldebug.filterFunctions", configuration.get<boolean>("debug.filterFunctions", true));
        vscode.commands.executeCommand("setContext", "qmldebug.sortMembers", configuration.get<boolean>("debug.sortMembers", true));
    });

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand("qmlhelper.debug.enableFilterFunctions",
            () => {
                vscode.workspace.getConfiguration("qmlhelper").update("debug.filterFunctions", true);
            }
        ),
        vscode.commands.registerCommand("qmlhelper.debug.disableFilterFunctions",
            () => {
                vscode.workspace.getConfiguration("qmlhelper").update("debug.filterFunctions", false);
            }
        ),
        vscode.commands.registerCommand("qmlhelper.debug.enableSortMembers",
            () => {
                vscode.workspace.getConfiguration("qmlhelper").update("debug.sortMembers", true);
            }
        ),
        vscode.commands.registerCommand("qmlhelper.debug.disableSortMembers",
            () => {
                vscode.workspace.getConfiguration("qmlhelper").update("debug.sortMembers", false);
            }
        ),
        vscode.debug.registerDebugAdapterDescriptorFactory("qml", new QmlDebugAdapterFactory()),
        outputChannel,
        new Qmlformat(),
        // new Qmllint(),
        new QmllsContext(outputChannel)
    );
}

// This method is called when your extension is deactivated
export function deactivate() {
    Log.trace("extension.deactivate", [context]);
}
