import { ServiceDebugMessages } from "./service-debug-messages";
import { ServiceQmlDebugger } from "./service-qml-debugger";
import { ServiceV8Debugger } from "./service-v8-debugger";
import { ServiceDeclarativeDebugClient } from "./service-declarative-debug-client";
import { PacketManager } from "./packet-manager";
import { Log } from "./log";
import { QmlEvent, QmlBreakEventBody, isQmlBreakEvent } from "./qml-messages";
import {
    InitializedEvent, LoggingDebugSession, Response, StoppedEvent, TerminatedEvent, Thread, StackFrame,
    Source, Scope, Variable, InvalidatedEvent
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import * as vscode from "vscode";
import { QmlBreakpoint, QmlDebugSessionAttachArguments, convertScopeName, convertScopeType } from "./debug-util";
import { PathMap } from "./path-map";
import * as path from 'path';

export class QmlDebugSession extends LoggingDebugSession {
    private packetManager_ = new PacketManager(this);
    private qmlDebugger = new ServiceQmlDebugger(this);
    private debugMessages = new ServiceDebugMessages(this);
    private v8debugger = new ServiceV8Debugger(this);
    private declarativeDebugClient = new ServiceDeclarativeDebugClient(this);

    private breaked = false;
    private breakpoints: QmlBreakpoint[] = [];
    private pathMappings = new Map<string, string>([]);
    private linesStartFromZero = false;
    protected columnsStartFromZero = false;
    private filterFunctions = true;
    private sortMembers = true;

    constructor(session: vscode.DebugSession) {
        super();

        this.filterFunctions = vscode.workspace.getConfiguration("qmlhelper").get<boolean>("debug.filterFunctions", true);
        this.sortMembers = vscode.workspace.getConfiguration("qmlhelper").get<boolean>("debug.sortMembers", true);
        vscode.workspace.onDidChangeConfiguration(() => {
            const filterFunctions = vscode.workspace.getConfiguration("qmlhelper").get<boolean>("debug.filterFunctions", true);
            const sortMembers = vscode.workspace.getConfiguration("qmlhelper").get<boolean>("debug.sortMembers", true);
            const invalidate = (this.filterFunctions !== filterFunctions || this.sortMembers !== sortMembers);

            this.filterFunctions = filterFunctions;
            this.sortMembers = sortMembers;

            if (invalidate && this.breaked)
                this.sendEvent(new InvalidatedEvent());
        });

        Log.trace("QmlDebugSession.continueRequest", [session]);
    }

    get packetManager(): PacketManager { return this.packetManager_; }
    get mainQmlThreadId(): number { return 1; }

    /**
     * 初始化调试器请求
     * @param response 
     * @param args 
     * @returns 
     */
    protected async initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): Promise<void> {
        Log.trace("QmlDebugSession.initializeRequest", [response, args]);

        this.linesStartFromZero = !args.linesStartAt1;
        this.columnsStartFromZero = !args.columnsStartAt1;

        response.body = {};
        /*WILL BE IMPLEMENTED*/
        response.body.supportsConfigurationDoneRequest = false;
        response.body.supportsFunctionBreakpoints = false;
        response.body.supportsConditionalBreakpoints = false;
        response.body.supportsHitConditionalBreakpoints = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsEvaluateForHovers = false;
        response.body.exceptionBreakpointFilters = [
            {
                label: "All Exceptions",
                filter: "all",
            }
            // NOT SUPPORTED YET
            /*{
                label: "Uncaught Exceptions",
                filter: "uncaught",
            }*/
        ];
        response.body.supportsStepBack = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsSetVariable = false;
        response.body.supportsRestartFrame = false;
        response.body.supportsGotoTargetsRequest = false;
        response.body.supportsStepInTargetsRequest = false;
        response.body.supportsCompletionsRequest = false;
        response.body.completionTriggerCharacters = [];
        response.body.supportsModulesRequest = false;
        response.body.additionalModuleColumns = [];
        response.body.supportedChecksumAlgorithms = [];
        response.body.supportsRestartRequest = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsExceptionOptions = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsValueFormattingOptions = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsExceptionInfoRequest = false;
        response.body.supportTerminateDebuggee = false;
        response.body.supportSuspendDebuggee = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsDelayedStackTraceLoading = true;
        response.body.supportsLoadedSourcesRequest = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsLogPoints = false;
        response.body.supportsTerminateThreadsRequest = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsSetExpression = false;
        response.body.supportsTerminateRequest = false;
        response.body.supportsDataBreakpoints = false;
        response.body.supportsReadMemoryRequest = false;
        response.body.supportsWriteMemoryRequest = false;
        response.body.supportsDisassembleRequest = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsCancelRequest = false;
        /*WILL BE IMPLEMENTED*/
        response.body.supportsBreakpointLocationsRequest = false;
        response.body.supportsClipboardContext = false;
        response.body.supportsSteppingGranularity = false;
        response.body.supportsInstructionBreakpoints = false;
        response.body.supportsExceptionFilterOptions = false;
        response.body.supportsSingleThreadExecutionRequests = false;

        try {
            await this.debugMessages.initialize();
            await this.qmlDebugger.initialize();
            await this.v8debugger.initialize();
            await this.declarativeDebugClient.initialize();
        }
        catch (error) {
            this.raiseError(response, 1001, "Cannot initialize. " + error);
            return;
        }


        this.sendResponse(response);
    }

    /**
     * 启动调试器请求
     * @param response 
     * @param args 
     * @param request 
     */
    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.launchRequest", [response, args, request]);
    }

    /**
     * 附加调试器请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async attachRequest(response: DebugProtocol.AttachResponse, args: QmlDebugSessionAttachArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.attachRequest", [response, args, request]);

        this.packetManager.host = args.host;
        this.packetManager.port = args.port;
        if (args.paths !== undefined)
            this.pathMappings = new Map(Object.entries(args.paths));

        try {
            await this.packetManager.connect();
            await this.declarativeDebugClient.handshake();
            await this.v8debugger.handshake();
            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1002, "Cannot connect to Qml debugger. \n\tHost: " + this.packetManager.host + "\n\tPort:" + this.packetManager.port + "\n\t" + error);
            return;
        }

        this.sendEvent(new InitializedEvent());
    }

    /**
     * 断开调试器请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): Promise<void> {
        try {
            await this.v8debugger.requestContinue();
            await this.v8debugger.disconnect();
            await this.v8debugger.deinitialize();
            await this.qmlDebugger.deinitialize();
            await this.declarativeDebugClient.deinitialize();
            await this.packetManager.disconnect();
        }
        catch (error) {
            this.raiseError(response, 1004, "Cannot disconnect from Qml debugger. \n\tHost: " + this.packetManager.host + "\n\tPort:" + this.packetManager.port + ", " + error);
            return;
        }
    }

    /**
     * 向调试器设置断点请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.setBreakPointsRequest", [response, args, request]);

        for (let i = 0; i < this.breakpoints.length; i++) {
            const currentExisting = this.breakpoints[i];

            let found = false;
            for (let n = 0; n < args.breakpoints!.length; n++) {
                const current = args.breakpoints![n];
                if (currentExisting.filename === args.source && currentExisting.line === current.line) {
                    found = true;
                    break;
                }
            }

            if (!found) {
                this.breakpoints.splice(i, 1);

                try {
                    const result = await this.v8debugger.requestClearBreakpoint(currentExisting.id);
                    if (!result.success) {
                        response.success = false;
                        this.sendResponse(response);
                        return;
                    }
                }
                catch (error) {
                    this.raiseError(response, 1005, "Request failed. Request: \"removebreakpoint\". " + error);
                }
            }
        }

        for (let i = 0; i < args.breakpoints!.length; i++) {
            const current = args.breakpoints![i];

            let found = false;
            for (let n = 0; n < this.breakpoints.length; n++) {
                const currentExisting = this.breakpoints![n];
                if (currentExisting.filename === args.source.path! &&
                    currentExisting.line === current.line) {
                    found = true;
                    break;
                }
            }

            if (found)
                continue;


            let breakpointId = 0;

            try {
                const result = await this.v8debugger.requestSetBreakpoint(
                    PathMap.mapPathTo(args.source.path!),
                    PathMap.mapLineNumberTo(current.line, this.linesStartFromZero)
                );
                if (!result.success) {
                    response.success = false;
                    this.sendResponse(response);
                    return;
                }

                breakpointId = result.body.breakpoint;
            }
            catch (error) {
                this.raiseError(response, 1005, "Request failed. Request: \"setbreakpoint\". " + error);
            }

            const newBreakpoint: QmlBreakpoint =
            {
                id: breakpointId,
                filename: args.source.path!,
                line: current.line,
            };
            this.breakpoints.push(newBreakpoint);
        }

        response.body =
        {
            breakpoints: this.breakpoints
                .filter((value): boolean => { return value.filename === args.source.path!; })
                .map<DebugProtocol.Breakpoint>(
                    (value, index, array): DebugProtocol.Breakpoint => {
                        const breakpoint: DebugProtocol.Breakpoint =
                        {
                            id: value.id,
                            line: value.line,
                            verified: true
                        };
                        return breakpoint;
                    }
                )
        };

        this.sendResponse(response);
    }

    /**
     * 设置断点发生异常的时候请求处理
     * @param response 
     * @param args 
     * @param request 
     */
    protected async setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments, request?: DebugProtocol.Request): Promise<void> {
        this.v8debugger.requestSetExceptionBreakpoint("all", args.filters.indexOf("all") !== -1);

        // NOT SUPPORTED YET
        //this.v8debugger.requestSetExceptionBreakpoint("uncaught", args.filters.indexOf("uncaught") !== -1);
    }

    /**
     * 线程请求
     * @param response 
     * @param request 
     */
    protected async threadsRequest(response: DebugProtocol.ThreadsResponse, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.threadsRequest", [response, request]);

        response.body =
        {
            threads: [
                new Thread(this.mainQmlThreadId, "Qml Thread")
            ]
        };
        this.sendResponse(response);
    }

    /**
     * 堆栈调用记录请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.continueRequest", [response, args, request]);

        try {
            const result = await this.v8debugger.requestBacktrace();
            if (!result.success) {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            const backtrace = result.body;
            let frameCount = 0;
            response.body =
            {
                stackFrames: backtrace.frames
                    .filter(
                        (value, index, array) => {
                            if (args.startFrame !== undefined) {
                                if (index < args.startFrame)
                                    return false;
                            }

                            if (args.levels !== undefined) {
                                if (frameCount >= args.levels)
                                    return false;

                                frameCount++;
                            }

                            return true;
                        }
                    )
                    .map<StackFrame>(
                        (frame, index, array) => {
                            const physicalPath = PathMap.mapPathFrom(frame.script, this.pathMappings);
                            const parsedPath = path.parse(physicalPath);
                            return new StackFrame(
                                frame.index,
                                frame.func,
                                new Source(parsedPath.base, physicalPath),
                                PathMap.mapLineNumberFrom(frame.line, this.linesStartFromZero)
                            );
                        }
                    )
            };
            response.body.totalFrames = result.body.frames.length;

            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1005, "Request failed. Request: \"backtrace\". " + error);
        }
    }

    /**
     * 区域作用域请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.scopesRequest", [response, args, request]);

        try {
            const result = await this.v8debugger.requestFrame(args.frameId);
            if (!result.success) {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            const frame = result.body;
            response.body =
            {
                scopes: []
            };

            for (const scopeRef of frame.scopes) {
                const scopeResult = await this.v8debugger.requestScope(scopeRef.index);
                if (!scopeResult.success) {
                    response.success = false;
                    /* eslint-disable */
                    throw new Error("Cannot make scope request. ScopeId: " + scopeRef);
                    /* eslint-enable */
                }

                const scope = scopeResult.body;
                const dapScope: DebugProtocol.Scope = new Scope(convertScopeName(scope.type), scope.index, false);

                if (scope.object === undefined)
                    continue;

                if (scope.object.value === 0)
                    continue;

                dapScope.presentationHint = convertScopeType(scope.type);
                dapScope.variablesReference = PathMap.mapHandleFrom(scope.object!.handle);
                dapScope.namedVariables = scope.object?.value;

                response.body.scopes.push(dapScope);
            }

            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1005, "Request failed. Request: \"scope\". " + error);
        }
    }

    /**
     * 变量请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.variablesRequest", [response, args, request]);

        try {
            const result = await this.v8debugger.requestLookup([PathMap.mapHandleTo(args.variablesReference)]);
            if (!result.success) {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            const variables = Object.values(result.body);

            if (variables[0].properties === undefined) {
                this.sendResponse(response);
                return;
            }

            let variableCount = 0;
            response.body =
            {
                variables: variables[0].properties!
                    .filter(
                        (value, index, array): boolean => {
                            if (this.filterFunctions && value.type === "function")
                                return false;

                            if (args.start !== undefined) {
                                if (index < args.start)
                                    return false;
                            }

                            if (args.count !== undefined) {
                                if (variableCount >= args.count)
                                    return false;

                                variableCount++;
                            }

                            return true;
                        }
                    )
                    .map<Variable>(
                        (qmlVariable, index, array) => {
                            const dapVariable: DebugProtocol.Variable =
                            {
                                name: qmlVariable.name!,
                                type: qmlVariable.type,
                                value: "" + qmlVariable.value,
                                variablesReference: 0,
                                namedVariables: 0,
                                indexedVariables: 0,
                                presentationHint:
                                {
                                    kind: "property"
                                }
                            };

                            if (qmlVariable.type === "object") {
                                if (qmlVariable.value !== null)

                                    dapVariable.value = "object";
                                else
                                    dapVariable.value = "null";

                                dapVariable.namedVariables = qmlVariable.value;
                                if (dapVariable.namedVariables !== 0)
                                    dapVariable.variablesReference = PathMap.mapHandleFrom(qmlVariable.ref!);
                            }
                            else if (qmlVariable.type === "function") {
                                dapVariable.value = "function";
                                dapVariable.presentationHint!.kind = "method";
                            }
                            else if (qmlVariable.type === "undefined") {
                                dapVariable.value = "undefined";
                            }
                            else if (qmlVariable.type === "string") {
                                dapVariable.value = "\"" + qmlVariable.value + "\"";
                            }

                            Log.debug(() => { return "DAP Variable: " + JSON.stringify(dapVariable); });

                            return dapVariable;
                        }
                    )
            };

            if (this.sortMembers) {
                response.body.variables = response.body.variables
                    .sort(
                        (a, b) => {
                            if (a.name === b.name)
                                return 0;
                            else if (a.name > b.name)
                                return 1;
                            else
                                return -1;
                        }
                    );
            }

            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1005, "Request failed. Request: \"variables\". " + error);
        }
    }

    /**
     * 求值请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.evaluateRequest", [response, args, request]);

        try {
            const result = await this.v8debugger.requestEvaluate(args.frameId!, args.expression);
            if (!result.success) {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            response.body =
            {
                result: "" + result.body.value,
                type: result.body.type,
                variablesReference: 0,
                namedVariables: 0,
                indexedVariables: 0,
                presentationHint:
                {
                    kind: "property"
                }
            };

            if (result.body.type === "object") {
                if (result.body.value !== null)
                    response.body.result = "object";
                else
                    response.body.result = "null";

                response.body.variablesReference = PathMap.mapHandleFrom(result.body.handle);
                response.body.namedVariables = result.body.value;
            }
            else if (result.body.type === "string") {
                response.body.result = "\"" + result.body.value + "\"";
            }
            else if (result.body.type === "function") {
                response.body.result = "function";
                response.body.presentationHint!.kind = "method";
            }
            else if (result.body.type === "undefined") {
                response.body.result = "undefined";
            }

            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1005, "Request failed. Request: \"evaluate\". " + error);
        }
    }

    /**
     * step in调试请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.stepInRequest", [response, args, request]);

        try {
            const result = await this.v8debugger.requestContinue("in", 1);
            if (!result.success) {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = false;

            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1005, "Request failed. Request: \"stepin\". " + error);
        }
    }

    /**
     * step out请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.stepOutRequest", [response, args, request]);

        try {
            const result = await this.v8debugger.requestContinue("out", 1);
            if (!result.success) {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = false;

            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1005, "Request failed. Request: \"stepout\". " + error);
        }
    }

    /**
     * 下一步请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.nextRequest", [response, args, request]);

        try {
            const result = await this.v8debugger.requestContinue("next", 1);
            if (!result.success) {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = false;

            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1005, "Request failed. Request: \"next\". " + error);
        }
    }

    /**
     * continue请求
     * @param response 
     * @param args 
     * @param request 
     * @returns 
     */
    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments, request?: DebugProtocol.Request): Promise<void> {
        Log.trace("QmlDebugSession.continueRequest", [response, args, request]);

        try {
            const result = await this.v8debugger.requestContinue(undefined, undefined);
            if (!result.success) {
                response.success = false;
                this.sendResponse(response);
                return;
            }

            this.breaked = false;

            this.sendResponse(response);
        }
        catch (error) {
            this.raiseError(response, 1005, "Request failed. Request: \"continue\". " + error);
        }
    }

    /**
     * 命中断点之后，调试器会停在这里，等待调试器的下一步指令
     * @param event 
     * @returns 
     */
    onEvent(event: QmlEvent<any>): void {
        if (event.event === "break") {
            if (!isQmlBreakEvent(event)) { return; }

            const breakEvent: QmlBreakEventBody = event.body as QmlBreakEventBody;
            // 查找映射的文件路径
            const filename = PathMap.mapPathFrom(breakEvent.script.name, this.pathMappings);
            const breakpointIds: number[] = [];
            for (let i = 0; i < this.breakpoints.length; i++) {
                const current = this.breakpoints[i];
                // 如果断点的文件名和行号与当前断点一致，则将断点id添加到断点id数组中
                if (current.filename === filename && current.line === PathMap.mapLineNumberFrom(breakEvent.sourceLine, this.linesStartFromZero)) {
                    breakpointIds.push(i);
                }
            }

            this.breaked = true;

            if (breakpointIds.length === 0) {
                this.sendEvent(new StoppedEvent("step", this.mainQmlThreadId));
            }
            else {
                const stoppedEvent: DebugProtocol.StoppedEvent = new StoppedEvent("breakpoint", this.mainQmlThreadId);
                stoppedEvent.body.hitBreakpointIds = breakpointIds;
                stoppedEvent.body.description = "Breakpoint hit at " + filename + " on line(s) " + breakpointIds + ".";
                this.sendEvent(stoppedEvent);
            }
        }
    }



    private raiseError(response: Response, errorNo: number, errorText: string): void {
        this.sendErrorResponse(response,
            {
                id: errorNo,
                format: "QML Debug: " + errorText,
                showUser: true
            }
        );

        this.sendEvent(new TerminatedEvent());
    }
}

export class QmlDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    public createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        Log.trace("QmlDebugAdapterFactory.createDebugAdapterDescriptor", [session, executable]);

        return new vscode.DebugAdapterInlineImplementation(new QmlDebugSession(session));
    }

}