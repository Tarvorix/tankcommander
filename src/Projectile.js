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
