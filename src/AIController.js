import * as THREE from 'three';

/**
 * AI controller that drives a Tank or Warhound vehicle using the same
 * setMoveInput / setTurretInput / fire interface as the player controls.
 *
 * States: patrol → chase → attack (+ cooldown retreat)
 */
export class AIController {
  constructor(vehicle, playerVehicle) {
    this.vehicle = vehicle;
    this.player = playerVehicle;

    // State machine
    this.state = 'patrol';
    this.stateTimer = 0;

    // Patrol
    this.patrolTarget = new THREE.Vector3();
    this.pickPatrolTarget();

    // Detection / engagement ranges
    this.detectRange = 60;
    this.attackRange = 40;
    this.retreatRange = 8;

    // Attack timing
    this.fireTimer = 0;
    this.fireCooldown = 1.5; // seconds between shots
    this.aimThreshold = 0.15; // radians — how close aim must be to fire

    // Steering helpers
    this._toTarget = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._desiredDir = new THREE.Vector3();
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

    // State transitions
    switch (this.state) {
      case 'patrol':
        if (distToPlayer < this.detectRange) {
          this.state = 'chase';
        }
        break;

      case 'chase':
        if (distToPlayer > this.detectRange * 1.2) {
          this.state = 'patrol';
          this.pickPatrolTarget();
        } else if (distToPlayer < this.attackRange) {
          this.state = 'attack';
        }
        break;

      case 'attack':
        if (distToPlayer > this.attackRange * 1.3) {
          this.state = 'chase';
        }
        break;
    }

    // Execute current state
    switch (this.state) {
      case 'patrol':
        this.doPatrol(delta, myPos);
        break;
      case 'chase':
        this.doChase(delta, myPos, playerPos);
        break;
      case 'attack':
        this.doAttack(delta, myPos, playerPos);
        break;
    }
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
   * Steer the vehicle hull toward a world-space target.
   * Returns the signed angle error.
   */
  steerToward(targetPos, myPos, moveForward) {
    const angle = this.angleTo(myPos, targetPos);

    // Steering input: proportional to angle, clamped to [-1, 1]
    const steerX = Math.max(-1, Math.min(1, angle * 2));
    const moveY = moveForward ? 1 : 0;

    this.vehicle.setMoveInput(steerX, moveY);
    return angle;
  }

  // --- States ---

  doPatrol(delta, myPos) {
    // Head toward patrol target
    const dist = myPos.distanceTo(this.patrolTarget);
    if (dist < 5) {
      this.pickPatrolTarget();
    }
    this.steerToward(this.patrolTarget, myPos, true);
    this.vehicle.setTurretInput(0, 0);
  }

  doChase(delta, myPos, playerPos) {
    // Drive toward the player
    this.steerToward(playerPos, myPos, true);
    // Start pre-aiming turret
    this.aimTurretAt(delta, myPos, playerPos);
  }

  doAttack(delta, myPos, playerPos) {
    const distToPlayer = myPos.distanceTo(playerPos);

    // If too close, back up; otherwise hold position / creep forward
    if (distToPlayer < this.retreatRange) {
      // Back up while still facing player
      this.steerToward(playerPos, myPos, false);
      this.vehicle.setMoveInput(this.vehicle.moveInput.x, -0.5);
    } else {
      // Slowly approach or hold
      const angle = this.steerToward(playerPos, myPos, false);
      // Only move forward if roughly facing the player
      if (Math.abs(angle) < 0.5) {
        this.vehicle.setMoveInput(this.vehicle.moveInput.x, 0.3);
      }
    }

    // Aim and fire
    const aimError = this.aimTurretAt(delta, myPos, playerPos);

    this.fireTimer += delta;
    if (Math.abs(aimError) < this.aimThreshold && this.fireTimer >= this.fireCooldown) {
      this.vehicle.fire();
      this.fireTimer = 0;
    }
  }

  /**
   * Aim the turret toward the player. Returns the turret aim error in radians.
   * For the Tank, the turret rotates independently of the hull.
   * For the Warhound, the spine rotation is clamped to ±45°.
   */
  aimTurretAt(delta, myPos, playerPos) {
    // Angle from hull forward to player
    const angleToPlayer = this.angleTo(myPos, playerPos);

    // Current turret angle (relative to hull forward)
    const currentTurretAngle = this.vehicle.turretAngle || 0;

    // Error = how far the turret needs to rotate
    const aimError = angleToPlayer - currentTurretAngle;

    // Feed turret input proportional to error
    const turretInput = Math.max(-1, Math.min(1, aimError * 3));
    this.vehicle.setTurretInput(turretInput, 0);

    return aimError;
  }
}
