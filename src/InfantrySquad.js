import { Infantry } from './Infantry.js';

/**
 * Manages a squad of infantry soldiers.
 * Handles shared asset loading, formation positioning, and collective updates.
 */
export class InfantrySquad {
  constructor(scene, world, terrain) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain;
    this.soldiers = [];
    this.squadSize = 10;
    this.leader = null;           // Vehicle this squad follows
    this.formationRadius = 8;     // meters behind leader
    this.formationSpacing = 2.5;  // meters between soldiers
  }

  async load() {
    // Load shared assets once (idempotent)
    await Infantry.loadSharedAssets();

    // Create soldiers
    for (let i = 0; i < this.squadSize; i++) {
      const soldier = new Infantry(this.scene, this.world);
      await soldier.load();
      this.soldiers.push(soldier);
    }

    console.log(`Infantry squad loaded: ${this.soldiers.length} soldiers`);
    return this;
  }

  setLeader(vehicle) {
    this.leader = vehicle;
  }

  setDamageTargets(targets) {
    for (const soldier of this.soldiers) {
      soldier.damageTargets = targets;
    }
  }

  getAliveSoldiers() {
    return this.soldiers.filter(s => s.isAlive());
  }

  getAllSoldiers() {
    return this.soldiers;
  }

  /**
   * Position the squad in formation around a center point.
   * Used for initial spawn placement.
   */
  positionFormation(center) {
    const alive = this.getAliveSoldiers();
    for (let i = 0; i < alive.length; i++) {
      const offset = this.getFormationOffset(i, alive.length);
      const x = center.x + offset.x;
      const z = center.z + offset.z;
      if (alive[i].body) {
        const terrainY = this.terrain ? this.terrain.getTerrainHeight(x, z) : 0;
        // Place capsule center just above ground (totalHalfY ≈ 0.92m for 1.83m soldier)
        alive[i].body.setTranslation({ x, y: terrainY + 1.0, z }, true);
      }
    }
  }

  /**
   * Two-row staggered formation offset.
   * Row 0: soldiers 0-4, Row 1: soldiers 5-9.
   * Negative Z = behind the leader.
   */
  getFormationOffset(index, total) {
    const row = Math.floor(index / 5);
    const col = index % 5;
    const rowOffset = -(this.formationRadius + row * this.formationSpacing);
    const colOffset = (col - 2) * this.formationSpacing;
    return { x: colOffset, z: rowOffset };
  }

  update(delta) {
    for (const soldier of this.soldiers) {
      soldier.update(delta);
    }
  }

  dispose() {
    for (const soldier of this.soldiers) {
      soldier.dispose();
    }
    this.soldiers.length = 0;
  }
}
