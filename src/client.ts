import * as three from "three";
import * as common from "./common";
import { assert } from "./utils";

const TPS = 30;

class State {
    public me: common.Player | undefined;
    public players = new Map<number, common.Player>();

    public tick(textures: Map<number, three.Mesh>) {
        this.players.forEach((p) => {
            common.updatePlayerPos(p);
            const playerMesh = textures.get(p.id);
            if (playerMesh) {
                playerMesh.position.set(p.position.x, 0, p.position.y);
            }
        });
    }
}

class Game {
    private zoomFactor = 1;
    private raycaster = new three.Raycaster();
    private mousePos = new three.Vector2();
    private cellHighlightMesh: three.LineLoop;
    private playerTextures = new Map<number, three.Mesh>();

    constructor(
        public scene: three.Scene,
        public renderer: three.WebGLRenderer,
        public camera: three.Camera,
        public ws: WebSocket,
        public state: State,
    ) {
        const outlineGeometry = new three.BufferGeometry();
        //prettier-ignore
        const outlineVertices = new Float32Array([
            -0.5, 0, -0.5,
            0.5, 0, -0.5,
            0.5, 0, 0.5,
            -0.5, 0, 0.5,
            -0.5, 0, -0.5,
        ]);
        outlineGeometry.setAttribute(
            "position",
            new three.BufferAttribute(outlineVertices, 3),
        );
        const outlineMaterial = new three.LineBasicMaterial({
            color: 0xffffff,
            linewidth: 5,
        });
        this.cellHighlightMesh = new three.LineLoop(
            outlineGeometry,
            outlineMaterial,
        );
        this.cellHighlightMesh.position.y = 0;
        this.cellHighlightMesh.visible = false;
        this.scene.add(this.cellHighlightMesh);
        this.setupCellRaycasting();
        this.setupWs();
        this.setupWheelCameraZoom();

        setInterval(() => {
            game.state.tick(this.playerTextures);
        }, 1000 / TPS);
    }

    public setupWs() {
        this.ws.binaryType = "arraybuffer";
        this.ws.addEventListener("open", () => {
            console.log("Socket connection open");
        });
        this.ws.addEventListener("close", () => {
            console.log("Socket connection closed");
        });
        this.ws.addEventListener("error", (event) => {
            //TODO: reconnect on errors
            console.log("Websocket error", event);
        });
        this.ws.addEventListener("message", (ev) => {
            assert(ev.data instanceof ArrayBuffer, "Expected binary message");
            assert(ev.data.byteLength >= 1, "Expected non-empty buffer");
            const buf = new Uint8Array(ev.data); // convert to Uint8array
            try {
                const { kind } = common.Packet.decode(buf);
                switch (kind) {
                    case common.PacketKind.Hello: {
                        const packet = common.HelloPacket.decode(buf);
                        console.log("Received hello packet", packet);
                        this.state.me = new common.Player(packet.id);
                        this.state.me.position.set(packet.x, packet.y);
                        this.state.me.color = new three.Color(packet.color);
                        this.state.players.set(this.state.me.id, this.state.me);
                        const playerMesh = common.boxFromColor(
                            this.state.me.color,
                        );
                        this.playerTextures.set(this.state.me.id, playerMesh);
                        this.scene.add(playerMesh);
                        break;
                    }
                    case common.PacketKind.PlayerJoin: {
                        const packet = common.PlayerJoinPacket.decode(buf);
                        console.log("Received player join packet", packet);
                        const player = new common.Player(packet.id);
                        player.position.set(packet.x, packet.y);
                        player.color = new three.Color(packet.color);
                        this.state.players.set(packet.id, player);
                        const playerMesh = common.boxFromColor(player.color);
                        this.playerTextures.set(player.id, playerMesh);
                        this.scene.add(playerMesh);
                        break;
                    }
                    case common.PacketKind.PlayerLeft: {
                        const packet = common.PlayerLeftPacket.decode(buf);
                        console.log("Received player left packet", packet);
                        this.state.players.delete(packet.id);
                        const playerMesh = this.playerTextures.get(packet.id);
                        if (playerMesh) {
                            this.playerTextures.delete(packet.id);
                            this.scene.remove(playerMesh);
                        }
                        break;
                    }
                    case common.PacketKind.PlayerMoving: {
                        const packet = common.PlayerMovingPacket.decode(buf);
                        console.log("Received player moving packet", packet);
                        const player = this.state.players.get(packet.id);
                        if (!player) {
                            console.log(
                                `Received message for unknown player ${packet.id}`,
                            );
                            this.ws.close();
                            return;
                        }
                        player.moveTarget = new three.Vector2(
                            packet.targetX,
                            packet.targetY,
                        );
                        break;
                    }
                }
            } catch (error) {
                console.error("Invalid message", error);
                ws.close(1003, "Invalid message");
            }
        });
    }

    public render() {
        function frame() {
            renderer.render(scene, camera);
        }

        renderer.setAnimationLoop(frame);
    }

    private setupWheelCameraZoom() {
        renderer.domElement.addEventListener("wheel", (event) => {
            const zoomSpeed = 0.1;
            const newZoomFactor =
                this.zoomFactor + (event.deltaY > 0 ? zoomSpeed : -zoomSpeed);
            this.updateCameraZoom(Math.max(0.1, Math.min(newZoomFactor, 5))); // Limit zoom between 0.1 and 5
        });
    }

    private updateCameraZoom(newZoomFactor: number) {
        this.zoomFactor = newZoomFactor;
        camera.left = -d * aspect * this.zoomFactor;
        camera.right = d * aspect * this.zoomFactor;
        camera.top = d * this.zoomFactor;
        camera.bottom = -d * this.zoomFactor;
        camera.updateProjectionMatrix();
    }

    private setupCellRaycasting() {
        this.renderer.domElement.addEventListener(
            "mousemove",
            (e: MouseEvent) => {
                this.raycastMouseInGrid(e, (cell) => {
                    if (!cell) {
                        this.cellHighlightMesh.visible = false;
                        return;
                    }

                    this.cellHighlightMesh.position.set(
                        cell.x + 0.5,
                        0,
                        cell.y + 0.5,
                    );
                    this.cellHighlightMesh.visible = true;
                });
            },
        );

        renderer.domElement.addEventListener("click", (e: MouseEvent) => {
            this.raycastMouseInGrid(e, (cell) => {
                if (!cell) return;
                if (!this.state.me) return;
                this.state.me.moveTarget = cell;
                const packet = new common.PlayerMovingPacket(
                    this.state.me.id,
                    this.state.me.moveTarget.x,
                    this.state.me.moveTarget.y,
                ).encode();
                this.ws.send(packet);
            });
        });
    }

    private raycastMouseInGrid(
        e: MouseEvent,
        cb: (cell: three.Vector2 | null) => void,
    ) {
        this.mousePos.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mousePos.y = -(e.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mousePos, camera);
        const intersects = this.raycaster.intersectObject(grid);
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const cellX = Math.round(point.x);
            const cellZ = Math.round(point.z);
            cb(new three.Vector2(cellX, cellZ));
            return;
        }
        cb(null);
    }
}

const renderer = new three.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x202020);
document.body.appendChild(renderer.domElement);

const scene = new three.Scene();

const DEFAULT_ZOOM_FACTOR = 0.5;
const aspect = window.innerWidth / window.innerHeight;
const d = 10;
const camera = new three.OrthographicCamera(
    -d * aspect * DEFAULT_ZOOM_FACTOR,
    d * aspect * DEFAULT_ZOOM_FACTOR,
    d * DEFAULT_ZOOM_FACTOR,
    -d * DEFAULT_ZOOM_FACTOR,
    1,
    1000,
);
camera.position.set(d, d, d);
camera.lookAt(scene.position);

const grid = new three.GridHelper(
    common.MAP_SIZE.x,
    common.MAP_SIZE.y,
    0x888888,
);
grid.position.y = -1;
scene.add(grid);

const ws = new WebSocket(
    `ws://${window.location.hostname}:${common.SERVER_PORT}`,
);
const state = new State();
const game = new Game(scene, renderer, camera, ws, state);

game.render();
//@ts-ignore
window.DEBUG = function () {
    console.log(game);
};
