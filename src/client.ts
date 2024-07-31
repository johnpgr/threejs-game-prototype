import * as three from "three";
import * as addons from "three/addons/renderers/CSS3DRenderer.js";
import * as common from "./common";
import { objectToFriendlyString, unreachable } from "./utils";
import Stats from "three/addons/libs/stats.module.js";

const TPS = 60;
const DEFAULT_ZOOM_FACTOR = 1.0;
const CAMERA_DISTANCE = 10;

class State {
    public me: common.Player | undefined;
    public players = new Map<number, common.Player>();
    private lastTimestamp = performance.now();
    constructor(private textures: Map<number, three.Mesh>) {
        //@ts-ignore
        window.DEBUG = () => {
            console.log(this);
        };
    }

    public tick = () => {
        const now = performance.now();
        const deltaTime = (now - this.lastTimestamp) / 1000;
        this.lastTimestamp = now;

        this.players.forEach((p) => {
            common.updatePlayerPos(p, deltaTime);
            const playerMesh = this.textures.get(p.id);
            if (playerMesh) {
                playerMesh.position.set(p.position.x, 0.01, p.position.y);
            }
        });
    };
}

namespace Game {
    let zoomFactor = 1;
    let screenWidth = window.innerWidth;
    let screenHeight = window.innerHeight;
    let aspect = screenWidth / screenHeight;
    const scene = new three.Scene();
    const ws = createWs();
    const stats = createStats();
    const rendererCss = createRendererCss();
    const camera = createCamera();
    const renderer = createRenderer();
    const playerTextures = new Map<number, three.Mesh>();
    const playerUIs = new Map<number, addons.CSS3DObject>();
    const state = new State(playerTextures);
    const raycaster = new three.Raycaster();
    const mousePos = new three.Vector2();

    export function start() {
        startGrid();
        startResizeListener();
        startMouseCellRaycasting();
        startMouseWheelCameraZoom();
        setInterval(state.tick, 1000 / TPS);
        animate();
    }

    function startResizeListener() {
        window.document.addEventListener("resize", () => {
            screenWidth = window.innerWidth;
            screenHeight = window.innerHeight;
            aspect = screenWidth / screenHeight;
            renderer.setSize(screenWidth, screenHeight);
            rendererCss.setSize(screenWidth, screenHeight);
            camera.left = -CAMERA_DISTANCE * aspect * zoomFactor;
            camera.right = CAMERA_DISTANCE * aspect * zoomFactor;
            camera.updateProjectionMatrix();
        });
    }

    export function startGrid() {
        const grid = new three.GridHelper(
            common.MAP_WIDTH*2,
            common.MAP_HEIGHT*2,
            0x888888,
        );
        grid.material.depthWrite = false;
        scene.add(grid);
    }

    function createCamera(): three.OrthographicCamera {
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

        return camera;
    }

    function createRendererCss(): addons.CSS3DRenderer {
        const rendererCss = new addons.CSS3DRenderer();
        rendererCss.setSize(screenWidth, screenHeight);
        rendererCss.domElement.style.pointerEvents = "none";
        rendererCss.domElement.style.position = "absolute";
        rendererCss.domElement.style.top = "0";
        rendererCss.domElement.style.left = "0";
        document.body.appendChild(rendererCss.domElement);

        return rendererCss;
    }

    function createStats(): Stats {
        const stats = new Stats();
        stats.dom.style.position = "absolute";
        stats.dom.style.top = "0";
        stats.dom.style.left = "0";
        stats.dom.style.pointerEvents = "none";
        stats.dom.style.zIndex = "999";
        document.body.appendChild(stats.dom);

        return stats;
    }

    function createRenderer(): three.WebGLRenderer {
        const renderer = new three.WebGLRenderer();
        renderer.setSize(screenWidth, screenHeight);
        renderer.setClearColor(0x000000);
        document.body.appendChild(renderer.domElement);

        return renderer;
    }

    function createWs(): WebSocket {
        const ws = new WebSocket(
            `ws://${window.location.hostname}:${common.SERVER_PORT}`,
        );
        ws.binaryType = "arraybuffer";
        ws.addEventListener("open", () => {
            console.log("Socket connection open");
        });
        ws.addEventListener("close", () => {
            console.log("Socket connection closed");
        });
        ws.addEventListener("error", (event) => {
            //TODO: reconnect on errors
            console.log("Websocket error", event);
        });
        ws.addEventListener("message", handleIncomingMessage);
        return ws;
    }

    function handleIncomingMessage(ev: MessageEvent) {
        if (!(ev.data instanceof ArrayBuffer)) {
            ws.close(1003, "Invalid message");
            return;
        }
        if (ev.data.byteLength < 1) {
            ws.close(1003, "Invalid message");
            return;
        }
        try {
            const buf = new Uint8Array(ev.data);
            const { kind } = common.Packet.decode(buf);
            switch (kind) {
                case common.PacketKind.Hello: {
                    handleHello(buf);
                    break;
                }
                case common.PacketKind.PlayerJoinBatch: {
                    handlePlayerJoin(buf);
                    break;
                }
                case common.PacketKind.PlayerLeftBatch: {
                    handlePlayerLeft(buf);
                    break;
                }
                case common.PacketKind.PlayerMovingBatch: {
                    handlePlayerMoving(buf);
                    break;
                }
                default: {
                    unreachable("Unexpected packet kind");
                }
            }
        } catch (error) {
            console.error("Error handling message:", error);
            ws.close(1000, "Invalid message");
        }
    }

    function handleHello(buf: Uint8Array) {
        const packet = common.HelloPacket.decode(buf);
        console.log(`Connected as player ${packet.id}`);
        state.me = new common.Player(packet.id);
        state.me.position.set(packet.x, packet.y);
        state.me.color = new three.Color(packet.color);
        state.players.set(state.me.id, state.me);
        const playerMesh = common.boxFromColor(state.me.color);
        const playerUI = createPlayerUI(state.me);
        playerTextures.set(state.me.id, playerMesh);
        playerUIs.set(state.me.id, playerUI);
        scene.add(playerMesh);
        scene.add(playerUI);
        packet.map.createMeshes(scene);
    }

    function handlePlayerJoin(buf: Uint8Array) {
        const packet = common.PlayerJoinBatchPacket.decode(buf);
        for (const p of packet.players) {
            if (p.id === state.me?.id) continue;
            const player = new common.Player(
                p.id,
                new three.Vector2().set(p.x, p.y),
                new three.Color(p.color),
            );
            console.log(`Player joined: ${player.id}`);
            state.players.set(p.id, player);
            const playerMesh = common.boxFromColor(player.color!);
            const playerUI = createPlayerUI(player);
            playerTextures.set(player.id, playerMesh);
            playerUIs.set(player.id, playerUI);
            scene.add(playerMesh);
            scene.add(playerUI);
        }
    }

    function handlePlayerLeft(buf: Uint8Array) {
        const packet = common.PlayerLeftBatchPacket.decode(buf);
        for (const id of packet.playerIds) {
            console.log(`Player left: ${id}`);
            state.players.delete(id);
            const playerMesh = playerTextures.get(id);
            const playerUI = playerUIs.get(id);
            if (playerMesh) {
                playerTextures.delete(id);
                scene.remove(playerMesh);
            }
            if (playerUI) {
                playerUIs.delete(id);
                scene.remove(playerUI);
            }
        }
    }

    function handlePlayerMoving(buf: Uint8Array) {
        const packet = common.PlayerMovingBatchPacket.decode(buf);
        for (const move of packet.moves) {
            const player = state.players.get(move.id);
            if (!player) {
                console.log(`Received message for unknown player ${move.id}`);
                ws.close();
                return;
            }
            player.moveTarget = new three.Vector2(move.targetX, move.targetY);
        }
    }

    function animate() {
        stats.begin();
        renderer.setAnimationLoop(animate);
        for (const [id, ui] of playerUIs.entries()) {
            const player = state.players.get(id);
            if (!player) continue;
            // Position the UI to the right of the player's cube
            ui.position.copy(
                new three.Vector3(player.position.x, 0, player.position.y),
            );
            ui.position.x += 2.5; // Adjust value to change the UI's distance from the player
            ui.position.y += 2; // Adjust to change the vertical position of the UI

            // Make the UI always face the camera
            ui.quaternion.copy(camera.quaternion);
        }
        renderer.render(scene, camera);
        //rendererCss.render(scene, camera);
        stats.end();
    }

    function startMouseWheelCameraZoom() {
        renderer.domElement.addEventListener("wheel", (event) => {
            const zoomSpeed = 0.1;
            const newZoomFactor =
                zoomFactor + (event.deltaY > 0 ? zoomSpeed : -zoomSpeed);
            updateCameraZoom(Math.max(0.1, Math.min(newZoomFactor, 5))); // Limit zoom between 0.1 and 5
        });
    }

    function updateCameraZoom(newZoomFactor: number) {
        zoomFactor = newZoomFactor;
        camera.left = -CAMERA_DISTANCE * aspect * zoomFactor;
        camera.right = CAMERA_DISTANCE * aspect * zoomFactor;
        camera.top = CAMERA_DISTANCE * zoomFactor;
        camera.bottom = -CAMERA_DISTANCE * zoomFactor;
        camera.updateProjectionMatrix();
    }

    function startMouseCellRaycasting() {
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
        const cellHighlightMesh = new three.LineLoop(
            outlineGeometry,
            outlineMaterial,
        );
        cellHighlightMesh.visible = false;
        scene.add(cellHighlightMesh);

        renderer.domElement.addEventListener("mousemove", (e: MouseEvent) => {
            raycastMouseInGrid(e, (cell) => {
                if (!cell) {
                    cellHighlightMesh.visible = false;
                    return;
                }

                cellHighlightMesh.position.set(cell.x + 0.5, 0.02, cell.y + 0.5);
                cellHighlightMesh.visible = true;
            });
        });

        renderer.domElement.addEventListener("click", (e: MouseEvent) => {
            raycastMouseInGrid(e, (cell) => {
                if (!cell) return;
                if (!state.me) return;
                state.me.moveTarget = cell;
                const packet = new common.PlayerMovingPacket(
                    state.me.id,
                    state.me.moveTarget.x,
                    state.me.moveTarget.y,
                ).encode();
                ws.send(packet);
            });
        });
    }

    function raycastMouseInGrid(
        e: MouseEvent,
        callback: (cell: three.Vector2 | null) => void,
    ) {
        // Get the bounding rectangle of the renderer's DOM element
        const rect = renderer.domElement.getBoundingClientRect();

        // Calculate mouse position relative to the canvas
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Convert to normalized device coordinates (-1 to +1)
        mousePos.x = (mouseX / rect.width) * 2 - 1;
        mousePos.y = -(mouseY / rect.height) * 2 + 1;

        raycaster.setFromCamera(mousePos, camera);
        const plane = new three.Plane(new three.Vector3(0, 1, 0), 0);
        const intersectionPoint = new three.Vector3();
        raycaster.ray.intersectPlane(plane, intersectionPoint);

        if (intersectionPoint) {
            const cellX = Math.round(intersectionPoint.x);
            const cellZ = Math.round(intersectionPoint.z);
            callback(new three.Vector2(cellX, cellZ));
        } else {
            callback(null);
        }
    }

    function createPlayerUI(player: common.Player): addons.CSS3DObject {
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

Game.start();
