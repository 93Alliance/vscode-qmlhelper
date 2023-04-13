import { Disposable } from "vscode";
import * as fs from 'fs';

export function disposeAll(items: Disposable[]): any[] {
    return items.reverse().map((d) => d.dispose());
}

export function exists(path: string): boolean {
    try {
        fs.accessSync(path);
        return true;
    } catch (error) {
        return false;
    }
}