import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
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
    this.targetManager = null;
    this.damageTargets = []; // vehicles that projectiles can damage

    // Visual offset from physics body (tweak if tank floats/sinks)
    this.meshOffsetY = 0;
    this._forwardLocal = new THREE.Vector3(0, 0, -1);
    this._forwardWorld = new THREE.Vector3();

    // Lock-on
    this.lockTarget = null; // set by Controls when player taps an enemy
    this._lockTurretSpeed = 3.0; // auto-aim rotation speed (rad/sec)
    this._toTargetDir = new THREE.Vector3();

    // Health
    this.maxHealth = 50;
    this.health = this.maxHealth;
    this.colliderHandle = null;
    this.onDeath = null; // callback

    // Target height for 40K scale (1 unit = 1 meter, super heavy tank ~6.3m tall)
    this.targetHeight = 6.3;
    this.vehicleHeight = this.targetHeight;
    this.scaleFactor = 1;
  }

  setTargetManager(targetManager) {
    this.targetManager = targetManager;
  }

  async load(path) {
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(path, (gltf) => {
        this.mesh = gltf.scene;

        // Measure original model size and scale to target height
        const origBox = new THREE.Box3().setFromObject(gltf.scene);
        const origSize = origBox.getSize(new THREE.Vector3());
        this.scaleFactor = this.targetHeight / origSize.y;
        this.mesh.scale.setScalar(this.scaleFactor);
        console.log('Tank scale factor:', this.scaleFactor, '(original height:', origSize.y, '→', this.targetHeight, ')');

        // Recompute bounding box from scaled model
        const box = new THREE.Box3().setFromObject(this.mesh);
        const size = box.getSize(new THREE.Vector3());
        this.vehicleHeight = size.y;
        console.log('Tank scaled size:', size);
        console.log('Tank bounds min:', box.min);
        console.log('Tank bounds max:', box.max);

        // Find parts
        this.mesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            console.log('Mesh found:', child.name);

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

        console.log('Turret found:', this.turret ? this.turret.name : 'NO');

        // Initial position will be set by physics body after creation
        this.mesh.position.set(0, 0, 0);

        this.scene.add(this.mesh);

        // Store size for physics
        this.modelSize = size;
        this.modelBox = box;

        // Create physics body
        this.createPhysicsBody(size);

        resolve(this);
      }, undefined, reject);
    });
  }

  createPhysicsBody(size) {
    console.log('Model size from bounds:', size);

    // Collider dimensions
    const halfX = Math.max(size.x / 2, 1);
    const halfY = Math.max(size.y / 2, 0.5);
    const halfZ = Math.max(size.z / 2, 1);

    // Spawn height: collider half-height above ground (Y=0) plus small margin
    const spawnY = halfY + 0.1;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, spawnY, 0)
      .setLinearDamping(5.0)  // Higher damping for less drift
      .setAngularDamping(10.0) // High angular damping to prevent spinning
      .enabledRotations(false, true, false); // Only allow Y rotation

    this.body = this.world.createRigidBody(rigidBodyDesc);

    // Collision groups: vehicles use membership=0x0002 so infantry (filter=0x0001) won't collide.
    // filter=0xFFFF means vehicles still collide with terrain, rocks, projectiles, other vehicles.
    const vehicleGroups = (0x0002 << 16) | 0xFFFF;

    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
      .setMass(50)
      .setFriction(1.0)
      .setCollisionGroups(vehicleGroups);
    const collider = this.world.createCollider(colliderDesc, this.body);
    this.colliderHandle = collider.handle;

    console.log('Tank collider halfY:', halfY, 'spawnY:', spawnY);
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
    if (!this.canFire || !this.turret) return;

    this.canFire = false;

    // Get turret world position and direction
    const turretWorldPos = new THREE.Vector3();
    this.turret.getWorldPosition(turretWorldPos);

    // Direction turret is facing (-Z is forward)
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(this.mesh.quaternion);
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.turretAngle);

    // Spawn projectile at barrel tip (offset scales with model)
    const barrelOffset = this.modelSize.z * 0.4;
    const spawnPos = turretWorldPos.clone().add(direction.clone().multiplyScalar(barrelOffset));
    spawnPos.y += this.modelSize.y * 0.05;

    const projectile = new Projectile(this.scene, this.world, spawnPos, direction.normalize(), this.targetManager, this.damageTargets);
    this.projectiles.push(projectile);

    // Cooldown
    setTimeout(() => {
      this.canFire = true;
    }, this.fireRate * 1000);
  }

  update(delta) {
    if (!this.mesh || !this.body) return;

    // Get physics state
    const pos = this.body.translation();
    const rot = this.body.rotation();
    let currentVel = this.body.linvel();

    // Clamp upward velocity to prevent infantry from pushing vehicle up
    if (currentVel.y > 2) {
      this.body.setLinvel({ x: currentVel.x, y: 2, z: currentVel.z }, true);
      currentVel = this.body.linvel();
    }

    // Direct rotation control (no momentum buildup)
    if (Math.abs(this.moveInput.x) > 0.1) {
      // Set angular velocity directly for precise turning
      const turnRate = -this.moveInput.x * this.turnSpeed;
      this.body.setAngvel({ x: 0, y: turnRate, z: 0 }, true);
    } else {
      // Stop rotation when not turning
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Movement - set velocity in facing direction
    if (Math.abs(this.moveInput.y) > 0.1) {
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(this.mesh.quaternion);

      const targetSpeed = this.moveInput.y * this.moveSpeed;
      const targetVel = forward.multiplyScalar(targetSpeed);

      // Set horizontal velocity directly, preserve vertical (for gravity/terrain)
      this.body.setLinvel({ x: targetVel.x, y: currentVel.y, z: targetVel.z }, true);
    } else {
      // Stop horizontal movement when not pressing, preserve vertical
      this.body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);
    }

    // Update mesh from physics (apply offset if tank floats/sinks)
    this.mesh.position.set(pos.x, pos.y + this.meshOffsetY, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Turret rotation (independent of hull)
    // Manual turret input takes priority over lock-on
    if (Math.abs(this.turretInput.x) > 0.1) {
      this.turretAngle -= this.turretInput.x * this.turretSpeed * delta;
    } else if (this.lockTarget && this.lockTarget.isAlive && this.lockTarget.isAlive() && this.lockTarget.mesh) {
      // Auto-track locked target
      const targetPos = this.lockTarget.getPosition();
      this._toTargetDir.subVectors(targetPos, this.mesh.position).setY(0).normalize();

      // Get hull forward
      const hullForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion);
      hullForward.setY(0).normalize();

      // Angle from hull forward to target
      const cross = hullForward.x * this._toTargetDir.z - hullForward.z * this._toTargetDir.x;
      const dot = hullForward.dot(this._toTargetDir);
      const desiredAngle = Math.atan2(cross, dot);

      // Smoothly rotate toward desired angle
      const angleDiff = desiredAngle - this.turretAngle;
      const maxStep = this._lockTurretSpeed * delta;
      if (Math.abs(angleDiff) < maxStep) {
        this.turretAngle = desiredAngle;
      } else {
        this.turretAngle += Math.sign(angleDiff) * maxStep;
      }
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

  takeDamage(amount) {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0 && this.onDeath) {
      this.onDeath(this);
    }
  }

  isAlive() {
    return this.health > 0;
  }

  getColliderHandle() {
    return this.colliderHandle;
  }

  getPosition() {
    return this.mesh ? this.mesh.position.clone() : new THREE.Vector3();
  }

  getForwardVector(target = new THREE.Vector3()) {
    if (!this.mesh) return target.set(0, 0, -1);
    return target.copy(this._forwardLocal).applyQuaternion(this.mesh.quaternion).normalize();
  }

  getRotation() {
    return this.mesh ? this.mesh.rotation.y : 0;
  }
}
