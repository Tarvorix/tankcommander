import * as THREE from 'three';

/**
 * AI controller that drives a Tank or Warhound vehicle using the same
 * setMoveInput / setTurretInput / fire interface as the player controls.
 *
 * States: patrol → chase → attack (with smooth transitions)
 *
 * Key improvements over the original:
 * - Turns in place when angle to target is large (no more wide arcs)
 * - Smooth input lerping (no more snapping)
 * - Better attack behavior: strafing and circling
 * - Patrol pauses and turret scanning
 * - Simple obstacle avoidance via forward raycast
 */
export class AIController {
  constructor(vehicle, playerVehicle, scene) {
    this.vehicle = vehicle;
    this.player = playerVehicle;
    this.scene = scene || null;

    // State machine
    this.state = 'patrol';
    this.stateTimer = 0;

    // Patrol
    this.patrolTarget = new THREE.Vector3();
    this.pickPatrolTarget();
    this.patrolPauseTimer = 0;      // pause at each waypoint
    this.patrolPauseDuration = 0;    // how long to pause (randomized)
    this.patrolScanDir = 1;          // turret scan direction while patrolling

    // Detection / engagement ranges
    this.detectRange = 60;
    this.attackRange = 35;
    this.optimalRange = 20;   // preferred fighting distance
    this.retreatRange = 10;   // back up if closer than this

    // Attack timing
    this.fireTimer = 0;
    this.fireCooldown = 1.5;
    this.fireCooldownVariance = 0.5; // adds randomness to fire timing
    this.aimThreshold = 0.18;        // radians — how close aim must be to fire

    // Strafe behavior during attack
    this.strafeDir = 1;             // 1 = circle right, -1 = circle left
    this.strafeTimer = 0;
    this.strafeSwitchInterval = 3;  // switch strafe direction every N seconds

    // Smoothed inputs (prevents jerky snapping)
    this._smoothMoveX = 0;
    this._smoothMoveY = 0;
    this._smoothTurretX = 0;
    this._inputLerpSpeed = 4.0; // how fast inputs blend

    // Steering helpers
    this._toTarget = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._desiredDir = new THREE.Vector3();

    // Obstacle avoidance
    this._raycaster = new THREE.Raycaster();
    this._rayDir = new THREE.Vector3();
    this._obstacleAvoidSteer = 0;
    this._obstacleCheckTimer = 0;
    this._obstacleCheckInterval = 0.25; // check every 250ms

    // Angular threshold: if angle to target > this, turn in place instead of driving
    this._turnInPlaceThreshold = 0.5; // ~28 degrees
  }

  pickPatrolTarget() {
    // Random point within the 200×200 map, staying 20 units from edges
    this.patrolTarget.set(
      (Math.random() - 0.5) * 160,
      0,
      (Math.random() - 0.5) * 160
    );
  }

  update(delta) {
    if (!this.vehicle || !this.vehicle.mesh || !this.vehicle.body) return;
    if (!this.player || !this.player.mesh) return;

    const myPos = this.vehicle.getPosition();
    const playerPos = this.player.getPosition();
    const distToPlayer = myPos.distanceTo(playerPos);

    this.stateTimer += delta;

    // State transitions
    switch (this.state) {
      case 'patrol':
        if (distToPlayer < this.detectRange) {
          this.state = 'chase';
          this.stateTimer = 0;
        }
        break;

      case 'chase':
        if (distToPlayer > this.detectRange * 1.2) {
          this.state = 'patrol';
          this.stateTimer = 0;
          this.pickPatrolTarget();
        } else if (distToPlayer < this.attackRange) {
          this.state = 'attack';
          this.stateTimer = 0;
          this.strafeDir = Math.random() > 0.5 ? 1 : -1;
        }
        break;

      case 'attack':
        if (distToPlayer > this.attackRange * 1.4) {
          this.state = 'chase';
          this.stateTimer = 0;
        }
        break;
    }

    // Execute current state (sets raw desired inputs)
    let rawMoveX = 0;
    let rawMoveY = 0;
    let rawTurretX = 0;

    switch (this.state) {
      case 'patrol': {
        const result = this.doPatrol(delta, myPos);
        rawMoveX = result.moveX;
        rawMoveY = result.moveY;
        rawTurretX = result.turretX;
        break;
      }
      case 'chase': {
        const result = this.doChase(delta, myPos, playerPos);
        rawMoveX = result.moveX;
        rawMoveY = result.moveY;
        rawTurretX = result.turretX;
        break;
      }
      case 'attack': {
        const result = this.doAttack(delta, myPos, playerPos);
        rawMoveX = result.moveX;
        rawMoveY = result.moveY;
        rawTurretX = result.turretX;
        break;
      }
    }

    // Obstacle avoidance: nudge steering away from obstacles
    this._obstacleCheckTimer += delta;
    if (this._obstacleCheckTimer >= this._obstacleCheckInterval) {
      this._obstacleCheckTimer = 0;
      this._obstacleAvoidSteer = this.checkObstacleAvoidance(myPos);
    }
    if (Math.abs(this._obstacleAvoidSteer) > 0.01 && rawMoveY > 0) {
      rawMoveX += this._obstacleAvoidSteer;
      rawMoveX = Math.max(-1, Math.min(1, rawMoveX));
    }

    // Smooth inputs with lerp
    this._smoothMoveX = this.lerpValue(this._smoothMoveX, rawMoveX, this._inputLerpSpeed * delta);
    this._smoothMoveY = this.lerpValue(this._smoothMoveY, rawMoveY, this._inputLerpSpeed * delta);
    this._smoothTurretX = this.lerpValue(this._smoothTurretX, rawTurretX, this._inputLerpSpeed * 2 * delta);

    // Apply smoothed inputs
    this.vehicle.setMoveInput(this._smoothMoveX, this._smoothMoveY);
    this.vehicle.setTurretInput(this._smoothTurretX, 0);
  }

  lerpValue(current, target, t) {
    t = Math.min(t, 1);
    return current + (target - current) * t;
  }

  /**
   * Compute the signed angle (on the XZ plane) from the vehicle's forward
   * direction to the direction toward a world-space target point.
   * Positive = target is to the right, negative = target is to the left.
   */
  angleTo(myPos, targetPos) {
    this._toTarget.subVectors(targetPos, myPos).setY(0).normalize();
    this.vehicle.getForwardVector(this._forward);
    this._forward.setY(0).normalize();

    // Cross product Y component gives sin of the signed angle
    const cross = this._forward.x * this._toTarget.z - this._forward.z * this._toTarget.x;
    const dot = this._forward.dot(this._toTarget);
    return Math.atan2(cross, dot);
  }

  /**
   * Calculate steering toward a target. Returns { moveX, moveY }.
   * Smart: turns in place if angle is too large before driving forward.
   */
  steerToward(targetPos, myPos, wantForward) {
    const angle = this.angleTo(myPos, targetPos);

    // Steering input: proportional to angle, clamped
    const steerX = Math.max(-1, Math.min(1, angle * 2.5));

    let moveY = 0;
    if (wantForward) {
      // Only drive forward if roughly facing the target
      if (Math.abs(angle) < this._turnInPlaceThreshold) {
        // Facing roughly right — full speed ahead
        moveY = 1;
      } else if (Math.abs(angle) < this._turnInPlaceThreshold * 2) {
        // Moderate angle — slow forward while turning
        moveY = 0.3;
      } else {
        // Large angle — turn in place, don't drive forward
        moveY = 0;
      }
    }

    return { moveX: steerX, moveY, angle };
  }

  // --- States ---

  doPatrol(delta, myPos) {
    // Check if we've reached the patrol target
    const dist = myPos.distanceTo(this.patrolTarget);

    if (dist < 5) {
      // Arrived at waypoint — pause briefly
      if (this.patrolPauseTimer <= 0) {
        this.patrolPauseDuration = 1 + Math.random() * 2; // 1-3 seconds
        this.patrolPauseTimer = this.patrolPauseDuration;
      }

      this.patrolPauseTimer -= delta;

      if (this.patrolPauseTimer <= 0) {
        // Done pausing, pick new target
        this.pickPatrolTarget();
        this.patrolPauseTimer = 0;
      }

      // While pausing: scan turret left/right
      const scanSpeed = 0.5;
      let turretX = this.patrolScanDir * scanSpeed;

      // Reverse scan direction at limits
      const currentAngle = this.vehicle.turretAngle || 0;
      if (Math.abs(currentAngle) > 0.8) {
        this.patrolScanDir *= -1;
        turretX = this.patrolScanDir * scanSpeed;
      }

      return { moveX: 0, moveY: 0, turretX };
    }

    // Drive toward patrol target
    const steer = this.steerToward(this.patrolTarget, myPos, true);
    // Patrol at a leisurely speed
    return { moveX: steer.moveX, moveY: steer.moveY * 0.7, turretX: 0 };
  }

  doChase(delta, myPos, playerPos) {
    // Sprint toward the player
    const steer = this.steerToward(playerPos, myPos, true);

    // Pre-aim turret at player while chasing
    const turretX = this.aimTurretAt(myPos, playerPos);

    return { moveX: steer.moveX, moveY: steer.moveY, turretX };
  }

  doAttack(delta, myPos, playerPos) {
    const distToPlayer = myPos.distanceTo(playerPos);
    const angleToPlayer = this.angleTo(myPos, playerPos);

    let moveX = 0;
    let moveY = 0;

    // Update strafe timer
    this.strafeTimer += delta;
    if (this.strafeTimer >= this.strafeSwitchInterval) {
      this.strafeTimer = 0;
      this.strafeDir *= -1;
      // Randomize next switch interval
      this.strafeSwitchInterval = 2 + Math.random() * 3;
    }

    if (distToPlayer < this.retreatRange) {
      // Too close — back up while facing player
      const steer = this.steerToward(playerPos, myPos, false);
      moveX = steer.moveX;
      moveY = -0.6; // reverse

    } else if (distToPlayer > this.optimalRange + 5) {
      // Too far — close the gap
      const steer = this.steerToward(playerPos, myPos, true);
      moveX = steer.moveX;
      moveY = steer.moveY * 0.6; // approach at moderate speed

    } else {
      // At optimal range — circle/strafe around the player
      // Face the player while circling
      const steer = this.steerToward(playerPos, myPos, false);
      moveX = steer.moveX;

      // Add lateral movement to create circling behavior
      // If roughly facing the player, strafe perpendicular
      if (Math.abs(angleToPlayer) < 0.8) {
        moveX += this.strafeDir * 0.6;
        moveX = Math.max(-1, Math.min(1, moveX));
        moveY = 0.2; // slow forward to maintain slight spiral
      } else {
        // Not facing well — turn to face, minimal forward
        moveY = 0;
      }
    }

    // Aim turret and fire
    const turretX = this.aimTurretAt(myPos, playerPos);

    this.fireTimer += delta;
    const currentTurretAngle = this.vehicle.turretAngle || 0;
    const aimError = this.angleTo(myPos, playerPos) - currentTurretAngle;
    const effectiveCooldown = this.fireCooldown + (Math.random() - 0.5) * this.fireCooldownVariance;

    if (Math.abs(aimError) < this.aimThreshold && this.fireTimer >= effectiveCooldown) {
      this.vehicle.fire();
      this.fireTimer = 0;
    }

    return { moveX, moveY, turretX };
  }

  /**
   * Calculate turret input to aim at the player. Returns the turret input value.
   */
  aimTurretAt(myPos, playerPos) {
    // Angle from hull forward to player
    const angleToPlayer = this.angleTo(myPos, playerPos);

    // Current turret angle (relative to hull forward)
    const currentTurretAngle = this.vehicle.turretAngle || 0;

    // Error = how far the turret needs to rotate
    const aimError = angleToPlayer - currentTurretAngle;

    // Feed turret input proportional to error
    return Math.max(-1, Math.min(1, aimError * 3));
  }

  /**
   * Simple obstacle avoidance: cast rays forward-left and forward-right.
   * Returns a steering nudge value to avoid obstacles.
   */
  checkObstacleAvoidance(myPos) {
    if (!this.scene) return 0;

    this.vehicle.getForwardVector(this._forward);
    this._forward.setY(0).normalize();

    const checkDist = 8;
    const spreadAngle = 0.4; // ~23 degrees

    // Build meshes list (terrain, rocks - fixed objects)
    const meshes = [];
    const vehicleMeshes = new Set();
    if (this.vehicle.mesh) {
      this.vehicle.mesh.traverse((c) => { if (c.isMesh) vehicleMeshes.add(c); });
    }
    if (this.player && this.player.mesh) {
      this.player.mesh.traverse((c) => { if (c.isMesh) vehicleMeshes.add(c); });
    }
    this.scene.traverse((obj) => {
      if (obj.isMesh && !vehicleMeshes.has(obj)) {
        meshes.push(obj);
      }
    });

    if (meshes.length === 0) return 0;

    const origin = myPos.clone();
    origin.y += 1; // raise origin so we don't hit ground

    // Forward-left ray
    this._rayDir.copy(this._forward);
    this._rayDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spreadAngle);
    this._raycaster.set(origin, this._rayDir);
    this._raycaster.far = checkDist;
    const hitsLeft = this._raycaster.intersectObjects(meshes);

    // Forward-right ray
    this._rayDir.copy(this._forward);
    this._rayDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -spreadAngle);
    this._raycaster.set(origin, this._rayDir);
    this._raycaster.far = checkDist;
    const hitsRight = this._raycaster.intersectObjects(meshes);

    // Straight forward ray
    this._raycaster.set(origin, this._forward);
    this._raycaster.far = checkDist;
    const hitsFwd = this._raycaster.intersectObjects(meshes);

    let steer = 0;

    if (hitsFwd.length > 0) {
      // Something directly ahead — steer away from whichever side is more blocked
      const leftDist = hitsLeft.length > 0 ? hitsLeft[0].distance : checkDist;
      const rightDist = hitsRight.length > 0 ? hitsRight[0].distance : checkDist;

      if (leftDist > rightDist) {
        steer = -0.8; // steer left (negative moveX = turn left)
      } else {
        steer = 0.8;  // steer right
      }
    } else if (hitsLeft.length > 0 && hitsLeft[0].distance < checkDist * 0.5) {
      steer = 0.5; // obstacle on left, nudge right
    } else if (hitsRight.length > 0 && hitsRight[0].distance < checkDist * 0.5) {
      steer = -0.5; // obstacle on right, nudge left
    }

    return steer;
  }
}
