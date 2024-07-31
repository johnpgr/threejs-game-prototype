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
        this.position = ServerPlayer.randomPlayerPosition();
        this.color = ServerPlayer.randomColor();
    }

    public static randomColor(): three.Color {
        return new three.Color().setHSL(Math.random(), 1, 0.5);
    }

    public static randomPlayerPosition(): three.Vector2 {
        const signX = Math.random() < 0.5 ? -1 : 1;
        const signY = Math.random() < 0.5 ? -1 : 1;
        return new three.Vector2(
            Math.floor((Math.random() * common.MAP_HEIGHT) / 2 - 1) * signX,
            Math.floor((Math.random() * common.MAP_WIDTH) / 2 - 1) * signY,
         );
    }
}

namespace Server {
    let nextPlayerId = 0;
    let lastTimestamp = performance.now();
    const players = new Map<number, ServerPlayer>();
    const joinedIds = new Set<number>();
    const leftIds = new Set<number>();
    const moves = new Set<common.PlayerMovingPacket>();
    const gameMap = new common.GameMap();

    export function start() {
        Bun.serve<{ id?: number }>({
            port: common.SERVER_PORT,
            fetch(request, server) {
                server.upgrade(request, { data: {} });
                return;
            },
            websocket: {
                open: handleConnection,
                message: handleMessage,
                close: handleDisconnection,
            },
        });
        console.log(`Server started on port ${common.SERVER_PORT}`);
        setTimeout(tick, 1000 / SERVER_TPS);
    }

    function tick() {
        const now = performance.now();
        const deltaTime = (now - lastTimestamp) / 1000;
        lastTimestamp = now;
        updatePlayersPositions(deltaTime);
        sendUpdatesToPlayers();
        clearTickData();
        const tickTime = performance.now() - now;
        setTimeout(tick, Math.max(0, 1000 / SERVER_TPS - tickTime));
    }

    function handleConnection(ws: ServerSocket) {
        ws.binaryType = "uint8array";
        const player = addPlayer(ws);
        if (!player) return;
        console.log(`Player ${player.id} connected`);
        joinedIds.add(player.id);
    }

    function handleMessage(ws: ServerSocket, message: Buffer) {
        if (!(message instanceof Uint8Array) || message.byteLength < 1) {
            console.error("Invalid message received", message);
            ws.close(1003, "Invalid message");
            return;
        }
        try {
            const { kind } = common.Packet.decode(message);
            switch (kind) {
                case common.PacketKind.PlayerMoving:
                    handlePlayerMoving(message);
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

    function handleDisconnection(
        ws: ServerSocket,
        code: number,
        reason: string,
    ) {
        assert(ws.data.id !== undefined, "Disconnected player id was not set");
        console.log(
            `Player ${ws.data.id} disconnected; code: ${code}; reason: ${reason}`,
        );
        players.delete(ws.data.id);
        leftIds.add(ws.data.id);
    }

    function handlePlayerMoving(data: Uint8Array) {
        const decoded = common.PlayerMovingPacket.decode(data);
        moves.add(decoded);
    }

    function updatePlayersPositions(deltaTime: number) {
        players.forEach((p) => common.updatePlayerPos(p, deltaTime));
    }

    function sendUpdatesToPlayers() {
        sendWelcomeToNewPlayers();

        const joinPackets = createBatchJoinsPacket();
        const leftPackets = createBatchLeftPacket();
        const movingPackets = createBatchMovingPacket();

        players.forEach((p) => {
            if (joinPackets) common.sendPacket(p.ws, joinPackets);
            if (leftPackets) common.sendPacket(p.ws, leftPackets);
            if (movingPackets) common.sendPacket(p.ws, movingPackets);
        });
    }

    function createBatchJoinsPacket(): common.PlayerJoinBatchPacket | null {
        if (joinedIds.size === 0) return null;
        const joined = Array.from(joinedIds).map((id) => {
            const player = players.get(id)!;
            return {
                id: player.id,
                x: player.position.x,
                y: player.position.y,
                color: player.color!.getHex(),
            };
        });
        return new common.PlayerJoinBatchPacket(joined);
    }

    function createBatchLeftPacket(): common.PlayerLeftBatchPacket | null {
        if (leftIds.size === 0) return null;
        return new common.PlayerLeftBatchPacket(Array.from(leftIds));
    }

    function createBatchMovingPacket(): common.PlayerMovingBatchPacket | null {
        if (moves.size === 0) return null;
        return new common.PlayerMovingBatchPacket(Array.from(moves));
    }

    function sendWelcomeToNewPlayers() {
        joinedIds.forEach((joinedId) => {
            const joinedPlayer = players.get(joinedId);
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

            const existingPlayers = Array.from(players.values())
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

    function clearTickData() {
        joinedIds.clear();
        leftIds.clear();
        moves.clear();
    }

    function addPlayer(ws: ServerSocket): ServerPlayer | null {
        if (players.size >= MAX_PLAYERS) {
            ws.close(1000, "Server is full");
            return null;
        }
        const player = new ServerPlayer(nextPlayerId++, ws);
        players.set(player.id, player);
        player.ws.data.id = player.id;
        return player;
    }
}

Server.start();
