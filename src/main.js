import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank.js';
import { Warhound } from './Warhound.js';
import { Terrain } from './Terrain.js';
import { Controls } from './Controls.js';
import { ThirdPersonCamera } from './Camera.js';
import { TargetManager } from './Target.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.clock = new THREE.Clock();
    this.vehicle = null;
    this.selectedVehicle = null;
    this.selectedIndex = 0;
    this.previewScene = null;
    this.previewCamera = null;
    this.previewRenderer = null;
    this.previewControls = null;
    this.previewModel = null;
    this.previewFrameId = null;
    this.previewLoader = null;
    this.previewLoadToken = 0;
    this.previewContainer = document.getElementById('unit-preview');
    this.vehicles = [
      { id: 'tank', name: 'Iron Bastion', desc: 'Heavy Battle Tank', model: 'bastion.glb' },
      { id: 'warhound', name: 'Warhound Titan', desc: 'Assault Walker', model: 'warhound.glb' }
    ];

    this.setupMenu();
    this.initPreview();
    window.addEventListener('resize', () => this.onResize());
  }

  setupMenu() {
    const prevBtn = document.getElementById('unit-prev');
    const nextBtn = document.getElementById('unit-next');
    const selectBtn = document.getElementById('unit-select');

    prevBtn.addEventListener('click', () => this.selectIndex(this.selectedIndex - 1));
    nextBtn.addEventListener('click', () => this.selectIndex(this.selectedIndex + 1));
    selectBtn.addEventListener('click', () => this.startGame());

    window.addEventListener('keydown', (e) => {
      if (document.getElementById('start-menu').classList.contains('hidden')) return;
      if (e.code === 'ArrowLeft') this.selectIndex(this.selectedIndex - 1);
      if (e.code === 'ArrowRight') this.selectIndex(this.selectedIndex + 1);
      if (e.code === 'Enter') this.startGame();
    });
  }

  initPreview() {
    if (!this.previewContainer) return;

    this.previewScene = new THREE.Scene();
    this.previewCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
    this.previewCamera.position.set(0, 2, 6);

    this.previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.previewRenderer.toneMappingExposure = 1.0;
    this.previewContainer.appendChild(this.previewRenderer.domElement);

    const hemi = new THREE.HemisphereLight(0x9bc8ff, 0x3d2c1e, 0.9);
    this.previewScene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(6, 10, 4);
    this.previewScene.add(key);
    const rim = new THREE.DirectionalLight(0x7ad6ff, 0.6);
    rim.position.set(-6, 6, -6);
    this.previewScene.add(rim);

    this.previewControls = new OrbitControls(this.previewCamera, this.previewRenderer.domElement);
    this.previewControls.enablePan = false;
    this.previewControls.enableDamping = true;
    this.previewControls.dampingFactor = 0.08;
    this.previewControls.minDistance = 2;
    this.previewControls.maxDistance = 12;

    this.previewLoader = new GLTFLoader();
    this.selectIndex(0);
    this.previewAnimate();
    this.onResize();
  }

  previewAnimate() {
    this.previewFrameId = requestAnimationFrame(() => this.previewAnimate());
    if (this.previewControls) this.previewControls.update();
    if (this.previewRenderer && this.previewScene && this.previewCamera) {
      this.previewRenderer.render(this.previewScene, this.previewCamera);
    }
  }

  disposePreviewModel() {
    if (!this.previewModel) return;
    this.previewScene.remove(this.previewModel);
    this.previewModel.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });
    this.previewModel = null;
  }

  loadPreviewModel(modelPath) {
    if (!this.previewLoader) return;
    const token = ++this.previewLoadToken;
    this.previewLoader.load(modelPath, (gltf) => {
      if (token !== this.previewLoadToken) return;

      this.disposePreviewModel();
      this.previewModel = gltf.scene;

      const box = new THREE.Box3().setFromObject(this.previewModel);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      this.previewModel.position.sub(center);
      const minY = box.min.y - center.y;
      this.previewModel.position.y -= minY;

      this.previewScene.add(this.previewModel);

      const radius = Math.max(size.x, size.y, size.z) * 0.6;
      const distance = Math.max(radius * 3, 3.5);
      this.previewCamera.position.set(0, radius * 1.1, distance);
      this.previewControls.target.set(0, radius * 0.7, 0);
      this.previewControls.update();
    });
  }

  selectIndex(index) {
    const max = this.vehicles.length;
    this.selectedIndex = (index + max) % max;
    const vehicle = this.vehicles[this.selectedIndex];
    this.selectedVehicle = vehicle.id;
    document.getElementById('unit-name').textContent = vehicle.name;
    document.getElementById('unit-desc').textContent = vehicle.desc;
    this.loadPreviewModel(vehicle.model);
  }

  async startGame() {
    // Hide menu
    document.getElementById('start-menu').classList.add('hidden');

    // Show game UI
    document.querySelectorAll('.game-ui').forEach(el => el.classList.add('active'));

    this.teardownPreview();
    await this.init();
  }

  teardownPreview() {
    if (this.previewFrameId) {
      cancelAnimationFrame(this.previewFrameId);
      this.previewFrameId = null;
    }
    this.disposePreviewModel();
    if (this.previewControls) {
      this.previewControls.dispose();
      this.previewControls = null;
    }
    if (this.previewRenderer) {
      this.previewRenderer.dispose();
      if (this.previewRenderer.domElement && this.previewRenderer.domElement.parentNode) {
        this.previewRenderer.domElement.parentNode.removeChild(this.previewRenderer.domElement);
      }
      this.previewRenderer = null;
    }
    this.previewScene = null;
    this.previewCamera = null;
  }

  async init() {
    try {
      console.log('Starting game init...');

      // Renderer setup
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      document.getElementById('game-container').appendChild(this.renderer.domElement);
      console.log('Renderer ready');

      // Initialize Rapier physics
      await RAPIER.init();
      this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      console.log('Physics ready');

      // Lighting
      this.setupLighting();
      console.log('Lighting ready');

      // Create terrain
      this.terrain = new Terrain(this.scene, this.world);
      console.log('Terrain ready');

      // Create targets
      this.targetManager = new TargetManager(this.scene, this.world);
      this.targetManager.spawnTargets(5);
      console.log('Targets spawned');

      // Load selected vehicle
      if (this.selectedVehicle === 'warhound') {
        this.vehicle = new Warhound(this.scene, this.world);
        await this.vehicle.load('warhound.glb');
        console.log('Warhound loaded');
      } else {
        this.vehicle = new Tank(this.scene, this.world);
        await this.vehicle.load('bastion.glb');
        console.log('Tank loaded');
      }
      this.vehicle.setTargetManager(this.targetManager);

      // Camera (pass scene for terrain collision detection)
      this.camera = new ThirdPersonCamera(this.vehicle, this.scene);
      console.log('Camera ready');

      // Controls
      this.controls = new Controls(this.vehicle, this.camera);
      console.log('Controls ready');

      // Start game loop
      this.animate();
      console.log('Game running');
    } catch (error) {
      console.error('Game init failed:', error);
    }
  }

  setupLighting() {
    // Hemisphere light for natural sky/ground lighting
    const hemi = new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 0.6);
    this.scene.add(hemi);

    // Ambient for fill
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // Directional (sun)
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    this.scene.add(sun);

    // Sky color
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 50, 200);
  }

  onResize() {
    if (this.camera && this.camera.camera) {
      this.camera.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.camera.updateProjectionMatrix();
    }
    if (this.renderer) {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    if (this.previewRenderer && this.previewCamera && this.previewContainer) {
      const width = this.previewContainer.clientWidth || 1;
      const height = this.previewContainer.clientHeight || 1;
      this.previewRenderer.setSize(width, height, false);
      this.previewCamera.aspect = width / height;
      this.previewCamera.updateProjectionMatrix();
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();

    // Physics step
    this.world.step();

    // Update vehicle
    this.vehicle.update(delta);

    // Update targets
    this.targetManager.update(delta);

    // Update camera
    this.camera.update(delta);

    // Render
    this.renderer.render(this.scene, this.camera.camera);
  }
}

// Start game
new Game();
