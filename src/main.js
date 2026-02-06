import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank.js';
import { Warhound } from './Warhound.js';
import { MOBAMap } from './MOBAMap.js';
import { MOBACamera } from './MOBACamera.js';
import { MOBAControls } from './MOBAControls.js';
import { Tower } from './Tower.js';
import { ControlPoint } from './ControlPoint.js';
import { MinionWave } from './MinionWave.js';
import { HeroTank } from './HeroTank.js';
import { HeroTitan } from './HeroTitan.js';
import { MOBAHeroAI } from './MOBAHeroAI.js';
import { SmokeEffect } from './SmokeEffect.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.clock = new THREE.Clock();

    // Player
    this.vehicle = null;
    this.heroWrapper = null;

    // Enemy
    this.enemyVehicle = null;
    this.enemyHeroWrapper = null;
    this.enemyHeroAI = null;

    // Game systems
    this.mobaMap = null;
    this.mobaCamera = null;
    this.mobaControls = null;
    this.controlPoint = null;
    this.minionWave = null;
    this.towers = { blue: [], red: [] };
    this.effects = [];

    // Game state
    this.gameOver = false;
    this.winner = null;

    // Hero selection
    this.selectedVehicle = null;
    this.selectedIndex = 0;

    // Preview
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
      { id: 'tank', name: 'Iron Bastion', desc: 'Heavy Battle Tank — Tanky bruiser with shields and artillery', model: 'bastion.glb' },
      { id: 'warhound', name: 'Warhound Titan', desc: 'Assault Walker — Mobile fighter with charge and war cry', model: 'warhound.glb' }
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
    document.getElementById('start-menu').classList.add('hidden');
    document.getElementById('loading-overlay').classList.add('active');

    this.teardownPreview();
    await this.init();

    document.getElementById('loading-overlay').classList.remove('active');
    document.querySelectorAll('.game-ui').forEach(el => el.classList.add('active'));
  }

  updateLoading(percent, status) {
    const fill = document.getElementById('loading-bar-fill');
    const text = document.getElementById('loading-status');
    if (fill) fill.style.width = percent + '%';
    if (text) text.textContent = status;
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
      console.log('Starting MOBA game init...');
      this.updateLoading(0, 'Initializing renderer...');

      // Renderer
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      document.getElementById('game-container').appendChild(this.renderer.domElement);

      // Physics
      this.updateLoading(5, 'Initializing physics engine...');
      await RAPIER.init();
      this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

      // Lighting
      this.updateLoading(10, 'Setting up lighting...');
      this.setupLighting();

      // Environment map
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      pmremGenerator.compileEquirectangularShader();
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x87CEEB);
      const envHemi = new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 0.8);
      envScene.add(envHemi);
      const envSun = new THREE.DirectionalLight(0xffffff, 1.5);
      envSun.position.set(0, 1, 0.5);
      envScene.add(envSun);
      this.scene.environment = pmremGenerator.fromScene(envScene, 0.04).texture;
      pmremGenerator.dispose();

      // MOBA Map
      this.updateLoading(15, 'Generating MOBA map...');
      this.mobaMap = new MOBAMap(this.scene, this.world);

      // Load player hero
      this.updateLoading(25, 'Loading your hero...');
      if (this.selectedVehicle === 'warhound') {
        this.vehicle = new Warhound(this.scene, this.world);
        await this.vehicle.load('warhound.glb');
        this.heroWrapper = new HeroTitan(this.vehicle, this.scene, this.world);
      } else {
        this.vehicle = new Tank(this.scene, this.world);
        await this.vehicle.load('bastion.glb');
        this.heroWrapper = new HeroTank(this.vehicle, this.scene, this.world);
      }

      // Position player at blue base
      if (this.vehicle.body) {
        this.vehicle.body.setTranslation({ x: 0, y: 4, z: -122 }, true);
      }

      // Load enemy hero (opposite type)
      this.updateLoading(40, 'Loading enemy hero...');
      if (this.selectedVehicle === 'warhound') {
        this.enemyVehicle = new Tank(this.scene, this.world);
        await this.enemyVehicle.load('bastion.glb');
        this.enemyHeroWrapper = new HeroTank(this.enemyVehicle, this.scene, this.world);
      } else {
        this.enemyVehicle = new Warhound(this.scene, this.world);
        await this.enemyVehicle.load('warhound.glb');
        this.enemyHeroWrapper = new HeroTitan(this.enemyVehicle, this.scene, this.world);
      }

      // Position enemy at red base
      if (this.enemyVehicle.body) {
        this.enemyVehicle.body.setTranslation({ x: 0, y: 4, z: 122 }, true);
        // Face toward blue base
        const quat = new THREE.Quaternion();
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        this.enemyVehicle.body.setRotation(
          { x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true
        );
      }

      // Towers
      this.updateLoading(50, 'Placing towers...');
      this.createTowers();

      // Control Point
      this.updateLoading(55, 'Setting up control point...');
      this.controlPoint = new ControlPoint(this.scene, new THREE.Vector3(0, 0, 0));

      // Minion Waves
      this.updateLoading(60, 'Loading minion assets...');
      this.minionWave = new MinionWave(this.scene, this.world, this.mobaMap);
      await this.minionWave.loadAssets();

      // Wire up damage targets
      this.updateLoading(70, 'Wiring up combat systems...');
      this.wireDamageTargets();

      // Enemy hero AI
      this.updateLoading(75, 'Setting up enemy AI...');
      this.enemyHeroAI = new MOBAHeroAI(
        this.enemyVehicle,
        this.enemyHeroWrapper,
        this.vehicle,
        this.mobaMap
      );

      // Give enemy AI starting ability levels
      this.enemyHeroWrapper.abilitySystem.addXP(100);
      this.enemyHeroWrapper.abilitySystem.levelUpAbility('q');

      // Handle hero deaths
      this.setupDeathHandlers();

      // Camera
      this.updateLoading(80, 'Setting up camera...');
      this.mobaCamera = new MOBACamera(this.vehicle);

      // Controls
      this.updateLoading(85, 'Setting up controls...');
      this.mobaControls = new MOBAControls(
        this.vehicle,
        this.mobaCamera,
        this.renderer,
        this.scene
      );

      // Wire ability callbacks to controls
      this.setupAbilityControls();

      // Set enemy units for click targeting
      this.updateEnemyTargetList();

      // Auto-level first ability for player
      this.heroWrapper.abilitySystem.levelUpAbility('q');

      // Setup ability level-up button handlers
      this.setupAbilityLevelUpButtons();

      // Setup mobile recenter camera button
      this.setupRecenterButton();

      // Start game loop
      this.updateLoading(100, 'Battle begins...');
      this.animate();
      console.log('MOBA game running');

    } catch (error) {
      console.error('Game init failed:', error);
    }
  }

  setupLighting() {
    const hemi = new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 0.6);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0, 150, 50);
    sun.castShadow = true;
    sun.shadow.bias = -0.002;
    sun.shadow.normalBias = 0.05;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -200;
    sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200;
    sun.shadow.camera.bottom = -200;
    this.scene.add(sun);

    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 150, 350);
  }

  createTowers() {
    const positions = this.mobaMap.towerPositions;

    for (const lane of ['left', 'mid', 'right']) {
      for (const pos of positions.blue[lane]) {
        const tower = new Tower(this.scene, this.world, pos, 'blue');
        this.towers.blue.push(tower);
      }
    }

    for (const lane of ['left', 'mid', 'right']) {
      for (const pos of positions.red[lane]) {
        const tower = new Tower(this.scene, this.world, pos, 'red');
        this.towers.red.push(tower);
      }
    }
  }

  wireDamageTargets() {
    const redTargets = [this.enemyVehicle, ...this.towers.red];
    const blueTargets = [this.vehicle, ...this.towers.blue];

    this.vehicle.damageTargets = [...redTargets];
    this.enemyVehicle.damageTargets = [...blueTargets];

    for (const tower of this.towers.blue) {
      tower.setDamageTargets([this.enemyVehicle]);
    }
    for (const tower of this.towers.red) {
      tower.setDamageTargets([this.vehicle]);
    }

    this.minionWave.redDamageTargets = blueTargets;
    this.minionWave.blueDamageTargets = redTargets;
  }

  setupDeathHandlers() {
    this.vehicle.onDeath = (vehicle) => {
      console.log('Player hero destroyed!');
      const pos = vehicle.getPosition();
      const smokeScale = (vehicle.vehicleHeight || 6) / 6;
      this.effects.push(new SmokeEffect(this.scene, pos, smokeScale));

      setTimeout(() => {
        if (this.gameOver) return;
        vehicle.health = vehicle.maxHealth;
        if (vehicle.body) {
          vehicle.body.setTranslation({ x: 0, y: 4, z: -122 }, true);
        }
        console.log('Player hero respawned!');
      }, 8000);
    };

    this.enemyVehicle.onDeath = (vehicle) => {
      console.log('Enemy hero destroyed!');
      const pos = vehicle.getPosition();
      const smokeScale = (vehicle.vehicleHeight || 6) / 6;
      this.effects.push(new SmokeEffect(this.scene, pos, smokeScale));

      this.heroWrapper.abilitySystem.addXP(80);

      setTimeout(() => {
        if (this.gameOver) return;
        vehicle.health = vehicle.maxHealth;
        if (vehicle.body) {
          vehicle.body.setTranslation({ x: 0, y: 4, z: 122 }, true);
        }
        console.log('Enemy hero respawned!');
      }, 10000);
    };

    for (const tower of [...this.towers.blue, ...this.towers.red]) {
      tower.onDeath = (t) => {
        const pos = t.getPosition();
        this.effects.push(new SmokeEffect(this.scene, pos, 1.5));
        if (t.team === 'red') {
          this.heroWrapper.abilitySystem.addXP(50);
        }
      };
    }
  }

  setupAbilityControls() {
    const abilities = this.heroWrapper.abilitySystem;

    this.mobaControls.setAbilityCallback('q', (target, groundPos) => {
      return abilities.castAbility('q', target, groundPos);
    });
    this.mobaControls.setAbilityCallback('w', (target, groundPos) => {
      return abilities.castAbility('w', target, groundPos);
    });
    this.mobaControls.setAbilityCallback('e', (target, groundPos) => {
      return abilities.castAbility('e', target, groundPos);
    });
    this.mobaControls.setAbilityCallback('r', (target, groundPos) => {
      return abilities.castAbility('r', target, groundPos);
    });
  }

  setupAbilityLevelUpButtons() {
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    for (const slot of ['q', 'w', 'e', 'r']) {
      const btn = document.getElementById(`ability-${slot}`);
      if (!btn) continue;

      if (isTouchDevice) {
        // Mobile: tap to cast, long-press (500ms) to level up
        let touchTimer = null;
        let didLongPress = false;

        btn.addEventListener('touchstart', (e) => {
          e.preventDefault(); // Prevent ghost click
          e.stopPropagation(); // Don't let it reach the canvas
          didLongPress = false;
          touchTimer = setTimeout(() => {
            didLongPress = true;
            this.heroWrapper.abilitySystem.levelUpAbility(slot);
            // Brief visual feedback
            btn.style.transform = 'scale(1.15)';
            setTimeout(() => { btn.style.transform = ''; }, 200);
          }, 500);
        }, { passive: false });

        btn.addEventListener('touchend', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
          }
          if (!didLongPress) {
            // Short tap — cast ability
            this.mobaControls.triggerAbility(slot);
          }
        }, { passive: false });

        btn.addEventListener('touchmove', (e) => {
          // Cancel long-press if finger moves
          if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
          }
        }, { passive: true });

        btn.addEventListener('touchcancel', () => {
          if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
          }
        });
      } else {
        // Desktop: click to cast, Ctrl+click to level up
        btn.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey) {
            this.heroWrapper.abilitySystem.levelUpAbility(slot);
          } else {
            this.mobaControls.triggerAbility(slot);
          }
        });
      }
    }
  }

  setupRecenterButton() {
    const btn = document.getElementById('recenter-btn');
    if (btn && this.mobaCamera) {
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.mobaCamera.isLockedToHero = true;
        this.mobaCamera.panOffset.set(0, 0, 0);
      };
      btn.addEventListener('touchstart', handler, { passive: false });
      btn.addEventListener('click', handler);
    }
  }

  updateEnemyTargetList() {
    const enemies = [this.enemyVehicle, ...this.towers.red];
    this.mobaControls.setEnemyUnits(enemies);
  }

  onResize() {
    if (this.mobaCamera && this.mobaCamera.camera) {
      this.mobaCamera.camera.aspect = window.innerWidth / window.innerHeight;
      this.mobaCamera.camera.updateProjectionMatrix();
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

  updateHUD() {
    // Player health
    const playerHealthBar = document.getElementById('player-health-fill');
    const playerHealthText = document.getElementById('player-health-text');
    if (playerHealthBar && this.vehicle) {
      const pct = Math.max(0, this.vehicle.health / this.vehicle.maxHealth) * 100;
      playerHealthBar.style.width = pct + '%';
      if (pct > 50) {
        playerHealthBar.style.background = 'linear-gradient(90deg, #00cc44, #44ff66)';
      } else if (pct > 25) {
        playerHealthBar.style.background = 'linear-gradient(90deg, #ccaa00, #ffcc00)';
      } else {
        playerHealthBar.style.background = 'linear-gradient(90deg, #cc2200, #ff4444)';
      }
      if (playerHealthText) {
        playerHealthText.textContent = Math.ceil(this.vehicle.health) + ' / ' + this.vehicle.maxHealth;
      }
    }

    // Enemy health
    const enemyHealthBar = document.getElementById('enemy-health-fill');
    const enemyHealthText = document.getElementById('enemy-health-text');
    if (enemyHealthBar && this.enemyVehicle) {
      const pct = Math.max(0, this.enemyVehicle.health / this.enemyVehicle.maxHealth) * 100;
      enemyHealthBar.style.width = pct + '%';
      if (pct > 50) {
        enemyHealthBar.style.background = 'linear-gradient(90deg, #cc2200, #ff4444)';
      } else if (pct > 25) {
        enemyHealthBar.style.background = 'linear-gradient(90deg, #ccaa00, #ffcc00)';
      } else {
        enemyHealthBar.style.background = 'linear-gradient(90deg, #cc2200, #ff4444)';
      }
      if (enemyHealthText) {
        enemyHealthText.textContent = Math.ceil(this.enemyVehicle.health) + ' / ' + this.enemyVehicle.maxHealth;
      }
    }

    // Ability cooldowns
    for (const slot of ['q', 'w', 'e', 'r']) {
      const info = this.heroWrapper.abilitySystem.getAbilityInfo(slot);
      const btn = document.getElementById(`ability-${slot}`);
      const cdOverlay = document.getElementById(`ability-${slot}-cd`);
      const levelDots = document.getElementById(`ability-${slot}-level`);

      if (btn && info) {
        if (info.cooldown > 0) {
          btn.classList.add('on-cooldown');
          if (cdOverlay) {
            cdOverlay.textContent = Math.ceil(info.cooldown);
            cdOverlay.style.display = 'flex';
          }
        } else {
          btn.classList.remove('on-cooldown');
          if (cdOverlay) cdOverlay.style.display = 'none';
        }

        if (info.level <= 0) {
          btn.classList.add('not-learned');
        } else {
          btn.classList.remove('not-learned');
        }

        if (info.canLevelUp) {
          btn.classList.add('can-level-up');
        } else {
          btn.classList.remove('can-level-up');
        }

        if (levelDots) {
          levelDots.innerHTML = '';
          for (let i = 0; i < info.maxLevel; i++) {
            const dot = document.createElement('span');
            dot.className = i < info.level ? 'level-dot filled' : 'level-dot';
            levelDots.appendChild(dot);
          }
        }
      }
    }

    // Level & XP
    const levelEl = document.getElementById('hero-level');
    const xpEl = document.getElementById('hero-xp-fill');
    if (levelEl) levelEl.textContent = this.heroWrapper.abilitySystem.level;
    if (xpEl) {
      const as = this.heroWrapper.abilitySystem;
      const xpNeeded = as.xpToLevel[as.level] || 999;
      const pct = Math.min(100, (as.xp / xpNeeded) * 100);
      xpEl.style.width = pct + '%';
    }

    // Skill points
    const spEl = document.getElementById('skill-points');
    if (spEl) {
      const sp = this.heroWrapper.abilitySystem.skillPoints;
      spEl.textContent = sp > 0 ? `${sp} Skill Point${sp > 1 ? 's' : ''}` : '';
      spEl.style.display = sp > 0 ? 'block' : 'none';
    }

    // Control point scores
    const blueScoreEl = document.getElementById('blue-score');
    const redScoreEl = document.getElementById('red-score');
    const cpStatusEl = document.getElementById('cp-status');
    if (blueScoreEl) blueScoreEl.textContent = Math.floor(this.controlPoint.blueScore);
    if (redScoreEl) redScoreEl.textContent = Math.floor(this.controlPoint.redScore);
    if (cpStatusEl) {
      if (this.controlPoint.isContested) {
        cpStatusEl.textContent = 'CONTESTED';
        cpStatusEl.style.color = '#ff8800';
      } else if (this.controlPoint.controllingTeam === 'blue') {
        cpStatusEl.textContent = 'BLUE CONTROLS';
        cpStatusEl.style.color = '#4488ff';
      } else if (this.controlPoint.controllingTeam === 'red') {
        cpStatusEl.textContent = 'RED CONTROLS';
        cpStatusEl.style.color = '#ff4444';
      } else {
        cpStatusEl.textContent = 'NEUTRAL';
        cpStatusEl.style.color = '#ffdd44';
      }
    }

    // Minimap
    this.updateMinimap();
  }

  updateMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const mapSize = 300;
    const scale = size / mapSize;

    const toMM = (x, z) => ({
      x: (x + mapSize / 2) * scale,
      y: (z + mapSize / 2) * scale,
    });

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, size, size);

    // Lanes
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    for (const [, waypoints] of Object.entries(this.mobaMap.laneWaypoints)) {
      ctx.beginPath();
      for (let i = 0; i < waypoints.length; i++) {
        const p = toMM(waypoints[i].x, waypoints[i].z);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Center point
    const cp = toMM(0, 0);
    ctx.fillStyle = this.controlPoint.controllingTeam === 'blue' ? '#4488ff' :
                    this.controlPoint.controllingTeam === 'red' ? '#ff4444' : '#ffdd44';
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Bases
    const bb = toMM(0, -130);
    ctx.fillStyle = '#2244aa';
    ctx.fillRect(bb.x - 5, bb.y - 5, 10, 10);
    const rb = toMM(0, 130);
    ctx.fillStyle = '#aa2222';
    ctx.fillRect(rb.x - 5, rb.y - 5, 10, 10);

    // Towers
    for (const tower of this.towers.blue) {
      if (!tower.alive) continue;
      const tp = toMM(tower.position.x, tower.position.z);
      ctx.fillStyle = '#4488ff';
      ctx.fillRect(tp.x - 3, tp.y - 3, 6, 6);
    }
    for (const tower of this.towers.red) {
      if (!tower.alive) continue;
      const tp = toMM(tower.position.x, tower.position.z);
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(tp.x - 3, tp.y - 3, 6, 6);
    }

    // Minions
    for (const m of this.minionWave.blueMinions) {
      if (!m.isAlive()) continue;
      const pos = m.getPosition();
      const mp = toMM(pos.x, pos.z);
      ctx.fillStyle = '#6699ff';
      ctx.fillRect(mp.x - 1, mp.y - 1, 2, 2);
    }
    for (const m of this.minionWave.redMinions) {
      if (!m.isAlive()) continue;
      const pos = m.getPosition();
      const mp = toMM(pos.x, pos.z);
      ctx.fillStyle = '#ff6666';
      ctx.fillRect(mp.x - 1, mp.y - 1, 2, 2);
    }

    // Player hero
    if (this.vehicle && this.vehicle.isAlive()) {
      const heroPos = this.vehicle.getPosition();
      const hp = toMM(heroPos.x, heroPos.z);
      ctx.fillStyle = '#44ffaa';
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Enemy hero
    if (this.enemyVehicle && this.enemyVehicle.isAlive()) {
      const enemyPos = this.enemyVehicle.getPosition();
      const ep = toMM(enemyPos.x, enemyPos.z);
      ctx.fillStyle = '#ff4466';
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  showGameOver(winner) {
    this.gameOver = true;
    this.winner = winner;

    const overlay = document.getElementById('game-over-overlay');
    const text = document.getElementById('game-over-text');
    if (overlay) {
      overlay.style.display = 'flex';
      if (text) {
        text.textContent = winner === 'blue' ? 'VICTORY!' : 'DEFEAT!';
        text.style.color = winner === 'blue' ? '#44ffaa' : '#ff4444';
      }
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.05);

    if (this.gameOver) {
      this.mobaCamera.update(delta);
      this.renderer.render(this.scene, this.mobaCamera.camera);
      return;
    }

    // Physics
    this.world.step();

    // Player hero
    this.vehicle.update(delta);
    this.heroWrapper.update(delta);
    this.mobaControls.update(delta);

    // Enemy hero
    if (this.enemyVehicle && this.enemyVehicle.isAlive()) {
      this.enemyHeroAI.update(delta);
      this.enemyVehicle.update(delta);
      this.enemyHeroWrapper.update(delta);
    }

    // Towers
    for (const tower of [...this.towers.blue, ...this.towers.red]) {
      tower.update(delta);
    }

    // Minions
    this.minionWave.update(delta);

    // Dynamic targets
    this.updateDynamicTargets();

    // Control point
    const blueUnits = [
      this.vehicle,
      ...this.minionWave.getAliveMinions('blue'),
    ];
    const redUnits = [
      this.enemyVehicle,
      ...this.minionWave.getAliveMinions('red'),
    ];
    const cpResult = this.controlPoint.update(delta, blueUnits, redUnits);

    if (cpResult.winner) {
      this.showGameOver(cpResult.winner);
    }

    // XP
    this.checkMinionKillXP();

    // Map animations
    this.mobaMap.update(delta);

    // Effects
    this.effects = this.effects.filter(effect => {
      effect.update(delta);
      if (!effect.alive) {
        effect.dispose();
        return false;
      }
      return true;
    });

    // Camera
    this.mobaCamera.update(delta);

    // HUD
    this.updateHUD();

    // Base healing
    this.handleBaseHealing(delta);

    // Render
    this.renderer.render(this.scene, this.mobaCamera.camera);
  }

  updateDynamicTargets() {
    const aliveRedMinions = this.minionWave.getAliveMinions('red');
    const aliveBlueMinions = this.minionWave.getAliveMinions('blue');

    this.vehicle.damageTargets = [
      this.enemyVehicle,
      ...this.towers.red.filter(t => t.alive),
      ...aliveRedMinions,
    ];

    this.enemyVehicle.damageTargets = [
      this.vehicle,
      ...this.towers.blue.filter(t => t.alive),
      ...aliveBlueMinions,
    ];

    for (const tower of this.towers.blue) {
      if (!tower.alive) continue;
      tower.setDamageTargets([this.enemyVehicle, ...aliveRedMinions]);
    }
    for (const tower of this.towers.red) {
      if (!tower.alive) continue;
      tower.setDamageTargets([this.vehicle, ...aliveBlueMinions]);
    }

    this.minionWave.blueDamageTargets = [this.enemyVehicle, ...this.towers.red.filter(t => t.alive)];
    this.minionWave.redDamageTargets = [this.vehicle, ...this.towers.blue.filter(t => t.alive)];

    this.mobaControls.setEnemyUnits([
      this.enemyVehicle,
      ...this.towers.red.filter(t => t.alive),
      ...aliveRedMinions,
    ]);
  }

  checkMinionKillXP() {
    for (const minion of this.minionWave.redMinions) {
      if (!minion.isAlive() && !minion._xpAwarded) {
        minion._xpAwarded = true;
        const heroPos = this.vehicle.getPosition();
        const minionPos = minion.getPosition();
        if (heroPos.distanceTo(minionPos) < 30) {
          this.heroWrapper.abilitySystem.addXP(minion.xpValue || 15);
        }
      }
    }

    for (const minion of this.minionWave.blueMinions) {
      if (!minion.isAlive() && !minion._xpAwarded) {
        minion._xpAwarded = true;
        const enemyPos = this.enemyVehicle.getPosition();
        const minionPos = minion.getPosition();
        if (enemyPos.distanceTo(minionPos) < 30) {
          this.enemyHeroWrapper.abilitySystem.addXP(minion.xpValue || 15);
        }
      }
    }
  }

  handleBaseHealing(delta) {
    const blueBase = this.mobaMap.blueBasePos;
    const redBase = this.mobaMap.redBasePos;
    const healRadius = 20;
    const healRate = 8;

    if (this.vehicle.isAlive()) {
      const pos = this.vehicle.getPosition();
      if (pos.distanceTo(blueBase) < healRadius) {
        this.vehicle.health = Math.min(
          this.vehicle.maxHealth,
          this.vehicle.health + healRate * delta
        );
      }
    }

    if (this.enemyVehicle.isAlive()) {
      const pos = this.enemyVehicle.getPosition();
      if (pos.distanceTo(redBase) < healRadius) {
        this.enemyVehicle.health = Math.min(
          this.enemyVehicle.maxHealth,
          this.enemyVehicle.health + healRate * delta
        );
      }
    }
  }
}

// Start game
new Game();
