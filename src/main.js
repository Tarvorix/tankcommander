import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank.js';
import { Warhound } from './Warhound.js';
import { Terrain } from './Terrain.js';
import { Controls } from './Controls.js';
import { ThirdPersonCamera } from './Camera.js';
import { TargetManager } from './Target.js';

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.clock = new THREE.Clock();
    this.vehicle = null;
    this.selectedVehicle = null;

    this.setupMenu();
  }

  setupMenu() {
    const vehicleButtons = document.querySelectorAll('.vehicle-btn');
    vehicleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedVehicle = btn.dataset.vehicle;
        this.startGame();
      });
    });
  }

  async startGame() {
    // Hide menu
    document.getElementById('start-menu').classList.add('hidden');

    // Show game UI
    document.querySelectorAll('.game-ui').forEach(el => el.classList.add('active'));

    await this.init();
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

      // Handle resize
      window.addEventListener('resize', () => this.onResize());

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
    this.camera.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
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
