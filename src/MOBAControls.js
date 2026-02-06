import * as THREE from 'three';

/**
 * MOBA-style controls:
 * - Right-click to move (desktop) / Tap to move (mobile)
 * - Right-click on enemy to attack-move
 * - Q/W/E/R for abilities
 * - A + click for attack-move
 * - Spacebar to center camera
 *
 * Mobile:
 * - Tap ground to move
 * - Tap enemy to attack
 * - Ability buttons on screen
 */
export class MOBAControls {
  constructor(hero, camera, renderer, scene) {
    this.hero = hero;
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;

    // Movement target
    this.moveTarget = null;             // {x, y, z} world position to move to
    this.attackTarget = null;           // unit to attack-move toward
    this.isAttackMoveMode = false;      // 'A' key held

    // Move indicator
    this.moveIndicator = null;
    this.moveIndicatorLife = 0;
    this.createMoveIndicator();

    // Ability state
    this.abilityPending = null;         // 'q', 'w', 'e', 'r' — awaiting target selection
    this.abilityCallbacks = {};         // { q: fn, w: fn, e: fn, r: fn }

    // Enemy units that can be clicked
    this.enemyUnits = [];

    // Raycaster
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._intersectionPoint = new THREE.Vector3();

    // Keys held
    this._keys = {};

    this.setupDesktopControls();
    this.setupMobileControls();
    this.setupKeyboard();
  }

  setEnemyUnits(units) {
    this.enemyUnits = units;
  }

  setAbilityCallback(key, callback) {
    this.abilityCallbacks[key] = callback;
  }

  createMoveIndicator() {
    // Green circle on ground showing where you're moving
    const geo = new THREE.RingGeometry(0.8, 1.2, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    this.moveIndicator = new THREE.Mesh(geo, mat);
    this.moveIndicator.rotation.x = -Math.PI / 2;
    this.moveIndicator.position.y = 0.2;
    this.moveIndicator.visible = false;
    this.scene.add(this.moveIndicator);
  }

  screenToGround(screenX, screenY) {
    this._ndc.set(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._ndc, this.camera.camera);
    const hit = this._raycaster.ray.intersectPlane(this._groundPlane, this._intersectionPoint);
    return hit ? this._intersectionPoint.clone() : null;
  }

  /**
   * Try to pick an enemy unit at the given screen coordinates.
   */
  pickEnemy(screenX, screenY) {
    this._ndc.set(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._ndc, this.camera.camera);

    const hitCandidates = [];
    for (const unit of this.enemyUnits) {
      if (!unit.isAlive || !unit.isAlive()) continue;
      if (!unit.mesh) continue;
      unit.mesh.traverse((child) => {
        if (child.isMesh) {
          child.userData._pickUnit = unit;
          hitCandidates.push(child);
        }
      });
    }

    if (hitCandidates.length === 0) return null;

    const hits = this._raycaster.intersectObjects(hitCandidates);
    if (hits.length > 0) {
      return hits[0].object.userData._pickUnit || null;
    }
    return null;
  }

  setupDesktopControls() {
    const canvas = this.renderer.domElement;

    // Right-click to move / attack
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    canvas.addEventListener('mousedown', (e) => {
      // Right click = move/attack
      if (e.button === 2) {
        this.handleRightClick(e.clientX, e.clientY);
      }
      // Left click
      if (e.button === 0) {
        this.handleLeftClick(e.clientX, e.clientY);
      }
    });
  }

  setupMobileControls() {
    const canvas = this.renderer.domElement;

    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartTime = performance.now();
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      const elapsed = performance.now() - touchStartTime;
      if (elapsed < 300 && e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 20) {
          // Tap — treat as right-click (move/attack)
          this.handleRightClick(touch.clientX, touch.clientY);
        }
      }
    }, { passive: true });
  }

  setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      this._keys[e.code] = true;

      // Ability keys
      if (e.code === 'KeyQ') this.triggerAbility('q');
      if (e.code === 'KeyW') this.triggerAbility('w');
      if (e.code === 'KeyE') this.triggerAbility('e');
      if (e.code === 'KeyR') this.triggerAbility('r');

      // Attack move
      if (e.code === 'KeyA') {
        this.isAttackMoveMode = true;
      }

      // Stop
      if (e.code === 'KeyS') {
        this.moveTarget = null;
        this.attackTarget = null;
        this.hero.setMoveInput(0, 0);
      }
    });

    window.addEventListener('keyup', (e) => {
      this._keys[e.code] = false;

      if (e.code === 'KeyA') {
        this.isAttackMoveMode = false;
      }
    });
  }

  handleRightClick(screenX, screenY) {
    // Check if clicking on enemy
    const enemy = this.pickEnemy(screenX, screenY);
    if (enemy) {
      this.attackTarget = enemy;
      this.moveTarget = null;
      this.showMoveIndicator(enemy.getPosition(), 0xff4444); // red indicator for attack
      return;
    }

    // Move to ground position
    const groundPos = this.screenToGround(screenX, screenY);
    if (groundPos) {
      this.moveTarget = groundPos;
      this.attackTarget = null;
      this.showMoveIndicator(groundPos, 0x44ff44); // green for move
    }
  }

  handleLeftClick(screenX, screenY) {
    // If ability is pending target, use it
    if (this.abilityPending) {
      const ability = this.abilityPending;
      this.abilityPending = null;

      const enemy = this.pickEnemy(screenX, screenY);
      const groundPos = this.screenToGround(screenX, screenY);

      if (this.abilityCallbacks[ability]) {
        this.abilityCallbacks[ability](enemy, groundPos);
      }
      return;
    }

    // Attack move mode
    if (this.isAttackMoveMode) {
      const enemy = this.pickEnemy(screenX, screenY);
      if (enemy) {
        this.attackTarget = enemy;
        this.moveTarget = null;
      } else {
        const groundPos = this.screenToGround(screenX, screenY);
        if (groundPos) {
          this.moveTarget = groundPos;
          this.attackTarget = null;
          // Attack-move: will auto-attack enemies encountered on the way
        }
      }
      this.isAttackMoveMode = false;
      return;
    }
  }

  triggerAbility(key) {
    if (this.abilityCallbacks[key]) {
      // For instant abilities, fire immediately
      // For targeted abilities, set pending
      const result = this.abilityCallbacks[key](null, null);
      if (result === 'needs_target') {
        this.abilityPending = key;
      }
    }
  }

  showMoveIndicator(position, color) {
    this.moveIndicator.position.set(position.x, 0.2, position.z);
    this.moveIndicator.material.color.setHex(color);
    this.moveIndicator.material.opacity = 0.8;
    this.moveIndicator.visible = true;
    this.moveIndicatorLife = 1.0;
  }

  /**
   * Called every frame to compute hero movement inputs.
   */
  update(delta) {
    if (!this.hero || !this.hero.mesh || !this.hero.body) return;
    if (!this.hero.isAlive()) {
      this.hero.setMoveInput(0, 0);
      return;
    }

    const heroPos = this.hero.getPosition();

    // Handle attack target
    if (this.attackTarget) {
      if (!this.attackTarget.isAlive || !this.attackTarget.isAlive()) {
        this.attackTarget = null;
      } else {
        const targetPos = this.attackTarget.getPosition();
        const dist = heroPos.distanceTo(targetPos);
        const attackRange = this.hero.attackRange || 15;

        if (dist > attackRange) {
          // Move toward attack target
          this.driveToward(heroPos, targetPos, delta);
        } else {
          // In range — stop and attack
          this.hero.setMoveInput(0, 0);
          this.aimAndFire(heroPos, targetPos, delta);
        }
        this.updateMoveIndicator(delta);
        return;
      }
    }

    // Handle move target
    if (this.moveTarget) {
      const dist = heroPos.distanceTo(this.moveTarget);

      if (dist < 3) {
        // Arrived
        this.moveTarget = null;
        this.hero.setMoveInput(0, 0);
      } else {
        this.driveToward(heroPos, this.moveTarget, delta);
      }
    } else {
      // No target — idle
      this.hero.setMoveInput(0, 0);
    }

    this.updateMoveIndicator(delta);
  }

  /**
   * Drive the hero toward a target position using the existing
   * setMoveInput interface (x = turn, y = forward/back).
   */
  driveToward(heroPos, targetPos, delta) {
    const dx = targetPos.x - heroPos.x;
    const dz = targetPos.z - heroPos.z;
    const targetAngle = Math.atan2(dx, dz);

    // Get hero's current facing angle
    const heroForward = new THREE.Vector3();
    this.hero.getForwardVector(heroForward);
    const heroAngle = Math.atan2(heroForward.x, heroForward.z);

    // Angle difference
    let angleDiff = targetAngle - heroAngle;
    // Normalize to [-PI, PI]
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Steering: proportional to angle difference
    const steerX = Math.max(-1, Math.min(1, angleDiff * 2));

    // Forward: drive when roughly facing target
    let moveY = 0;
    if (Math.abs(angleDiff) < 0.5) {
      moveY = 1;
    } else if (Math.abs(angleDiff) < 1.2) {
      moveY = 0.5;
    } else {
      moveY = 0.1; // mostly turning
    }

    this.hero.setMoveInput(steerX, moveY);
  }

  /**
   * Aim turret at target and fire when aligned.
   */
  aimAndFire(heroPos, targetPos, delta) {
    const dx = targetPos.x - heroPos.x;
    const dz = targetPos.z - heroPos.z;

    // Point turret toward target
    const heroForward = new THREE.Vector3();
    this.hero.getForwardVector(heroForward);
    const heroAngle = Math.atan2(heroForward.x, heroForward.z);
    const targetAngle = Math.atan2(dx, dz);

    let angleDiff = targetAngle - heroAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Turn body toward target
    const steerX = Math.max(-1, Math.min(1, angleDiff * 2));
    this.hero.setMoveInput(steerX, 0);

    // Also set turret toward target
    const turretInput = Math.max(-1, Math.min(1, angleDiff * 3));
    this.hero.setTurretInput(turretInput, 0);

    // Fire when roughly aimed
    if (Math.abs(angleDiff) < 0.3) {
      this.hero.fire();
    }
  }

  updateMoveIndicator(delta) {
    if (this.moveIndicatorLife > 0) {
      this.moveIndicatorLife -= delta * 2;
      this.moveIndicator.material.opacity = Math.max(0, this.moveIndicatorLife * 0.8);
      this.moveIndicator.scale.setScalar(1 + (1 - this.moveIndicatorLife) * 0.5);
      if (this.moveIndicatorLife <= 0) {
        this.moveIndicator.visible = false;
      }
    }
  }

  dispose() {
    if (this.moveIndicator) {
      this.scene.remove(this.moveIndicator);
    }
  }
}
