import * as THREE from 'three';

/**
 * 3D lock-on reticle that orbits above a locked target vehicle.
 * Shows a spinning diamond ring + pulsing inner brackets to make
 * it clear which enemy is targeted.
 */
export class LockOnReticle {
  constructor(scene) {
    this.scene = scene;
    this.target = null;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.phase = 0;

    // --- Outer rotating ring (4 diamond shapes arranged in a circle) ---
    const ringGroup = new THREE.Group();
    const diamondShape = new THREE.Shape();
    diamondShape.moveTo(0, 0.3);
    diamondShape.lineTo(0.12, 0);
    diamondShape.lineTo(0, -0.3);
    diamondShape.lineTo(-0.12, 0);
    diamondShape.closePath();

    const diamondGeo = new THREE.ShapeGeometry(diamondShape);
    const diamondMat = new THREE.MeshBasicMaterial({
      color: 0xff2200,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    });

    for (let i = 0; i < 4; i++) {
      const diamond = new THREE.Mesh(diamondGeo, diamondMat);
      const angle = (i / 4) * Math.PI * 2;
      diamond.position.set(Math.cos(angle) * 1.6, 0, Math.sin(angle) * 1.6);
      diamond.lookAt(0, 0, 0);
      ringGroup.add(diamond);
    }
    this.ringGroup = ringGroup;
    this.group.add(ringGroup);

    // --- Inner bracket corners ---
    const bracketMat = new THREE.LineBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    });

    const bracketSize = 0.8;
    const bracketLen = 0.35;
    const corners = [
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: 1, z: 1 },
      { x: -1, z: 1 }
    ];

    this.brackets = [];
    for (const c of corners) {
      const points = [
        new THREE.Vector3(c.x * bracketSize, 0, c.z * (bracketSize - bracketLen)),
        new THREE.Vector3(c.x * bracketSize, 0, c.z * bracketSize),
        new THREE.Vector3(c.x * (bracketSize - bracketLen), 0, c.z * bracketSize)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, bracketMat);
      this.brackets.push(line);
      this.group.add(line);
    }

    // --- "LOCKED" text indicator (small dot at center) ---
    const dotGeo = new THREE.CircleGeometry(0.1, 16);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      side: THREE.DoubleSide
    });
    this.dot = new THREE.Mesh(dotGeo, dotMat);
    this.group.add(this.dot);

    // Make the whole group render on top and face camera
    this.group.renderOrder = 999;
    this.scene.add(this.group);
  }

  setTarget(target) {
    this.target = target;
    this.group.visible = !!target;
  }

  update(delta, camera) {
    if (!this.target || !this.target.mesh || !this.group.visible) return;

    this.phase += delta;

    // Position above the target
    const targetPos = this.target.getPosition();
    this.group.position.set(targetPos.x, targetPos.y + 3.5, targetPos.z);

    // Face the reticle toward the camera (billboard on Y axis)
    if (camera && camera.camera) {
      const camPos = camera.camera.position;
      this.group.lookAt(camPos.x, this.group.position.y, camPos.z);
    }

    // Spin outer ring
    this.ringGroup.rotation.y = this.phase * 1.5;

    // Pulse brackets scale
    const pulse = 1.0 + Math.sin(this.phase * 4) * 0.12;
    for (const b of this.brackets) {
      b.scale.setScalar(pulse);
    }

    // Pulse center dot opacity
    this.dot.material.opacity = 0.5 + Math.sin(this.phase * 6) * 0.4;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
