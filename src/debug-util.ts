
import { DebugProtocol } from "@vscode/debugprotocol";


export interface QmlBreakpoint {
    id: number;
    filename: string;
    line: number;
}

export interface QmlDebugSessionAttachArguments extends DebugProtocol.AttachRequestArguments {
    host: string;
    port: number;
    paths: { [key: string]: string };
}

export function convertScopeName(type: number): string {
    switch (type) {
        default:
        case -1:
            return "Qml Context";

        case 0:
            return "Globals";

        case 1:
            return "Arguments";

        case 2:
        case 4:
            return "Locals";
    }
}

export function convertScopeType(type: number): string {
    switch (type) {
        default:
        case 0:
            return "globals";

        case 1:
            return "arguments";

        case 2:
        case 4:
            return "locals";
    }
}