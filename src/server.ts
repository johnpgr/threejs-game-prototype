import * as three from "three";
import { type WebSocket, type MessageEvent, WebSocketServer } from "ws";
import * as common from "./common";
import { exhaustive } from "./utils";

const MAX_PLAYERS = 10;
const SERVER_TPS = 30;

export class ServerPlayer extends common.Player {
    constructor(
        id: number,
        public ws: WebSocket,
    ) {
        super(id);
        this.position = randomPlayerPosition();
        this.color = randomColor();
    }
}

function randomColor(): three.Color {
    return new three.Color(Math.random() * 0xffffff);
}

function randomPlayerPosition(): three.Vector2 {
    //return new three.Vector2(
    //    Math.floor(Math.random() * common.MAP_SIZE.x),
    //    Math.floor(Math.random() * common.MAP_SIZE.y),
    //);
    return new three.Vector2(0, 0);
}

export class ServerState {
    public nextPlayerId = 0;
    public players = new Map<number, ServerPlayer>();
    public eventQueue = new Set<common.Packet>();
    public joinedIds = new Set<number>();
    public leftIds = new Set<number>();
    public moves = new Set<common.PlayerMovingPacket>();
    private lastTimestamp = performance.now();

    constructor(public wss: WebSocketServer) {
        wss.on("connection", this.handleConnection.bind(this));
        setTimeout(this.tick.bind(this), 1000 / SERVER_TPS);
    }

    public tick() {
        const now = performance.now();
        const deltaTime = (now - this.lastTimestamp) / 1000;
        this.lastTimestamp = now;
        this.updatePlayersPositions(deltaTime);
        this.sendUpdatesToPlayers();
        this.clearTickData();
        const tickTime = performance.now() - now;
        setTimeout(
            this.tick.bind(this),
            Math.max(0, 1000 / SERVER_TPS - tickTime),
        );
    }

    private handleConnection(ws: WebSocket) {
        ws.binaryType = "arraybuffer";
        const player = this.addPlayer(ws);
        if (!player) return;
        this.joinedIds.add(player.id);
        ws.addEventListener("message", (ev) => this.handleMessage(player, ev));
        ws.addEventListener("close", () => this.handleDisconnection(player));
    }

    private handleMessage(p: ServerPlayer, ev: MessageEvent) {
        console.log(`[ws]: Received message from player ${p.id}`);
        if (!(ev.data instanceof Uint8Array) || ev.data.byteLength < 1) {
            p.ws.close(1003, "Invalid message");
            return;
        }
        try {
            const { kind } = common.Packet.decode(ev.data);
            switch (kind) {
                case common.PacketKind.PlayerMoving:
                    this.handlePlayerMoving(ev.data);
                    break;
                case common.PacketKind.Hello:
                case common.PacketKind.PlayerJoinBatch:
                case common.PacketKind.PlayerLeftBatch:
                case common.PacketKind.PlayerMovingBatch:
                    // The only packet that server expects from client is PlayerMoving
                    throw new Error(
                        `Unexpected packet kind: ${common.PacketKind[kind]}`,
                    );
                default:
                    exhaustive(kind);
            }
        } catch (error) {
            console.error("Error handling message:", error);
            p.ws.close(1003, "Invalid message");
        }
    }

    private handleDisconnection(p: ServerPlayer) {
        console.log(`Player ${p.id} disconnected`);
        this.players.delete(p.id);
        this.leftIds.add(p.id);
    }

    private handlePlayerMoving(data: Uint8Array) {
        const decoded = common.PlayerMovingPacket.decode(data);
        this.moves.add(decoded);
    }

    private updatePlayersPositions(deltaTime: number) {
        this.players.forEach((p) => common.updatePlayerPos(p, deltaTime));
    }

    private sendUpdatesToPlayers() {
        this.sendWelcomeToNewPlayers();

        const joinPackets = this.createBatchJoinsPacket();
        const leftPackets = this.createBatchLeftPacket();
        const movingPackets = this.createBatchMovingPacket();

        this.players.forEach((p) => {
            if (joinPackets) common.sendPacket(p.ws, joinPackets);
            if (leftPackets) common.sendPacket(p.ws, leftPackets);
            if (movingPackets) common.sendPacket(p.ws, movingPackets);
        });
    }

    private createBatchJoinsPacket(): common.PlayerJoinBatchPacket | null {
        if (this.joinedIds.size === 0) return null;
        const joined = Array.from(this.joinedIds).map((id) => {
            const player = this.players.get(id)!;
            return {
                id: player.id,
                x: player.position.x,
                y: player.position.y,
                color: player.color!.getHex(),
            };
        });
        return new common.PlayerJoinBatchPacket(joined);
    }

    private createBatchLeftPacket(): common.PlayerLeftBatchPacket | null {
        if (this.leftIds.size === 0) return null;
        return new common.PlayerLeftBatchPacket(Array.from(this.leftIds));
    }

    private createBatchMovingPacket(): common.PlayerMovingBatchPacket | null {
        if (this.moves.size === 0) return null;
        return new common.PlayerMovingBatchPacket(Array.from(this.moves));
    }

    private sendWelcomeToNewPlayers() {
        this.joinedIds.forEach((joinedId) => {
            const joinedPlayer = this.players.get(joinedId);
            if (!joinedPlayer) return;

            common.sendPacket<common.HelloPacket>(
                joinedPlayer.ws,
                new common.HelloPacket(
                    joinedPlayer.id,
                    joinedPlayer.position.x,
                    joinedPlayer.position.y,
                    joinedPlayer.color!.getHex(),
                ),
            );

            const existingPlayers = Array.from(this.players.values())
                .filter((p) => p.id !== joinedId)
                .map((p) => ({
                    id: p.id,
                    x: p.position.x,
                    y: p.position.y,
                    color: p.color!.getHex(),
                }));

            if (existingPlayers.length > 0) {
                common.sendPacket<common.PlayerJoinBatchPacket>(
                    joinedPlayer.ws,
                    new common.PlayerJoinBatchPacket(existingPlayers),
                );
            }
        });
    }

    private clearTickData() {
        this.joinedIds.clear();
        this.leftIds.clear();
        this.moves.clear();
    }

    private addPlayer(ws: WebSocket): ServerPlayer | null {
        if (this.players.size >= MAX_PLAYERS) {
            ws.close(1000, "Server is full");
            return null;
        }
        const player = new ServerPlayer(this.nextPlayerId++, ws);
        console.log(`Player ${player.id} added`);
        this.players.set(player.id, player);
        return player;
    }
}

const wss = new WebSocketServer({ port: common.SERVER_PORT }, () => {
    console.log(`Server started on port ${common.SERVER_PORT}`);
});

new ServerState(wss);
