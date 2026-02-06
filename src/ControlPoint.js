import * as THREE from 'three';

/**
 * Central control point — capture mechanic.
 *
 * Capture rules:
 * - Stand within capture radius to capture
 * - Capture progress fills over time (3 seconds)
 * - If both teams are present, it's contested (no progress)
 * - Controlling team earns 1 point per second
 * - First to scoreToWin points wins
 *
 * Visual feedback:
 * - Ring color changes to controlling team
 * - Pulsing beacon when captured
 * - Progress bar above point
 */
export class ControlPoint {
  constructor(scene, position) {
    this.scene = scene;
    this.position = position.clone();
    this.position.y = 0;

    // Capture settings
    this.captureRadius = 15;
    this.captureTime = 3.0;       // seconds to capture from neutral
    this.captureProgress = 0;      // 0 to 1
    this.captureTeam = null;       // 'blue', 'red', or null (neutral)
    this.controllingTeam = null;   // team that has captured it
    this.isContested = false;

    // Scoring
    this.scoreToWin = 200;
    this.blueScore = 0;
    this.redScore = 0;
    this.scoreRate = 1.0; // points per second while controlling

    // Visual
    this.beaconLight = null;
    this.captureRing = null;
    this.captureRingMaterial = null;
    this.beaconColumn = null;
    this.beaconColumnMaterial = null;

    // Colors
    this.neutralColor = new THREE.Color(0xffdd44);
    this.blueColor = new THREE.Color(0x4488ff);
    this.redColor = new THREE.Color(0xff4444);
    this.contestedColor = new THREE.Color(0xff8800);

    this.createVisual();
  }

  createVisual() {
    // Capture ring on ground
    const ringGeo = new THREE.TorusGeometry(this.captureRadius, 0.5, 8, 64);
    this.captureRingMaterial = new THREE.MeshStandardMaterial({
      color: this.neutralColor,
      roughness: 0.3,
      metalness: 0.6,
      emissive: this.neutralColor,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.8,
    });
    this.captureRing = new THREE.Mesh(ringGeo, this.captureRingMaterial);
    this.captureRing.rotation.x = -Math.PI / 2;
    this.captureRing.position.set(this.position.x, 0.5, this.position.z);
    this.scene.add(this.captureRing);

    // Inner fill ring (shows capture progress)
    const fillGeo = new THREE.RingGeometry(0, this.captureRadius - 1, 48);
    this.fillMaterial = new THREE.MeshBasicMaterial({
      color: this.neutralColor,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
    });
    this.fillMesh = new THREE.Mesh(fillGeo, this.fillMaterial);
    this.fillMesh.rotation.x = -Math.PI / 2;
    this.fillMesh.position.set(this.position.x, 0.15, this.position.z);
    this.scene.add(this.fillMesh);

    // Beacon column (visible when captured)
    const beaconGeo = new THREE.CylinderGeometry(1, 2, 30, 8, 1, true);
    this.beaconColumnMaterial = new THREE.MeshBasicMaterial({
      color: this.neutralColor,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    this.beaconColumn = new THREE.Mesh(beaconGeo, this.beaconColumnMaterial);
    this.beaconColumn.position.set(this.position.x, 15, this.position.z);
    this.scene.add(this.beaconColumn);

    // Point light at capture point
    this.beaconLight = new THREE.PointLight(0xffdd44, 0, 30);
    this.beaconLight.position.set(this.position.x, 5, this.position.z);
    this.scene.add(this.beaconLight);

    // Floating flag/icon above capture point
    const flagGeo = new THREE.OctahedronGeometry(2, 0);
    this.flagMaterial = new THREE.MeshStandardMaterial({
      color: this.neutralColor,
      roughness: 0.2,
      metalness: 0.8,
      emissive: this.neutralColor,
      emissiveIntensity: 0.6,
    });
    this.flag = new THREE.Mesh(flagGeo, this.flagMaterial);
    this.flag.position.set(this.position.x, 8, this.position.z);
    this.scene.add(this.flag);
  }

  /**
   * Update capture state.
   * @param {number} delta - frame delta time
   * @param {Array} blueUnits - blue team units near the point
   * @param {Array} redUnits - red team units near the point
   * @returns {{ blueScore, redScore, winner }} current scores and winner if any
   */
  update(delta, blueUnits, redUnits) {
    // Count units in capture radius
    const blueInRange = this.countUnitsInRange(blueUnits);
    const redInRange = this.countUnitsInRange(redUnits);

    // Determine capture state
    const bluePresent = blueInRange > 0;
    const redPresent = redInRange > 0;

    this.isContested = bluePresent && redPresent;

    if (this.isContested) {
      // Both teams present — contested, no progress change
      // Slowly decay progress back toward 0
      this.captureProgress = Math.max(0, this.captureProgress - delta * 0.2);
    } else if (bluePresent && !redPresent) {
      // Blue capturing
      if (this.captureTeam === 'blue') {
        // Continue capturing
        this.captureProgress = Math.min(1, this.captureProgress + delta / this.captureTime);
      } else if (this.captureTeam === 'red') {
        // Decapture red first
        this.captureProgress = Math.max(0, this.captureProgress - delta / this.captureTime);
        if (this.captureProgress <= 0) {
          this.captureTeam = 'blue';
          this.controllingTeam = null;
        }
      } else {
        // Neutral — start capturing for blue
        this.captureTeam = 'blue';
        this.captureProgress = Math.min(1, this.captureProgress + delta / this.captureTime);
      }

      if (this.captureTeam === 'blue' && this.captureProgress >= 1) {
        this.controllingTeam = 'blue';
      }
    } else if (redPresent && !bluePresent) {
      // Red capturing
      if (this.captureTeam === 'red') {
        this.captureProgress = Math.min(1, this.captureProgress + delta / this.captureTime);
      } else if (this.captureTeam === 'blue') {
        this.captureProgress = Math.max(0, this.captureProgress - delta / this.captureTime);
        if (this.captureProgress <= 0) {
          this.captureTeam = 'red';
          this.controllingTeam = null;
        }
      } else {
        this.captureTeam = 'red';
        this.captureProgress = Math.min(1, this.captureProgress + delta / this.captureTime);
      }

      if (this.captureTeam === 'red' && this.captureProgress >= 1) {
        this.controllingTeam = 'red';
      }
    } else {
      // No one present — slowly decay
      if (!this.controllingTeam) {
        this.captureProgress = Math.max(0, this.captureProgress - delta * 0.1);
        if (this.captureProgress <= 0) {
          this.captureTeam = null;
        }
      }
    }

    // Scoring
    if (this.controllingTeam === 'blue') {
      this.blueScore += this.scoreRate * delta;
    } else if (this.controllingTeam === 'red') {
      this.redScore += this.scoreRate * delta;
    }

    // Update visuals
    this.updateVisuals(delta);

    // Check winner
    let winner = null;
    if (this.blueScore >= this.scoreToWin) winner = 'blue';
    if (this.redScore >= this.scoreToWin) winner = 'red';

    return {
      blueScore: Math.floor(this.blueScore),
      redScore: Math.floor(this.redScore),
      winner,
      controllingTeam: this.controllingTeam,
      isContested: this.isContested,
      captureProgress: this.captureProgress,
      captureTeam: this.captureTeam,
    };
  }

  countUnitsInRange(units) {
    let count = 0;
    for (const unit of units) {
      if (!unit.isAlive || !unit.isAlive()) continue;
      const pos = unit.getPosition();
      const dx = pos.x - this.position.x;
      const dz = pos.z - this.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= this.captureRadius) count++;
    }
    return count;
  }

  updateVisuals(delta) {
    // Determine current color
    let targetColor;
    if (this.isContested) {
      targetColor = this.contestedColor;
    } else if (this.controllingTeam === 'blue') {
      targetColor = this.blueColor;
    } else if (this.controllingTeam === 'red') {
      targetColor = this.redColor;
    } else if (this.captureTeam === 'blue') {
      targetColor = this.blueColor;
    } else if (this.captureTeam === 'red') {
      targetColor = this.redColor;
    } else {
      targetColor = this.neutralColor;
    }

    // Lerp ring color
    this.captureRingMaterial.color.lerp(targetColor, delta * 5);
    this.captureRingMaterial.emissive.lerp(targetColor, delta * 5);

    // Fill opacity based on capture progress
    this.fillMaterial.color.copy(targetColor);
    this.fillMaterial.opacity = this.captureProgress * 0.15;

    // Beacon visibility
    const beaconVisible = this.controllingTeam !== null;
    const targetBeaconOpacity = beaconVisible ? 0.15 : 0;
    this.beaconColumnMaterial.opacity += (targetBeaconOpacity - this.beaconColumnMaterial.opacity) * delta * 3;
    this.beaconColumnMaterial.color.lerp(targetColor, delta * 5);

    // Light intensity
    const targetIntensity = this.controllingTeam ? 3 : (this.captureProgress > 0 ? 1 : 0);
    this.beaconLight.intensity += (targetIntensity - this.beaconLight.intensity) * delta * 3;
    this.beaconLight.color.lerp(targetColor, delta * 5);

    // Flag
    this.flag.rotation.y += delta * 1.5;
    this.flag.position.y = 8 + Math.sin(Date.now() * 0.002) * 0.5;
    this.flagMaterial.color.lerp(targetColor, delta * 5);
    this.flagMaterial.emissive.lerp(targetColor, delta * 5);

    // Pulsing ring when captured
    if (this.controllingTeam) {
      const pulse = 0.6 + Math.sin(Date.now() * 0.003) * 0.2;
      this.captureRingMaterial.emissiveIntensity = pulse;
    } else {
      this.captureRingMaterial.emissiveIntensity = 0.3 + this.captureProgress * 0.3;
    }

    // Scale capture ring slightly with progress
    const ringScale = 1 + this.captureProgress * 0.05;
    this.captureRing.scale.set(ringScale, ringScale, 1);
  }
}
