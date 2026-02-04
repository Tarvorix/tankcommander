import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Target {
  constructor(scene, world, position) {
    this.scene = scene;
    this.world = world;
    this.alive = true;
    this.health = 1;

    // Create target visual - simple cylinder with bullseye
    const group = new THREE.Group();

    // Base stand
    const standGeometry = new THREE.CylinderGeometry(0.3, 0.4, 2, 8);
    const standMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const stand = new THREE.Mesh(standGeometry, standMaterial);
    stand.position.y = 1;
    stand.castShadow = true;
    group.add(stand);

    // Target board (flat cylinder)
    const boardGeometry = new THREE.CylinderGeometry(1.5, 1.5, 0.2, 32);
    const boardMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const board = new THREE.Mesh(boardGeometry, boardMaterial);
    board.rotation.x = Math.PI / 2;
    board.position.y = 2.5;
    board.castShadow = true;
    group.add(board);

    // Red outer ring
    const ring1Geometry = new THREE.RingGeometry(1.0, 1.4, 32);
    const ring1Material = new THREE.MeshStandardMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const ring1 = new THREE.Mesh(ring1Geometry, ring1Material);
    ring1.position.y = 2.5;
    ring1.position.z = 0.11;
    group.add(ring1);

    // White middle ring
    const ring2Geometry = new THREE.RingGeometry(0.6, 1.0, 32);
    const ring2Material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const ring2 = new THREE.Mesh(ring2Geometry, ring2Material);
    ring2.position.y = 2.5;
    ring2.position.z = 0.11;
    group.add(ring2);

    // Red inner ring
    const ring3Geometry = new THREE.RingGeometry(0.2, 0.6, 32);
    const ring3Material = new THREE.MeshStandardMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const ring3 = new THREE.Mesh(ring3Geometry, ring3Material);
    ring3.position.y = 2.5;
    ring3.position.z = 0.11;
    group.add(ring3);

    // Bullseye center
    const centerGeometry = new THREE.CircleGeometry(0.2, 32);
    const centerMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00, side: THREE.DoubleSide });
    const center = new THREE.Mesh(centerGeometry, centerMaterial);
    center.position.y = 2.5;
    center.position.z = 0.12;
    group.add(center);

    group.position.copy(position);
    this.mesh = group;
    this.scene.add(this.mesh);

    // Physics body - box collider for the target board area
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y + 2.5, position.z);
    this.body = this.world.createRigidBody(bodyDesc);

    // Collider for hit detection (box around the target face)
    const colliderDesc = RAPIER.ColliderDesc.cuboid(1.5, 1.5, 0.3);
    this.collider = this.world.createCollider(colliderDesc, this.body);

    // Store reference to this target on the collider for hit detection
    this.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  }

  hit() {
    if (!this.alive) return;

    this.health -= 1;

    if (this.health <= 0) {
      this.destroy();
    }
  }

  destroy() {
    this.alive = false;

    // Animate falling over
    this.falling = true;
    this.fallRotation = 0;
  }

  update(delta) {
    if (this.falling) {
      this.fallRotation += delta * 3;
      this.mesh.rotation.x = -this.fallRotation;

      if (this.fallRotation > Math.PI / 2) {
        // Remove after fallen
        this.scene.remove(this.mesh);
        this.world.removeRigidBody(this.body);
        this.falling = false;
      }
    }
  }

  getColliderHandle() {
    return this.collider.handle;
  }
}

export class TargetManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.targets = [];
  }

  spawnTargets(count = 5) {
    // Spawn targets at various positions around the map
    const positions = [
      new THREE.Vector3(20, 0, -20),
      new THREE.Vector3(-25, 0, -15),
      new THREE.Vector3(30, 0, 10),
      new THREE.Vector3(-20, 0, 25),
      new THREE.Vector3(0, 0, -40),
      new THREE.Vector3(40, 0, -30),
      new THREE.Vector3(-35, 0, 0),
    ];

    for (let i = 0; i < Math.min(count, positions.length); i++) {
      const target = new Target(this.scene, this.world, positions[i]);
      // Rotate target to face center (roughly toward player spawn)
      target.mesh.lookAt(0, target.mesh.position.y, 0);
      this.targets.push(target);
    }
  }

  update(delta) {
    this.targets.forEach(target => target.update(delta));
    // Remove destroyed targets from list
    this.targets = this.targets.filter(t => t.alive || t.falling);
  }

  checkHit(colliderHandle) {
    for (const target of this.targets) {
      if (target.alive && target.getColliderHandle() === colliderHandle) {
        target.hit();
        return true;
      }
    }
    return false;
  }

  getActiveTargets() {
    return this.targets.filter(t => t.alive);
  }
}
