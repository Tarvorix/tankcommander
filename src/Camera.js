import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(tank) {
    this.tank = tank;

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Camera offset from tank (behind on +Z axis, forward is -Z)
    this.offset = new THREE.Vector3(0, 5, 8);
    this.lookOffset = new THREE.Vector3(0, 1, 0);

    // Smoothing
    this.currentPosition = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.smoothSpeed = 5;
  }

  update(delta) {
    if (!this.tank.mesh) return;

    // Calculate desired position (behind and above tank)
    const tankPos = this.tank.getPosition();
    const tankRotation = this.tank.getRotation();

    // Offset rotated by tank's heading
    const rotatedOffset = this.offset.clone();
    rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), tankRotation);

    const desiredPosition = tankPos.clone().add(rotatedOffset);
    const desiredLookAt = tankPos.clone().add(this.lookOffset);

    // Smooth follow
    this.currentPosition.lerp(desiredPosition, this.smoothSpeed * delta);
    this.currentLookAt.lerp(desiredLookAt, this.smoothSpeed * delta);

    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }
}
