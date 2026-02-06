import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { Projectile } from './Projectile.js';

export class Warhound {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    this.mesh = null;  // Container group
    this.model = null; // Actual loaded model
    this.body = null;

    // Bones for animation
    this.hipL = null;
    this.hipR = null;
    this.spine = null;

    // Store original bone quaternions (bind pose)
    this.hipLBaseQuat = null;
    this.hipRBaseQuat = null;
    this.spineBaseQuat = null;
    this._hipLDeltaQuat = new THREE.Quaternion();
    this._hipRDeltaQuat = new THREE.Quaternion();
    this._spineDeltaQuat = new THREE.Quaternion();
    this._spineWorldQuat = new THREE.Quaternion();
    this._localXAxis = new THREE.Vector3(1, 0, 0);
    this._localYAxis = new THREE.Vector3(0, 1, 0);
    this._forwardLocal = new THREE.Vector3(0, 0, 1);
    this._forwardWorld = new THREE.Vector3();

    // Walking animation
    this.walkPhase = 0;
    this.isWalking = false;

    // Movement
    this.moveSpeed = 6;
    this.turnSpeed = 1.5;
    this.velocity = new THREE.Vector3();
    this.moveInput = { x: 0, y: 0 };

    // Turret (spine rotation)
    this.turretAngle = 0;
    this.turretInput = { x: 0, y: 0 };
    this.turretSpeed = 1.5;
    this.maxTurretAngle = Math.PI / 4; // 45 degrees max each way

    // Firing
    this.canFire = true;
    this.fireRate = 0.8;
    this.projectiles = [];
    this.targetManager = null;
    this.damageTargets = []; // vehicles that projectiles can damage

    // Visual offset from physics body
    this.meshOffsetY = 0;

    // Lock-on
    this.lockTarget = null; // set by Controls when player taps an enemy
    this._lockTurretSpeed = 3.0; // auto-aim rotation speed (rad/sec)
    this._toTargetDir = new THREE.Vector3();

    // Health
    this.maxHealth = 50;
    this.health = this.maxHealth;
    this.colliderHandle = null;
    this.onDeath = null; // callback
  }

  setTargetManager(targetManager) {
    this.targetManager = targetManager;
  }

  async load(path) {
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(path, (gltf) => {
        this.model = gltf.scene;

        // Debug: Log model info
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        console.log('Warhound model size:', size);
        console.log('Warhound bounds min:', box.min);
        console.log('Warhound bounds max:', box.max);

        // Find bones and meshes
        this.model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            console.log('Mesh found:', child.name);
          }
          if (child.isBone) {
            console.log('Bone found:', child.name);
          }
        });

        // Grab bones by name
        this.hipL = this.model.getObjectByName('hip_L');
        this.hipR = this.model.getObjectByName('hip_R');
        this.spine = this.model.getObjectByName('spine');

        console.log('hip_L found:', this.hipL ? 'YES' : 'NO');
        console.log('hip_R found:', this.hipR ? 'YES' : 'NO');
        console.log('spine found:', this.spine ? 'YES' : 'NO');

        // Store original bone quaternions from bind pose
        if (this.hipL) this.hipLBaseQuat = this.hipL.quaternion.clone();
        if (this.hipR) this.hipRBaseQuat = this.hipR.quaternion.clone();
        if (this.spine) this.spineBaseQuat = this.spine.quaternion.clone();

        // Create container group for physics-controlled movement
        this.mesh = new THREE.Group();

        // Keep the imported rig hierarchy untouched to preserve skinning.
        this.mesh.add(this.model);

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
    console.log('Warhound model size from bounds:', size);

    // Capsule collider — the hemisphere bottom prevents the body from
    // lifting on slopes (a flat-bottomed cuboid rests on its corner when
    // X/Z rotations are locked, pushing the model above the terrain).
    const radius = Math.max(Math.max(size.x, size.z) / 2, 1.5);
    const totalHalfY = Math.max(size.y / 2, 2);
    const capsuleHalfHeight = Math.max(totalHalfY - radius, 0.1);

    // Align rendered model feet with ground when capsule rests on ground.
    // Capsule bottom is at body.y - capsuleHalfHeight - radius = body.y - totalHalfY.
    const modelMinY = this.modelBox ? this.modelBox.min.y : 0;
    this.meshOffsetY = -totalHalfY - modelMinY;

    // Spawn height — capsule center needs to be totalHalfY above ground
    const spawnY = totalHalfY + 0.1;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, spawnY, 0)
      .setLinearDamping(5.0)
      .setAngularDamping(10.0)
      .enabledRotations(false, true, false);

    this.body = this.world.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, radius)
      .setMass(80)
      .setFriction(1.0);
    const collider = this.world.createCollider(colliderDesc, this.body);
    this.colliderHandle = collider.handle;

    console.log('Warhound collider totalHalfY:', totalHalfY, 'spawnY:', spawnY, 'meshOffsetY:', this.meshOffsetY);
  }

  setMoveInput(x, y) {
    this.moveInput.x = x;
    this.moveInput.y = y;
    this.isWalking = Math.abs(y) > 0.1;
  }

  setTurretInput(x, y) {
    this.turretInput.x = x;
    this.turretInput.y = y;
  }

  fire() {
    if (!this.canFire || !this.spine) return;

    this.canFire = false;

    // Get spine world position for firing point
    const spineWorldPos = new THREE.Vector3();
    this.spine.getWorldPosition(spineWorldPos);

    // Use spine world orientation so projectile direction matches visible torso aim.
    this.spine.getWorldQuaternion(this._spineWorldQuat);
    const direction = this._forwardWorld
      .copy(this._forwardLocal)
      .applyQuaternion(this._spineWorldQuat)
      .normalize();

    // Spawn projectile
    const spawnPos = spineWorldPos.clone().add(direction.clone().multiplyScalar(3));
    spawnPos.y += 1;

    const projectile = new Projectile(this.scene, this.world, spawnPos, direction.normalize(), this.targetManager, this.damageTargets);
    this.projectiles.push(projectile);

    setTimeout(() => {
      this.canFire = true;
    }, this.fireRate * 1000);
  }

  update(delta) {
    if (!this.mesh || !this.body) return;

    // Get physics state
    const pos = this.body.translation();
    const rot = this.body.rotation();
    const currentVel = this.body.linvel();

    // Rotation control
    if (Math.abs(this.moveInput.x) > 0.1) {
      const turnRate = -this.moveInput.x * this.turnSpeed;
      this.body.setAngvel({ x: 0, y: turnRate, z: 0 }, true);
    } else {
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Movement
    if (Math.abs(this.moveInput.y) > 0.1) {
      const forward = this._forwardWorld
        .copy(this._forwardLocal)
        .applyQuaternion(this.mesh.quaternion);

      const targetSpeed = this.moveInput.y * this.moveSpeed;
      const targetVel = forward.multiplyScalar(targetSpeed);

      this.body.setLinvel({ x: targetVel.x, y: currentVel.y, z: targetVel.z }, true);
    } else {
      this.body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);
    }

    // Update mesh from physics
    this.mesh.position.set(pos.x, pos.y + this.meshOffsetY, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Walking animation: apply local delta quaternions on top of bind pose.
    if (this.hipL && this.hipR && this.hipLBaseQuat && this.hipRBaseQuat) {
      let swing = 0;
      if (this.isWalking) {
        this.walkPhase += delta * 6.0;
        swing = Math.sin(this.walkPhase) * 0.26; // ~15 degrees
      }

      this._hipLDeltaQuat.setFromAxisAngle(this._localXAxis, swing);
      this._hipRDeltaQuat.setFromAxisAngle(this._localXAxis, -swing);
      this.hipL.quaternion.copy(this.hipLBaseQuat).multiply(this._hipLDeltaQuat);
      this.hipR.quaternion.copy(this.hipRBaseQuat).multiply(this._hipRDeltaQuat);
    }

    // Turret (spine) rotation - ADD to base, clamped to ±45 degrees
    // Manual turret input takes priority over lock-on
    if (Math.abs(this.turretInput.x) > 0.1) {
      this.turretAngle -= this.turretInput.x * this.turretSpeed * delta;
      this.turretAngle = Math.max(-this.maxTurretAngle, Math.min(this.maxTurretAngle, this.turretAngle));
    } else if (this.lockTarget && this.lockTarget.isAlive && this.lockTarget.isAlive() && this.lockTarget.mesh) {
      // Auto-track locked target
      const targetPos = this.lockTarget.getPosition();
      this._toTargetDir.subVectors(targetPos, this.mesh.position).setY(0).normalize();

      // Get hull forward (Warhound forward is +Z)
      const hullForward = this._forwardWorld.copy(this._forwardLocal).applyQuaternion(this.mesh.quaternion);
      hullForward.setY(0).normalize();

      // Angle from hull forward to target
      const cross = hullForward.x * this._toTargetDir.z - hullForward.z * this._toTargetDir.x;
      const dot = hullForward.dot(this._toTargetDir);
      let desiredAngle = Math.atan2(cross, dot);

      // Clamp to spine limits
      desiredAngle = Math.max(-this.maxTurretAngle, Math.min(this.maxTurretAngle, desiredAngle));

      // Smoothly rotate toward desired angle
      const angleDiff = desiredAngle - this.turretAngle;
      const maxStep = this._lockTurretSpeed * delta;
      if (Math.abs(angleDiff) < maxStep) {
        this.turretAngle = desiredAngle;
      } else {
        this.turretAngle += Math.sign(angleDiff) * maxStep;
      }
      this.turretAngle = Math.max(-this.maxTurretAngle, Math.min(this.maxTurretAngle, this.turretAngle));
    }

    if (this.spine && this.spineBaseQuat) {
      this._spineDeltaQuat.setFromAxisAngle(this._localYAxis, this.turretAngle);
      this.spine.quaternion.copy(this.spineBaseQuat).multiply(this._spineDeltaQuat);
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
    if (!this.mesh) return target.set(0, 0, 1);
    return target.copy(this._forwardLocal).applyQuaternion(this.mesh.quaternion).normalize();
  }

  getRotation() {
    return this.mesh ? this.mesh.rotation.y : 0;
  }
}
