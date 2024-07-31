import Bun from "bun";
import * as three from "three";
import * as common from "./common";
import { assert, unreachable } from "./utils";

const MAX_PLAYERS = 10;
const SERVER_TPS = 60;

export type ServerSocket = Bun.ServerWebSocket<{ id?: number }>;

export class ServerPlayer extends common.Player {
    constructor(
        id: number,
        public ws: ServerSocket,
    ) {
        super(id);
        this.position = randomPlayerPosition();
        this.color = randomColor();
    }
}

function randomColor(): three.Color {
    return new three.Color().setHSL(Math.random(), 1, 0.5);
}

function randomPlayerPosition(): three.Vector2 {
    const signX = Math.random() < 0.5 ? -1 : 1;
    const signY = Math.random() < 0.5 ? -1 : 1;
    return new three.Vector2(
        Math.floor((Math.random() * common.MAP_HEIGHT) / 2 - 1) * signX,
        Math.floor((Math.random() * common.MAP_WIDTH) / 2 - 1) * signY,
    );
}

export class ServerState {
    private nextPlayerId = 0;
    private players = new Map<number, ServerPlayer>();
    private joinedIds = new Set<number>();
    private leftIds = new Set<number>();
    private moves = new Set<common.PlayerMovingPacket>();
    private lastTimestamp = performance.now();

    constructor() {
        Bun.serve<{ id?: number }>({
            port: common.SERVER_PORT,
            fetch(request, server) {
                server.upgrade(request, { data: {} });
                return;
            },
            websocket: {
                open: this.handleConnection.bind(this),
                message: this.handleMessage.bind(this),
                close: this.handleDisconnection.bind(this),
            },
        });
        console.log(`Server started on port ${common.SERVER_PORT}`);
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

    private handleConnection(ws: ServerSocket) {
        ws.binaryType = "uint8array";
        const player = this.addPlayer(ws);
        if (!player) return;
        console.log(`Player ${player.id} connected`);
        this.joinedIds.add(player.id);
    }

    private handleMessage(ws: ServerSocket, message: Buffer) {
        if (!(message instanceof Uint8Array) || message.byteLength < 1) {
            console.error("Invalid message received", message);
            ws.close(1003, "Invalid message");
            return;
        }
        try {
            const { kind } = common.Packet.decode(message);
            switch (kind) {
                case common.PacketKind.PlayerMoving:
                    this.handlePlayerMoving(message);
                    break;
                default:
                    // The only packet that server expects from client is PlayerMoving
                    unreachable(
                        `Unexpected packet kind on the server: ${kind}`,
                    );
            }
        } catch (error) {
            console.error("Error handling message:", error);
            ws.close(1003, "Invalid message");
        }
    }

    private handleDisconnection(
        ws: ServerSocket,
        code: number,
        reason: string,
    ) {
        assert(ws.data.id !== undefined, "Disconnected player id was not set");
        console.log(
            `Player ${ws.data.id} disconnected; code: ${code}; reason: ${reason}`,
        );
        this.players.delete(ws.data.id);
        this.leftIds.add(ws.data.id);
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

    private addPlayer(ws: ServerSocket): ServerPlayer | null {
        if (this.players.size >= MAX_PLAYERS) {
            ws.close(1000, "Server is full");
            return null;
        }
        const player = new ServerPlayer(this.nextPlayerId++, ws);
        this.players.set(player.id, player);
        player.ws.data.id = player.id;
        return player;
    }
}

new ServerState();
