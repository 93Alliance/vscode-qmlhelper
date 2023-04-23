import { Disposable, Range, TextDocument, TextEdit, languages, window, workspace } from "vscode";
import * as utils from "./utils";
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as child_process from 'child_process';

export class Qmlformat implements Disposable {
    private _dispose: Disposable[] = [];

    constructor() {
        const formatDisposable = languages.registerDocumentFormattingEditProvider('qml', {
            async provideDocumentFormattingEdits(document: TextDocument): Promise<TextEdit[]> {
                const fileContent = document.getText();
                const filePath = document.fileName;

                return Qmlformat.format(fileContent, filePath).then((formattedContent: string) => {
                    const lastLineId = document.lineCount - 1;
                    const fullRange = new Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
                    return [TextEdit.replace(fullRange, formattedContent)];
                }, (error: any) => {
                    window.showErrorMessage(error);
                    return error;
                });
            }
        });

        this._dispose.push(formatDisposable);
    }

    dispose() {
        utils.disposeAll(this._dispose);
    }

    static async format(fileContent: string, filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const config = workspace.getConfiguration();
            const command = config.get<{ linux?: string, windows?: string, osx?: string }>("qmlhelper.qmlformat.command")!;

            let cmd = "";

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

            const args = config.get<string[]>("qmlhelper.qmlformat.args")!;
            const home = os.homedir();
            const pathObject = path.parse(filePath);
            const fileName = pathObject.base;

            if (!fileContent.trim()) {
                return resolve("");
            }

            const randomString = Math.random().toString(36).substring(2, 10);
            const tempFileDir = path.join(home, ".vscode", "qmlformat");

            const exists = utils.exists(tempFileDir);

            if (!exists) {
                fs.mkdirSync(tempFileDir);
            }

            const tempFilePath = path.join(tempFileDir, `${pathObject.name}-${randomString}-formatting-tmp.qml`);

            fs.access(tempFilePath, fs.constants.F_OK, (err) => {
                if (!err) {
                    return reject(`Formatting of '${fileName}' aborted because file '${tempFilePath}' already exists.`);
                }

                fs.writeFile(tempFilePath, fileContent, { "encoding": "utf8" }, (writeError) => {
                    if (writeError) {
                        return reject(`Formatting of '${fileName}' aborted because file '${tempFilePath}' could not be created: '${writeError.message}'.`);
                    }
                    // We must format the file in-place and not rely on stdout.
                    // For one thing, "\n" outputed by "qmlformat" would be transformed to "\r\n" on Windows, which causes problems with "NewlineType=windows" option.
                    // Secondly, the "execFile" buffer size is limited (~1MB by default), so it's not reliable enough to use it.
                    child_process.execFile(cmd, ["-i", tempFilePath].concat(args), (execError, _execStdout, _execStderr) => {
                        fs.readFile(tempFilePath, { "encoding": "utf8" }, (readError, readData) => {
                            fs.unlink(tempFilePath, (unlinkError) => {
                                // The "execStdout" and "execStderr" are ignored for now (because they should not cause a failure).
                                // It would probably be better to log them somehow.
                                if (execError) {
                                    return reject(`Formatting of '${fileName}' failed\n'${execError.message}\n${_execStderr}'.`);
                                }
                                if (readError) {
                                    return reject(`Formatting of '${fileName}' aborted because file '${tempFilePath}' could not be read: '${readError.message}'.`);
                                }
                                if (unlinkError) {
                                    return reject(`Formatting of '${fileName}' ended with an error because file '${tempFilePath}' could not be deleted: '${unlinkError.message}'.`);
                                }
                                resolve(readData);
                            });
                        });
                    });
                });
            });
        });
    }
}