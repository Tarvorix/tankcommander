import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(tank, scene) {
    this.tank = tank;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Camera offset from tank (behind and above)
    this.baseOffset = new THREE.Vector3(0, 5, 8);
    this.currentOffset = this.baseOffset.clone();
    this.lookOffset = new THREE.Vector3(0, 1, 0);

    // Smoothing
    this.currentPosition = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.smoothSpeed = 8; // Snappier camera response

    // Dynamic distance settings
    this.minDistance = 8;
    this.maxDistance = 14;
    this.currentDistance = 10;
    this.distanceSmoothSpeed = 3;

    // Turret follow mode - disabled by default for better driving
    this.followTurret = false;
    this.turretFollowStrength = 0.5; // 0 = hull only, 1 = full turret follow

    // Terrain collision
    this.raycaster = new THREE.Raycaster();
    this.minCameraHeight = 2; // Minimum height above ground
  }

  update(delta) {
    if (!this.tank.mesh) return;

    const tankPos = this.tank.getPosition();
    const tankRotation = this.tank.getRotation();

    // Calculate speed for dynamic distance
    const velocity = this.tank.body ? this.tank.body.linvel() : { x: 0, y: 0, z: 0 };
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

    // Dynamic distance: further when moving fast, closer when stopped
    const speedFactor = Math.min(speed / 10, 1); // Normalize to 0-1
    const targetDistance = this.minDistance + (this.maxDistance - this.minDistance) * speedFactor;
    this.currentDistance += (targetDistance - this.currentDistance) * this.distanceSmoothSpeed * delta;

    // Calculate rotation to follow (blend hull and turret based on settings)
    let followRotation = tankRotation;
    if (this.followTurret && this.tank.turretAngle !== undefined) {
      // Blend between hull rotation and hull+turret rotation
      followRotation = tankRotation + (this.tank.turretAngle * this.turretFollowStrength);
    }

    // Calculate offset with dynamic distance
    const scaledOffset = new THREE.Vector3(
      0,
      this.baseOffset.y,
      this.currentDistance
    );

    // Rotate offset by follow rotation
    const rotatedOffset = scaledOffset.clone();
    rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), followRotation);

    let desiredPosition = tankPos.clone().add(rotatedOffset);
    const desiredLookAt = tankPos.clone().add(this.lookOffset);

    // Terrain collision check - cast ray from tank to desired camera position
    desiredPosition = this.adjustForTerrain(tankPos, desiredPosition);

    // Smooth follow
    this.currentPosition.lerp(desiredPosition, this.smoothSpeed * delta);
    this.currentLookAt.lerp(desiredLookAt, this.smoothSpeed * delta);

    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }

  adjustForTerrain(tankPos, desiredPosition) {
    // Cast ray from tank to desired camera position
    const direction = desiredPosition.clone().sub(tankPos).normalize();
    const distance = tankPos.distanceTo(desiredPosition);

    this.raycaster.set(tankPos, direction);
    this.raycaster.far = distance;

    // Get all meshes in scene that could block camera (terrain, rocks)
    const meshes = [];
    this.scene.traverse((obj) => {
      if (obj.isMesh && obj !== this.tank.mesh) {
        meshes.push(obj);
      }
    });

    const intersects = this.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      // Hit something - move camera closer
      const hitPoint = intersects[0].point;
      const safeDistance = tankPos.distanceTo(hitPoint) - 1; // 1 unit buffer

      if (safeDistance > 0) {
        // Position camera at safe distance
        const safePosition = tankPos.clone().add(direction.multiplyScalar(safeDistance));
        // Ensure minimum height
        safePosition.y = Math.max(safePosition.y, tankPos.y + this.minCameraHeight);
        return safePosition;
      }
    }

    // Also ensure camera doesn't go below minimum height above tank
    if (desiredPosition.y < tankPos.y + this.minCameraHeight) {
      desiredPosition.y = tankPos.y + this.minCameraHeight;
    }

    return desiredPosition;
  }

  // Toggle turret follow mode
  setTurretFollow(enabled) {
    this.followTurret = enabled;
  }

  // Set how strongly camera follows turret (0-1)
  setTurretFollowStrength(strength) {
    this.turretFollowStrength = Math.max(0, Math.min(1, strength));
  }
}
