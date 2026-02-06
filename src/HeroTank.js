import * as THREE from 'three';
import { AbilitySystem } from './AbilitySystem.js';
import { Projectile } from './Projectile.js';

/**
 * Tank Hero — "Iron Bastion"
 * MOBA hero wrapper around the Tank vehicle class.
 *
 * Passive: Heavy Armor — 10% damage reduction
 * Q: Shield Wall — Gain 50% damage reduction for 3 seconds (8s CD)
 * W: Siege Shot — Fire a massive shot dealing 25/35/45 damage (10s CD)
 * E: Fortify — Anchor in place, gain 30% attack speed for 5s (15s CD)
 * R: Artillery Barrage — Rain shells on an area for 3s dealing 15 dmg each (60s CD)
 */
export class HeroTank {
  constructor(tank, scene, world) {
    this.tank = tank;
    this.scene = scene;
    this.world = world;
    this.heroName = 'Iron Bastion';
    this.heroType = 'tank';

    // MOBA stats
    this.attackRange = 20;
    this.baseFireRate = tank.fireRate;
    this.baseMoveSpeed = tank.moveSpeed;

    // Buff state
    this.shieldWallActive = false;
    this.shieldWallReduction = 0;
    this.fortifyActive = false;
    this.originalFireRate = tank.fireRate;

    // Shield wall visual
    this.shieldBubble = null;

    // Ability system
    this.abilitySystem = new AbilitySystem(tank, scene, world);
    this.registerAbilities();

    // Override tank's takeDamage for passive
    const originalTakeDamage = tank.takeDamage.bind(tank);
    tank.takeDamage = (amount) => {
      // Passive: 10% damage reduction always
      let reduced = amount * 0.9;

      // Shield Wall: additional 50% reduction
      if (this.shieldWallActive) {
        reduced *= 0.5;
      }

      originalTakeDamage(reduced);
    };
  }

  registerAbilities() {
    // Q: Shield Wall
    this.abilitySystem.registerAbility('q', {
      name: 'Shield Wall',
      description: 'Gain 50% damage reduction for 3 seconds',
      cooldown: 8,
      cooldownPerLevel: [8, 7, 6],
      maxLevel: 3,
      levelRequired: 1,
      type: 'instant',
      execute: (hero, target, groundPos, level, system) => {
        this.shieldWallActive = true;

        // Visual: blue shield bubble
        if (this.shieldBubble) {
          this.scene.remove(this.shieldBubble);
        }
        const bubbleGeo = new THREE.SphereGeometry(5, 16, 16);
        const bubbleMat = new THREE.MeshBasicMaterial({
          color: 0x4488ff,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
        });
        this.shieldBubble = new THREE.Mesh(bubbleGeo, bubbleMat);
        this.scene.add(this.shieldBubble);

        const duration = 3;
        system.applyBuff('shield_wall', duration,
          () => { this.shieldWallActive = true; },
          () => {
            this.shieldWallActive = false;
            if (this.shieldBubble) {
              this.scene.remove(this.shieldBubble);
              this.shieldBubble = null;
            }
          }
        );
      }
    });

    // W: Siege Shot
    this.abilitySystem.registerAbility('w', {
      name: 'Siege Shot',
      description: 'Fire a massive shot dealing heavy damage',
      cooldown: 10,
      cooldownPerLevel: [10, 9, 8],
      maxLevel: 3,
      levelRequired: 1,
      type: 'instant',
      damagePerLevel: [25, 35, 45],
      execute: (hero, target, groundPos, level, system) => {
        if (!hero.turret) return;

        // Get turret world position and direction
        const turretWorldPos = new THREE.Vector3();
        hero.turret.getWorldPosition(turretWorldPos);

        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(hero.mesh.quaternion);
        direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), hero.turretAngle);

        const barrelOffset = hero.modelSize.z * 0.4;
        const spawnPos = turretWorldPos.clone().add(direction.clone().multiplyScalar(barrelOffset));
        spawnPos.y += hero.modelSize.y * 0.05;

        const projectile = new Projectile(
          this.scene, this.world, spawnPos, direction.normalize(),
          hero.targetManager, hero.damageTargets
        );
        projectile.damage = [25, 35, 45][level - 1];
        projectile.speed = 35; // Slower but harder hitting

        // Bigger visual
        if (projectile.mesh) {
          projectile.mesh.scale.setScalar(2.5);
          projectile.mesh.material.color.setHex(0xff8800);
        }

        hero.projectiles.push(projectile);
      }
    });

    // E: Fortify
    this.abilitySystem.registerAbility('e', {
      name: 'Fortify',
      description: 'Anchor in place, gain 30% attack speed for 5 seconds',
      cooldown: 15,
      cooldownPerLevel: [15, 13, 11],
      maxLevel: 3,
      levelRequired: 1,
      type: 'instant',
      execute: (hero, target, groundPos, level, system) => {
        const speedBoost = 0.3 + (level - 1) * 0.1; // 30/40/50%
        const originalRate = this.originalFireRate;
        hero.fireRate = originalRate * (1 - speedBoost);

        // Visual anchor effect
        const anchorGeo = new THREE.RingGeometry(3, 4, 6);
        const anchorMat = new THREE.MeshBasicMaterial({
          color: 0xffaa00,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
        });
        const anchorMesh = new THREE.Mesh(anchorGeo, anchorMat);
        anchorMesh.rotation.x = -Math.PI / 2;
        this.scene.add(anchorMesh);

        const heroPos = hero.getPosition();
        system.activeEffects.push({
          mesh: anchorMesh,
          age: 0,
          duration: 5,
          update: (dt) => {
            const pos = hero.getPosition();
            anchorMesh.position.set(pos.x, 0.2, pos.z);
            anchorMesh.rotation.z += dt * 2;
            anchorMat.opacity = 0.5 * (1 - system.activeEffects.find(e => e.mesh === anchorMesh).age / 5);
          },
          onEnd: () => {
            hero.fireRate = originalRate;
            this.fortifyActive = false;
          }
        });

        this.fortifyActive = true;
      }
    });

    // R: Artillery Barrage
    this.abilitySystem.registerAbility('r', {
      name: 'Artillery Barrage',
      description: 'Rain shells on a target area for 3 seconds',
      cooldown: 60,
      cooldownPerLevel: [60, 50, 40],
      maxLevel: 3,
      levelRequired: 6,
      type: 'ground_target',
      range: 40,
      execute: (hero, target, groundPos, level, system) => {
        if (!groundPos) return;

        const barrageCenter = groundPos.clone();
        barrageCenter.y = 0;
        const barrageRadius = 12;
        const barrageDuration = 3;
        const shellDamage = [15, 22, 30][level - 1];
        const shellInterval = 0.3;
        let shellTimer = 0;

        // Visual: danger zone circle
        system.createAOEEffect(barrageCenter, barrageRadius, 0xff4400, barrageDuration + 0.5);

        // Barrage effect that spawns shells
        system.activeEffects.push({
          mesh: null,
          age: 0,
          duration: barrageDuration,
          update: (dt) => {
            shellTimer += dt;
            if (shellTimer >= shellInterval) {
              shellTimer -= shellInterval;

              // Random position within barrage radius
              const angle = Math.random() * Math.PI * 2;
              const dist = Math.random() * barrageRadius;
              const shellX = barrageCenter.x + Math.cos(angle) * dist;
              const shellZ = barrageCenter.z + Math.sin(angle) * dist;

              // Spawn shell from high above
              const spawnPos = new THREE.Vector3(shellX, 40, shellZ);
              const direction = new THREE.Vector3(0, -1, 0);

              const shell = new Projectile(
                system.scene, system.world, spawnPos, direction,
                null, hero.damageTargets
              );
              shell.damage = shellDamage;
              shell.speed = 60;

              if (shell.mesh) {
                shell.mesh.material.color.setHex(0xff6600);
                shell.mesh.scale.setScalar(1.8);
              }

              hero.projectiles.push(shell);
            }
          },
          onEnd: () => {}
        });
      }
    });
  }

  update(delta) {
    // Update shield bubble position
    if (this.shieldBubble && this.tank.mesh) {
      const pos = this.tank.getPosition();
      this.shieldBubble.position.set(pos.x, pos.y + 3, pos.z);
      // Pulse effect
      const scale = 1 + Math.sin(Date.now() * 0.005) * 0.05;
      this.shieldBubble.scale.setScalar(scale);
    }

    // Update ability system
    this.abilitySystem.update(delta);
  }
}
