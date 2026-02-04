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
  }

  async load(path) {
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(path, (gltf) => {
        this.mesh = gltf.scene;

        // Debug: Log model info
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        console.log('Model size:', size);
        console.log('Model bounds min:', box.min);
        console.log('Model bounds max:', box.max);

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

        // Position mesh - just set Y height, keep X/Z at origin
        this.mesh.position.set(0, 1, 0);

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

    // Position physics body to match mesh position
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1, 0)
      .setLinearDamping(2.0)
      .setAngularDamping(2.0)
      .enabledRotations(false, true, false); // Only allow Y rotation

    this.body = this.world.createRigidBody(rigidBodyDesc);

    // Collider sized to model
    const halfX = Math.max(size.x / 2, 1);
    const halfY = Math.max(size.y / 2, 0.5);
    const halfZ = Math.max(size.z / 2, 1);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
      .setMass(20)
      .setFriction(0.5);
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
    if (!this.canFire || !this.turret) return;

    this.canFire = false;

    // Get turret world position and direction
    const turretWorldPos = new THREE.Vector3();
    this.turret.getWorldPosition(turretWorldPos);

    // Direction turret is facing (-Z is forward)
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(this.mesh.quaternion);
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.turretAngle);

    // Spawn projectile at barrel tip
    const spawnPos = turretWorldPos.clone().add(direction.clone().multiplyScalar(1.5));
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
      // Forward/back (-Z is forward)
      const forward = new THREE.Vector3(0, 0, -1);
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
