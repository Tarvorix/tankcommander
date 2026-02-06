import * as THREE from 'three';

/**
 * Smoke column effect for destroyed vehicles.
 * Uses a pool of billboard sprites with a canvas-generated gradient texture.
 * Self-cleaning: alive becomes false once all particles have faded.
 */
export class SmokeEffect {
  constructor(scene, position, scale = 1) {
    this.scene = scene;
    this.basePosition = position.clone();
    this.scale = scale;
    this.alive = true;
    this.age = 0;
    this.emitting = true;
    this.emitDuration = 12;       // seconds of active emission
    this.emitAccumulator = 0;
    this.emitRate = 2.5;          // particles per second

    // Shared texture (canvas-generated soft circle)
    this.texture = this.createSmokeTexture();

    // Particle pool
    this.maxParticles = 25;
    this.particles = [];
  }

  createSmokeTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Radial gradient: white center fading to transparent edge
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.6)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  spawnParticle() {
    // Count active particles
    const activeCount = this.particles.filter(p => p.active).length;
    if (activeCount >= this.maxParticles) return;

    const material = new THREE.SpriteMaterial({
      map: this.texture,
      color: 0x222222,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    const sprite = new THREE.Sprite(material);

    // Random offset from base position (scaled with vehicle size)
    const s = this.scale;
    const ox = (Math.random() - 0.5) * 1.0 * s;
    const oz = (Math.random() - 0.5) * 1.0 * s;
    sprite.position.set(
      this.basePosition.x + ox,
      this.basePosition.y + 0.5 * s,
      this.basePosition.z + oz
    );

    const startScale = (0.5 + Math.random() * 0.5) * s;
    sprite.scale.setScalar(startScale);

    this.scene.add(sprite);

    this.particles.push({
      sprite,
      material,
      active: true,
      age: 0,
      maxAge: 3 + Math.random() * 2,               // 3-5 seconds
      velocityY: (2 + Math.random() * 2) * s,       // upward speed scales
      driftX: (Math.random() - 0.5) * 0.6 * s,      // horizontal wander scales
      driftZ: (Math.random() - 0.5) * 0.6 * s,
      growRate: (0.5 + Math.random() * 0.5) * s,    // expansion rate scales
      startOpacity: 0.5 + Math.random() * 0.15
    });
  }

  update(delta) {
    if (!this.alive) return;

    this.age += delta;

    // Emission phase
    if (this.emitting) {
      if (this.age < this.emitDuration) {
        this.emitAccumulator += delta;
        const interval = 1 / this.emitRate;
        while (this.emitAccumulator >= interval) {
          this.emitAccumulator -= interval;
          this.spawnParticle();
        }
      } else {
        this.emitting = false;
      }
    }

    // Update particles
    let anyActive = false;
    for (const p of this.particles) {
      if (!p.active) continue;

      p.age += delta;

      if (p.age >= p.maxAge) {
        // Kill particle
        p.active = false;
        this.scene.remove(p.sprite);
        continue;
      }

      anyActive = true;

      // Move upward with drift
      p.sprite.position.y += p.velocityY * delta;
      p.sprite.position.x += p.driftX * delta;
      p.sprite.position.z += p.driftZ * delta;

      // Expand
      const currentScale = p.sprite.scale.x + p.growRate * delta;
      p.sprite.scale.setScalar(currentScale);

      // Fade out over lifetime
      const t = p.age / p.maxAge;
      p.material.opacity = p.startOpacity * (1 - t * t);
    }

    // Check if effect is done
    if (!this.emitting && !anyActive) {
      this.alive = false;
    }
  }

  dispose() {
    for (const p of this.particles) {
      if (p.active) {
        this.scene.remove(p.sprite);
      }
      p.material.dispose();
    }
    this.particles.length = 0;
    this.texture.dispose();
  }
}
