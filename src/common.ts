import * as three from "three";
import typia from "typia";
import type { i32 } from "./types";
import type * as ws from "ws";
import { assert } from "./utils";
import { ServerSocket } from "./server";

export const SERVER_PORT = 6970;
export const MAP_WIDTH = 24;
export const MAP_HEIGHT = 24;

export function isServer(): boolean {
    return typeof window === "undefined";
}

export enum PacketKind {
    Hello,
    GameMap,
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
        Object.setPrototypeOf(packet, HelloPacket.prototype);
        return packet;
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
        Object.setPrototypeOf(packet, PlayerJoinBatchPacket.prototype);
        return packet;
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
        Object.setPrototypeOf(packet, PlayerLeftBatchPacket.prototype);
        return packet;
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
        Object.setPrototypeOf(packet, PlayerMovingPacket.prototype);
        return packet;
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
        Object.setPrototypeOf(packet, PlayerMovingBatchPacket.prototype);
        return packet;
    }

    public encode(): Uint8Array {
        return PlayerMovingBatchPacket._encode(this);
    }
}

export class GameMapPacket implements Packet {
    public kind = PacketKind.GameMap;

    constructor(public map: GameMap) {}

    private static _encode = typia.protobuf.createEncode<GameMapPacket>();
    private static _decode = typia.protobuf.createDecode<GameMapPacket>();

    public static decode(data: Uint8Array): GameMapPacket {
        const packet = GameMapPacket._decode(data);
        Object.setPrototypeOf(packet, GameMapPacket.prototype);
        Object.setPrototypeOf(packet.map, GameMap.prototype);
        return packet;
    }

    public encode(): Uint8Array {
        return GameMapPacket._encode(this);
    }
}

export function sendPacket<T extends Packet>(
    ws: WebSocket | ServerSocket,
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

/**
 * Vector2 coordinate as a string to use in maps and avoid object creation
 */
export type Vector2Str = `${number},${number}`;

export class Tile {
    constructor(
        public x: number,
        public y: number,
        public kind: TileKind,
        //TODO: For now using only colors, however this should be changed to textures
        public color: string | null = null
    ) {}

    private static _encode = typia.protobuf.createEncode<Tile>();
    private static _decode = typia.protobuf.createDecode<Tile>();

    public encode(): Uint8Array {
        return Tile._encode(this);
    }

    public static decode(data: Uint8Array): Tile {
        const tile = Tile._decode(data);
        Object.setPrototypeOf(tile, Tile.prototype); // Avoids having to create a new object
        return tile
    }

    public static Wall(x: number, y: number, color: string): Tile {
        return new Tile(x, y, TileKind.Wall, color);
    }

    public static Floor(x: number, y: number): Tile {
        return new Tile(x, y, TileKind.Floor);
    }

    public destroyWall(tileMap: Map<Vector2Str, three.Mesh>) {
        const mesh = tileMap.get(`${this.x},${this.y}`);
        assert(this.kind === TileKind.Wall, "Tried to destroy a non-wall tile");
        assert(mesh !== undefined, "Tile mesh doesn't exist");
        this.kind = TileKind.DestroyedWall;
        mesh!.scale.y = 0.1;
    }

    createMesh(mapWidth: number, mapHeight: number): three.Mesh {
        assert(!isServer(), "Cannot create meshes on server");
        assert(this.color !== null, "Tile color is null");
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

        const mesh = new three.Mesh(geometry, material);

        // Adjust the position to center the map
        const adjustedX = this.x - mapWidth / 2 + 0.5;
        const adjustedY = -this.y + mapHeight / 2 - 0.5; // Invert Y-axis

        mesh.position.set(adjustedX, 0.5, adjustedY); // Use adjusted Y for z in 3D space

        if (this.kind === TileKind.Floor) {
            mesh.rotation.x = -Math.PI / 2; // Rotate floor to lay flat
        }

        return mesh;
    }
}

export class GameMap {
    public tiles: Tile[];

    constructor(
        public width: number = MAP_WIDTH,
        public height: number = MAP_HEIGHT
    ) {
        this.tiles = new Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                this.setTile(x, y, TileKind.Empty);
            }
        }
    }

    public index(x: number, y: number): number {
        return y * this.width + x;
    }

    public setTile(x: number, y: number, kind: TileKind, color: string | null = null) {
        assert(
            x >= 0 && x < this.width && y >= 0 && y < this.height,
            "Tile out of bounds"
        );
        this.tiles[this.index(x, y)] = new Tile(x, y, kind, color);
    }

    public getTile(x: number, y: number): Tile | null {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return null;
        }
        return this.tiles[this.index(x, y)];
    }

    public createMeshes(scene: three.Scene) {
        assert(!isServer(), "Cannot create meshes on server");
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const tile = this.getTile(x, y);
                if (tile && tile.kind !== TileKind.Empty) {
                    const mesh = tile.createMesh(this.width, this.height);
                    scene.add(mesh);
                }
            }
        }
    }
}
