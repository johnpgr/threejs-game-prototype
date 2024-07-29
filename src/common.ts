import * as three from "three";
import typia from "typia";
import type { i32 } from "./types";
import type * as ws from "ws";
import { assert } from "./utils";

export const SERVER_PORT = 6970;
export const MAP_WIDTH = 24;
export const MAP_HEIGHT = 24;

export function isServer(): boolean {
    return typeof window === "undefined";
}

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

    private static _encode =
        typia.protobuf.createEncode<PlayerLeftBatchPacket>();
    private static _decode =
        typia.protobuf.createDecode<PlayerLeftBatchPacket>();

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

export function sendPacket<T extends Packet>(
    ws: WebSocket | ws.WebSocket,
    packet: T,
) {
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

export enum TileKind {
    Empty,
    Floor,
    Wall,
    DestroyedWall,
}

export class Tile {
    public mesh: three.Mesh | null = null;

    constructor(
        public x: number,
        public y: number,
        public kind: TileKind,
        public color: three.Color = new three.Color(0x000000),
    ) {}

    public static Wall(x: number, y: number, color: three.Color): Tile {
        return new Tile(x, y, TileKind.Wall, color);
    }

    public static Floor(x: number, y: number): Tile {
        return new Tile(x, y, TileKind.Floor);
    }

    public destroyWall() {
        assert(this.kind === TileKind.Wall, "Tried to destroy a non-wall tile");
        assert(this.mesh !== null, "Tile mesh is null");
        this.kind = TileKind.DestroyedWall;
        this.mesh!.scale.y = 0.1;
    }

    createMesh(mapWidth: number, mapHeight: number): three.Mesh {
        assert(!isServer(), "Cannot create mesh on server");
        let geometry: three.BufferGeometry;
        let material: three.Material;

        switch (this.kind) {
            case TileKind.Wall:
                geometry = new three.BoxGeometry(1, 1, 1);
                material = new three.MeshBasicMaterial({ color: this.color });
                break;
            case TileKind.Floor:
                geometry = new three.PlaneGeometry(1, 1);
                material = new three.MeshBasicMaterial({ color: this.color });
                break;
            default:
                geometry = new three.PlaneGeometry(1, 1);
                material = new three.MeshBasicMaterial({
                    color: 0x000000,
                    transparent: true,
                    opacity: 0,
                }); // Invisible for empty tiles
        }

        this.mesh = new three.Mesh(geometry, material);

        // Adjust the position to center the map
        const adjustedX = this.x - mapWidth / 2 + 0.5;
        const adjustedY = -this.y + mapHeight / 2 - 0.5; // Invert Y-axis

        this.mesh.position.set(adjustedX, .5, adjustedY); // Use adjusted Y for z in 3D space

        if (this.kind === TileKind.Floor) {
            this.mesh.rotation.x = -Math.PI / 2; // Rotate floor to lay flat
        }

        return this.mesh;
    }
}

export class GameMap {
    constructor(
        public width: number = MAP_HEIGHT,
        public height: number = MAP_WIDTH,
        public tiles: Tile[][] = [],
    ) {
        for (let y = 0; y < height; y++) {
            tiles[y] = [];
            for (let x = 0; x < width; x++) {
                tiles[y][x] = new Tile(x, y, TileKind.Empty);
            }
        }
    }

    public setTile(x: number, y: number, kind: TileKind, color: three.Color) {
        assert(
            x >= 0 && x < this.width && y >= 0 && y < this.height,
            "Tile out of bounds",
        );
        this.tiles[y][x] = new Tile(x, y, kind, color);
    }

    public getTile(x: number, y: number): Tile | null {
        return this.tiles[y][x] ?? null;
    }

    public createMeshes(scene: three.Scene) {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const tile = this.tiles[y][x];
                if (tile.kind !== TileKind.Empty) {
                    const mesh = tile.createMesh(this.width, this.height);
                    scene.add(mesh);
                }
            }
        }
    }
}
