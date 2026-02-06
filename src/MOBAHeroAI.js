import * as THREE from 'three';

/**
 * AI controller for the enemy hero in MOBA mode.
 *
 * Behaviors:
 * - Lane: march down a lane toward center, fight minions
 * - Contest: move to control point when available
 * - Retreat: fall back to base when low health
 * - Fight: engage player hero when nearby
 * - Abilities: use abilities when appropriate
 *
 * State machine: idle → lane → contest → fight → retreat
 */
export class MOBAHeroAI {
  constructor(vehicle, heroWrapper, playerVehicle, mobaMap) {
    this.vehicle = vehicle;
    this.heroWrapper = heroWrapper;
    this.player = playerVehicle;
    this.mobaMap = mobaMap;

    // Navigation system (set externally)
    this.navSystem = null;

    // State
    this.state = 'idle';
    this.stateTimer = 0;
    this.currentLane = 'mid';

    // Waypoint navigation
    this.moveTarget = null;
    this.waypointIndex = 0;
    this.lanePath = null;

    // Nav mesh path following
    this.navPath = [];
    this.navPathIndex = 0;
    this.navPathTimer = 0;

    // Combat
    this.attackTarget = null;
    this.fireTimer = 0;

    // Ranges
    this.detectRange = 40;
    this.attackRange = 20;
    this.retreatHealthPercent = 0.25;

    // AI timing
    this.decisionTimer = 0;
    this.decisionInterval = 1.0; // re-evaluate every second

    // Ability usage timers
    this.abilityTimer = 0;
    this.abilityInterval = 2.0;

    // Reusable vectors
    this._forward = new THREE.Vector3();
    this._toTarget = new THREE.Vector3();

    // Start by marching mid lane
    this.setLane('mid');
  }

  setLane(lane) {
    this.currentLane = lane;
    const waypoints = this.mobaMap.laneWaypoints[lane];
    // AI is red team — walk from red base toward center (reversed path)
    this.lanePath = [...waypoints].reverse();
    this.waypointIndex = 0;
    this.state = 'lane';
  }

  update(delta) {
    if (!this.vehicle || !this.vehicle.mesh || !this.vehicle.body) return;
    if (!this.vehicle.isAlive()) return;

    const myPos = this.vehicle.getPosition();
    const healthPercent = this.vehicle.health / this.vehicle.maxHealth;

    this.stateTimer += delta;
    this.decisionTimer += delta;
    this.abilityTimer += delta;

    // Decision making
    if (this.decisionTimer >= this.decisionInterval) {
      this.decisionTimer = 0;
      this.makeDecision(myPos, healthPercent);
    }

    // Execute current state
    switch (this.state) {
      case 'idle':
        this.vehicle.setMoveInput(0, 0);
        break;
      case 'lane':
        this.doLane(delta, myPos);
        break;
      case 'contest':
        this.doContest(delta, myPos);
        break;
      case 'fight':
        this.doFight(delta, myPos);
        break;
      case 'retreat':
        this.doRetreat(delta, myPos);
        break;
    }

    // Try using abilities
    if (this.abilityTimer >= this.abilityInterval) {
      this.abilityTimer = 0;
      this.tryUseAbilities(myPos, healthPercent);
    }
  }

  makeDecision(myPos, healthPercent) {
    // Retreat if low health
    if (healthPercent < this.retreatHealthPercent) {
      if (this.state !== 'retreat') {
        this.state = 'retreat';
        this.stateTimer = 0;
      }
      return;
    }

    // Fight if player is nearby
    if (this.player && this.player.isAlive()) {
      const distToPlayer = myPos.distanceTo(this.player.getPosition());
      if (distToPlayer < this.detectRange) {
        if (this.state !== 'fight') {
          this.state = 'fight';
          this.stateTimer = 0;
          this.attackTarget = this.player;
        }
        return;
      }
    }

    // Contest control point if we're strong enough
    const distToCenter = myPos.distanceTo(new THREE.Vector3(0, 0, 0));
    if (distToCenter < 60 && healthPercent > 0.5) {
      if (this.state !== 'contest') {
        this.state = 'contest';
        this.stateTimer = 0;
      }
      return;
    }

    // Default: lane
    if (this.state !== 'lane') {
      this.setLane(this.currentLane);
    }
  }

  /**
   * Navigate to a position using the nav mesh if available.
   * Computes path and starts following it.
   */
  navigateTo(myPos, targetPos) {
    if (this.navSystem && this.navSystem.ready) {
      this.navPath = this.navSystem.findPath(myPos, targetPos);
      this.navPathIndex = 0;
      // Skip first waypoint if close to start
      if (this.navPath.length > 1) {
        const firstDist = myPos.distanceTo(this.navPath[0]);
        if (firstDist < 5) this.navPathIndex = 1;
      }
    } else {
      this.navPath = [new THREE.Vector3(targetPos.x, targetPos.y || 0, targetPos.z)];
      this.navPathIndex = 0;
    }
  }

  /**
   * Follow nav path waypoints, steering toward each one.
   */
  followNavPath(myPos, moveForward) {
    if (this.navPathIndex >= this.navPath.length) {
      this.vehicle.setMoveInput(0, 0);
      return;
    }

    const wp = this.navPath[this.navPathIndex];
    const dist = myPos.distanceTo(wp);

    if (dist < 5 && this.navPathIndex < this.navPath.length - 1) {
      this.navPathIndex++;
    }

    const currentWP = this.navPath[this.navPathIndex];
    this.steerToward(myPos, currentWP, moveForward);
  }

  doLane(delta, myPos) {
    if (!this.lanePath || this.lanePath.length === 0) return;

    // Navigate along lane waypoints
    let wp = this.lanePath[Math.min(this.waypointIndex, this.lanePath.length - 1)];
    const dist = Math.sqrt(
      (wp.x - myPos.x) ** 2 + (wp.z - myPos.z) ** 2
    );

    if (dist < 5 && this.waypointIndex < this.lanePath.length - 1) {
      this.waypointIndex++;
      wp = this.lanePath[this.waypointIndex];
    }

    // Use nav mesh to navigate to next lane waypoint
    this.navPathTimer -= delta;
    if (this.navPathTimer <= 0 || this.navPath.length === 0) {
      this.navigateTo(myPos, { x: wp.x, y: 0, z: wp.z });
      this.navPathTimer = 2.0; // recompute every 2 seconds
    }
    this.followNavPath(myPos, true);

    // Attack nearby enemies while marching
    this.checkForNearbyEnemies(myPos, delta);
  }

  doContest(delta, myPos) {
    // Move to center control point
    const center = new THREE.Vector3(0, 0, 0);
    const dist = myPos.distanceTo(center);

    if (dist > 10) {
      this.navPathTimer -= delta;
      if (this.navPathTimer <= 0 || this.navPath.length === 0) {
        this.navigateTo(myPos, center);
        this.navPathTimer = 2.0;
      }
      this.followNavPath(myPos, true);
    } else {
      // At control point — hold position, look for enemies
      this.vehicle.setMoveInput(0, 0);
      this.checkForNearbyEnemies(myPos, delta);
    }
  }

  doFight(delta, myPos) {
    if (!this.attackTarget || !this.attackTarget.isAlive || !this.attackTarget.isAlive()) {
      this.state = 'lane';
      this.setLane(this.currentLane);
      return;
    }

    const targetPos = this.attackTarget.getPosition();
    const dist = myPos.distanceTo(targetPos);

    if (dist > this.attackRange) {
      // Chase using pathfinding
      this.navPathTimer -= delta;
      if (this.navPathTimer <= 0 || this.navPath.length === 0) {
        this.navigateTo(myPos, targetPos);
        this.navPathTimer = 1.0; // more frequent updates when chasing
      }
      this.followNavPath(myPos, true);
    } else if (dist > this.attackRange * 0.6) {
      // At range — face target and fire
      this.steerToward(myPos, targetPos, false);
      this.aimAndFire(myPos, targetPos, delta);
    } else {
      // Close range — back up while fighting
      this.steerToward(myPos, targetPos, false);
      this.vehicle.setMoveInput(0, -0.3); // back up slightly
      this.aimAndFire(myPos, targetPos, delta);
    }
  }

  doRetreat(delta, myPos) {
    // Move toward red base
    const base = this.mobaMap.redBasePos;
    const dist = myPos.distanceTo(base);

    if (dist < 20) {
      // At base — heal and wait
      this.vehicle.setMoveInput(0, 0);
      this.navPath = [];

      // Passive healing at base
      if (this.vehicle.health < this.vehicle.maxHealth) {
        this.vehicle.health = Math.min(
          this.vehicle.maxHealth,
          this.vehicle.health + 5 * delta
        );
      }

      // Return to lane when healed enough
      if (this.vehicle.health > this.vehicle.maxHealth * 0.7) {
        this.setLane(this.currentLane);
      }
    } else {
      this.navPathTimer -= delta;
      if (this.navPathTimer <= 0 || this.navPath.length === 0) {
        this.navigateTo(myPos, base);
        this.navPathTimer = 2.0;
      }
      this.followNavPath(myPos, true);
    }
  }

  checkForNearbyEnemies(myPos, delta) {
    if (!this.vehicle.damageTargets) return;

    let nearest = null;
    let nearestDist = Infinity;

    for (const target of this.vehicle.damageTargets) {
      if (!target.isAlive || !target.isAlive()) continue;
      const d = myPos.distanceTo(target.getPosition());
      if (d < this.attackRange && d < nearestDist) {
        nearestDist = d;
        nearest = target;
      }
    }

    if (nearest) {
      this.aimAndFire(myPos, nearest.getPosition(), delta);
    }
  }

  steerToward(myPos, targetPos, moveForward) {
    const dx = targetPos.x - myPos.x;
    const dz = targetPos.z - myPos.z;
    const targetAngle = Math.atan2(dx, dz);

    this.vehicle.getForwardVector(this._forward);
    const heroAngle = Math.atan2(this._forward.x, this._forward.z);

    let angleDiff = targetAngle - heroAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const steerX = Math.max(-1, Math.min(1, angleDiff * 2.5));

    let moveY = 0;
    if (moveForward) {
      if (Math.abs(angleDiff) < 0.5) moveY = 1;
      else if (Math.abs(angleDiff) < 1.2) moveY = 0.5;
      else moveY = 0.1;
    }

    this.vehicle.setMoveInput(steerX, moveY);
  }

  aimAndFire(myPos, targetPos, delta) {
    const dx = targetPos.x - myPos.x;
    const dz = targetPos.z - myPos.z;

    this.vehicle.getForwardVector(this._forward);
    const heroAngle = Math.atan2(this._forward.x, this._forward.z);
    const targetAngle = Math.atan2(dx, dz);

    let angleDiff = targetAngle - heroAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const turretInput = Math.max(-1, Math.min(1, angleDiff * 3));
    this.vehicle.setTurretInput(turretInput, 0);

    if (Math.abs(angleDiff) < 0.3) {
      this.vehicle.fire();
    }
  }

  tryUseAbilities(myPos, healthPercent) {
    if (!this.heroWrapper || !this.heroWrapper.abilitySystem) return;

    const abilities = this.heroWrapper.abilitySystem;

    // Auto-level abilities: Q > W > E > R
    if (abilities.skillPoints > 0) {
      if (abilities.level >= 6 && abilities.abilities.r && abilities.abilities.r.level < abilities.abilities.r.maxLevel) {
        abilities.levelUpAbility('r');
      } else if (abilities.abilities.q && abilities.abilities.q.level < abilities.abilities.q.maxLevel) {
        abilities.levelUpAbility('q');
      } else if (abilities.abilities.w && abilities.abilities.w.level < abilities.abilities.w.maxLevel) {
        abilities.levelUpAbility('w');
      } else if (abilities.abilities.e && abilities.abilities.e.level < abilities.abilities.e.maxLevel) {
        abilities.levelUpAbility('e');
      }
    }

    // Use Q when enemies are nearby
    const distToPlayer = this.player && this.player.isAlive() ?
      myPos.distanceTo(this.player.getPosition()) : 999;

    if (distToPlayer < 15) {
      abilities.castAbility('q', null, null);
    }

    // Use W when chasing or in fight
    if (this.state === 'fight' && distToPlayer < 20 && distToPlayer > 10) {
      abilities.castAbility('w', null, null);
    }

    // Use E periodically (buff minions / attack speed)
    if (this.state === 'lane' || this.state === 'contest') {
      abilities.castAbility('e', null, null);
    }

    // Use R when fighting and health is moderate
    if (this.state === 'fight' && healthPercent > 0.4 && healthPercent < 0.8) {
      if (this.heroWrapper.heroType === 'titan') {
        abilities.castAbility('r', null, null);
      } else {
        // Tank R needs a ground position
        if (this.player && this.player.isAlive()) {
          abilities.castAbility('r', null, this.player.getPosition());
        }
      }
    }
  }
}
