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
 * - Tap ability buttons to cast
 * - Long-press ability buttons to level up
 * - Two-finger drag for camera pan (handled in MOBACamera)
 */
export class MOBAControls {
  constructor(hero, camera, renderer, scene) {
    this.hero = hero;
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;

    // Navigation system (set externally after construction)
    this.navSystem = null;

    // Movement target
    this.moveTarget = null;             // final {x, y, z} world position
    this.attackTarget = null;           // unit to attack-move toward
    this.isAttackMoveMode = false;      // 'A' key held

    // Path following
    this.currentPath = [];              // Array of THREE.Vector3 waypoints
    this.currentWaypointIndex = 0;      // Which waypoint we're heading to
    this.waypointArrivalDist = 4;       // How close before moving to next waypoint

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

    // Detect touch device
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

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
    // The game container wraps the canvas
    const gameContainer = canvas.parentElement || canvas;

    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoved = false;
    let touchId = -1;
    let fingerCount = 0;
    let touchStartedOnGame = false;

    // Helper: check if a touch target is a game UI button (not the game world)
    const isUIElement = (target) => {
      if (!target) return false;
      // Walk up DOM to see if touch started inside a UI overlay
      let el = target;
      while (el && el !== document.body) {
        if (el === canvas || el === gameContainer) return false;
        if (el.id === 'ability-bar' || el.id === 'minimap' ||
            el.id === 'recenter-btn' || el.id === 'game-over-overlay' ||
            el.id === 'start-menu' || el.id === 'loading-overlay') {
          return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    // Listen on document to catch all touch events reliably on iOS Safari
    // Canvas-level touch listeners can be unreliable on mobile WebGL
    document.addEventListener('touchstart', (e) => {
      fingerCount = e.touches.length;

      // Ignore touches on UI buttons
      if (isUIElement(e.target)) {
        touchStartedOnGame = false;
        return;
      }

      // Only track single-finger taps for movement
      // Two-finger gestures are handled by MOBACamera for pan/zoom
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStartTime = performance.now();
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchMoved = false;
        touchId = touch.identifier;
        touchStartedOnGame = true;

        // Prevent default to avoid 300ms click delay and browser gestures on iOS
        e.preventDefault();
      }
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      fingerCount = e.touches.length;

      if (!touchStartedOnGame) return;

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (touch.identifier === touchId) {
          const dx = touch.clientX - touchStartX;
          const dy = touch.clientY - touchStartY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 15) {
            touchMoved = true;
          }
        }
      }

      // Prevent scrolling/rubber-banding
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      if (!touchStartedOnGame) {
        fingerCount = e.touches.length;
        return;
      }

      const touch = e.changedTouches[0];
      if (!touch) return;
      if (touch.identifier !== touchId) return;

      const elapsed = performance.now() - touchStartTime;

      // Tap detection: quick single-finger touch without much movement
      // fingerCount check ensures two-finger gestures that end one finger at a time
      // don't accidentally trigger movement
      if (elapsed < 400 && !touchMoved && fingerCount <= 1) {
        // Treat tap as right-click (move to location / attack enemy)
        this.handleRightClick(touch.clientX, touch.clientY);
      }

      touchId = -1;
      fingerCount = e.touches.length;
      touchStartedOnGame = false;

      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchcancel', () => {
      touchId = -1;
      fingerCount = 0;
      touchStartedOnGame = false;
    });

    // Prevent touch-hold context menu on game area
    gameContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
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
      this.currentPath = [];
      this.currentWaypointIndex = 0;
      this.showMoveIndicator(enemy.getPosition(), 0xff4444); // red indicator for attack
      return;
    }

    // Move to ground position
    const groundPos = this.screenToGround(screenX, screenY);
    if (groundPos) {
      this.moveTarget = groundPos;
      this.attackTarget = null;
      this.computePath(groundPos);
      this.showMoveIndicator(groundPos, 0x44ff44); // green for move
    }
  }

  /**
   * Compute a nav mesh path from hero to target position.
   */
  computePath(targetPos) {
    if (!this.hero || !this.hero.mesh) return;
    const heroPos = this.hero.getPosition();

    if (this.navSystem && this.navSystem.ready) {
      this.currentPath = this.navSystem.findPath(heroPos, targetPos);
      // Skip the first waypoint if it's very close to hero (starting position)
      this.currentWaypointIndex = 0;
      if (this.currentPath.length > 1) {
        const firstDist = heroPos.distanceTo(this.currentPath[0]);
        if (firstDist < this.waypointArrivalDist) {
          this.currentWaypointIndex = 1;
        }
      }
    } else {
      // Fallback: direct path
      this.currentPath = [targetPos.clone ? targetPos.clone() : new THREE.Vector3(targetPos.x, targetPos.y || 0, targetPos.z)];
      this.currentWaypointIndex = 0;
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
        this.currentPath = [];
      } else {
        const targetPos = this.attackTarget.getPosition();
        const dist = heroPos.distanceTo(targetPos);
        const attackRange = this.hero.attackRange || 15;

        if (dist > attackRange) {
          // Move toward attack target using pathfinding
          // Recompute path periodically since the target moves
          if (this.currentPath.length === 0 || this._attackPathTimer <= 0) {
            this.computePath(targetPos);
            this._attackPathTimer = 1.0; // recompute every second
          }
          this._attackPathTimer -= delta;
          this.followPath(heroPos, delta);
        } else {
          // In range — stop and attack
          this.hero.setMoveInput(0, 0);
          this.currentPath = [];
          this.aimAndFire(heroPos, targetPos, delta);
        }
        this.updateMoveIndicator(delta);
        return;
      }
    }

    // Handle move target using path waypoints
    if (this.moveTarget && this.currentPath.length > 0) {
      // Check if we've arrived at final destination
      const finalDist = heroPos.distanceTo(this.moveTarget);
      if (finalDist < 3) {
        this.moveTarget = null;
        this.currentPath = [];
        this.currentWaypointIndex = 0;
        this.hero.setMoveInput(0, 0);
      } else {
        this.followPath(heroPos, delta);
      }
    } else if (this.moveTarget) {
      // Have a target but no path — drive direct as fallback
      const dist = heroPos.distanceTo(this.moveTarget);
      if (dist < 3) {
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
   * Follow the current path waypoints.
   */
  followPath(heroPos, delta) {
    if (this.currentWaypointIndex >= this.currentPath.length) {
      // Reached end of path
      this.hero.setMoveInput(0, 0);
      this.currentPath = [];
      this.moveTarget = null;
      return;
    }

    const waypoint = this.currentPath[this.currentWaypointIndex];
    const dist = heroPos.distanceTo(waypoint);

    if (dist < this.waypointArrivalDist) {
      // Move to next waypoint
      this.currentWaypointIndex++;
      if (this.currentWaypointIndex >= this.currentPath.length) {
        this.hero.setMoveInput(0, 0);
        this.currentPath = [];
        this.moveTarget = null;
        return;
      }
    }

    // Drive toward current waypoint
    const currentWP = this.currentPath[this.currentWaypointIndex];
    this.driveToward(heroPos, currentWP, delta);
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
