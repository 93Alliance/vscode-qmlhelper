import { TerminatedEvent } from "@vscode/debugadapter";
import { PromiseSocket } from "promise-socket";
import { BufferHex, BufferHexOptions } from "buffer-hex";
import { QmlDebugSession } from "./debug-adapter";
import { TerminalColor } from "terminal-styler";
import { Packet } from "./packet";
import { Socket } from "net";
import { Log } from "./log";

type PacketHandlerCallback = (header: string, data: Packet) => boolean;

export interface PacketHandler {
    name: string;
    callback: PacketHandlerCallback;
}

export class PacketManager {
    private session?: QmlDebugSession;
    private nodeSocket: Socket | null = null;
    private socket: PromiseSocket<Socket> | null = null;
    private receiveBuffer = Buffer.alloc(0);
    private packetHandlers: PacketHandler[] = [];

    public constructor(session: QmlDebugSession) {
        Log.trace("PacketManager.constructor", [session]);
        this.session = session;
    }

    public host = "localhost";
    public port = 10222;
    public logging = false;

    private onData(data: Buffer): void {
        Log.trace("PacketManager.onData()", [data]);
        Log.debug(
            () => {
                const options: BufferHexOptions =
                {
                    offsetStyle:
                    {
                        foregroundColor: TerminalColor.green
                    }
                };
                return "Raw Data Received:\n" + BufferHex.dump(data, undefined, undefined, options);
            }
        );
        this.receivePacket(data);
    }

    private onClose(): void {
        Log.trace("PacketManager.onClose", []);

        this.session?.sendEvent(new TerminatedEvent());

        Log.warning("Connection closed.");
    }

    private onError(err: any): void {
        Log.trace("PacketManager.onError", [err]);

        Log.error("Socket Error - " + err);
    }

    public async connect(): Promise<void> {
        Log.trace("connect", []);

        this.nodeSocket = new Socket();
        this.socket = new PromiseSocket(this.nodeSocket);
        this.nodeSocket.on("data", (data: Buffer) => { this.onData(data); });
        this.nodeSocket?.on("close", () => { this.onClose(); });
        this.nodeSocket?.on("error", (err) => { this.onError(err); });

        Log.info("Connecting to " + this.host + ":" + this.port + "...");
        await this.socket.connect(this.port, this.host);
        Log.success("Connected.");
    }

    public async disconnect(): Promise<void> {
        Log.trace("PacketManager.disconnect", []);

        if (this.socket === null)
            return;

        Log.info("Disconnecting from " + this.host + ":" + this.port + "...");

        await this.socket.end();

        this.socket.destroy();
        this.socket = null;

        this.nodeSocket?.destroy();
        this.nodeSocket = null;

        Log.success("Disconnected.");
    }

    public registerHandler(header: string, callback: PacketHandlerCallback): void {
        Log.trace("PacketManager.registerHandler", [header, callback]);

        this.packetHandlers.push({ name: header, callback: callback });
    }

    private dispatchPacket(packet: Packet) {
        Log.trace("PacketManager.dispatchPacket", [packet]);

        const header = packet.readStringUTF16();

        for (const current of this.packetHandlers) {
            if (current.name !== header || current.name === "*")
                continue;

            const result = current.callback(header, packet);
            if (!result)
                continue;

            break;
        }
    }

    public receivePacket(buffer: Buffer): void {
        Log.trace("PacketManager.receivePacket", [buffer]);

        this.receiveBuffer = Buffer.concat([this.receiveBuffer, buffer]);

        while (true) {
            let targetSize: number;
            if (this.receiveBuffer.length > 4)
                targetSize = this.receiveBuffer.readUInt32LE();
            else
                targetSize = Number.MAX_SAFE_INTEGER;

            if (this.receiveBuffer.length === targetSize) {
                this.dispatchPacket(new Packet(this.receiveBuffer, targetSize - 4, 4));
                this.receiveBuffer = Buffer.alloc(0);
            }
            else if (this.receiveBuffer.length > targetSize) {
                this.dispatchPacket(new Packet(this.receiveBuffer, targetSize - 4, 4));
                this.receiveBuffer = this.receiveBuffer.slice(targetSize, this.receiveBuffer.length);
            }
            else {
                break;
            }
        }
    }

    public async writePacket(packet: Packet): Promise<void> {
        Log.trace("PacketManager.writePacket", [packet]);

        if (this.socket === null)
            throw new Error("PacketManager::writePacket: Uninitialized connection.");

        let buffer = Buffer.alloc(4);
        buffer.writeUInt32LE(packet.getSize() + 4);
        buffer = Buffer.concat([buffer, packet.getData()]);

        while (true) {
            const count = await this.socket.write(buffer);

            Log.debug(
                () => {
                    const options: BufferHexOptions =
                    {
                        offsetStyle: {
                            foregroundColor: TerminalColor.red
                        }
                    };

                    return "Raw Data Transfered:\n" + BufferHex.dump(buffer, undefined, undefined, options);
                }
            );

            if (count === buffer.length)
                return;

            buffer = buffer.slice(count, buffer.length - count);
        }
    }

    public async process(): Promise<void> {
        Log.trace("PacketManager.process", []);

        if (this.nodeSocket === null)
            throw new Error("PacketManager::process: Uninitialized connection.");

        return new Promise(
            (resolve, reject) => {
                this.nodeSocket?.on("close",
                    () => {
                        this.onClose();
                        resolve();
                    }
                );

                this.nodeSocket?.on("error",
                    (err) => {
                        this.onError(err);
                        reject();
                    }
                );
            }
        );
    }
}