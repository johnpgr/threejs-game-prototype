import * as three from "three";

//renderer
const renderer = new three.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x202020);
document.body.appendChild(renderer.domElement);
//scene
const scene = new three.Scene();

//camera
const aspect = window.innerWidth / window.innerHeight;
const d = 10;
const camera = new three.OrthographicCamera(
    -d * aspect,
    d * aspect,
    d,
    -d,
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
const grid = new three.GridHelper(64, 64);
grid.position.y = -1;
scene.add(grid);
//scene.add(new three.AxesHelper(50));

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
    constructor(
        public scene: three.Scene,
        public renderer: three.WebGLRenderer,
        public camera: three.Camera,
        public state: State,
    ) {
        this.scene.add(this.state.player.mesh);
    }

    public render() {
        function frame() {
            renderer.render(scene, camera);
        }

        renderer.setAnimationLoop(frame);
    }
}

const player = new Player(new three.Vector2(0, 0), new three.Color(0xff0000));
const state = new State(player);
const game = new Game(scene, renderer, camera, state);
game.render();
