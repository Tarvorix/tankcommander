import * as THREE from 'three';
import { Infantry } from './Infantry.js';

/**
 * Manages minion wave spawning and lane marching.
 * Spawns waves of infantry minions that march down lanes,
 * attack enemy minions/towers/heroes, and grant XP/gold on death.
 *
 * Each wave: 4 minions per lane, 3 lanes = 12 minions per wave per team
 * Waves spawn every 30 seconds
 */
export class MinionWave {
  constructor(scene, world, mobaMap) {
    this.scene = scene;
    this.world = world;
    this.mobaMap = mobaMap;

    // Wave timing
    this.waveInterval = 30;       // seconds between waves
    this.firstWaveDelay = 15;     // seconds before first wave
    this.waveTimer = -this.firstWaveDelay;
    this.waveCount = 0;

    // Minions per wave per lane
    this.minionsPerLane = 4;

    // All active minions per team
    this.blueMinions = [];
    this.redMinions = [];

    // Lane assignments for minions
    this.laneNames = ['left', 'mid', 'right'];

    // XP and gold values
    this.minionXP = 15;
    this.minionGold = 20;

    // Damage targets (set externally)
    this.blueDamageTargets = [];
    this.redDamageTargets = [];

    // Track if shared infantry assets are loaded
    this.assetsLoaded = false;
  }

  async loadAssets() {
    await Infantry.loadSharedAssets();
    this.assetsLoaded = true;
  }

  /**
   * Spawn a wave for both teams.
   */
  async spawnWave() {
    if (!this.assetsLoaded) return;

    this.waveCount++;
    console.log(`Spawning minion wave #${this.waveCount}`);

    for (const lane of this.laneNames) {
      await this.spawnLaneWave('blue', lane);
      await this.spawnLaneWave('red', lane);
    }
  }

  async spawnLaneWave(team, lane) {
    const spawn = this.mobaMap.minionSpawns[team][lane];
    const waypoints = this.mobaMap.laneWaypoints[lane];

    // Red team walks waypoints in reverse
    const path = team === 'blue' ? [...waypoints] : [...waypoints].reverse();

    for (let i = 0; i < this.minionsPerLane; i++) {
      const minion = new Infantry(this.scene, this.world);
      await minion.load();

      // Mark as minion
      minion.isMinion = true;
      minion.team = team;
      minion.lane = lane;
      minion.xpValue = this.minionXP;
      minion.goldValue = this.minionGold;

      // MOBA minion stats
      minion.maxHealth = 12 + this.waveCount * 1.5; // scale with wave count
      minion.health = minion.maxHealth;
      minion.moveSpeed = 4;
      minion.fireRate = 1.5;

      // Assign lane path
      minion._lanePath = path;
      minion._laneWaypointIndex = 0;

      // Position at spawn with slight offset per minion
      const offsetX = (i - this.minionsPerLane / 2) * 2;
      const spawnX = spawn.x + offsetX;
      const spawnZ = spawn.z;

      if (minion.body) {
        minion.body.setTranslation({ x: spawnX, y: 1, z: spawnZ }, true);

        // Face toward first waypoint
        const firstWP = path[0];
        const angle = Math.atan2(firstWP.x - spawnX, firstWP.z - spawnZ);
        const quat = new THREE.Quaternion();
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        minion.body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
      }

      // Set damage targets
      minion.damageTargets = team === 'blue' ? this.redDamageTargets : this.blueDamageTargets;

      // Add to team list
      if (team === 'blue') {
        this.blueMinions.push(minion);
      } else {
        this.redMinions.push(minion);
      }
    }
  }

  /**
   * Update all minions — handle lane marching and combat.
   */
  update(delta) {
    // Wave spawning timer
    this.waveTimer += delta;
    if (this.waveTimer >= this.waveInterval) {
      this.waveTimer -= this.waveInterval;
      this.spawnWave();
    }

    // Update all minions
    this.updateTeamMinions(this.blueMinions, this.redMinions, delta);
    this.updateTeamMinions(this.redMinions, this.blueMinions, delta);

    // Clean up dead minions
    this.blueMinions = this.blueMinions.filter(m => {
      if (!m.isAlive()) {
        // Dispose after death animation finishes
        if (m.currentState === 'death') {
          m._deathTimer = (m._deathTimer || 0) + delta;
          if (m._deathTimer > 3) {
            m.dispose();
            return false;
          }
          m.update(delta); // keep updating for death animation
          return true;
        }
      }
      return m.isAlive();
    });

    this.redMinions = this.redMinions.filter(m => {
      if (!m.isAlive()) {
        if (m.currentState === 'death') {
          m._deathTimer = (m._deathTimer || 0) + delta;
          if (m._deathTimer > 3) {
            m.dispose();
            return false;
          }
          m.update(delta);
          return true;
        }
      }
      return m.isAlive();
    });
  }

  updateTeamMinions(friendlyMinions, enemyMinions, delta) {
    for (const minion of friendlyMinions) {
      if (!minion.isAlive()) continue;

      const myPos = minion.getPosition();

      // Find nearest enemy (minions, heroes, towers)
      let nearestEnemy = null;
      let nearestDist = Infinity;

      // Check enemy minions
      for (const enemy of enemyMinions) {
        if (!enemy.isAlive()) continue;
        const d = myPos.distanceTo(enemy.getPosition());
        if (d < nearestDist) {
          nearestDist = d;
          nearestEnemy = enemy;
        }
      }

      // Also check damage targets (heroes, towers)
      for (const target of minion.damageTargets) {
        if (!target.isAlive || !target.isAlive()) continue;
        const d = myPos.distanceTo(target.getPosition());
        if (d < nearestDist) {
          nearestDist = d;
          nearestEnemy = target;
        }
      }

      const engageRange = 15;
      const fireRange = 10;

      if (nearestEnemy && nearestDist < engageRange) {
        // Engage enemy
        this.doMinionEngage(minion, nearestEnemy, nearestDist, myPos, delta);
      } else {
        // March down lane
        this.doMinionMarch(minion, myPos, delta);
      }

      minion.update(delta);
    }
  }

  doMinionEngage(minion, target, dist, myPos, delta) {
    const targetPos = target.getPosition();

    // Direction to target
    const dx = targetPos.x - myPos.x;
    const dz = targetPos.z - myPos.z;
    const toTarget = new THREE.Vector3(dx, 0, dz).normalize();

    // Get minion forward
    const forward = new THREE.Vector3();
    minion.getForwardVector(forward);
    forward.setY(0).normalize();

    // Calculate turn
    const cross = forward.x * toTarget.z - forward.z * toTarget.x;
    const dot = forward.dot(toTarget);
    const angle = Math.atan2(cross, dot);

    const steerX = Math.max(-1, Math.min(1, angle * 3));

    if (dist > 8) {
      // Move toward
      minion.setMoveInput(steerX, Math.abs(angle) < 1.5 ? 0.6 : 0.2);
    } else if (dist > 4) {
      // Slow approach
      minion.setMoveInput(steerX, 0.2);
    } else {
      // In range — stop and fight
      minion.setMoveInput(steerX, 0);
    }

    // Fire when aimed
    if (Math.abs(angle) < 0.4 && dist < 12) {
      minion.fire();
    }
  }

  doMinionMarch(minion, myPos, delta) {
    if (!minion._lanePath || minion._lanePath.length === 0) {
      minion.setMoveInput(0, 0);
      return;
    }

    // Get current waypoint
    let wpIndex = minion._laneWaypointIndex;
    if (wpIndex >= minion._lanePath.length) {
      wpIndex = minion._lanePath.length - 1;
    }

    const wp = minion._lanePath[wpIndex];
    const dx = wp.x - myPos.x;
    const dz = wp.z - myPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Advance waypoint if close enough
    if (dist < 4 && wpIndex < minion._lanePath.length - 1) {
      minion._laneWaypointIndex++;
    }

    // Steer toward waypoint
    const toWP = new THREE.Vector3(dx, 0, dz).normalize();
    const forward = new THREE.Vector3();
    minion.getForwardVector(forward);
    forward.setY(0).normalize();

    const cross = forward.x * toWP.z - forward.z * toWP.x;
    const dot = forward.dot(toWP);
    const angle = Math.atan2(cross, dot);

    const steerX = Math.max(-1, Math.min(1, angle * 3));
    const moveY = Math.abs(angle) < 1.5 ? 0.7 : 0.3;

    minion.setMoveInput(steerX, moveY);
  }

  /**
   * Get all alive minions for a team.
   */
  getAliveMinions(team) {
    const minions = team === 'blue' ? this.blueMinions : this.redMinions;
    return minions.filter(m => m.isAlive());
  }

  /**
   * Get all alive minions from both teams.
   */
  getAllAliveMinions() {
    return [
      ...this.blueMinions.filter(m => m.isAlive()),
      ...this.redMinions.filter(m => m.isAlive()),
    ];
  }

  dispose() {
    for (const m of this.blueMinions) m.dispose();
    for (const m of this.redMinions) m.dispose();
    this.blueMinions.length = 0;
    this.redMinions.length = 0;
  }
}
