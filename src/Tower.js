import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Projectile } from './Projectile.js';

/**
 * Defensive tower that guards a lane.
 * Auto-targets nearby enemies: prioritizes minions, targets heroes if they attack allied heroes.
 * Fires at a fixed rate, dealing heavy damage.
 */
export class Tower {
  constructor(scene, world, position, team) {
    this.scene = scene;
    this.world = world;
    this.team = team; // 'blue' or 'red'
    this.position = new THREE.Vector3(position.x, 0, position.z);

    // Stats
    this.maxHealth = 200;
    this.health = this.maxHealth;
    this.damage = 25;
    this.attackRange = 30;
    this.fireRate = 1.5; // seconds between shots
    this.fireTimer = 0;
    this.projectileSpeed = 40;

    // Targeting
    this.currentTarget = null;
    this.damageTargets = []; // enemies that can be damaged
    this.aggroTarget = null; // priority target (hero that attacked allied hero)
    this.aggroTimer = 0;
    this.aggroDuration = 3; // seconds to prioritize aggro target

    // Visual
    this.mesh = null;
    this.turretPivot = null;
    this.rangeIndicator = null;
    this.alive = true;
    this.projectiles = [];
    this.colliderHandle = null;

    // Death callback
    this.onDeath = null;

    this.createVisual();
    this.createPhysics();
  }

  createVisual() {
    const color = this.team === 'blue' ? 0x3366cc : 0xcc3333;
    const darkColor = this.team === 'blue' ? 0x224488 : 0x882222;

    // Tower group
    this.mesh = new THREE.Group();
    this.mesh.position.copy(this.position);

    // Base pedestal
    const baseGeo = new THREE.CylinderGeometry(3, 3.5, 2, 8);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.8,
      metalness: 0.2,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 1;
    base.castShadow = true;
    base.receiveShadow = true;
    this.mesh.add(base);

    // Tower body
    const bodyGeo = new THREE.CylinderGeometry(2, 2.5, 10, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: darkColor,
      roughness: 0.6,
      metalness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 7;
    body.castShadow = true;
    body.receiveShadow = true;
    this.mesh.add(body);

    // Tower top platform
    const topGeo = new THREE.CylinderGeometry(2.8, 2, 2, 8);
    const topMat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.4,
      metalness: 0.4,
      emissive: color,
      emissiveIntensity: 0.3,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 13;
    top.castShadow = true;
    this.mesh.add(top);

    // Turret pivot (rotates to aim)
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.y = 14;
    this.mesh.add(this.turretPivot);

    // Turret barrel
    const barrelGeo = new THREE.CylinderGeometry(0.4, 0.5, 5, 6);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.5,
      metalness: 0.6,
    });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.z = 2.5;
    barrel.castShadow = true;
    this.turretPivot.add(barrel);

    // Glowing orb on top
    const orbGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const orbMat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.1,
      metalness: 0.9,
      emissive: color,
      emissiveIntensity: 1.0,
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = 1.5;
    this.turretPivot.add(orb);
    this.orbMaterial = orbMat;

    // Range indicator (debug visualization, can toggle)
    const rangeGeo = new THREE.RingGeometry(this.attackRange - 0.5, this.attackRange, 48);
    const rangeMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    });
    this.rangeIndicator = new THREE.Mesh(rangeGeo, rangeMat);
    this.rangeIndicator.rotation.x = -Math.PI / 2;
    this.rangeIndicator.position.y = 0.1;
    this.rangeIndicator.visible = false; // hidden by default
    this.mesh.add(this.rangeIndicator);

    this.scene.add(this.mesh);
  }

  createPhysics() {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(this.position.x, 6, this.position.z);
    const body = this.world.createRigidBody(bodyDesc);

    // Tower collision — cylinder approximated as cuboid
    const colliderDesc = RAPIER.ColliderDesc.cuboid(2.5, 6, 2.5);
    const collider = this.world.createCollider(colliderDesc, body);
    this.colliderHandle = collider.handle;
    this.body = body;
  }

  setDamageTargets(targets) {
    this.damageTargets = targets;
  }

  /**
   * Called when this tower's allied hero is attacked by an enemy hero.
   * Tower switches to target that hero for a duration.
   */
  setAggro(target) {
    this.aggroTarget = target;
    this.aggroTimer = this.aggroDuration;
  }

  findTarget() {
    if (!this.alive) return null;

    // Priority 1: Aggro target (hero that attacked allied hero)
    if (this.aggroTarget && this.aggroTarget.isAlive && this.aggroTarget.isAlive()) {
      const dist = this.position.distanceTo(this.aggroTarget.getPosition());
      if (dist <= this.attackRange) {
        return this.aggroTarget;
      }
    }

    // Priority 2: Nearest minion in range
    let nearestMinion = null;
    let nearestMinionDist = Infinity;
    let nearestHero = null;
    let nearestHeroDist = Infinity;

    for (const target of this.damageTargets) {
      if (!target.isAlive || !target.isAlive()) continue;
      const dist = this.position.distanceTo(target.getPosition());
      if (dist > this.attackRange) continue;

      if (target.isMinion) {
        if (dist < nearestMinionDist) {
          nearestMinionDist = dist;
          nearestMinion = target;
        }
      } else {
        if (dist < nearestHeroDist) {
          nearestHeroDist = dist;
          nearestHero = target;
        }
      }
    }

    // Prefer minions, fall back to heroes
    return nearestMinion || nearestHero || null;
  }

  fire(target) {
    if (!target || !target.isAlive()) return;

    const targetPos = target.getPosition();
    const spawnPos = new THREE.Vector3(
      this.position.x,
      14, // turret height
      this.position.z
    );

    const direction = new THREE.Vector3()
      .subVectors(targetPos, spawnPos);

    // Lead the target slightly based on distance
    const dist = direction.length();
    direction.normalize();

    // Slightly aim upward for visual arc effect
    direction.y += 0.1;
    direction.normalize();

    const projectile = new Projectile(
      this.scene, this.world, spawnPos, direction,
      null, this.damageTargets
    );
    projectile.damage = this.damage;
    projectile.speed = this.projectileSpeed;

    // Override projectile visual for tower shots
    if (projectile.mesh && projectile.mesh.material) {
      const towerColor = this.team === 'blue' ? 0x44aaff : 0xff4444;
      projectile.mesh.material.color.setHex(towerColor);
      projectile.mesh.scale.setScalar(1.5);
    }

    this.projectiles.push(projectile);
  }

  update(delta) {
    if (!this.alive) return;

    // Aggro timer
    if (this.aggroTimer > 0) {
      this.aggroTimer -= delta;
      if (this.aggroTimer <= 0) {
        this.aggroTarget = null;
      }
    }

    // Find target
    this.currentTarget = this.findTarget();

    // Aim turret at target
    if (this.currentTarget && this.turretPivot) {
      const targetPos = this.currentTarget.getPosition();
      const dx = targetPos.x - this.position.x;
      const dz = targetPos.z - this.position.z;
      const angle = Math.atan2(dx, dz);
      this.turretPivot.rotation.y = angle;
    }

    // Fire at target
    this.fireTimer += delta;
    if (this.currentTarget && this.fireTimer >= this.fireRate) {
      this.fire(this.currentTarget);
      this.fireTimer = 0;
    }

    // Update projectiles
    this.projectiles = this.projectiles.filter(p => {
      p.update(delta);
      return p.alive;
    });

    // Pulse orb when targeting
    if (this.orbMaterial) {
      const pulse = this.currentTarget ? 1.0 + Math.sin(Date.now() * 0.005) * 0.5 : 0.5;
      this.orbMaterial.emissiveIntensity = pulse;
    }
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this.destroy();
      if (this.onDeath) this.onDeath(this);
    }
  }

  isAlive() {
    return this.alive;
  }

  getPosition() {
    return this.position.clone();
  }

  getColliderHandle() {
    return this.colliderHandle;
  }

  destroy() {
    this.alive = false;
    // Visual destruction — collapse tower
    if (this.mesh) {
      // Fade and sink
      this.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.transparent = true;
          child.material.opacity = 0.5;
        }
      });
      // Tilt tower
      this.mesh.rotation.x = 0.3;
      this.mesh.position.y = -2;
    }
  }

  dispose() {
    if (this.mesh) this.scene.remove(this.mesh);
    for (const p of this.projectiles) {
      if (p.alive) p.destroy();
    }
    this.projectiles.length = 0;
  }
}
