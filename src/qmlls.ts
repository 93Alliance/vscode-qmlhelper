import * as vscode from 'vscode';
import * as utils from "./utils";
import * as os from 'os';
import {
    LanguageClient, Executable, ServerOptions, LanguageClientOptions, RevealOutputChannelOn
} from "vscode-languageclient/node"
import { onExtComplete } from './qml-lsp-middleware';

export class QmllsContext implements vscode.Disposable {
    client!: LanguageClient;

    private _dispose: vscode.Disposable[] = [];
    private qmlDocumentSelector;
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.qmlDocumentSelector = [
            { scheme: 'file', language: 'qml' },
        ];
        this.active();
    }

    // 是否是QML文件
    isDocument(document: vscode.TextDocument) {
        return vscode.languages.match(this.qmlDocumentSelector, document);
    }

    dispose() {
        utils.disposeAll(this._dispose);
        this._dispose = []
        if (this.client) this.client.stop();
    }

    private active(): void {
        const config = vscode.workspace.getConfiguration();
        const command = config.get<{ linux?: string, windows?: string, osx?: string }>("qmlhelper.qmlls.command")!;
        const options = config.get<string[]>("qmlhelper.qmlls.args", []);
        let qmlDir = config.get<{ linux: string, windows: string, osx: string }>(
            "qmlhelper.qmlls.buildDir",
            { linux: "", windows: "", osx: "" }
        )!;

        let cmd = "";
        let qmlDirArg = "";

        if (os.platform() === "win32") {
            qmlDirArg = qmlDir.windows;
            if (!command.windows) {
                this.outputChannel.append("not found qmlhelper.qmlls.command.windows");
                return;
            }
            cmd = command.windows;
        } else if (os.platform() === "linux") {
            qmlDirArg = qmlDir.linux;
            if (!command.linux) {
                this.outputChannel.append("not found qmlhelper.qmlls.command.linux");
                return;
            }
            cmd = command.linux;
        } else if (os.platform() === "darwin") {
            qmlDirArg = qmlDir.osx;
            if (!command.osx) {
                this.outputChannel.append("not found qmlhelper.qmlls.command.osx");
                return;
            }
            cmd = command.osx;
        } else {
            this.outputChannel.append(`not supported platform ${os.platform()}`);
            return;
        }

        // 获取工作目录
        const wss = vscode.workspace.workspaceFolders;
        let cwd = undefined;
        if (wss) cwd = wss[0].uri.fsPath;

        if (qmlDirArg !== "") {
            if (qmlDirArg.startsWith(".")) {
                qmlDirArg = cwd + qmlDirArg.slice(1);
            }
            // QMLLS_BUILD_DIRS
            options.push(...["-b", qmlDirArg])
        }

        // options.push(...["-l", "E:/project/tools/vscode-ext/qmlhelper/qmlls.log"]);

        // 运行qmlls的配置
        const qmlls: Executable = {
            command: cmd,
            args: options,
            options: { shell: true }
        };

        const serverOptions: ServerOptions = qmlls;

        // lsp的客户端选项配置
        const clientOptions: LanguageClientOptions = {
            documentSelector: this.qmlDocumentSelector,
            outputChannel: this.outputChannel,
            // 当qmlls返回输出时不要切换到输出窗口。
            // revealOutputChannelOn: RevealOutputChannelOn.Never,
            synchronize: {
                // Notify the server about file changes to '.clientrc files contained in the workspace
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.qml')
            },
            initializationOptions: {
                extendedClientCapabilities: {
                    definitionProvider: true
                }
            },
            middleware: {
                async provideCompletionItem(document, position, context, token, next) {
                    return onExtComplete(document, position, context, token, next);
                },
                async provideDefinition(document, position, token, next) {
                    return await next(document, position, token);
                }
            }
        }

        this.client = new LanguageClient("qmlls", "QML Language Server", serverOptions, clientOptions);
        // 启动，同时也会启动服务端。
        this.client.start().then(() => {
            // this.client.initializeResult?.then((result: any) => {
            //     console.log(result);
            // });
        });

        this.outputChannel.append('Qmlls Language Server is now active!\n');

        
    }
}