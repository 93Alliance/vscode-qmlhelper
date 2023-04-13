import {
    Diagnostic, DiagnosticCollection, DiagnosticSeverity, Disposable, Position,
    Range, TextDocument, languages, window, workspace
} from "vscode";
import * as utils from "./utils";
import * as os from 'os';
import * as child_process from 'child_process';

interface QMLLintResponse {
    files: QMLLintResult[];
    revision: number;
}

interface QMLLintResult {
    filename: string;
    success: boolean;
    warnings: QMLLintWarning[];
}

interface QMLLintWarning {
    charOffset: number;
    column: number;
    length: number;
    line: number;
    message: string;
    type: string; // critical
}

export class Qmllint implements Disposable {
    private _dispose: Disposable[] = [];
    private diagnosticCollection: DiagnosticCollection;

    constructor() {
        // 创建诊断对象
        this.diagnosticCollection = languages.createDiagnosticCollection('qmllint');
        this._dispose.push(this.diagnosticCollection);
        // 监听打开文档时自动执行lint检查
        this._dispose.push(workspace.onDidOpenTextDocument(this.doLint, this));
        // 监听关闭文档时关闭lint
        this._dispose.push(workspace.onDidCloseTextDocument((textDocument) => {
            this.diagnosticCollection.delete(textDocument.uri);
        }, null));
        // 监听保存文档时执行lint检查
        this._dispose.push(workspace.onDidSaveTextDocument(this.doLint, this));
    }

    dispose(): void {
        utils.disposeAll(this._dispose);
    }

    private async doLint(textDocument: TextDocument) {
        // 如果不是qml文件，直接返回
        if (textDocument.languageId !== 'qml') {
            return;
        }

        try {
            const results = await this.lintFile(textDocument.uri.fsPath);
            console.log(results);

            // 只支持单个文件
            if (results.files.length === 0) {
                return;
            }
            const result = results.files[0];
            const diagnostics = this.qmllintResult2Diagnostic(result);
            this.diagnosticCollection.set(textDocument.uri, diagnostics);
        } catch (error: any) {
            window.showErrorMessage(error);
            return
        }
    }

    private async lintFile(filePath: string): Promise<QMLLintResponse> {
        return new Promise((resolve, reject) => {
            const config = workspace.getConfiguration();
            const command = config.get<{ linux?: string, windows?: string, osx?: string }>("qmlhelper.qmllint.command")!;
            let cmd = '';

            if (os.platform() === "win32") {
                if (!command.windows) {
                    return reject("Please configure the path to qmlformat in the settings.");
                }
                cmd = command.windows;
            } else if (os.platform() === "linux") {
                if (!command.linux) {
                    return reject("Please configure the path to qmlformat in the settings.");
                }
                cmd = command.linux;
            } else if (os.platform() === "darwin") {
                if (!command.osx) {
                    return reject("Please configure the path to qmlformat in the settings.");
                }
                cmd = command.osx;
            } else {
                return reject(`not supported platform ${os.platform()}`);
            }

            const args = config.get<string[]>("qmlhelper.qmllint.args") || [];

            const callback = (error: child_process.ExecFileException | null, stdout: string, stderr: string) => {
                if (stdout !== '') {
                    const result = JSON.parse(stdout);
                    if (!result) {
                        return resolve({ files: [], revision: 0 });
                    }
                    return resolve(result);
                } else if (stderr !== '') {
                    const result = JSON.parse(stdout);
                    if (!result) {
                        return resolve({ files: [], revision: 0 });
                    }
                    return resolve(result);
                } else {
                    if (error) {
                        return reject(`${error.message}\n${stderr}`);
                    }
                    return resolve({ files: [], revision: 0 });
                }
            };

            child_process.execFile(
                cmd,
                ["--json", ...args].concat(filePath),
                callback,
            )
        });
    }

    private qmllintResult2Diagnostic(result: QMLLintResult): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        for (const warn of result.warnings) {
            const range = new Range(
                new Position(warn.line - 1, warn.column - 1),
                new Position(warn.line - 1, warn.column - 1 + warn.length),
            );
            const diagnostic = new Diagnostic(
                range,
                warn.message,
                warn.type === 'critical' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            );
            diagnostics.push(diagnostic);
        }
        return diagnostics;
    }
}