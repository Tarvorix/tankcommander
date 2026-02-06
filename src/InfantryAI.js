import * as THREE from 'three';

/**
 * AI controller for an infantry squad.
 * Each soldier independently follows its leader in formation and engages
 * enemies when they come into range.
 *
 * Two behaviors per soldier:
 *   Follow — move to formation position relative to leader vehicle
 *   Engage — turn toward nearest enemy, advance, and fire
 *
 * Uses navmesh pathfinding (when available) to navigate around obstacles.
 * Falls back to direct steering if navmesh is not ready or query fails.
 */
export class InfantryAI {
  constructor(squad, targetProvider, navMeshSystem) {
    this.squad = squad;
    this.targetProvider = targetProvider; // () => array of enemy units
    this.navMeshSystem = navMeshSystem || null;
    this.engageRange = 25;      // meters — start shooting
    this.followDistance = 12;    // meters behind leader

    // Reusable vectors (avoid per-frame allocations)
    this._toTarget = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();

    // Navmesh pathfinding state per soldier (keyed by soldier instance)
    this.soldierPaths = new Map();
    this.pathReQueryInterval = 0.75;  // re-query path every 0.75 seconds
    this.waypointArrivalDist = 2.0;   // advance to next waypoint when within this distance

    // Soldier separation (prevents clumping)
    this.separationDist = 2.0;        // push soldiers apart when closer than this
    this.separationStrength = 3.0;    // repulsion force multiplier
  }

  /**
   * Get or create the pathfinding state for a soldier.
   */
  getSoldierPathState(soldier) {
    if (!this.soldierPaths.has(soldier)) {
      this.soldierPaths.set(soldier, {
        waypoints: null,       // Array<{x,y,z}> from navmesh query
        waypointIndex: 0,      // current waypoint we're steering toward
        pathAge: 999,          // seconds since last path query (999 forces immediate query)
        targetPos: new THREE.Vector3()  // last queried destination (for change detection)
      });
    }
    return this.soldierPaths.get(soldier);
  }

  update(delta) {
    const alive = this.squad.getAliveSoldiers();
    if (alive.length === 0) return;

    const targets = this.targetProvider();
    const leader = this.squad.leader;
    const leaderPos = leader ? leader.getPosition() : null;
    const leaderForward = new THREE.Vector3();
    if (leader && typeof leader.getForwardVector === 'function') {
      leader.getForwardVector(leaderForward);
    }

    for (let i = 0; i < alive.length; i++) {
      this.updateSoldier(alive[i], i, alive.length, delta, targets, leaderPos, leaderForward);
    }

    // Apply soldier separation after individual movement decisions
    this.applySeparation(alive, delta);
  }

  updateSoldier(soldier, index, totalAlive, delta, targets, leaderPos, leaderForward) {
    const myPos = soldier.getPosition();

    // Find nearest alive enemy
    let nearestTarget = null;
    let nearestDist = Infinity;
    for (const target of targets) {
      if (!target.isAlive || !target.isAlive()) continue;
      const d = myPos.distanceTo(target.getPosition());
      if (d < nearestDist) {
        nearestDist = d;
        nearestTarget = target;
      }
    }

    // Engage if enemy is in range
    if (nearestTarget && nearestDist < this.engageRange) {
      this.doEngage(soldier, nearestTarget, nearestDist, myPos, delta);
      return;
    }

    // Otherwise follow leader in formation
    if (leaderPos) {
      this.doFollow(soldier, index, totalAlive, leaderPos, leaderForward, myPos, delta);
    } else {
      soldier.setMoveInput(0, 0);
    }
  }

  /**
   * Query the navmesh for a path if enough time has elapsed or the target moved.
   */
  queryPath(soldier, fromPos, toPos, pathState, delta) {
    pathState.pathAge += delta;

    // Re-query if interval elapsed, target moved significantly, or no path yet
    const targetMoved = pathState.targetPos.distanceTo(toPos) > 3.0;
    if (pathState.pathAge >= this.pathReQueryInterval || targetMoved || !pathState.waypoints) {
      if (this.navMeshSystem && this.navMeshSystem.ready) {
        const path = this.navMeshSystem.findPath(fromPos, toPos);
        if (path && path.length > 0) {
          pathState.waypoints = path;
          pathState.waypointIndex = 0;
          pathState.pathAge = 0;
          pathState.targetPos.copy(toPos);

          // Skip waypoints we've already passed
          this.advanceWaypointIndex(pathState, fromPos);
        }
      }
    }
  }

  /**
   * Advance the waypoint index past any waypoints the soldier has already reached.
   */
  advanceWaypointIndex(pathState, myPos) {
    if (!pathState.waypoints) return;

    // Don't skip past the final waypoint
    while (pathState.waypointIndex < pathState.waypoints.length - 1) {
      const wp = pathState.waypoints[pathState.waypointIndex];
      const dx = wp.x - myPos.x;
      const dz = wp.z - myPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < this.waypointArrivalDist) {
        pathState.waypointIndex++;
      } else {
        break;
      }
    }
  }

  /**
   * Get the current steering target position from navmesh path.
   * Returns the waypoint position, or null if no valid path.
   */
  getWaypointTarget(pathState) {
    if (!pathState.waypoints || pathState.waypoints.length === 0) return null;
    const idx = Math.min(pathState.waypointIndex, pathState.waypoints.length - 1);
    return pathState.waypoints[idx];
  }

  doEngage(soldier, target, dist, myPos, delta) {
    const targetPos = target.getPosition();
    const pathState = this.getSoldierPathState(soldier);

    // Query navmesh for path to target
    this.queryPath(soldier, myPos, targetPos, pathState, delta);
    this.advanceWaypointIndex(pathState, myPos);

    // Determine steering direction: navmesh waypoint or direct fallback
    const wp = this.getWaypointTarget(pathState);
    if (wp) {
      this._toTarget.set(wp.x - myPos.x, 0, wp.z - myPos.z);
    } else {
      this._toTarget.subVectors(targetPos, myPos).setY(0);
    }
    if (this._toTarget.lengthSq() > 0.001) {
      this._toTarget.normalize();
    }

    // Calculate turn angle toward steering target
    soldier.getForwardVector(this._forward);
    this._forward.setY(0).normalize();

    const cross = this._forward.x * this._toTarget.z - this._forward.z * this._toTarget.x;
    const dot = this._forward.dot(this._toTarget);
    const angle = Math.atan2(cross, dot);

    const steerX = Math.max(-1, Math.min(1, angle * 3));

    // Move toward target — always maintain some forward movement to keep walk animation
    let moveY = 0;
    if (dist > 15) {
      moveY = Math.abs(angle) < 1.5 ? 0.8 : 0.3;
    } else if (dist > 8) {
      moveY = Math.abs(angle) < 1.5 ? 0.5 : 0.2;
    } else if (dist > 4) {
      // Close range: slow approach while firing
      moveY = Math.abs(angle) < 1.0 ? 0.25 : 0.15;
    } else {
      // Very close: hold position but don't go to zero (prevents idle flicker)
      moveY = 0;
    }

    soldier.setMoveInput(steerX, moveY);

    // Fire decision: check angle to the actual target (not waypoint)
    this._toTarget.subVectors(targetPos, myPos).setY(0);
    if (this._toTarget.lengthSq() > 0.001) {
      this._toTarget.normalize();
    }
    soldier.getForwardVector(this._forward);
    this._forward.setY(0).normalize();

    const fireCross = this._forward.x * this._toTarget.z - this._forward.z * this._toTarget.x;
    const fireDot = this._forward.dot(this._toTarget);
    const fireAngle = Math.atan2(fireCross, fireDot);

    if (Math.abs(fireAngle) < 0.3 && dist < this.engageRange) {
      soldier.fire();
    }
  }

  doFollow(soldier, index, totalAlive, leaderPos, leaderForward, myPos, delta) {
    // Compute formation position relative to leader
    const offset = this.squad.getFormationOffset(index, totalAlive);

    // Rotate offset by leader's facing direction
    const angle = Math.atan2(leaderForward.x, leaderForward.z);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const worldOffsetX = offset.x * cos - offset.z * sin;
    const worldOffsetZ = offset.x * sin + offset.z * cos;

    const targetX = leaderPos.x + worldOffsetX;
    const targetZ = leaderPos.z + worldOffsetZ;
    this._targetPos.set(targetX, myPos.y, targetZ);

    const dist = myPos.distanceTo(this._targetPos);

    if (dist < 2) {
      // Close enough — idle
      soldier.setMoveInput(0, 0);
      return;
    }

    const pathState = this.getSoldierPathState(soldier);

    // Query navmesh for path to formation position
    this.queryPath(soldier, myPos, this._targetPos, pathState, delta);
    this.advanceWaypointIndex(pathState, myPos);

    // Determine steering direction: navmesh waypoint or direct fallback
    const wp = this.getWaypointTarget(pathState);
    let steerTargetX, steerTargetZ;

    if (wp) {
      steerTargetX = wp.x;
      steerTargetZ = wp.z;
    } else {
      steerTargetX = targetX;
      steerTargetZ = targetZ;
    }

    // Steer toward target
    this._toTarget.set(steerTargetX - myPos.x, 0, steerTargetZ - myPos.z);
    if (this._toTarget.lengthSq() > 0.001) {
      this._toTarget.normalize();
    }
    soldier.getForwardVector(this._forward);
    this._forward.setY(0).normalize();

    const cross = this._forward.x * this._toTarget.z - this._forward.z * this._toTarget.x;
    const dotP = this._forward.dot(this._toTarget);
    const steerAngle = Math.atan2(cross, dotP);

    const steerX = Math.max(-1, Math.min(1, steerAngle * 3));
    // Always move forward while turning — infantry should walk, not stop to rotate
    let moveY = 0;
    if (Math.abs(steerAngle) < 2.0) {
      moveY = dist > 6 ? 1.0 : 0.6; // run if far, walk if close
    } else {
      moveY = 0.3; // still creep forward even when nearly backwards
    }

    soldier.setMoveInput(steerX, moveY);
  }

  /**
   * Push soldiers apart that are too close to each other.
   * Applied as a small physics body translation nudge each frame.
   */
  applySeparation(alive, delta) {
    for (let i = 0; i < alive.length; i++) {
      const posA = alive[i].getPosition();
      for (let j = i + 1; j < alive.length; j++) {
        const posB = alive[j].getPosition();
        const dx = posA.x - posB.x;
        const dz = posA.z - posB.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < this.separationDist * this.separationDist && distSq > 0.001) {
          const dist = Math.sqrt(distSq);
          const overlap = this.separationDist - dist;
          const pushX = (dx / dist) * overlap * this.separationStrength * delta;
          const pushZ = (dz / dist) * overlap * this.separationStrength * delta;

          // Nudge both soldiers apart via their physics bodies
          if (alive[i].body) {
            const tA = alive[i].body.translation();
            alive[i].body.setTranslation(
              { x: tA.x + pushX, y: tA.y, z: tA.z + pushZ },
              true
            );
          }
          if (alive[j].body) {
            const tB = alive[j].body.translation();
            alive[j].body.setTranslation(
              { x: tB.x - pushX, y: tB.y, z: tB.z - pushZ },
              true
            );
          }
        }
      }
    }
  }
}
