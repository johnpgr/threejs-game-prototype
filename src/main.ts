import * as three from "three";

class Player {
    public mesh: three.Mesh;

    constructor(
        public position: three.Vector2,
        public color: three.Color,
    ) {
        const geometry = new three.BoxGeometry(1, 1, 1);
        const material = new three.MeshBasicMaterial({ color: color });
        const cube = new three.Mesh(geometry, material);
        cube.position.set(position.x, 0, position.y);
        this.mesh = cube;
    }
}

class State {
    constructor(public player: Player) {}

    public update() {
        //TODO
    }
}

class Game {
    private zoomFactor = 1;
    private raycaster = new three.Raycaster();
    private mousePos = new three.Vector2();
    private cellHighlightMesh: three.LineLoop;

    constructor(
        public scene: three.Scene,
        public renderer: three.WebGLRenderer,
        public camera: three.Camera,
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
        this.scene.add(this.state.player.mesh);
        this.setupCellRaycasting();
        this.setupWheelCameraZoom();
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
                if (!cell) {
                    return;
                }

                player.position = cell;
                player.mesh.position.set(cell.x, 0, cell.y);
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

//renderer
const renderer = new three.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x202020);
document.body.appendChild(renderer.domElement);

//scene
const scene = new three.Scene();

//camera
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

//light
scene.add(new three.AmbientLight(0x444444));
const light = new three.PointLight(0xffffff, 0.8);
light.position.set(0, 50, 50);
scene.add(light);

//scene helpers
const grid = new three.GridHelper(64, 64, 0x888888);
grid.position.y = -1;
scene.add(grid);
//scene.add(new three.AxesHelper(50));

const player = new Player(new three.Vector2(0, 0), new three.Color(0xff0000));
const state = new State(player);
const game = new Game(scene, renderer, camera, state);

game.render();
