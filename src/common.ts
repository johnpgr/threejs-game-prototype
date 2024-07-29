import * as three from "three";
import typia from "typia";
import type { i32 } from "./types";
import type * as ws from "ws";

export const SERVER_PORT = 6970;
export const MAP_SIZE = new three.Vector2(100, 100);

export enum PacketKind {
    Hello,
    PlayerJoinBatch,
    PlayerLeftBatch,
    PlayerMoving,
    PlayerMovingBatch,
}

export interface Packet {
    kind: PacketKind;
    encode(): Uint8Array;
}

export namespace Packet {
    const decoder = typia.protobuf.createDecode<Packet>();

    export function decode(data: Uint8Array): Packet {
        return decoder(data);
    }
}

export class HelloPacket implements Packet {
    public kind = PacketKind.Hello;

    constructor(
        public id: i32,
        public x: i32,
        public y: i32,
        public color: i32,
    ) {}

    private static _encode = typia.protobuf.createEncode<HelloPacket>();
    private static _decode = typia.protobuf.createDecode<HelloPacket>();

    public static decode(data: Uint8Array): HelloPacket {
        const packet = HelloPacket._decode(data);
        return new HelloPacket(packet.id, packet.x, packet.y, packet.color);
    }

    public encode(): Uint8Array {
        return HelloPacket._encode(this);
    }
}

export interface PlayerJoin {
    id: i32;
    x: i32;
    y: i32;
    color: i32;
}

export class PlayerJoinBatchPacket implements Packet {
    public kind = PacketKind.PlayerJoinBatch;
    constructor(public players: Array<PlayerJoin>) {}

    private static _encode =
        typia.protobuf.createEncode<PlayerJoinBatchPacket>();
    private static _decode =
        typia.protobuf.createDecode<PlayerJoinBatchPacket>();

    public static decode(data: Uint8Array): PlayerJoinBatchPacket {
        const packet = PlayerJoinBatchPacket._decode(data);
        return new PlayerJoinBatchPacket(packet.players);
    }

    public encode(): Uint8Array {
        return PlayerJoinBatchPacket._encode(this);
    }
}

export interface PlayerLeft {
    id: i32;
}

export class PlayerLeftBatchPacket implements Packet {
    public kind = PacketKind.PlayerLeftBatch;
    constructor(public playerIds: Array<number>) {}

    private static _encode = typia.protobuf.createEncode<PlayerLeftBatchPacket>();
    private static _decode = typia.protobuf.createDecode<PlayerLeftBatchPacket>();

    public static decode(data: Uint8Array): PlayerLeftBatchPacket {
        const packet = PlayerLeftBatchPacket._decode(data);
        return new PlayerLeftBatchPacket(packet.playerIds);
    }

    public encode(): Uint8Array {
        return PlayerLeftBatchPacket._encode(this);
    }
}

export interface PlayerMove {
    id: number;
    targetX: number;
    targetY: number;
}

export class PlayerMovingPacket implements Packet, PlayerMove {
    public kind = PacketKind.PlayerMoving;
    constructor(
        public id: i32,
        public targetX: i32,
        public targetY: i32,
    ) {}

    private static _encode = typia.protobuf.createEncode<PlayerMovingPacket>();
    private static _decode = typia.protobuf.createDecode<PlayerMovingPacket>();

    public static decode(data: Uint8Array): PlayerMovingPacket {
        const packet = PlayerMovingPacket._decode(data);
        return new PlayerMovingPacket(
            packet.id,
            packet.targetX,
            packet.targetY,
        );
    }

    public encode(): Uint8Array {
        return PlayerMovingPacket._encode(this);
    }
}

export class PlayerMovingBatchPacket implements Packet {
    public kind = PacketKind.PlayerMovingBatch;
    constructor(public moves: Array<PlayerMove>) {}

    private static _encode =
        typia.protobuf.createEncode<PlayerMovingBatchPacket>();
    private static _decode =
        typia.protobuf.createDecode<PlayerMovingBatchPacket>();

    public static decode(data: Uint8Array): PlayerMovingBatchPacket {
        const packet = PlayerMovingBatchPacket._decode(data);
        return new PlayerMovingBatchPacket(packet.moves);
    }

    public encode(): Uint8Array {
        return PlayerMovingBatchPacket._encode(this);
    }
}


export function sendPacket<T extends Packet>(ws: WebSocket | ws.WebSocket, packet: T) {
    ws.send(packet.encode());
}

export class Player {
    constructor(
        public id: number,
        public position: three.Vector2 = new three.Vector2(0, 0),
        public color: three.Color | null = null,
        public moveTarget: three.Vector2 | null = null,
        public speed: number = BASE_PLAYER_SPEED,
    ) {}
}

const BASE_PLAYER_SPEED = 5.0; // Initial speed
const ACCELERATION = 0.1; // Speed increase per tick
const MAX_SPEED = 10.0; // Maximum speed cap

export function updatePlayerPos(p: Player, deltaTime: number) {
    if (!p.moveTarget) return;

    // Initialize speed if it doesn't exist
    if (p.speed === undefined) {
        p.speed = BASE_PLAYER_SPEED;
    }

    // Increase speed, but cap it at MAX_SPEED
    p.speed = Math.min(p.speed + ACCELERATION * deltaTime, MAX_SPEED);

    let dx = p.moveTarget.x - p.position.x;
    let dy = p.moveTarget.y - p.position.y;

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0.01) {
        // Only move if we're not too close to the target
        // Normalize direction
        dx /= distance;
        dy /= distance;

        // Apply speed and deltaTime
        const moveDistance = p.speed * deltaTime;

        // Check if we would overshoot the target
        if (moveDistance > distance) {
            // If so, just move to the target
            p.position.x = p.moveTarget.x;
            p.position.y = p.moveTarget.y;
        } else {
            // Otherwise, move towards the target
            p.position.x += dx * moveDistance;
            p.position.y += dy * moveDistance;
        }
    } else {
        // We've reached the target, reset speed
        p.speed = BASE_PLAYER_SPEED;
        p.moveTarget = null; // Clear the move target
    }
}

export function boxFromColor(color: three.Color): three.Mesh {
    const geometry = new three.BoxGeometry(1, 1, 1);
    const material = new three.MeshBasicMaterial({ color });
    return new three.Mesh(geometry, material);
}
