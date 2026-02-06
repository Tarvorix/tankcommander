import * as THREE from 'three';
import { AbilitySystem } from './AbilitySystem.js';

/**
 * Titan Hero — "Warhound Titan"
 * MOBA hero wrapper around the Warhound vehicle class.
 *
 * Passive: Towering Presence — Nearby enemy minions deal 15% less damage
 * Q: Ground Stomp — AOE slam dealing 20/30/40 damage, slowing enemies 40% for 2s (8s CD)
 * W: Titan Charge — Dash forward 15m, dealing 15/22/30 damage to enemies hit (12s CD)
 * E: War Cry — Nearby allied minions gain 30% attack speed for 5s (15s CD)
 * R: Titan Rage — Gain 50% attack speed + 20% move speed for 8s (60s CD)
 */
export class HeroTitan {
  constructor(warhound, scene, world) {
    this.warhound = warhound;
    this.scene = scene;
    this.world = world;
    this.heroName = 'Warhound Titan';
    this.heroType = 'titan';

    // MOBA stats
    this.attackRange = 18;
    this.baseFireRate = warhound.fireRate;
    this.baseMoveSpeed = warhound.moveSpeed;

    // Buff state
    this.rageActive = false;
    this.chargeActive = false;

    // Passive: track nearby minions
    this.passiveRadius = 15;
    this.affectedMinions = new Set();

    // Ability system
    this.abilitySystem = new AbilitySystem(warhound, scene, world);
    this.registerAbilities();
  }

  registerAbilities() {
    // Q: Ground Stomp
    this.abilitySystem.registerAbility('q', {
      name: 'Ground Stomp',
      description: 'AOE slam dealing damage and slowing enemies',
      cooldown: 8,
      cooldownPerLevel: [8, 7, 6],
      maxLevel: 3,
      levelRequired: 1,
      type: 'instant',
      damagePerLevel: [20, 30, 40],
      execute: (hero, target, groundPos, level, system) => {
        const heroPos = hero.getPosition();
        const stompRadius = 12;
        const damage = [20, 30, 40][level - 1];

        // Visual: shockwave expanding ring
        system.createAOEEffect(heroPos, stompRadius, 0xff8844, 1.0);

        // Create expanding ring visual
        const ringGeo = new THREE.TorusGeometry(2, 0.8, 8, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xff6600,
          transparent: true,
          opacity: 0.8,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(heroPos.x, 1, heroPos.z);
        system.scene.add(ring);

        system.activeEffects.push({
          mesh: ring,
          age: 0,
          duration: 0.6,
          update: (dt) => {
            const t = system.activeEffects.find(e => e.mesh === ring).age / 0.6;
            const scale = 1 + t * (stompRadius / 2);
            ring.scale.setScalar(scale);
            ringMat.opacity = 0.8 * (1 - t);
          },
          onEnd: () => {}
        });

        // Damage all enemies in radius
        if (hero.damageTargets) {
          for (const enemy of hero.damageTargets) {
            if (!enemy.isAlive || !enemy.isAlive()) continue;
            const enemyPos = enemy.getPosition();
            const dist = heroPos.distanceTo(enemyPos);
            if (dist <= stompRadius) {
              enemy.takeDamage(damage);

              // Slow effect: reduce move speed temporarily
              if (enemy.moveSpeed !== undefined) {
                const originalSpeed = enemy.moveSpeed;
                enemy.moveSpeed *= 0.6; // 40% slow
                setTimeout(() => {
                  if (enemy.isAlive && enemy.isAlive()) {
                    enemy.moveSpeed = originalSpeed;
                  }
                }, 2000);
              }
            }
          }
        }
      }
    });

    // W: Titan Charge
    this.abilitySystem.registerAbility('w', {
      name: 'Titan Charge',
      description: 'Dash forward dealing damage to enemies hit',
      cooldown: 12,
      cooldownPerLevel: [12, 10, 8],
      maxLevel: 3,
      levelRequired: 1,
      type: 'instant',
      damagePerLevel: [15, 22, 30],
      execute: (hero, target, groundPos, level, system) => {
        if (this.chargeActive) return;
        this.chargeActive = true;

        const damage = [15, 22, 30][level - 1];
        const chargeDistance = 15;
        const chargeDuration = 0.5;
        const chargeSpeed = chargeDistance / chargeDuration;

        // Get forward direction
        const forward = new THREE.Vector3();
        hero.getForwardVector(forward);
        forward.setY(0).normalize();

        const originalSpeed = hero.moveSpeed;
        hero.moveSpeed = chargeSpeed;

        // Track enemies already hit to avoid double-hitting
        const hitEnemies = new Set();

        // Visual trail
        const trailMat = new THREE.MeshBasicMaterial({
          color: 0xff4400,
          transparent: true,
          opacity: 0.4,
        });

        system.activeEffects.push({
          mesh: null,
          age: 0,
          duration: chargeDuration,
          update: (dt) => {
            // Force forward movement
            hero.setMoveInput(0, 1);

            // Check for enemy collisions during charge
            const heroPos = hero.getPosition();
            if (hero.damageTargets) {
              for (const enemy of hero.damageTargets) {
                if (hitEnemies.has(enemy)) continue;
                if (!enemy.isAlive || !enemy.isAlive()) continue;
                const dist = heroPos.distanceTo(enemy.getPosition());
                if (dist < 6) {
                  enemy.takeDamage(damage);
                  hitEnemies.add(enemy);
                }
              }
            }

            // Trail particles
            const trailGeo = new THREE.SphereGeometry(2, 4, 4);
            const trail = new THREE.Mesh(trailGeo, trailMat.clone());
            trail.position.copy(heroPos);
            trail.position.y = 2;
            system.scene.add(trail);

            system.activeEffects.push({
              mesh: trail,
              age: 0,
              duration: 0.4,
              update: (dt2) => {
                const te = system.activeEffects.find(e => e.mesh === trail);
                if (te) trail.material.opacity = 0.4 * (1 - te.age / 0.4);
              },
              onEnd: () => {}
            });
          },
          onEnd: () => {
            hero.moveSpeed = this.rageActive ? originalSpeed * 1.2 : originalSpeed;
            hero.setMoveInput(0, 0);
            this.chargeActive = false;
          }
        });
      }
    });

    // E: War Cry
    this.abilitySystem.registerAbility('e', {
      name: 'War Cry',
      description: 'Nearby allied minions gain 30% attack speed',
      cooldown: 15,
      cooldownPerLevel: [15, 13, 11],
      maxLevel: 3,
      levelRequired: 1,
      type: 'instant',
      execute: (hero, target, groundPos, level, system) => {
        const heroPos = hero.getPosition();
        const buffRadius = 20;
        const buffDuration = 5;
        const speedBoost = 0.3 + (level - 1) * 0.1;

        // Visual: expanding ring
        system.createAOEEffect(heroPos, buffRadius, 0x44ff44, 1.0);

        // Buff effect — store reference to allied minions for buff application
        // This will be applied by the game loop which has access to allied minions
        this._warCryPending = {
          center: heroPos.clone(),
          radius: buffRadius,
          duration: buffDuration,
          speedBoost: speedBoost,
        };
      }
    });

    // R: Titan Rage
    this.abilitySystem.registerAbility('r', {
      name: 'Titan Rage',
      description: 'Gain 50% attack speed and 20% move speed for 8 seconds',
      cooldown: 60,
      cooldownPerLevel: [60, 50, 40],
      maxLevel: 3,
      levelRequired: 6,
      type: 'instant',
      execute: (hero, target, groundPos, level, system) => {
        this.rageActive = true;

        const baseFireRate = this.baseFireRate;
        const baseMoveSpeed = this.baseMoveSpeed;
        const atkBoost = 0.5 + (level - 1) * 0.1;  // 50/60/70% attack speed
        const moveBoost = 0.2 + (level - 1) * 0.05; // 20/25/30% move speed
        const duration = 8;

        hero.fireRate = baseFireRate * (1 - atkBoost);
        hero.moveSpeed = baseMoveSpeed * (1 + moveBoost);

        // Visual: red/orange aura
        const auraGeo = new THREE.SphereGeometry(8, 12, 12);
        const auraMat = new THREE.MeshBasicMaterial({
          color: 0xff4400,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
        });
        const aura = new THREE.Mesh(auraGeo, auraMat);
        system.scene.add(aura);

        system.activeEffects.push({
          mesh: aura,
          age: 0,
          duration: duration,
          update: (dt) => {
            const pos = hero.getPosition();
            aura.position.set(pos.x, pos.y + 4, pos.z);
            const pulse = 1 + Math.sin(Date.now() * 0.008) * 0.1;
            aura.scale.setScalar(pulse);
            const te = system.activeEffects.find(e => e.mesh === aura);
            if (te) auraMat.opacity = 0.15 * (1 - te.age / duration * 0.5);
          },
          onEnd: () => {
            hero.fireRate = baseFireRate;
            hero.moveSpeed = baseMoveSpeed;
            this.rageActive = false;
          }
        });
      }
    });
  }

  /**
   * Apply passive aura — reduce nearby enemy minion damage.
   * Called by game loop with access to enemy minions.
   */
  applyPassiveAura(enemyMinions) {
    const heroPos = this.warhound.getPosition();

    for (const minion of enemyMinions) {
      if (!minion.isAlive || !minion.isAlive()) continue;
      const dist = heroPos.distanceTo(minion.getPosition());

      if (dist <= this.passiveRadius) {
        if (!this.affectedMinions.has(minion)) {
          this.affectedMinions.add(minion);
          // Apply damage debuff (track original damage)
          if (!minion._originalDamage) {
            minion._originalDamage = minion.damage || 2;
          }
          // Reduce to 85%
          if (minion.projectiles !== undefined) {
            // For infantry-type minions, we'll handle in their fire()
          }
        }
      } else {
        if (this.affectedMinions.has(minion)) {
          this.affectedMinions.delete(minion);
          // Restore original damage
          // (handled by game loop)
        }
      }
    }
  }

  /**
   * Check and apply pending War Cry buff.
   */
  getWarCryPending() {
    const pending = this._warCryPending;
    this._warCryPending = null;
    return pending;
  }

  update(delta) {
    this.abilitySystem.update(delta);
  }
}
