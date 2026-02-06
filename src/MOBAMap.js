import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * MOBA-style map with:
 * - Two bases (Blue north, Red south)
 * - 3 lanes from each base converging at a large center arena
 * - Central control point platform
 * - No jungle — open terrain between lanes
 * - Tower positions along lanes
 *
 * Map dimensions: 300x300 units (meters)
 * Blue base center: (0, 0, -130)
 * Red base center:  (0, 0, +130)
 * Center arena:     (0, 0, 0) — radius ~40m
 */
export class MOBAMap {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.textureLoader = new THREE.TextureLoader();
    this.exrLoader = new EXRLoader();
    this.obstacleMeshes = [];
    this.groundMesh = null;

    // Map dimensions
    this.mapSize = 300;
    this.halfMap = this.mapSize / 2;

    // Base positions
    this.blueBasePos = new THREE.Vector3(0, 0, -130);
    this.redBasePos = new THREE.Vector3(0, 0, 130);

    // Center arena
    this.centerPos = new THREE.Vector3(0, 0, 0);
    this.centerRadius = 40;

    // Lane definitions — waypoints from blue base to center, mirrored for red
    // Each lane: array of {x, z} waypoints from blue base → center
    this.lanes = {
      left: [
        { x: -20, z: -120 },   // exits blue base left side
        { x: -65, z: -90 },
        { x: -80, z: -55 },
        { x: -70, z: -25 },
        { x: -45, z: -5 },
        { x: -20, z: 0 },      // enters center from west
      ],
      mid: [
        { x: 0, z: -115 },     // exits blue base front
        { x: 0, z: -80 },
        { x: 0, z: -50 },
        { x: 0, z: -20 },
        { x: 0, z: 0 },        // straight to center
      ],
      right: [
        { x: 20, z: -120 },    // exits blue base right side
        { x: 65, z: -90 },
        { x: 80, z: -55 },
        { x: 70, z: -25 },
        { x: 45, z: -5 },
        { x: 20, z: 0 },       // enters center from east
      ]
    };

    // Tower positions per team per lane
    // Blue towers: along lane from base toward center
    // Red towers: mirrored (negate z, negate x for left/right swap)
    this.towerPositions = {
      blue: {
        left:  [{ x: -45, z: -95 }, { x: -75, z: -40 }],
        mid:   [{ x: 0, z: -90 }, { x: 0, z: -45 }],
        right: [{ x: 45, z: -95 }, { x: 75, z: -40 }],
      },
      red: {
        left:  [{ x: 45, z: 95 }, { x: 75, z: 40 }],
        mid:   [{ x: 0, z: 90 }, { x: 0, z: 45 }],
        right: [{ x: -45, z: 95 }, { x: -75, z: 40 }],
      }
    };

    // Minion spawn points (at base exits per lane)
    this.minionSpawns = {
      blue: {
        left:  { x: -20, z: -120 },
        mid:   { x: 0, z: -115 },
        right: { x: 20, z: -120 },
      },
      red: {
        left:  { x: 20, z: 120 },
        mid:   { x: 0, z: 115 },
        right: { x: -20, z: 120 },
      }
    };

    // Minion lane waypoints — full path from blue spawn to red spawn
    // Red minions walk these in reverse
    this.laneWaypoints = {
      left: [
        { x: -20, z: -120 },
        { x: -65, z: -90 },
        { x: -80, z: -55 },
        { x: -70, z: -25 },
        { x: -45, z: -5 },
        { x: -20, z: 0 },
        { x: 0, z: 0 },       // center
        { x: 20, z: 0 },
        { x: 45, z: 5 },
        { x: 70, z: 25 },
        { x: 80, z: 55 },
        { x: 65, z: 90 },
        { x: 20, z: 120 },
      ],
      mid: [
        { x: 0, z: -115 },
        { x: 0, z: -80 },
        { x: 0, z: -50 },
        { x: 0, z: -20 },
        { x: 0, z: 0 },       // center
        { x: 0, z: 20 },
        { x: 0, z: 50 },
        { x: 0, z: 80 },
        { x: 0, z: 115 },
      ],
      right: [
        { x: 20, z: -120 },
        { x: 65, z: -90 },
        { x: 80, z: -55 },
        { x: 70, z: -25 },
        { x: 45, z: -5 },
        { x: 20, z: 0 },
        { x: 0, z: 0 },       // center
        { x: -20, z: 0 },
        { x: -45, z: 5 },
        { x: -70, z: 25 },
        { x: -80, z: 55 },
        { x: -65, z: 90 },
        { x: -20, z: 120 },
      ]
    };

    this.createGround();
    this.createLanes();
    this.createCenterArena();
    this.createBases();
    this.createLaneWalls();
  }

  createGround() {
    // Flat ground plane — MOBA maps are flat for fairness
    const geometry = new THREE.PlaneGeometry(this.mapSize, this.mapSize, 1, 1);
    geometry.computeVertexNormals();

    const basePath = import.meta.env.BASE_URL;

    // Use gravelly sand for the base terrain
    const diffuseMap = this.textureLoader.load(`${basePath}textures/terrain/red_mud_stones/red_mud_stones_diff_4k.jpg`);
    const roughnessMap = this.textureLoader.load(`${basePath}textures/terrain/red_mud_stones/red_mud_stones_rough_4k.jpg`);
    diffuseMap.colorSpace = THREE.SRGBColorSpace;

    const textureRepeat = 30;
    [diffuseMap, roughnessMap].forEach(texture => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(textureRepeat, textureRepeat);
    });

    const material = new THREE.MeshStandardMaterial({
      map: diffuseMap,
      roughnessMap: roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      color: 0x556644
    });

    this.exrLoader.load(`${basePath}textures/terrain/red_mud_stones/red_mud_stones_nor_gl_4k.exr`, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(textureRepeat, textureRepeat);
      material.normalMap = texture;
      material.needsUpdate = true;
    });

    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.groundMesh = ground;

    // Physics ground — flat plane
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const groundCollider = RAPIER.ColliderDesc.cuboid(this.halfMap, 0.1, this.halfMap)
      .setTranslation(0, -0.1, 0);
    this.world.createCollider(groundCollider, groundBody);
  }

  createLanes() {
    // Visual lane paths — slightly raised, lighter colored strips
    const laneMaterial = new THREE.MeshStandardMaterial({
      color: 0x888877,
      roughness: 0.9,
      metalness: 0.0,
    });

    for (const [laneName, waypoints] of Object.entries(this.laneWaypoints)) {
      this.createLanePath(waypoints, laneMaterial);
    }
  }

  createLanePath(waypoints, material) {
    const laneWidth = 12;
    const laneHeight = 0.08; // Slightly above ground to be visible

    // Create segments between each pair of waypoints
    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];

      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);

      const midX = (from.x + to.x) / 2;
      const midZ = (from.z + to.z) / 2;

      const segGeo = new THREE.BoxGeometry(laneWidth, laneHeight, length + laneWidth * 0.5);
      const segMesh = new THREE.Mesh(segGeo, material);
      segMesh.position.set(midX, laneHeight / 2, midZ);
      segMesh.rotation.y = angle;
      segMesh.receiveShadow = true;
      this.scene.add(segMesh);
    }

    // Add circular pads at each waypoint for smooth junctions
    const padGeo = new THREE.CylinderGeometry(laneWidth / 2, laneWidth / 2, laneHeight, 16);
    for (const wp of waypoints) {
      const pad = new THREE.Mesh(padGeo, material);
      pad.position.set(wp.x, laneHeight / 2, wp.z);
      pad.receiveShadow = true;
      this.scene.add(pad);
    }
  }

  createCenterArena() {
    // Large circular platform at center
    const arenaRadius = this.centerRadius;
    const arenaHeight = 0.15;

    // Main arena floor
    const arenaGeo = new THREE.CylinderGeometry(arenaRadius, arenaRadius, arenaHeight, 48);
    const arenaMaterial = new THREE.MeshStandardMaterial({
      color: 0x999988,
      roughness: 0.7,
      metalness: 0.1,
    });
    const arena = new THREE.Mesh(arenaGeo, arenaMaterial);
    arena.position.set(0, arenaHeight / 2, 0);
    arena.receiveShadow = true;
    this.scene.add(arena);

    // Center control point platform (smaller raised circle)
    const cpRadius = 8;
    const cpHeight = 0.3;
    const cpGeo = new THREE.CylinderGeometry(cpRadius, cpRadius + 0.5, cpHeight, 32);
    const cpMaterial = new THREE.MeshStandardMaterial({
      color: 0xccccaa,
      roughness: 0.5,
      metalness: 0.2,
      emissive: 0x222211,
      emissiveIntensity: 0.3
    });
    const cpPlatform = new THREE.Mesh(cpGeo, cpMaterial);
    cpPlatform.position.set(0, arenaHeight + cpHeight / 2, 0);
    cpPlatform.receiveShadow = true;
    cpPlatform.castShadow = true;
    this.scene.add(cpPlatform);

    // Ring around control point
    const ringGeo = new THREE.TorusGeometry(cpRadius + 1, 0.3, 8, 48);
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0xffdd44,
      roughness: 0.3,
      metalness: 0.6,
      emissive: 0xffdd44,
      emissiveIntensity: 0.4
    });
    const ring = new THREE.Mesh(ringGeo, ringMaterial);
    ring.position.set(0, arenaHeight + cpHeight + 0.3, 0);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    this.controlPointRing = ring;

    // Decorative pillars around the arena edge
    const pillarCount = 12;
    const pillarGeo = new THREE.CylinderGeometry(1.2, 1.5, 6, 8);
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x776655,
      roughness: 0.8,
      metalness: 0.1,
    });
    for (let i = 0; i < pillarCount; i++) {
      const angle = (i / pillarCount) * Math.PI * 2;
      const px = Math.cos(angle) * (arenaRadius - 2);
      const pz = Math.sin(angle) * (arenaRadius - 2);
      const pillar = new THREE.Mesh(pillarGeo, pillarMaterial);
      pillar.position.set(px, 3, pz);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);
      this.obstacleMeshes.push(pillar);

      // Physics for pillar
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(px, 3, pz);
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cylinder(3, 1.5);
      this.world.createCollider(colliderDesc, body);
    }
  }

  createBases() {
    // Blue base (north)
    this.createBase(this.blueBasePos, 0x2244aa, 'blue');
    // Red base (south)
    this.createBase(this.redBasePos, 0xaa2222, 'red');
  }

  createBase(position, color, team) {
    const baseSize = 30;
    const wallHeight = 4;
    const wallThickness = 2;

    // Base platform
    const platformGeo = new THREE.BoxGeometry(baseSize, 0.5, baseSize);
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.6,
      metalness: 0.2,
      emissive: color,
      emissiveIntensity: 0.15
    });
    const platform = new THREE.Mesh(platformGeo, platformMaterial);
    platform.position.set(position.x, 0.25, position.z);
    platform.receiveShadow = true;
    platform.castShadow = true;
    this.scene.add(platform);

    // Base nexus/core crystal
    const nexusGeo = new THREE.OctahedronGeometry(4, 0);
    const nexusMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.1,
      metalness: 0.8,
      emissive: color,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9,
    });
    const nexus = new THREE.Mesh(nexusGeo, nexusMaterial);
    nexus.position.set(position.x, 6, position.z);
    nexus.castShadow = true;
    this.scene.add(nexus);

    if (team === 'blue') {
      this.blueNexus = nexus;
      this.blueNexusMaterial = nexusMaterial;
    } else {
      this.redNexus = nexus;
      this.redNexusMaterial = nexusMaterial;
    }

    // Spawn pad (where hero respawns)
    const spawnGeo = new THREE.CylinderGeometry(5, 5, 0.3, 24);
    const spawnMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.5,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.7,
    });
    const spawnPad = new THREE.Mesh(spawnGeo, spawnMaterial);
    const spawnOffset = team === 'blue' ? 8 : -8;
    spawnPad.position.set(position.x, 0.65, position.z + spawnOffset);
    this.scene.add(spawnPad);

    // Base walls (3 sides, open toward lanes)
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.8,
      metalness: 0.1,
    });

    // Back wall
    const backDir = team === 'blue' ? -1 : 1;
    const backWallGeo = new THREE.BoxGeometry(baseSize + wallThickness, wallHeight, wallThickness);
    const backWall = new THREE.Mesh(backWallGeo, wallMaterial);
    backWall.position.set(position.x, wallHeight / 2, position.z + backDir * (baseSize / 2));
    backWall.castShadow = true;
    this.scene.add(backWall);
    this.obstacleMeshes.push(backWall);

    // Side wall physics
    const backWallBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(backWall.position.x, backWall.position.y, backWall.position.z)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(baseSize / 2 + wallThickness / 2, wallHeight / 2, wallThickness / 2),
      backWallBody
    );

    // Left wall
    const leftWallGeo = new THREE.BoxGeometry(wallThickness, wallHeight, baseSize);
    const leftWall = new THREE.Mesh(leftWallGeo, wallMaterial);
    leftWall.position.set(position.x - baseSize / 2, wallHeight / 2, position.z);
    leftWall.castShadow = true;
    this.scene.add(leftWall);
    this.obstacleMeshes.push(leftWall);

    const leftWallBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(leftWall.position.x, leftWall.position.y, leftWall.position.z)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, baseSize / 2),
      leftWallBody
    );

    // Right wall
    const rightWall = new THREE.Mesh(leftWallGeo, wallMaterial);
    rightWall.position.set(position.x + baseSize / 2, wallHeight / 2, position.z);
    rightWall.castShadow = true;
    this.scene.add(rightWall);
    this.obstacleMeshes.push(rightWall);

    const rightWallBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(rightWall.position.x, rightWall.position.y, rightWall.position.z)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, baseSize / 2),
      rightWallBody
    );
  }

  createLaneWalls() {
    // Scatter rocks/barriers between lanes to guide movement
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x665544,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true,
    });

    const rockPositions = this.generateBetweenLaneRocks();

    for (const rp of rockPositions) {
      const baseGeo = new THREE.DodecahedronGeometry(rp.size, 1);
      const rockGeo = baseGeo;

      // Perturb vertices for natural look
      const positions = rockGeo.attributes.position;
      const perturbMap = new Map();
      const quantize = (val) => Math.round(val * 1000);
      const perturbStrength = 0.2;
      const tempVec = new THREE.Vector3();

      for (let v = 0; v < positions.count; v++) {
        const px = positions.getX(v);
        const py = positions.getY(v);
        const pz = positions.getZ(v);
        const key = `${quantize(px)},${quantize(py)},${quantize(pz)}`;

        if (!perturbMap.has(key)) {
          perturbMap.set(key, 1.0 + (Math.random() - 0.5) * 2 * perturbStrength);
        }
        const scale = perturbMap.get(key);
        tempVec.set(px, py, pz);
        const dist = tempVec.length();
        if (dist > 0) {
          tempVec.normalize().multiplyScalar(dist * scale);
          positions.setX(v, tempVec.x);
          positions.setY(v, tempVec.y);
          positions.setZ(v, tempVec.z);
        }
      }
      rockGeo.computeVertexNormals();

      const rock = new THREE.Mesh(rockGeo, rockMaterial);
      rock.position.set(rp.x, rp.size * 0.6, rp.z);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
      this.obstacleMeshes.push(rock);

      // Physics
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(rp.x, rp.size * 0.6, rp.z);
      const body = this.world.createRigidBody(bodyDesc);
      this.world.createCollider(
        RAPIER.ColliderDesc.ball(rp.size * 0.8),
        body
      );
    }
  }

  generateBetweenLaneRocks() {
    const rocks = [];
    // Place rocks between lanes and at map edges to funnel movement
    // Between left and mid lanes
    const betweenLeftMid = [
      { x: -40, z: -100, size: 4 },
      { x: -35, z: -80, size: 3.5 },
      { x: -45, z: -65, size: 5 },
      { x: -40, z: -50, size: 3 },
      { x: -30, z: -35, size: 4 },
      { x: -15, z: -20, size: 3 },
      // Mirror for south half
      { x: 40, z: 100, size: 4 },
      { x: 35, z: 80, size: 3.5 },
      { x: 45, z: 65, size: 5 },
      { x: 40, z: 50, size: 3 },
      { x: 30, z: 35, size: 4 },
      { x: 15, z: 20, size: 3 },
    ];

    // Between mid and right lanes
    const betweenMidRight = [
      { x: 40, z: -100, size: 4 },
      { x: 35, z: -80, size: 3.5 },
      { x: 45, z: -65, size: 5 },
      { x: 40, z: -50, size: 3 },
      { x: 30, z: -35, size: 4 },
      { x: 15, z: -20, size: 3 },
      // Mirror for south half
      { x: -40, z: 100, size: 4 },
      { x: -35, z: 80, size: 3.5 },
      { x: -45, z: 65, size: 5 },
      { x: -40, z: 50, size: 3 },
      { x: -30, z: 35, size: 4 },
      { x: -15, z: 20, size: 3 },
    ];

    // Outer edges (beyond left/right lanes)
    const outerRocks = [
      { x: -100, z: -60, size: 6 },
      { x: -95, z: -30, size: 5 },
      { x: -95, z: 0, size: 7 },
      { x: -95, z: 30, size: 5 },
      { x: -100, z: 60, size: 6 },
      { x: 100, z: -60, size: 6 },
      { x: 95, z: -30, size: 5 },
      { x: 95, z: 0, size: 7 },
      { x: 95, z: 30, size: 5 },
      { x: 100, z: 60, size: 6 },
    ];

    rocks.push(...betweenLeftMid, ...betweenMidRight, ...outerRocks);
    return rocks;
  }

  getTerrainHeight(worldX, worldZ) {
    // Flat MOBA map — always 0
    return 0;
  }

  /**
   * Animate nexus crystals (floating rotation)
   */
  update(delta) {
    if (this.blueNexus) {
      this.blueNexus.rotation.y += delta * 0.5;
      this.blueNexus.position.y = 6 + Math.sin(Date.now() * 0.001) * 0.5;
    }
    if (this.redNexus) {
      this.redNexus.rotation.y += delta * 0.5;
      this.redNexus.position.y = 6 + Math.sin(Date.now() * 0.001 + Math.PI) * 0.5;
    }
    if (this.controlPointRing) {
      this.controlPointRing.rotation.z += delta * 0.3;
    }
  }
}
