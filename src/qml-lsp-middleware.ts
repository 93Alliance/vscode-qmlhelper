import * as vscode from 'vscode';
import { ProvideCompletionItemsSignature } from 'vscode-languageclient/node';

// 从QML内反射出来的自有属性
// id, function, signal, property，console
export async function onExtComplete(document: vscode.TextDocument,  position: vscode.Position, context: vscode.CompletionContext, token: vscode.CancellationToken, next: ProvideCompletionItemsSignature) {
    let list = await next(document, position, context, token);

    if (!list) list = [];

    let items: vscode.CompletionItem[] = [];

    const text = document.getText();
    if (!text) return list;

    const textLine = text.split("\n")[position.line];
    const wordList = textLine.slice(0, position.character).split(" ");

    const word = wordList && wordList[wordList?.length - 1];
    if (!word) return list;

    if (word.includes("console.")) {
        // @ts-ignore
        return [...consoleCompletionItems, ...list];
    }

    if (context.triggerKind === 1 || context.triggerKind === 0) {
        let prop = text
            .split("\n")
            .filter((str: string) => str.match(new RegExp(`${word}`)))
            .filter((str: string) => str !== textLine);

        items = prop.map((str) => {
            const item: vscode.CompletionItem = {} as vscode.CompletionItem;

            if (str.includes("function") || str.includes("signal")) {
                item.kind = vscode.CompletionItemKind.Function;
            } else if (str.includes("property")) {
                item.kind = vscode.CompletionItemKind.Property;
            } else if (str.trim().endsWith("{")) {
                item.kind = vscode.CompletionItemKind.Module;
            } else if (str.includes("id:")) {
                item.kind = vscode.CompletionItemKind.Keyword;
            } else {
                item.kind = vscode.CompletionItemKind.Text;
            }

            let complitionText =
                str.split(" ").find((tx: string) => tx.includes(word!)) || "";
            complitionText =
                (complitionText.match(/[0-9a-zA-Z\_]+/) || [])[0] || complitionText;

            item.detail = complitionText;
            item.label = complitionText;

            return item;
        });
    }

    if (context.triggerKind === 2 || word.includes(".")) {
        const componentId = word.split(".")[0];
        if (componentId === "JSON") {
            let prop = ["stringify", "parse"];
            items = prop.map((str) => {
                const item: vscode.CompletionItem = {} as vscode.CompletionItem;

                item.kind = vscode.CompletionItemKind.Function;

                item.detail = str;
                item.label = str;

                return item;
            });
        } else {
            const match = text.match(new RegExp(`id: ?${componentId}`));
            if (match) {
                let parsedData = text.slice(match.index, text.length);
                const finalData = parsedData.match(/[a-zA-Z]{1,}\s{0,}\{/);
                let lastIndex = parsedData.length;
                if (finalData && finalData.index) lastIndex = finalData.index

                parsedData = parsedData.slice(0, lastIndex);

                const references: string[] = [
                    "function",
                    "property",
                    "signal",
                    "id",
                ];

                let prop = parsedData
                    .split("\n")
                    .filter(
                        (line: string): boolean => references.some((ref) => line.trim().startsWith(ref)) || line.includes(":")
                    )
                    .filter((line: string): boolean => !line.trim().startsWith("id"));

                items = prop.map((str) => {
                    const item: vscode.CompletionItem = {} as vscode.CompletionItem;

                    if (str.includes("function") || str.includes("signal")) {
                        item.kind = vscode.CompletionItemKind.Function;
                    } else {
                        item.kind = vscode.CompletionItemKind.Property;
                    }

                    let complitionText = str
                        .replace(/(property [a-zA-Z0-9]{1,}|function |signal )/, "")
                        .trim()
                        .replace(/:.*|\(.*/, "");
                    complitionText =
                        (complitionText.match(/[0-9a-zA-Z\_]+/) || [])[0] || complitionText;

                    item.detail = complitionText;
                    item.label = complitionText;

                    return item;
                });
            }

        }
    }
    
    return [...items, ...list];
}

const consoleCompletionItems = [
    {
        label: "log",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.log",
        insertText: "log();",
    },
    {
        label: "assert",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.assert",
        insertText: "assert();",
    },
    {
        label: "warn",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.warn",
        insertText: "warn();",
    },
    {
        label: "error",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.error",
        insertText: "error();",
    },
    {
        label: "info",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.info",
        insertText: "info();",
    },
    {
        label: "debug",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.debug",
        insertText: "debug();",
    },
    {
        label: "trace",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.trace",
        insertText: "trace();",
    },
    {
        label: "time",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.time",
        insertText: "time();",
    },
    {
        label: "timeEnd",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.timeEnd",
        insertText: "timeEnd();",
    },
    {
        label: "count",
        kind: vscode.CompletionItemKind.Function,
        documentation: "console.count",
        insertText: "count();",
    },
];