import * as three from "three";
import typia from "typia";

export const SERVER_PORT = 6970;
export const MAP_SIZE = new three.Vector2(100, 100);

export enum PacketKind {
    Hello,
    PlayerJoin,
    PlayerLeft,
    PlayerMoving,
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
        public id: number,
        public x: number,
        public y: number,
        public color: number,
    ) {}

    private static _encode = typia.protobuf.createEncode<HelloPacket>();
    public static decode = typia.protobuf.createDecode<HelloPacket>();

    public encode(): Uint8Array {
        return HelloPacket._encode(this);
    }
}

export class PlayerJoinPacket implements Packet {
    public kind = PacketKind.PlayerJoin;
    constructor(
        public id: number,
        public x: number,
        public y: number,
        public color: number,
    ) {}

    public static decode = typia.protobuf.createDecode<PlayerJoinPacket>();
    private static _encode = typia.protobuf.createEncode<PlayerJoinPacket>();

    public encode(): Uint8Array {
        return PlayerJoinPacket._encode(this);
    }
}

export class PlayerLeftPacket implements Packet {
    public kind = PacketKind.PlayerLeft;
    constructor(public id: number) {}

    private static _encode = typia.protobuf.createEncode<PlayerLeftPacket>();
    public static decode = typia.protobuf.createDecode<PlayerLeftPacket>();

    public encode(): Uint8Array {
        return PlayerLeftPacket._encode(this)
    }
}

export class PlayerMovingPacket implements Packet {
    public kind = PacketKind.PlayerMoving;
    constructor(
        public id: number,
        public targetX: number,
        public targetY: number,
    ) {}

    private static _encode = typia.protobuf.createEncode<PlayerMovingPacket>();
    public static decode = typia.protobuf.createDecode<PlayerMovingPacket>();

    public encode(): Uint8Array {
        return PlayerMovingPacket._encode(this);
    }
}

export class Player {
    public position: three.Vector2 = new three.Vector2(0, 0);
    public color: three.Color | null = null;
    public moveTarget: three.Vector2 | null = null;

    constructor(public id: number) {}
}

// TODO: Implement the path finding algorithm where the player moves to its moveTarget position
// while avoiding walls and other players.
// currently the player just moves in any direction
export function updatePlayerPos(p: Player) {
    if(!p.moveTarget) return;
    let dx = p.moveTarget.x - p.position.x;
    let dy = p.moveTarget.y - p.position.y;

    const l = dx * dx + dy * dy;
    if (l !== 0) {
        dx /= l;
        dy /= l;
    }
    p.position.x += dx;
    p.position.y += dy;
}

export function boxFromColor(color: three.Color): three.Mesh {
    const geometry = new three.BoxGeometry(1, 1, 1);
    const material = new three.MeshBasicMaterial({ color });
    return new three.Mesh(geometry, material);
}
