import { Log } from "./log";
import { Packet } from "./packet";
import { QmlDebugSession } from "./debug-adapter";


interface QmlEngine {
    name: string;
    debugId: number;
}

interface ServiceAwaitingRequest {
    seqId: number;
    resolve: any;
    reject: any;
    timerId: NodeJS.Timeout;
}

export class ServiceQmlDebugger {
    private seqId = 0;
    protected session?: QmlDebugSession;
    public awaitingRequests: ServiceAwaitingRequest[] = [];

    public async requestListEngines(): Promise<QmlEngine[]> {
        Log.trace("QmlDebugger.requestListEngines", []);

        const packet = await this.makeRequest("LIST_ENGINES");

        const count = packet.readUInt32BE();
        const engines: QmlEngine[] = [];
        for (let i = 0; i < count; i++) {
            const name = packet.readStringUTF8();
            const id = packet.readUInt32BE();
            engines.push(
                {
                    name: name,
                    debugId: id
                }
            );
        }

        return engines;
    }

    private packetReceived(packet: Packet) {
        Log.trace("ServiceQmlDebugger.packetReceived", [packet]);

        const operation = packet.readStringUTF8();
        const seqId = packet.readInt32BE();

        if (operation === "OBJECT_CREATED") {

        }
        else {
            for (let i = 0; i < this.awaitingRequests.length; i++) {
                const current = this.awaitingRequests[i];
                if (current.seqId === seqId) {
                    this.awaitingRequests.splice(i, 1);
                    clearTimeout(current.timerId);
                    current.resolve(packet);
                    return;
                }
            }

            Log.error("Packet with wrong sequence id received. Sequence Id: " + seqId + ", " + operation + "Operation: ");
        }
    }

    protected nextSeqId(): number {
        this.seqId++;
        return this.seqId;
    }

    protected makeRequest(operation: string, data?: Packet): Promise<Packet> {
        Log.trace("ServiceQmlDebugger.makeRequest", [operation, data]);

        return new Promise<Packet>(
            (resolve, reject) => {
                const seqId = this.nextSeqId();
                const packet = new Packet();
                packet.appendStringUTF8(operation);
                packet.appendUInt32BE(seqId);
                if (data !== undefined)
                    packet.combine(data);

                const envelopPacket = new Packet();
                envelopPacket.appendStringUTF16("QmlDebugger");
                envelopPacket.appendSubPacket(packet);

                const timerId = setTimeout(
                    () => {
                        reject(new Error("Request timed out. Sequence Id: " + seqId));
                    },
                    10000
                );

                this.awaitingRequests.push(
                    {
                        seqId: seqId,
                        resolve: resolve,
                        reject: reject,
                        timerId: timerId
                    }
                );

                this.session!.packetManager!.writePacket(envelopPacket);
            }
        );
    }

    public async initialize(): Promise<void> {
        Log.trace("ServiceQmlDebugger.initialize", []);
    }

    public async deinitialize(): Promise<void> {
        Log.trace("ServiceQmlDebugger.deinitialize", []);
    }

    public constructor(session: QmlDebugSession) {
        Log.trace("ServiceQmlDebugger.constructor", [session]);

        this.session = session;
        this.session.packetManager.registerHandler("QmlDebugger",
            (header, packet): boolean => {
                const servicePacket = packet.readSubPacket();
                this.packetReceived(servicePacket);

                return true;
            }
        );
    }
}
