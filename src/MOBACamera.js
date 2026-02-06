import * as THREE from 'three';

/**
 * League of Legends-style isometric camera.
 * - Fixed angle looking down (~55 degrees from horizontal)
 * - Follows player hero by default
 * - Edge-of-screen panning (desktop) or two-finger drag (mobile)
 * - Spacebar to snap back to hero
 * - Mouse wheel / pinch zoom (limited range)
 */
export class MOBACamera {
  constructor(hero) {
    this.hero = hero;

    // Camera setup — perspective with fixed angle
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      1,
      500
    );

    // Camera angle settings
    this.cameraAngle = 55 * (Math.PI / 180);  // 55 degrees from horizontal
    this.cameraRotation = 0;                    // Rotation around Y — 0 means looking along +Z

    // Zoom
    this.minZoom = 40;
    this.maxZoom = 90;
    this.currentZoom = 65;
    this.targetZoom = 65;
    this.zoomSpeed = 5;

    // Panning
    this.panOffset = new THREE.Vector3(0, 0, 0);
    this.panSpeed = 80;          // units per second for edge panning
    this.edgePanThreshold = 40;  // pixels from screen edge to start panning
    this.isPanning = false;
    this.isLockedToHero = true;

    // Smooth follow
    this.currentTarget = new THREE.Vector3();
    this.smoothSpeed = 8;

    // Mouse position (for edge panning)
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;

    // Drag panning state (desktop middle-mouse)
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartPan = new THREE.Vector3();

    // Touch state
    this.touchPanActive = false;
    this.touchPanStartX = 0;
    this.touchPanStartY = 0;
    this.touchPanStartOffset = new THREE.Vector3();
    this.touchPinchStartDist = 0;
    this.touchPinchStartZoom = 0;
    this.touchCount = 0;

    // Reusable vectors
    this._desiredTarget = new THREE.Vector3();
    this._cameraOffset = new THREE.Vector3();

    this.setupDesktopInputs();
    this.updateCameraPosition(0);
  }

  setupDesktopInputs() {
    // Mouse wheel for zoom
    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetZoom += e.deltaY * 0.05;
      this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom));
    }, { passive: false });

    // Mouse position tracking for edge panning
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    // Spacebar to recenter on hero
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        this.isLockedToHero = true;
        this.panOffset.set(0, 0, 0);
      }
    });

    // Middle mouse drag for panning
    window.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // Middle mouse
        e.preventDefault();
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartPan.copy(this.panOffset);
        this.isLockedToHero = false;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = (e.clientX - this.dragStartX) * 0.3;
        const dy = (e.clientY - this.dragStartY) * 0.3;
        this.panOffset.x = this.dragStartPan.x - dx;
        this.panOffset.z = this.dragStartPan.z - dy;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) {
        this.isDragging = false;
      }
    });
  }

  /**
   * Called by MOBAControls when a two-finger gesture begins.
   * @param {number} centerX - center X of the two touches (screen px)
   * @param {number} centerY - center Y of the two touches (screen px)
   * @param {number} pinchDist - distance between the two fingers (px)
   */
  startPanPinch(centerX, centerY, pinchDist) {
    this.touchPanActive = true;
    this.touchPanStartX = centerX;
    this.touchPanStartY = centerY;
    this.touchPanStartOffset.copy(this.panOffset);
    this.isLockedToHero = false;
    this.touchPinchStartDist = pinchDist;
    this.touchPinchStartZoom = this.targetZoom;
  }

  /**
   * Called by MOBAControls on two-finger move.
   */
  updatePanPinch(centerX, centerY, pinchDist) {
    if (!this.touchPanActive) return;

    // Two-finger drag pan
    const dx = (centerX - this.touchPanStartX) * 0.5;
    const dy = (centerY - this.touchPanStartY) * 0.5;
    this.panOffset.x = this.touchPanStartOffset.x - dx;
    this.panOffset.z = this.touchPanStartOffset.z - dy;

    // Pinch zoom
    if (this.touchPinchStartDist > 0) {
      const scale = this.touchPinchStartDist / pinchDist;
      this.targetZoom = Math.max(
        this.minZoom,
        Math.min(this.maxZoom, this.touchPinchStartZoom * scale)
      );
    }
  }

  /**
   * Called by MOBAControls when all fingers lift.
   */
  endPanPinch() {
    this.touchPanActive = false;
  }

  /**
   * Snap camera back to hero.
   */
  recenter() {
    this.isLockedToHero = true;
    this.panOffset.set(0, 0, 0);
  }

  update(delta) {
    if (!this.hero || !this.hero.mesh) return;

    // Zoom interpolation
    this.currentZoom += (this.targetZoom - this.currentZoom) * this.zoomSpeed * delta;

    // Edge panning (desktop only — skip if dragging or on touch)
    if (!this.isDragging && !this.touchPanActive) {
      this.handleEdgePan(delta);
    }

    // Compute desired target position
    const heroPos = this.hero.getPosition();

    if (this.isLockedToHero) {
      this._desiredTarget.copy(heroPos);
    } else {
      this._desiredTarget.copy(heroPos).add(this.panOffset);
    }

    // Smooth follow
    this.currentTarget.lerp(this._desiredTarget, this.smoothSpeed * delta);

    this.updateCameraPosition(delta);
  }

  handleEdgePan(delta) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const threshold = this.edgePanThreshold;
    const speed = this.panSpeed * delta;

    let panX = 0;
    let panZ = 0;

    if (this.mouseX < threshold) panX = -speed;
    else if (this.mouseX > w - threshold) panX = speed;

    if (this.mouseY < threshold) panZ = -speed;
    else if (this.mouseY > h - threshold) panZ = speed;

    if (panX !== 0 || panZ !== 0) {
      this.panOffset.x += panX;
      this.panOffset.z += panZ;
      if (this.isLockedToHero && (Math.abs(this.panOffset.x) > 5 || Math.abs(this.panOffset.z) > 5)) {
        this.isLockedToHero = false;
      }
    }
  }

  updateCameraPosition(delta) {
    // Camera position: offset from target by zoom distance at the fixed angle
    const distance = this.currentZoom;

    // Offset: behind and above the target
    this._cameraOffset.set(
      0,
      distance * Math.sin(this.cameraAngle),
      distance * Math.cos(this.cameraAngle)
    );

    // Apply rotation if any
    if (this.cameraRotation !== 0) {
      const cos = Math.cos(this.cameraRotation);
      const sin = Math.sin(this.cameraRotation);
      const x = this._cameraOffset.x;
      const z = this._cameraOffset.z;
      this._cameraOffset.x = x * cos - z * sin;
      this._cameraOffset.z = x * sin + z * cos;
    }

    this.camera.position.copy(this.currentTarget).add(this._cameraOffset);
    this.camera.lookAt(this.currentTarget);
  }

  /**
   * Project a screen position to a world position on the ground plane (Y=0).
   * Used for click-to-move.
   */
  screenToGround(screenX, screenY) {
    const ndc = new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);

    // Intersect with ground plane (Y=0)
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, intersection);

    return intersection;
  }

  /**
   * Get a raycaster from screen coordinates (for picking enemies).
   */
  getRaycaster(screenX, screenY) {
    const ndc = new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster;
  }
}
