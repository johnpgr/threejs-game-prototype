import * as three from "three";
import * as common from "./common";
import { type WebSocket, WebSocketServer } from "ws";
import { assert, unreachable } from "./utils";

const MAX_PLAYERS = 10;
const SERVER_TPS = 30;

export class ServerPlayer extends common.Player {
    constructor(
        id: number,
        public ws: WebSocket,
    ) {
        super(id);
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

    return new three.Vector2(0,0);
}

export class ServerState {
    public nextPlayerId = 0;
    public players = new Map<number, ServerPlayer>();
    public eventQueue = new Set<common.Packet>();
    public joinedIds = new Set<number>();
    public leftIds = new Set<number>();
    private lastTimestamp = performance.now();

    constructor(public wss: WebSocketServer) {
        this.setupWss();
        setTimeout(this.tick.bind(this), 1000 / SERVER_TPS);
    }

    public tick() {
        const now = performance.now();
        const deltaTime = (now - this.lastTimestamp) / 1000;
        this.lastTimestamp = now;
        this.joinedIds.clear();
        this.leftIds.clear();

        // This makes sure that if someone joins and leves in the same tick, the player will not be removed
        this.eventQueue.forEach((e) => {
            switch (e.kind) {
                case common.PacketKind.PlayerJoin: {
                    const packet = e as common.PlayerJoinPacket;
                    this.joinedIds.add(packet.id);
                    break;
                }
                case common.PacketKind.PlayerLeft: {
                    const packet = e as common.PlayerLeftPacket;
                    if (!this.joinedIds.delete(packet.id)) {
                        this.leftIds.add(packet.id);
                    }
                    break;
                }
            }
        });
        // Greet all the joined players and notify them about other players.
        this.joinedIds.forEach((joinedId) => {
            const joinedPlayer = this.players.get(joinedId);
            if (joinedPlayer !== undefined) {
                joinedPlayer.ws.send(
                    new common.HelloPacket(
                        joinedPlayer.id,
                        joinedPlayer.position.x,
                        joinedPlayer.position.y,
                        joinedPlayer.color!.getHex(),
                    ).encode(),
                );
                // Reconstruct the state of the other players
                this.players.forEach((otherPlayer) => {
                    if (joinedId !== otherPlayer.id) {
                        // Joined player should already know about themselves
                        const packet = new common.PlayerJoinPacket(
                            otherPlayer.id,
                            otherPlayer.position.x,
                            otherPlayer.position.y,
                            otherPlayer.color!.getHex(),
                        );
                        joinedPlayer.ws.send(packet.encode());

                        // Send the state of the other players to the joined player
                        if (otherPlayer.moveTarget) {
                            const packet = new common.PlayerMovingPacket(
                                otherPlayer.id,
                                otherPlayer.moveTarget.x,
                                otherPlayer.moveTarget.y,
                            );
                            joinedPlayer.ws.send(packet.encode());
                        }
                    }
                });
            }
        });

        // Notifying about who joined
        this.joinedIds.forEach((joinedId) => {
            const joinedPlayer = this.players.get(joinedId);
            if (joinedPlayer !== undefined) {
                //This should never happen, but we handling none existing ids for more robustness
                this.players.forEach((otherPlayer) => {
                    if (joinedId !== otherPlayer.id) {
                        const packet = new common.PlayerJoinPacket(
                            otherPlayer.id,
                            otherPlayer.position.x,
                            otherPlayer.position.y,
                            otherPlayer.color!.getHex(),
                        );
                        otherPlayer.ws.send(packet.encode());
                    }
                });
            }
        });

        // Notify about who left
        this.leftIds.forEach((leftId) => {
            this.players.forEach((otherPlayer) => {
                const packet = new common.PlayerLeftPacket(leftId);
                otherPlayer.ws.send(packet.encode());
            });
        });

        // Notify about movement
        this.eventQueue.forEach((event) => {
            switch (event.kind) {
                case common.PacketKind.PlayerMoving: {
                    const packet = event as common.PlayerMovingPacket;
                    const player = this.players.get(packet.id);
                    if (player === undefined) {
                        // This May happen if somebody joined, moved and left within a single tick. Just skipping.
                        return;
                    }
                    player.moveTarget = new three.Vector2(
                        packet.targetX,
                        packet.targetY,
                    );
                    this.players.forEach((otherPlayer) => {
                        otherPlayer.ws.send(packet.encode());
                    });
                    break;
                }
            }
        });
        const tickTime = performance.now() - this.lastTimestamp;
        this.players.forEach((p) => common.updatePlayerPos(p, deltaTime));
        this.eventQueue.clear();
        setTimeout(
            this.tick.bind(this),
            Math.max(0, 1000 / SERVER_TPS - tickTime),
        );
    }

    private setupWss() {
        this.wss.on("connection", (ws) => {
            ws.binaryType = "arraybuffer";
            if (this.players.size >= MAX_PLAYERS) {
                ws.close(1000, "Server is full");
                return;
            }
            const player = this.addPlayer(ws);
            player.position = randomPlayerPosition();
            player.color = randomColor();
            console.log(`Player ${player.id} joined`);
            this.eventQueue.add(
                new common.PlayerJoinPacket(
                    player.id,
                    player.position.x,
                    player.position.y,
                    player.color.getHex(),
                ),
            );
            ws.addEventListener("message", (e) => {
                console.log(`Received message from player ${player.id}`);
                assert(
                    e.data instanceof Uint8Array,
                    `Expected binary message`
                );
                assert(
                    e.data.byteLength >= 1,
                    "Expected non-empty Buffer",
                );
                try {
                    const { kind } = common.Packet.decode(e.data);
                    switch (kind) {
                        case common.PacketKind.Hello: {
                            return unreachable(
                                "Hello packet should be handled by client",
                            );
                        }
                        case common.PacketKind.PlayerJoin: {
                            return unreachable(
                                "PlayerJoin packet should be handled by client",
                            );
                        }
                        case common.PacketKind.PlayerMoving: {
                            try {
                                const packet = common.PlayerMovingPacket.decode(
                                    e.data,
                                );
                                this.eventQueue.add(packet);
                            } catch (error) {
                                ws.close(1003, "Invalid message");
                                return;
                            }
                        }
                    }
                } catch (error) {
                    ws.close(1003, "Invalid message");
                    return;
                }
            });
            ws.addEventListener("close", () => {
                console.log(`Player ${player.id} left`);
                this.players.delete(player.id);
                this.eventQueue.add(new common.PlayerLeftPacket(player.id));
            });
        });
    }

    public addPlayer(ws: WebSocket): ServerPlayer {
        const player = new ServerPlayer(this.nextPlayerId++, ws);
        this.players.set(player.id, player);
        return player;
    }

    public removePlayer(player: ServerPlayer) {
        this.players.delete(player.id);
    }
}

const wss = new WebSocketServer({ port: common.SERVER_PORT });
console.log(`Server started on port ${common.SERVER_PORT}`);
new ServerState(wss);
