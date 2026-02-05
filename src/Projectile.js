import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Projectile {
  constructor(scene, world, position, direction, targetManager = null, damageTargets = []) {
    this.scene = scene;
    this.world = world;
    this.targetManager = targetManager;
    this.damageTargets = damageTargets; // vehicles that can be damaged by this projectile
    this.damage = 10;
    this.alive = true;
    this.lifetime = 3; // seconds
    this.age = 0;
    this.speed = 50;

    // Visual
    const geometry = new THREE.SphereGeometry(0.15, 8, 8);
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

    const colliderDesc = RAPIER.ColliderDesc.ball(0.15)
      .setRestitution(0)
      .setFriction(0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = this.world.createCollider(colliderDesc, this.body);

    // Track previous position for trail effect
    this.prevPosition = position.clone();
  }

  update(delta) {
    if (!this.alive) return;

    this.age += delta;

    // Update visual from physics
    const pos = this.body.translation();
    this.mesh.position.set(pos.x, pos.y, pos.z);

    // Check for collisions with targets and vehicles
    if (this.targetManager || this.damageTargets.length > 0) {
      this.checkTargetCollisions();
    }

    // Check lifetime or if hit ground
    if (this.age > this.lifetime || pos.y < -2) {
      this.destroy();
    }

    this.prevPosition.set(pos.x, pos.y, pos.z);
  }

  checkTargetCollisions() {
    // Use Rapier's intersection test
    const pos = this.body.translation();

    // Cast a small sphere to check for intersections
    const shape = new RAPIER.Ball(0.2);
    const shapePos = { x: pos.x, y: pos.y, z: pos.z };
    const shapeRot = { x: 0, y: 0, z: 0, w: 1 };

    this.world.intersectionsWithShape(shapePos, shapeRot, shape, (collider) => {
      // Skip self
      if (collider.handle === this.collider.handle) return true;

      // Check if we hit a target (bullseye targets)
      if (this.targetManager && this.targetManager.checkHit(collider.handle)) {
        this.createHitEffect(pos);
        this.destroy();
        return false; // Stop iterating
      }

      // Check if we hit a damageable vehicle
      for (const vehicle of this.damageTargets) {
        if (vehicle.isAlive() && vehicle.getColliderHandle() === collider.handle) {
          vehicle.takeDamage(this.damage);
          this.createHitEffect(pos);
          this.destroy();
          return false; // Stop iterating
        }
      }

      // Check if we hit terrain or rocks (fixed bodies)
      const parentBody = collider.parent();
      if (parentBody && parentBody.isFixed()) {
        this.createHitEffect(pos);
        this.destroy();
        return false;
      }

      return true; // Continue iterating
    });
  }

  createHitEffect(position) {
    // Simple hit flash effect
    const flashGeometry = new THREE.SphereGeometry(0.5, 8, 8);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 1
    });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.set(position.x, position.y, position.z);
    this.scene.add(flash);

    // Animate and remove
    let scale = 1;
    const animate = () => {
      scale += 0.3;
      flash.scale.setScalar(scale);
      flashMaterial.opacity -= 0.15;

      if (flashMaterial.opacity > 0) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(flash);
        flashGeometry.dispose();
        flashMaterial.dispose();
      }
    };
    requestAnimationFrame(animate);
  }

  destroy() {
    if (!this.alive) return;

    this.alive = false;
    this.scene.remove(this.mesh);
    this.world.removeRigidBody(this.body);
  }
}
