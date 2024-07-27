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
    private static _decode = typia.protobuf.createDecode<HelloPacket>();

    public static decode(data: Uint8Array): HelloPacket {
        const packet = HelloPacket._decode(data);
        return new HelloPacket(packet.id, packet.x, packet.y, packet.color);
    }

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

    private static _encode = typia.protobuf.createEncode<PlayerJoinPacket>();
    private static _decode = typia.protobuf.createDecode<PlayerJoinPacket>();

    public static decode(data: Uint8Array): PlayerJoinPacket {
        const packet = PlayerJoinPacket._decode(data);
        return new PlayerJoinPacket(packet.id, packet.x, packet.y, packet.color);
    }

    public encode(): Uint8Array {
        return PlayerJoinPacket._encode(this);
    }
}

export class PlayerLeftPacket implements Packet {
    public kind = PacketKind.PlayerLeft;
    constructor(public id: number) {}

    private static _encode = typia.protobuf.createEncode<PlayerLeftPacket>();
    private static _decode = typia.protobuf.createDecode<PlayerLeftPacket>();

    public static decode(data: Uint8Array): PlayerLeftPacket {
        const packet = PlayerLeftPacket._decode(data);
        return new PlayerLeftPacket(packet.id);
    }

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
    private static _decode = typia.protobuf.createDecode<PlayerMovingPacket>();

    public static decode(data: Uint8Array): PlayerMovingPacket {
        const packet = PlayerMovingPacket._decode(data);
        return new PlayerMovingPacket(packet.id, packet.targetX, packet.targetY);
    }

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

const PLAYER_SPEED = 1.0;

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
    p.position.x += dx * PLAYER_SPEED;
    p.position.y += dy * PLAYER_SPEED;
}

export function boxFromColor(color: three.Color): three.Mesh {
    const geometry = new three.BoxGeometry(1, 1, 1);
    const material = new three.MeshBasicMaterial({ color });
    return new three.Mesh(geometry, material);
}
