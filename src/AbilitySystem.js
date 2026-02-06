import * as THREE from 'three';

/**
 * Ability system for MOBA heroes.
 * Each ability has:
 * - Cooldown timer
 * - Mana cost (optional)
 * - Level requirement
 * - Execute function
 * - Visual effect
 */
export class AbilitySystem {
  constructor(hero, scene, world) {
    this.hero = hero;
    this.scene = scene;
    this.world = world;

    // Ability slots
    this.abilities = {
      q: null,
      w: null,
      e: null,
      r: null,
    };

    // Hero level & XP
    this.level = 1;
    this.maxLevel = 10;
    this.xp = 0;
    this.xpToLevel = [0, 100, 220, 370, 550, 780, 1060, 1400, 1820, 2340]; // XP needed for each level
    this.skillPoints = 0;

    // Active effects to update each frame
    this.activeEffects = [];
  }

  /**
   * Register an ability in a slot.
   * @param {string} slot - 'q', 'w', 'e', 'r'
   * @param {Object} ability - Ability definition
   */
  registerAbility(slot, ability) {
    this.abilities[slot] = {
      name: ability.name || 'Ability',
      description: ability.description || '',
      cooldown: ability.cooldown || 10,
      currentCooldown: 0,
      manaCost: ability.manaCost || 0,
      level: 0,
      maxLevel: ability.maxLevel || 3,
      levelRequired: ability.levelRequired || 1,
      type: ability.type || 'instant',  // 'instant', 'targeted', 'ground_target', 'skillshot'
      range: ability.range || 20,
      execute: ability.execute,          // (hero, target, groundPos, level) => void
      icon: ability.icon || null,
      damagePerLevel: ability.damagePerLevel || [0],
      cooldownPerLevel: ability.cooldownPerLevel || null,
    };
  }

  /**
   * Try to cast an ability.
   * @param {string} slot - 'q', 'w', 'e', 'r'
   * @param {Object|null} target - enemy unit (for targeted abilities)
   * @param {THREE.Vector3|null} groundPos - ground position (for ground_target abilities)
   * @returns {string|boolean} - 'needs_target' if targeting needed, true if cast, false if failed
   */
  castAbility(slot, target, groundPos) {
    const ability = this.abilities[slot];
    if (!ability) return false;
    if (ability.level <= 0) return false;
    if (ability.currentCooldown > 0) return false;
    if (!this.hero.isAlive()) return false;

    // Check if ability needs a target
    if ((ability.type === 'targeted' || ability.type === 'ground_target' || ability.type === 'skillshot') && !target && !groundPos) {
      return 'needs_target';
    }

    // Execute ability
    if (ability.execute) {
      ability.execute(this.hero, target, groundPos, ability.level, this);
    }

    // Start cooldown
    const cd = ability.cooldownPerLevel ? ability.cooldownPerLevel[ability.level - 1] : ability.cooldown;
    ability.currentCooldown = cd;

    return true;
  }

  /**
   * Level up an ability.
   */
  levelUpAbility(slot) {
    const ability = this.abilities[slot];
    if (!ability) return false;
    if (this.skillPoints <= 0) return false;
    if (ability.level >= ability.maxLevel) return false;

    // R requires level 6
    if (slot === 'r' && this.level < 6 && ability.level === 0) return false;

    ability.level++;
    this.skillPoints--;
    return true;
  }

  /**
   * Add XP and check for level up.
   */
  addXP(amount) {
    this.xp += amount;

    while (this.level < this.maxLevel && this.xp >= this.xpToLevel[this.level]) {
      this.xp -= this.xpToLevel[this.level];
      this.level++;
      this.skillPoints++;
      this.onLevelUp();
    }
  }

  onLevelUp() {
    console.log(`Hero leveled up to ${this.level}! Skill points: ${this.skillPoints}`);

    // Increase hero stats per level
    if (this.hero.maxHealth) {
      this.hero.maxHealth += 15;
      this.hero.health = Math.min(this.hero.health + 15, this.hero.maxHealth);
    }
    if (this.hero.moveSpeed) {
      this.hero.moveSpeed += 0.2;
    }
  }

  /**
   * Update cooldowns and active effects.
   */
  update(delta) {
    // Update cooldowns
    for (const slot of ['q', 'w', 'e', 'r']) {
      const ability = this.abilities[slot];
      if (ability && ability.currentCooldown > 0) {
        ability.currentCooldown = Math.max(0, ability.currentCooldown - delta);
      }
    }

    // Update active effects
    this.activeEffects = this.activeEffects.filter(effect => {
      effect.age += delta;
      if (effect.update) effect.update(delta);

      if (effect.age >= effect.duration) {
        if (effect.onEnd) effect.onEnd();
        if (effect.mesh) {
          this.scene.remove(effect.mesh);
          if (effect.mesh.geometry) effect.mesh.geometry.dispose();
          if (effect.mesh.material) effect.mesh.material.dispose();
        }
        return false;
      }
      return true;
    });
  }

  /**
   * Create a visual AOE circle effect on the ground.
   */
  createAOEEffect(position, radius, color, duration) {
    const geo = new THREE.RingGeometry(0, radius, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(position.x, 0.2, position.z);
    this.scene.add(mesh);

    const effect = {
      mesh,
      age: 0,
      duration,
      update: (dt) => {
        const t = effect.age / duration;
        mat.opacity = 0.4 * (1 - t);
        mesh.scale.setScalar(1 + t * 0.3);
      },
      onEnd: () => {}
    };

    this.activeEffects.push(effect);
    return effect;
  }

  /**
   * Create a projectile-style skillshot effect.
   */
  createSkillshotEffect(startPos, direction, speed, range, radius, color, onHit) {
    const geo = new THREE.SphereGeometry(radius, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(startPos);
    mesh.position.y = 2;
    this.scene.add(mesh);

    const dir = direction.clone().normalize();
    const duration = range / speed;

    const effect = {
      mesh,
      age: 0,
      duration,
      startPos: startPos.clone(),
      hasHit: false,
      update: (dt) => {
        mesh.position.x += dir.x * speed * dt;
        mesh.position.z += dir.z * speed * dt;

        // Check hits
        if (!effect.hasHit && onHit) {
          const hitResult = onHit(mesh.position);
          if (hitResult) {
            effect.hasHit = true;
            effect.age = duration; // end effect
          }
        }
      },
      onEnd: () => {}
    };

    this.activeEffects.push(effect);
    return effect;
  }

  /**
   * Apply a temporary buff to the hero.
   */
  applyBuff(name, duration, onApply, onEnd) {
    if (onApply) onApply(this.hero);

    const effect = {
      mesh: null,
      age: 0,
      duration,
      update: () => {},
      onEnd: () => {
        if (onEnd) onEnd(this.hero);
      }
    };

    this.activeEffects.push(effect);
    return effect;
  }

  /**
   * Get ability info for HUD display.
   */
  getAbilityInfo(slot) {
    const ability = this.abilities[slot];
    if (!ability) return null;

    return {
      name: ability.name,
      description: ability.description,
      level: ability.level,
      maxLevel: ability.maxLevel,
      cooldown: ability.currentCooldown,
      maxCooldown: ability.cooldownPerLevel ? ability.cooldownPerLevel[Math.max(0, ability.level - 1)] : ability.cooldown,
      canLevelUp: this.skillPoints > 0 && ability.level < ability.maxLevel &&
                  (slot !== 'r' || this.level >= 6),
      canCast: ability.level > 0 && ability.currentCooldown <= 0,
    };
  }
}
