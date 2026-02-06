import nipplejs from 'nipplejs';
import * as THREE from 'three';

export class Controls {
  constructor(vehicle, camera, renderer, scene, lockableTargets) {
    this.vehicle = vehicle;
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;
    this.lockableTargets = lockableTargets || []; // vehicles that can be locked onto

    // Lock-on state
    this.lockedTarget = null;
    this.lockOnReticle = null; // set externally after construction

    // Right-joystick tap-to-fire detection
    this._rightTouchStart = 0;
    this._rightTouchMoved = false;

    // Raycaster for tap-to-lock
    this._raycaster = new THREE.Raycaster();
    this._tapScreenPos = new THREE.Vector2();

    this.setupJoysticks();
    this.setupKeyboard();
    this.setupTapToLock();
  }

  /* ------------------------------------------------------------------ */
  /*  Lock-on helpers                                                    */
  /* ------------------------------------------------------------------ */

  /** Try to lock onto whatever the user tapped in the 3D scene. */
  tryLockFromScreenPos(screenX, screenY) {
    if (!this.renderer || !this.camera) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this._tapScreenPos.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this._tapScreenPos.y = -((screenY - rect.top) / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._tapScreenPos, this.camera.camera);

    // Collect meshes from lockable targets
    const hitCandidates = [];
    for (const target of this.lockableTargets) {
      if (!target.isAlive() || !target.mesh) continue;
      target.mesh.traverse((child) => {
        if (child.isMesh) {
          child.userData._lockVehicle = target; // tag so we can trace back
          hitCandidates.push(child);
        }
      });
    }

    const hits = this._raycaster.intersectObjects(hitCandidates);

    if (hits.length > 0) {
      const hitVehicle = hits[0].object.userData._lockVehicle;
      if (hitVehicle) {
        // Toggle: if already locked onto this target, unlock
        if (this.lockedTarget === hitVehicle) {
          this.unlock();
        } else {
          this.lockOn(hitVehicle);
        }
        return;
      }
    }

    // Tapped empty space → unlock
    if (this.lockedTarget) {
      this.unlock();
    }
  }

  lockOn(target) {
    this.lockedTarget = target;
    this.vehicle.lockTarget = target;
    if (this.lockOnReticle) {
      this.lockOnReticle.setTarget(target);
    }
  }

  unlock() {
    this.lockedTarget = null;
    this.vehicle.lockTarget = null;
    if (this.lockOnReticle) {
      this.lockOnReticle.setTarget(null);
    }
  }

  /** Called each frame to validate lock (target died, etc.) */
  updateLock() {
    if (this.lockedTarget && (!this.lockedTarget.isAlive || !this.lockedTarget.isAlive())) {
      this.unlock();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Joysticks                                                          */
  /* ------------------------------------------------------------------ */

  setupJoysticks() {
    // Left joystick - movement (unchanged)
    this.moveJoystick = nipplejs.create({
      zone: document.getElementById('joystick-left'),
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'white',
      size: 100
    });

    this.moveJoystick.on('move', (evt, data) => {
      const x = data.vector.x;
      const y = data.vector.y;
      this.vehicle.setMoveInput(x, y);
    });

    this.moveJoystick.on('end', () => {
      this.vehicle.setMoveInput(0, 0);
    });

    // Right joystick - turret rotation + tap to fire
    this.turretJoystick = nipplejs.create({
      zone: document.getElementById('joystick-right'),
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'red',
      size: 100
    });

    this.turretJoystick.on('start', () => {
      this._rightTouchStart = performance.now();
      this._rightTouchMoved = false;
    });

    this.turretJoystick.on('move', (evt, data) => {
      const x = data.vector.x;
      // If the joystick moved a meaningful amount, mark as moved (not a tap)
      if (data.distance > 10) {
        this._rightTouchMoved = true;
      }
      this.vehicle.setTurretInput(x, 0);
    });

    this.turretJoystick.on('end', () => {
      this.vehicle.setTurretInput(0, 0);

      // Tap detection: short touch without much movement = fire
      const elapsed = performance.now() - this._rightTouchStart;
      if (elapsed < 250 && !this._rightTouchMoved) {
        this.vehicle.fire();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Keyboard                                                           */
  /* ------------------------------------------------------------------ */

  setupKeyboard() {
    const keys = {};

    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      this.updateFromKeys(keys);

      // Fire with space
      if (e.code === 'Space') {
        this.vehicle.fire();
      }

      // Lock-on toggle with Tab
      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.lockedTarget) {
          this.unlock();
        } else {
          // Lock onto nearest alive enemy
          this.lockNearest();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
      this.updateFromKeys(keys);
    });
  }

  /** For keyboard: lock onto the nearest alive lockable target. */
  lockNearest() {
    if (!this.vehicle.mesh) return;

    const myPos = this.vehicle.getPosition();
    let nearest = null;
    let nearestDist = Infinity;

    for (const target of this.lockableTargets) {
      if (!target.isAlive() || !target.mesh) continue;
      const d = myPos.distanceTo(target.getPosition());
      if (d < nearestDist) {
        nearestDist = d;
        nearest = target;
      }
    }

    if (nearest) {
      this.lockOn(nearest);
    }
  }

  updateFromKeys(keys) {
    // WASD for movement
    let moveX = 0;
    let moveY = 0;

    if (keys['KeyW']) moveY = 1;
    if (keys['KeyS']) moveY = -1;
    if (keys['KeyA']) moveX = -1;
    if (keys['KeyD']) moveX = 1;

    this.vehicle.setMoveInput(moveX, moveY);

    // Q/E for turret
    let turretX = 0;
    if (keys['KeyQ']) turretX = -1;
    if (keys['KeyE']) turretX = 1;

    this.vehicle.setTurretInput(turretX, 0);
  }

  /* ------------------------------------------------------------------ */
  /*  Tap-to-lock (3D scene raycasting)                                  */
  /* ------------------------------------------------------------------ */

  setupTapToLock() {
    const canvas = this.renderer.domElement;

    // Track whether user is interacting with joysticks to avoid false taps
    let joystickActive = false;
    const joyZoneL = document.getElementById('joystick-left');
    const joyZoneR = document.getElementById('joystick-right');

    // Touch: tap on 3D scene (not on joystick areas)
    canvas.addEventListener('pointerdown', (e) => {
      // Ignore if it started inside a joystick zone
      if (joyZoneL && joyZoneL.contains(e.target)) return;
      if (joyZoneR && joyZoneR.contains(e.target)) return;

      // Store for tap detection
      this._lockTapStart = performance.now();
      this._lockTapX = e.clientX;
      this._lockTapY = e.clientY;
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!this._lockTapStart) return;

      const elapsed = performance.now() - this._lockTapStart;
      const dx = e.clientX - this._lockTapX;
      const dy = e.clientY - this._lockTapY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      this._lockTapStart = 0;

      // Quick tap with little movement = lock attempt
      if (elapsed < 300 && dist < 15) {
        this.tryLockFromScreenPos(e.clientX, e.clientY);
      }
    });
  }
}
