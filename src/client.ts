import * as three from "three";
import * as addons from "three/addons/renderers/CSS3DRenderer.js";
import * as common from "./common";
import { objectToFriendlyString, unreachable } from "./utils";
import Stats from "three/addons/libs/stats.module.js";

const TPS = 60;
const GAME_WIDTH = window.innerWidth;
const GAME_HEIGHT = window.innerHeight;
const DEFAULT_ZOOM_FACTOR = 1.0;
const CAMERA_DISTANCE = 10;
let aspect = GAME_WIDTH / GAME_HEIGHT;

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
                playerMesh.position.set(p.position.x, 0.01, p.position.y);
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
        public camera: three.OrthographicCamera,
        public ws: WebSocket,
        public state: State,
        public stats: Stats,
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
        this.cellHighlightMesh.position.y = 0.01;
        this.cellHighlightMesh.visible = false;
        this.scene.add(this.cellHighlightMesh);
        this.setupCellRaycasting();
        this.setupWs();
        this.setupWheelCameraZoom();

        setInterval(() => {
            this.state.tick(this.playerTextures);
        }, 1000 / TPS);
    }

    private setupWs() {
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
        this.ws.addEventListener(
            "message",
            this.handleIncomingMessage.bind(this),
        );
    }

    private handleIncomingMessage(ev: MessageEvent) {
        if (!(ev.data instanceof ArrayBuffer)) {
            this.ws.close(1003, "Invalid message");
            return;
        }
        if (ev.data.byteLength < 1) {
            this.ws.close(1003, "Invalid message");
            return;
        }
        try {
            const buf = new Uint8Array(ev.data);
            const { kind } = common.Packet.decode(buf);
            switch (kind) {
                case common.PacketKind.Hello: {
                    this.handleHello(buf);
                    break;
                }
                case common.PacketKind.PlayerJoinBatch: {
                    this.handlePlayerJoin(buf);
                    break;
                }
                case common.PacketKind.PlayerLeftBatch: {
                    this.handlePlayerLeft(buf);
                    break;
                }
                case common.PacketKind.PlayerMovingBatch: {
                    this.handlePlayerMoving(buf);
                    break;
                }
                case common.PacketKind.PlayerMoving: {
                    unreachable("Unexpected packet kind");
                }
            }
        } catch (error) {
            console.error("Error handling message:", error);
            this.ws.close(1003, "Invalid message");
        }
    }

    private handleHello(buf: Uint8Array) {
        const packet = common.HelloPacket.decode(buf);
        console.log(`Connected as player ${packet.id}`);
        this.state.me = new common.Player(packet.id);
        this.state.me.position.set(packet.x, packet.y);
        this.state.me.color = new three.Color(packet.color);
        this.state.players.set(this.state.me.id, this.state.me);
        const playerMesh = common.boxFromColor(this.state.me.color);
        const playerUI = this.createPlayerUI(this.state.me);
        this.playerTextures.set(this.state.me.id, playerMesh);
        this.playerUIs.set(this.state.me.id, playerUI);
        this.scene.add(playerMesh);
        this.scene.add(playerUI);
    }

    private handlePlayerJoin(buf: Uint8Array) {
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
            const playerMesh = common.boxFromColor(player.color!);
            const playerUI = this.createPlayerUI(player);
            this.playerTextures.set(player.id, playerMesh);
            this.playerUIs.set(player.id, playerUI);
            this.scene.add(playerMesh);
            this.scene.add(playerUI);
        }
    }

    private handlePlayerLeft(buf: Uint8Array) {
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
    }

    private handlePlayerMoving(buf: Uint8Array) {
        const packet = common.PlayerMovingBatchPacket.decode(buf);
        for (const move of packet.moves) {
            const player = this.state.players.get(move.id);
            if (!player) {
                console.log(`Received message for unknown player ${move.id}`);
                this.ws.close();
                return;
            }
            player.moveTarget = new three.Vector2(move.targetX, move.targetY);
        }
    }

    public animate() {
        this.stats.begin();
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
            ui.quaternion.copy(this.camera.quaternion);
        }
        this.renderer.render(this.scene, this.camera);
        this.rendererCss.render(this.scene, this.camera);
        this.stats.end();
    }

    private setupWheelCameraZoom() {
        this.renderer.domElement.addEventListener("wheel", (event) => {
            const zoomSpeed = 0.1;
            const newZoomFactor =
                this.zoomFactor + (event.deltaY > 0 ? zoomSpeed : -zoomSpeed);
            this.updateCameraZoom(Math.max(0.1, Math.min(newZoomFactor, 5))); // Limit zoom between 0.1 and 5
        });
    }

    private updateCameraZoom(newZoomFactor: number) {
        this.zoomFactor = newZoomFactor;
        this.camera.left = -CAMERA_DISTANCE * aspect * this.zoomFactor;
        this.camera.right = CAMERA_DISTANCE * aspect * this.zoomFactor;
        this.camera.top = CAMERA_DISTANCE * this.zoomFactor;
        this.camera.bottom = -CAMERA_DISTANCE * this.zoomFactor;
        this.camera.updateProjectionMatrix();
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

        this.renderer.domElement.addEventListener("click", (e: MouseEvent) => {
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
        callback: (cell: three.Vector2 | null) => void,
    ) {
        // Get the bounding rectangle of the renderer's DOM element
        const rect = this.renderer.domElement.getBoundingClientRect();

        // Calculate mouse position relative to the canvas
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Convert to normalized device coordinates (-1 to +1)
        this.mousePos.x = (mouseX / rect.width) * 2 - 1;
        this.mousePos.y = -(mouseY / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mousePos, this.camera);
        const plane = new three.Plane(new three.Vector3(0, 1, 0), 0);
        const intersectionPoint = new three.Vector3();
        this.raycaster.ray.intersectPlane(plane, intersectionPoint);

        if (intersectionPoint) {
            const cellX = Math.round(intersectionPoint.x);
            const cellZ = Math.round(intersectionPoint.z);
            callback(new three.Vector2(cellX, cellZ));
        } else {
            callback(null);
        }
    }

    private createPlayerUI(player: common.Player): addons.CSS3DObject {
        const div = document.createElement("div");
        div.style.width = "300px";
        div.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
        div.style.color = "white";
        div.style.padding = "10px";
        div.style.borderRadius = "5px";
        div.style.fontFamily = "monospace";
        div.style.fontSize = "18px";
        div.style.pointerEvents = "none";

        const updateUI = () => {
            div.innerHTML = `<pre>${objectToFriendlyString({
                id: player.id,
                position: {
                    x: player.position.x.toFixed(2),
                    y: player.position.y.toFixed(2),
                },
                color: { hsl: player.color?.getHexString() },
                moveSpeed: player.speed.toFixed(2),
                moveTarget: player.moveTarget
                    ? {
                          x: player.moveTarget.x.toFixed(2),
                          y: player.moveTarget.y.toFixed(2),
                      }
                    : null,
            })}</pre>`;
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

main();

function main() {
    const scene = new three.Scene();
    const renderer = new three.WebGLRenderer();
    renderer.setSize(GAME_WIDTH, GAME_HEIGHT);
    renderer.setClearColor(0x000000);
    document.body.appendChild(renderer.domElement);

    const rendererCss = new addons.CSS3DRenderer();
    rendererCss.setSize(GAME_WIDTH, GAME_HEIGHT);
    rendererCss.domElement.style.pointerEvents = "none";
    rendererCss.domElement.style.position = "absolute";
    rendererCss.domElement.style.top = "0";
    rendererCss.domElement.style.left = "0";
    document.body.appendChild(rendererCss.domElement);

    const camera = new three.OrthographicCamera(
        -CAMERA_DISTANCE * aspect * DEFAULT_ZOOM_FACTOR,
        CAMERA_DISTANCE * aspect * DEFAULT_ZOOM_FACTOR,
        CAMERA_DISTANCE * DEFAULT_ZOOM_FACTOR,
        -CAMERA_DISTANCE * DEFAULT_ZOOM_FACTOR,
        1,
        1000,
    );
    camera.position.set(CAMERA_DISTANCE, CAMERA_DISTANCE, CAMERA_DISTANCE);
    camera.lookAt(scene.position);

    const grid = new three.GridHelper(
        common.MAP_WIDTH,
        common.MAP_HEIGHT,
        0x888888,
    );
    grid.material.depthWrite = false;
    scene.add(grid);

    const stats = new Stats();
    stats.dom.style.position = "absolute";
    stats.dom.style.top = "0";
    stats.dom.style.left = "0";
    stats.dom.style.pointerEvents = "none";
    stats.dom.style.zIndex = "999";
    // Add it to the document
    document.body.appendChild(stats.dom);

    const ws = new WebSocket(
        `ws://${window.location.hostname}:${common.SERVER_PORT}`,
    );
    const state = new State();
    const game = new Game(
        scene,
        renderer,
        rendererCss,
        camera,
        ws,
        state,
        stats,
    );
    game.animate();

    //@ts-ignore
    window.DEBUG = function () {
        console.log(game.state);
    };
}
