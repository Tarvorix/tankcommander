import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { Projectile } from './Projectile.js';

/**
 * Single infantry soldier.
 * Implements the same unit interface as Tank/Warhound so it plugs into
 * the existing damage, lock-on, and AI systems.
 *
 * Assets are loaded once (static) and cloned per soldier via SkeletonUtils.
 * Each soldier gets its own AnimationMixer for independent animation state.
 */
export class Infantry {
  // Shared across all instances — loaded once
  static _sourceModel = null;
  static _animations = {};    // { idle: AnimationClip, walk: AnimationClip, ... }
  static _loadPromise = null;

  /**
   * Trim dead time from the end of an animation clip.
   * Many Mixamo exports pad clips with static frames after the real motion ends.
   * This finds the last frame where any track actually changes and trims there.
   */
  static trimClipDeadTime(clip) {
    let lastActiveTime = 0;

    for (const track of clip.tracks) {
      const times = track.times;
      const values = track.values;
      if (times.length < 2) continue;

      const stride = values.length / times.length;

      // Walk through consecutive keyframe pairs; record the latest time with real change
      for (let i = 0; i < times.length - 1; i++) {
        let hasDiff = false;
        for (let s = 0; s < stride; s++) {
          if (Math.abs(values[(i + 1) * stride + s] - values[i * stride + s]) > 0.0001) {
            hasDiff = true;
            break;
          }
        }
        if (hasDiff) {
          lastActiveTime = Math.max(lastActiveTime, times[i + 1]);
        }
      }
    }

    // Only trim if we found significant dead time (>5% of clip)
    if (lastActiveTime > 0 && lastActiveTime < clip.duration * 0.95) {
      const trimmed = clip.duration - lastActiveTime;
      console.log(`Trimming '${clip.name}': ${clip.duration.toFixed(2)}s → ${lastActiveTime.toFixed(2)}s (removed ${trimmed.toFixed(2)}s dead time)`);
      clip.duration = lastActiveTime;

      // Also trim keyframe data past the effective end to save memory
      for (const track of clip.tracks) {
        let trimIdx = track.times.length;
        for (let i = 0; i < track.times.length; i++) {
          if (track.times[i] > lastActiveTime + 0.01) {
            trimIdx = i;
            break;
          }
        }
        if (trimIdx < track.times.length) {
          const stride = track.values.length / track.times.length;
          track.times = track.times.slice(0, trimIdx);
          track.values = track.values.slice(0, trimIdx * stride);
        }
      }
    }
  }

  /**
   * Load all 6 militia GLBs in parallel, extract mesh + animation clips.
   * Idempotent — safe to call multiple times.
   */
  static async loadSharedAssets() {
    if (Infantry._loadPromise) return Infantry._loadPromise;

    Infantry._loadPromise = (async () => {
      const loader = new GLTFLoader();
      const loadGLB = (path) => new Promise((resolve, reject) => {
        loader.load(path, resolve, undefined, reject);
      });

      const animNames = ['idle', 'walk', 'run', 'shoot', 'melee', 'death'];
      const paths = animNames.map(name => `militia/militia_${name}.glb`);
      const results = await Promise.all(paths.map(loadGLB));

      // Use idle GLB as source model (mesh + skeleton)
      Infantry._sourceModel = results[0].scene;

      // Collect all bone names from the source model for track name resolution
      const boneNames = new Set();
      Infantry._sourceModel.traverse(child => {
        if (child.isBone || child.isSkinnedMesh || child.isObject3D) {
          boneNames.add(child.name);
        }
      });

      // Extract the first animation clip from each GLB
      for (let i = 0; i < animNames.length; i++) {
        const clips = results[i].animations;
        if (clips.length > 0) {
          const clip = clips[0];

          // Normalize track names: strip path prefixes so tracks bind correctly
          // to the cloned model regardless of scene hierarchy differences between GLBs.
          // Track format: "path/to/boneName.property" → "boneName.property"
          for (const track of clip.tracks) {
            const lastDot = track.name.lastIndexOf('.');
            if (lastDot === -1) continue;
            const objectPath = track.name.substring(0, lastDot);
            const property = track.name.substring(lastDot);

            // Get the leaf name (last segment after '/')
            const lastSlash = objectPath.lastIndexOf('/');
            if (lastSlash >= 0) {
              const leafName = objectPath.substring(lastSlash + 1);
              if (boneNames.has(leafName)) {
                track.name = leafName + property;
              }
            }
          }

          // Trim dead frames from the end of each clip (Mixamo export padding)
          Infantry.trimClipDeadTime(clip);

          Infantry._animations[animNames[i]] = clip;
          console.log(`Infantry animation '${animNames[i]}': ${clip.name} (${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks)`);
        } else {
          console.warn(`Infantry GLB '${animNames[i]}' has no animation clips`);
        }
      }

      console.log('Infantry shared assets loaded');
    })();

    return Infantry._loadPromise;
  }

  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    this.mesh = null;   // Container THREE.Group (like Warhound pattern)
    this.model = null;  // Cloned SkinnedMesh scene
    this.body = null;

    // Animation
    this.mixer = null;
    this.actions = {};          // { idle: AnimationAction, ... }
    this.currentAction = null;
    this.currentState = 'idle';
    this.transitionCooldown = 0;       // seconds until next transition allowed
    this.minTransitionTime = 0.15;     // minimum time to hold an animation state (prevents sub-frame flicker)

    // Movement
    this.moveSpeed = 3;   // walk m/s
    this.runSpeed = 5;    // run m/s
    this.turnSpeed = 4;   // faster than vehicles
    this.moveInput = { x: 0, y: 0 };
    this.isMoving = false;

    // Turret (interface compliance — infantry has no turret)
    this.turretAngle = 0;
    this.turretInput = { x: 0, y: 0 };

    // Firing
    this.canFire = true;
    this.fireRate = 2.0;  // slower than vehicles
    this.projectiles = [];
    this.damageTargets = [];
    this.targetManager = null;

    // Lock-on (interface compliance)
    this.lockTarget = null;

    // Health (much lower than vehicles)
    this.maxHealth = 8;
    this.health = this.maxHealth;
    this.colliderHandle = null;
    this.onDeath = null;

    // Scale: 1.83m tall human
    this.targetHeight = 1.83;
    this.vehicleHeight = this.targetHeight;
    this.scaleFactor = 1;

    // Forward direction (will verify from model at load time)
    this._forwardLocal = new THREE.Vector3(0, 0, 1);
    this._forwardWorld = new THREE.Vector3();

    // Physics offset
    this.meshOffsetY = 0;
    this.modelSize = null;
    this.modelBox = null;
  }

  setTargetManager(targetManager) {
    this.targetManager = targetManager;
  }

  async load() {
    // Ensure shared assets loaded
    await Infantry.loadSharedAssets();

    // Clone source model (proper SkinnedMesh clone with independent skeleton)
    this.model = SkeletonUtils.clone(Infantry._sourceModel);

    // Scale to target height
    const origBox = new THREE.Box3().setFromObject(this.model);
    const origSize = origBox.getSize(new THREE.Vector3());
    this.scaleFactor = this.targetHeight / origSize.y;
    this.model.scale.setScalar(this.scaleFactor);

    // Enable shadows
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Recompute bounding box from scaled model
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    this.vehicleHeight = size.y;
    this.modelSize = size;
    this.modelBox = box;

    // Container group (same pattern as Warhound)
    this.mesh = new THREE.Group();
    this.mesh.add(this.model);
    this.scene.add(this.mesh);

    // Set up AnimationMixer on the cloned model
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of Object.entries(Infantry._animations)) {
      this.actions[name] = this.mixer.clipAction(clip);
    }

    // Start idle
    if (this.actions.idle) {
      this.actions.idle.play();
      this.currentAction = this.actions.idle;
      this.currentState = 'idle';
    }

    // Create physics body
    this.createPhysicsBody(size);

    return this;
  }

  createPhysicsBody(size) {
    // Use fixed human-appropriate radius (bbox width includes arms in bind pose,
    // giving ~0.6m+ radius which is way too fat and causes floating on slopes).
    const radius = 0.3;  // Human torso radius — tight to body
    const totalHalfY = Math.max(size.y / 2, 0.5);
    const capsuleHalfHeight = Math.max(totalHalfY - radius, 0.05);

    // Align model feet with ground
    const modelMinY = this.modelBox ? this.modelBox.min.y : 0;
    this.meshOffsetY = -totalHalfY - modelMinY;

    const spawnY = totalHalfY + 0.1;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, spawnY, 0)
      .setLinearDamping(1.0)
      .setAngularDamping(10.0)
      .enabledRotations(false, true, false);

    this.body = this.world.createRigidBody(rigidBodyDesc);

    // Collision groups: infantry only collides with terrain/rocks (fixed bodies).
    // membership=0x0004 (infantry group), filter=0x0001 (only respond to group 1).
    // Terrain/rocks use default membership (0xFFFF) which includes bit 0x0001 → collision.
    // Vehicles use membership 0x0002 which excludes bit 0x0001 → no collision.
    // Other infantry use membership 0x0004 which excludes bit 0x0001 → no collision.
    // Damage detection uses intersectionsWithShape() which ignores collision groups.
    const infantryGroups = (0x0004 << 16) | 0x0001;

    const colliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, radius)
      .setMass(1)
      .setFriction(0.5)
      .setCollisionGroups(infantryGroups);
    const collider = this.world.createCollider(colliderDesc, this.body);
    this.colliderHandle = collider.handle;
  }

  /**
   * Crossfade to a new animation state.
   * Respects a cooldown timer to prevent rapid flickering between states.
   */
  transitionTo(newState) {
    if (newState === this.currentState) return;
    if (!this.actions[newState]) return;

    // Don't allow rapid transitions (except death which always takes priority)
    if (newState !== 'death' && this.transitionCooldown > 0) return;

    const prevAction = this.currentAction;
    const nextAction = this.actions[newState];

    // Death plays once and clamps
    if (newState === 'death') {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    }

    nextAction.reset().fadeIn(0.25).play();
    if (prevAction && prevAction !== nextAction) {
      prevAction.fadeOut(0.25);
    }

    this.currentAction = nextAction;
    this.currentState = newState;
    this.transitionCooldown = this.minTransitionTime;
  }

  setMoveInput(x, y) {
    this.moveInput.x = x;
    this.moveInput.y = y;
  }

  setTurretInput(x, y) {
    // Infantry has no turret — aiming is done by body rotation
    this.turretInput.x = x;
    this.turretInput.y = y;
  }

  fire() {
    if (!this.canFire || this.health <= 0) return;
    this.canFire = false;

    // Play shoot animation briefly
    this.transitionTo('shoot');
    setTimeout(() => {
      if (this.health > 0 && this.currentState === 'shoot') {
        this.transitionTo(this.isMoving ? 'walk' : 'idle');
      }
    }, 500);

    // Spawn projectile from chest height
    const spawnPos = this.getPosition();
    spawnPos.y += this.vehicleHeight * 0.6;

    // Fire in facing direction
    const direction = new THREE.Vector3();
    this.getForwardVector(direction);

    // Small forward offset so projectile clears the model
    spawnPos.add(direction.clone().multiplyScalar(this.modelSize.z * 0.6));

    const projectile = new Projectile(
      this.scene, this.world, spawnPos, direction.normalize(),
      this.targetManager, this.damageTargets
    );
    projectile.damage = 2; // Much less than vehicle projectiles (10)
    this.projectiles.push(projectile);

    setTimeout(() => {
      this.canFire = true;
    }, this.fireRate * 1000);
  }

  update(delta) {
    if (!this.mesh || !this.body) return;

    // Dead — only update animation mixer for death anim
    if (this.health <= 0) {
      if (this.mixer) this.mixer.update(delta);
      return;
    }

    // Tick down animation transition cooldown
    if (this.transitionCooldown > 0) this.transitionCooldown -= delta;

    const pos = this.body.translation();
    const rot = this.body.rotation();
    const currentVel = this.body.linvel();

    // Rotation
    if (Math.abs(this.moveInput.x) > 0.1) {
      const turnRate = -this.moveInput.x * this.turnSpeed;
      this.body.setAngvel({ x: 0, y: turnRate, z: 0 }, true);
    } else {
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Movement
    const speed = Math.abs(this.moveInput.y) > 0.7 ? this.runSpeed : this.moveSpeed;
    if (Math.abs(this.moveInput.y) > 0.1) {
      const forward = this._forwardWorld
        .copy(this._forwardLocal)
        .applyQuaternion(this.mesh.quaternion);

      const targetSpeed = this.moveInput.y * speed;
      const targetVel = forward.multiplyScalar(targetSpeed);
      this.body.setLinvel({ x: targetVel.x, y: currentVel.y, z: targetVel.z }, true);
      this.isMoving = true;
    } else {
      this.body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);
      this.isMoving = false;
    }

    // Sync mesh to physics
    this.mesh.position.set(pos.x, pos.y + this.meshOffsetY, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Animation state transitions (don't interrupt shoot or death)
    if (this.currentState !== 'shoot' && this.currentState !== 'melee' && this.currentState !== 'death') {
      if (this.isMoving) {
        const animState = Math.abs(this.moveInput.y) > 0.7 ? 'run' : 'walk';
        this.transitionTo(animState);
      } else {
        this.transitionTo('idle');
      }
    }

    // Update animation mixer
    if (this.mixer) this.mixer.update(delta);

    // Update projectiles
    this.projectiles = this.projectiles.filter(p => {
      p.update(delta);
      return p.alive;
    });
  }

  takeDamage(amount) {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.transitionTo('death');
      if (this.onDeath) this.onDeath(this);
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

  dispose() {
    if (this.mesh) this.scene.remove(this.mesh);
    if (this.body) this.world.removeRigidBody(this.body);
    if (this.mixer) this.mixer.stopAllAction();
  }
}
