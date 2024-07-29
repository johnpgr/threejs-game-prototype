import * as three from "three";
import * as addons from "three/addons/renderers/CSS3DRenderer.js";
import * as common from "./common";
import { assert } from "./utils";

const TPS = 30;

class State {
    public me: common.Player | undefined;
    public players = new Map<number, common.Player>();
    private lastTimestamp = performance.now();

    public tick(textures: Map<number, three.Mesh>) {
        const now = performance.now();
        const deltaTime = (now - this.lastTimestamp) / 1000;
        this.lastTimestamp = now;

        this.players.forEach((p) => {
            common.updatePlayerPos(p, deltaTime);
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
    private playerUIs = new Map<number, addons.CSS3DObject>();

    constructor(
        public scene: three.Scene,
        public renderer: three.WebGLRenderer,
        public rendererCss: addons.CSS3DRenderer,
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
            linewidth: 4,
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
        //this.setupWheelCameraZoom();

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
                        console.log(`Connected as player ${packet.id}`);
                        this.state.me = new common.Player(packet.id);
                        this.state.me.position.set(packet.x, packet.y);
                        this.state.me.color = new three.Color(packet.color);
                        this.state.players.set(this.state.me.id, this.state.me);
                        const playerMesh = common.boxFromColor(
                            this.state.me.color,
                        );
                        const playerUI = this.createPlayerUI(this.state.me);
                        this.playerTextures.set(this.state.me.id, playerMesh);
                        this.playerUIs.set(this.state.me.id, playerUI);
                        this.scene.add(playerMesh);
                        this.scene.add(playerUI);
                        break;
                    }
                    case common.PacketKind.PlayerJoinBatch: {
                        const packet = common.PlayerJoinBatchPacket.decode(buf);
                        for (const p of packet.players) {
                            if (p.id === this.state.me?.id) continue;
                            const player = new common.Player(
                                p.id,
                                new three.Vector2().set(p.x, p.y),
                                new three.Color(p.color),
                            );
                            console.log(`Player joined: ${player.id}`);
                            this.state.players.set(p.id, player);
                            const playerMesh = common.boxFromColor(
                                player.color!,
                            );
                            const playerUI = this.createPlayerUI(player);
                            this.playerTextures.set(player.id, playerMesh);
                            this.playerUIs.set(player.id, playerUI);
                            this.scene.add(playerMesh);
                            this.scene.add(playerUI);
                        }
                        break;
                    }
                    case common.PacketKind.PlayerLeftBatch: {
                        const packet = common.PlayerLeftBatchPacket.decode(buf);
                        for (const id of packet.playerIds) {
                            console.log(`Player left: ${id}`);
                            this.state.players.delete(id);
                            const playerMesh = this.playerTextures.get(id);
                            const playerUI = this.playerUIs.get(id);
                            if (playerMesh) {
                                this.playerTextures.delete(id);
                                this.scene.remove(playerMesh);
                            }
                            if (playerUI) {
                                this.playerUIs.delete(id);
                                this.scene.remove(playerUI);
                            }
                        }
                        break;
                    }
                    case common.PacketKind.PlayerMovingBatch: {
                        const packet =
                            common.PlayerMovingBatchPacket.decode(buf);
                        for (const move of packet.moves) {
                            const player = this.state.players.get(move.id);
                            if (!player) {
                                console.log(
                                    `Received message for unknown player ${move.id}`,
                                );
                                this.ws.close();
                                return;
                            }
                            player.moveTarget = new three.Vector2(
                                move.targetX,
                                move.targetY,
                            );
                        }
                        break;
                    }
                }
            } catch (error) {
                console.error("Invalid message", error);
                ws.close(1003, "Invalid message");
            }
        });
    }

    public animate() {
        this.renderer.setAnimationLoop(this.animate.bind(this));
        for (const [id, ui] of this.playerUIs.entries()) {
            const player = this.state.players.get(id);
            if (!player) continue;
            // Position the UI to the right of the player's cube
            ui.position.copy(
                new three.Vector3(player.position.x, 0, player.position.y),
            );
            ui.position.x += 2.5; // Adjust this value to change the UI's distance from the player
            ui.position.y += 2; // Adjust this to change the vertical position of the UI

            // Make the UI always face the camera
            ui.quaternion.copy(camera.quaternion);
        }

        this.renderer.render(scene, camera);
        this.rendererCss.render(scene, camera);
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

    createPlayerUI(player: common.Player): addons.CSS3DObject {
        const div = document.createElement("div");
        div.style.width = "300px";
        div.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
        div.style.color = "white";
        div.style.padding = "10px";
        div.style.borderRadius = "5px";
        div.style.fontFamily = "monospace";
        div.style.fontSize = "18px";

        const updateUI = () => {
            div.innerHTML = `<pre>${JSON.stringify(player, null, 4)}</pre>`;
        };

        updateUI();

        // Create a CSS3DObject with the div
        const css3dObject = new addons.CSS3DObject(div);
        css3dObject.scale.set(0.01, 0.01, 0.01); // Scale down the CSS object to match your scene scale

        // Update the UI periodically
        setInterval(updateUI, 100);

        return css3dObject;
    }
}

const scene = new three.Scene();
const renderer = new three.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x202020);
document.body.appendChild(renderer.domElement);

const rendererCss = new addons.CSS3DRenderer();
rendererCss.setSize(window.innerWidth, window.innerHeight);
rendererCss.domElement.style.position = "absolute";
rendererCss.domElement.style.top = "0";
rendererCss.domElement.style.pointerEvents = "none";
document.body.appendChild(rendererCss.domElement);

const DEFAULT_ZOOM_FACTOR = 0.8;
let aspect = window.innerWidth / window.innerHeight;
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

window.addEventListener(
    "resize",
    () => {
        aspect = window.innerWidth / window.innerHeight;
        camera.left = -d * aspect * DEFAULT_ZOOM_FACTOR;
        camera.right = d * aspect * DEFAULT_ZOOM_FACTOR;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        rendererCss.setSize(window.innerWidth, window.innerHeight);
    },
    false,
);

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
const game = new Game(scene, renderer, rendererCss, camera, ws, state);
game.animate();

//@ts-ignore
window.DEBUG = function () {
    console.log(game);
};
