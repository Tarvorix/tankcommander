# Iron Bastion Tank Game - Three.js Implementation

## Overview
Third-person tank game with dual joystick controls for web and mobile (iOS).

## Tech Stack
- **Three.js** - 3D rendering
- **Rapier** - Physics (WASM, works on mobile)
- **nipplejs** - Virtual joysticks (touch-friendly)

## Project Structure
```
/tank-game
├── index.html
├── style.css
├── src/
│   ├── main.js          # Entry point
│   ├── Tank.js          # Tank class
│   ├── Terrain.js       # Ground/terrain
│   ├── Physics.js       # Rapier setup
│   ├── Controls.js      # Joystick input
│   ├── Camera.js        # Third person camera
│   ├── Projectile.js    # Shells
│   └── UI.js            # HUD elements
├── assets/
│   └── Iron_Bastion.glb
└── package.json
```

## Dependencies
```json
{
  "dependencies": {
    "three": "^0.160.0",
    "@dimforge/rapier3d-compat": "^0.12.0",
    "nipplejs": "^0.10.1"
  }
}
```

## index.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Iron Bastion</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="game-container"></div>
  <div id="joystick-left"></div>
  <div id="joystick-right"></div>
  <div id="fire-button">FIRE</div>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```

## style.css
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  touch-action: none;
}

body {
  overflow: hidden;
  background: #000;
}

#game-container {
  width: 100vw;
  height: 100vh;
}

#joystick-left {
  position: fixed;
  bottom: 20px;
  left: 20px;
  width: 120px;
  height: 120px;
  z-index: 100;
}

#joystick-right {
  position: fixed;
  bottom: 20px;
  right: 140px;
  width: 120px;
  height: 120px;
  z-index: 100;
}

#fire-button {
  position: fixed;
  bottom: 40px;
  right: 20px;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: rgba(255, 0, 0, 0.6);
  border: 3px solid #fff;
  color: #fff;
  font-family: Arial, sans-serif;
  font-weight: bold;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  user-select: none;
  -webkit-user-select: none;
}

#fire-button:active {
  background: rgba(255, 0, 0, 0.9);
  transform: scale(0.95);
}

/* Hide joysticks on desktop */
@media (hover: hover) and (pointer: fine) {
  #joystick-left, #joystick-right, #fire-button {
    display: none;
  }
}
```

## src/main.js
```javascript
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank.js';
import { Terrain } from './Terrain.js';
import { Controls } from './Controls.js';
import { ThirdPersonCamera } from './Camera.js';

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.clock = new THREE.Clock();
    
    this.init();
  }

  async init() {
    // Renderer setup
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    document.getElementById('game-container').appendChild(this.renderer.domElement);

    // Initialize Rapier physics
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    // Lighting
    this.setupLighting();

    // Create terrain
    this.terrain = new Terrain(this.scene, this.world);

    // Load tank
    this.tank = new Tank(this.scene, this.world);
    await this.tank.load('assets/Iron_Bastion.glb');

    // Camera
    this.camera = new ThirdPersonCamera(this.tank);

    // Controls
    this.controls = new Controls(this.tank, this.camera);

    // Handle resize
    window.addEventListener('resize', () => this.onResize());

    // Start game loop
    this.animate();
  }

  setupLighting() {
    // Ambient
    const ambient = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambient);

    // Directional (sun)
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
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

    // Update tank
    this.tank.update(delta);

    // Update camera
    this.camera.update(delta);

    // Render
    this.renderer.render(this.scene, this.camera.camera);
  }
}

// Start game
new Game();
```

## src/Tank.js
```javascript
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Projectile } from './Projectile.js';

export class Tank {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    
    this.mesh = null;
    this.hull = null;
    this.turret = null;
    this.body = null;
    
    // Movement
    this.moveSpeed = 8;
    this.turnSpeed = 2;
    this.velocity = new THREE.Vector3();
    this.moveInput = { x: 0, y: 0 };
    
    // Turret
    this.turretAngle = 0;
    this.turretInput = { x: 0, y: 0 };
    this.turretSpeed = 2;
    
    // Firing
    this.canFire = true;
    this.fireRate = 1.0; // seconds
    this.projectiles = [];
  }

  async load(path) {
    const loader = new GLTFLoader();
    
    return new Promise((resolve, reject) => {
      loader.load(path, (gltf) => {
        this.mesh = gltf.scene;
        this.mesh.position.set(0, 1, 0);
        
        // Find parts
        this.mesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            if (child.name.includes('Hull') || child.name.includes('PART_Hull')) {
              this.hull = child;
            }
            if (child.name.includes('Turret') || child.name.includes('PART_Turret')) {
              this.turret = child;
            }
          }
        });

        // If turret not found as separate, search children
        if (!this.turret) {
          this.turret = this.mesh.getObjectByName('PART_Turret');
        }

        this.scene.add(this.mesh);
        
        // Create physics body
        this.createPhysicsBody();
        
        resolve(this);
      }, undefined, reject);
    });
  }

  createPhysicsBody() {
    // Box collider for tank
    const bodyDesc = this.world.createRigidBodyDesc(
      this.world.RigidBodyDesc.dynamic()
    )
      .setTranslation(0, 1, 0)
      .setLinearDamping(2.0)
      .setAngularDamping(2.0);
    
    // Use RAPIER directly
    const RAPIER = this.world.constructor;
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1, 0)
      .setLinearDamping(2.0)
      .setAngularDamping(2.0);
    
    this.body = this.world.createRigidBody(rigidBodyDesc);
    
    // Collider (box shape approximating tank)
    const colliderDesc = RAPIER.ColliderDesc.cuboid(1.0, 0.5, 0.5);
    this.world.createCollider(colliderDesc, this.body);
  }

  setMoveInput(x, y) {
    this.moveInput.x = x;
    this.moveInput.y = y;
  }

  setTurretInput(x, y) {
    this.turretInput.x = x;
    this.turretInput.y = y;
  }

  fire() {
    if (!this.canFire) return;
    
    this.canFire = false;
    
    // Get turret world position and direction
    const turretWorldPos = new THREE.Vector3();
    this.turret.getWorldPosition(turretWorldPos);
    
    // Direction turret is facing
    const direction = new THREE.Vector3(1, 0, 0);
    direction.applyQuaternion(this.mesh.quaternion);
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.turretAngle);
    
    // Spawn projectile at barrel tip
    const spawnPos = turretWorldPos.clone().add(direction.multiplyScalar(1.5));
    spawnPos.y += 0.3;
    
    const projectile = new Projectile(this.scene, this.world, spawnPos, direction.normalize());
    this.projectiles.push(projectile);
    
    // Cooldown
    setTimeout(() => {
      this.canFire = true;
    }, this.fireRate * 1000);
  }

  update(delta) {
    if (!this.mesh || !this.body) return;

    // Get physics position
    const pos = this.body.translation();
    const rot = this.body.rotation();

    // Apply movement input
    if (Math.abs(this.moveInput.y) > 0.1) {
      // Forward/back
      const forward = new THREE.Vector3(1, 0, 0);
      forward.applyQuaternion(this.mesh.quaternion);
      
      const force = forward.multiplyScalar(this.moveInput.y * this.moveSpeed);
      this.body.applyImpulse({ x: force.x, y: 0, z: force.z }, true);
    }

    if (Math.abs(this.moveInput.x) > 0.1) {
      // Turn hull
      const torque = -this.moveInput.x * this.turnSpeed;
      this.body.applyTorqueImpulse({ x: 0, y: torque, z: 0 }, true);
    }

    // Update mesh from physics
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Turret rotation (independent of hull)
    if (Math.abs(this.turretInput.x) > 0.1) {
      this.turretAngle -= this.turretInput.x * this.turretSpeed * delta;
    }
    
    if (this.turret) {
      this.turret.rotation.y = this.turretAngle;
    }

    // Update projectiles
    this.projectiles = this.projectiles.filter(p => {
      p.update(delta);
      return p.alive;
    });
  }

  getPosition() {
    return this.mesh ? this.mesh.position.clone() : new THREE.Vector3();
  }

  getRotation() {
    return this.mesh ? this.mesh.rotation.y : 0;
  }
}
```

## src/Terrain.js
```javascript
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Terrain {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    
    this.createGround();
    this.createObstacles();
  }

  createGround() {
    // Visual ground
    const geometry = new THREE.PlaneGeometry(200, 200, 50, 50);
    
    // Add some height variation
    const vertices = geometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const y = vertices[i + 1];
      // Gentle rolling hills
      vertices[i + 2] = Math.sin(x * 0.05) * Math.cos(y * 0.05) * 2;
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x3d5c3d,
      roughness: 0.9,
      metalness: 0.1
    });

    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Physics ground (flat for simplicity)
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100);
    this.world.createCollider(groundColliderDesc, groundBody);
  }

  createObstacles() {
    // Add some rocks/obstacles
    const rockGeometry = new THREE.DodecahedronGeometry(2, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.8
    });

    for (let i = 0; i < 20; i++) {
      const rock = new THREE.Mesh(rockGeometry, rockMaterial);
      rock.position.set(
        (Math.random() - 0.5) * 150,
        1,
        (Math.random() - 0.5) * 150
      );
      rock.scale.setScalar(Math.random() * 1.5 + 0.5);
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);

      // Physics for rock
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(rock.position.x, rock.position.y, rock.position.z);
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.ball(rock.scale.x * 1.5);
      this.world.createCollider(colliderDesc, body);
    }
  }
}
```

## src/Controls.js
```javascript
import nipplejs from 'nipplejs';

export class Controls {
  constructor(tank, camera) {
    this.tank = tank;
    this.camera = camera;
    
    this.setupJoysticks();
    this.setupKeyboard();
    this.setupFireButton();
  }

  setupJoysticks() {
    // Left joystick - movement
    this.moveJoystick = nipplejs.create({
      zone: document.getElementById('joystick-left'),
      mode: 'static',
      position: { left: '60px', bottom: '60px' },
      color: 'white',
      size: 100
    });

    this.moveJoystick.on('move', (evt, data) => {
      const x = data.vector.x;
      const y = data.vector.y;
      this.tank.setMoveInput(x, y);
    });

    this.moveJoystick.on('end', () => {
      this.tank.setMoveInput(0, 0);
    });

    // Right joystick - turret
    this.turretJoystick = nipplejs.create({
      zone: document.getElementById('joystick-right'),
      mode: 'static',
      position: { right: '140px', bottom: '60px' },
      color: 'red',
      size: 100
    });

    this.turretJoystick.on('move', (evt, data) => {
      const x = data.vector.x;
      this.tank.setTurretInput(x, 0);
    });

    this.turretJoystick.on('end', () => {
      this.tank.setTurretInput(0, 0);
    });
  }

  setupKeyboard() {
    const keys = {};

    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      this.updateFromKeys(keys);
      
      // Fire with space
      if (e.code === 'Space') {
        this.tank.fire();
      }
    });

    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
      this.updateFromKeys(keys);
    });
  }

  updateFromKeys(keys) {
    // WASD for movement
    let moveX = 0;
    let moveY = 0;
    
    if (keys['KeyW']) moveY = 1;
    if (keys['KeyS']) moveY = -1;
    if (keys['KeyA']) moveX = -1;
    if (keys['KeyD']) moveX = 1;
    
    this.tank.setMoveInput(moveX, moveY);

    // Q/E for turret
    let turretX = 0;
    if (keys['KeyQ']) turretX = -1;
    if (keys['KeyE']) turretX = 1;
    
    this.tank.setTurretInput(turretX, 0);
  }

  setupFireButton() {
    const fireBtn = document.getElementById('fire-button');
    
    // Touch
    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.tank.fire();
    });
    
    // Mouse
    fireBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.tank.fire();
    });
  }
}
```

## src/Camera.js
```javascript
import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(tank) {
    this.tank = tank;
    
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Camera offset from tank
    this.offset = new THREE.Vector3(-8, 5, 0);
    this.lookOffset = new THREE.Vector3(0, 1, 0);
    
    // Smoothing
    this.currentPosition = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.smoothSpeed = 5;
  }

  update(delta) {
    if (!this.tank.mesh) return;

    // Calculate desired position (behind and above tank)
    const tankPos = this.tank.getPosition();
    const tankRotation = this.tank.getRotation();

    // Offset rotated by tank's heading
    const rotatedOffset = this.offset.clone();
    rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), tankRotation);

    const desiredPosition = tankPos.clone().add(rotatedOffset);
    const desiredLookAt = tankPos.clone().add(this.lookOffset);

    // Smooth follow
    this.currentPosition.lerp(desiredPosition, this.smoothSpeed * delta);
    this.currentLookAt.lerp(desiredLookAt, this.smoothSpeed * delta);

    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }
}
```

## src/Projectile.js
```javascript
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Projectile {
  constructor(scene, world, position, direction) {
    this.scene = scene;
    this.world = world;
    this.alive = true;
    this.lifetime = 3; // seconds
    this.age = 0;
    this.speed = 50;

    // Visual
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.scene.add(this.mesh);

    // Store direction for movement
    this.velocity = direction.clone().multiplyScalar(this.speed);

    // Physics body
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinvel(this.velocity.x, this.velocity.y, this.velocity.z)
      .setCcdEnabled(true); // Continuous collision for fast objects
    
    this.body = this.world.createRigidBody(bodyDesc);
    
    const colliderDesc = RAPIER.ColliderDesc.ball(0.1)
      .setRestitution(0)
      .setFriction(0);
    this.collider = this.world.createCollider(colliderDesc, this.body);
  }

  update(delta) {
    if (!this.alive) return;

    this.age += delta;
    
    // Update visual from physics
    const pos = this.body.translation();
    this.mesh.position.set(pos.x, pos.y, pos.z);

    // Check lifetime or if hit ground
    if (this.age > this.lifetime || pos.y < 0) {
      this.destroy();
    }
  }

  destroy() {
    this.alive = false;
    this.scene.remove(this.mesh);
    this.world.removeRigidBody(this.body);
    
    // Could add explosion effect here
  }
}
```

## Running Locally

```bash
# Install dependencies
npm install

# Run dev server (use Vite)
npx vite
```

## Controls Summary

| Platform | Movement | Turret | Fire |
|----------|----------|--------|------|
| Desktop | WASD | Q/E | Space |
| Mobile | Left Joystick | Right Joystick | Red Button |

## iOS Considerations

1. **Prevent bounce scroll**: `touch-action: none` in CSS
2. **Fullscreen**: Add to home screen for best experience
3. **Performance**: Limit shadows, reduce draw distance on mobile
4. **Audio**: Requires user interaction before playing sounds

## Next Steps

- [ ] Add muzzle flash effect
- [ ] Add explosion particles on impact
- [ ] Add enemy tanks
- [ ] Add health/damage system
- [ ] Add minimap
- [ ] Add sound effects
- [ ] Add mobile detection for quality settings
