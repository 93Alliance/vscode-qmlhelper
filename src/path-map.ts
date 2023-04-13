import * as path from 'path';

export class PathMap {

    static mapPathTo(filename: string): string {
        const parsed = path.parse(path.normalize(filename));

        // JUST WOW - It does not want full path only wants file name...
        /*for (const [ virtualPath, physicalPath ] of this.pathMappings)
        {
            if (parsed.dir.startsWith(physicalPath))
            {
                const relativePath = parsed.dir.slice(physicalPath.length, parsed.dir.length);
                return virtualPath + relativePath + "/" + parsed.base;
            }
        }

        return filename;*/

        return parsed.base;
    }

    static mapPathFrom(filename: string, pathMappings: Map<string, string>): string {
        const parsed = path.parse(path.normalize(filename));
        // windows下路径是反斜杠会导致不匹配
        parsed.dir = parsed.dir.replace(/\\/g, "/");

        for (const [virtualPath, physicalPath] of pathMappings) {
            if (parsed.dir.startsWith(virtualPath)) {
                const relativePath = parsed.dir.slice(virtualPath.length, parsed.dir.length);
                return physicalPath + relativePath + "/" + parsed.base;
            }
        }

        return filename;
    }

    static mapLineNumberTo(lineNumber: number, linesStartFromZero: boolean): number {
        return (linesStartFromZero ? lineNumber : lineNumber - 1);
    }

    static mapLineNumberFrom(lineNumber: number, linesStartFromZero: boolean): number {
        return (linesStartFromZero ? lineNumber : lineNumber + 1);
    }

    static mapColumnTo(column: number, columnsStartFromZero: boolean): number {
        return (columnsStartFromZero ? column : column - 1);
    }

    static mapColumnFrom(column: number, columnsStartFromZero: boolean): number {
        return (columnsStartFromZero ? column : column + 1);
    }

    static mapHandleTo(handle: number): number {
        return handle - 1;
    }

    static mapHandleFrom(handle: number): number {
        return handle + 1;
    }

    // static qmlFile
}