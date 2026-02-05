import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

export class Terrain {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.textureLoader = new THREE.TextureLoader();
    this.exrLoader = new EXRLoader();

    this.createGround();
    this.createSnowPatches();
    this.createObstacles();
  }

  createGround() {
    // Visual ground
    const geometry = new THREE.PlaneGeometry(200, 200, 50, 50);

    // Add some height variation
    const vertices = geometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const y = vertices[i + 1];
      // Gentle rolling hills
      vertices[i + 2] = Math.sin(x * 0.05) * Math.cos(y * 0.05) * 2;
    }
    geometry.computeVertexNormals();

    // Load red_mud_stones textures
    const basePath = import.meta.env.BASE_URL;
    const diffuseMap = this.textureLoader.load(`${basePath}textures/terrain/red_mud_stones/red_mud_stones_diff_4k.jpg`);
    const roughnessMap = this.textureLoader.load(`${basePath}textures/terrain/red_mud_stones/red_mud_stones_rough_4k.jpg`);

    // Set color space for diffuse map (critical for correct colors)
    diffuseMap.colorSpace = THREE.SRGBColorSpace;

    // Configure texture tiling
    const textureRepeat = 20;
    [diffuseMap, roughnessMap].forEach(texture => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(textureRepeat, textureRepeat);
    });

    const material = new THREE.MeshStandardMaterial({
      map: diffuseMap,
      roughnessMap: roughnessMap,
      roughness: 1.0,
      metalness: 0.0
    });

    // Load EXR normal map asynchronously
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

    // Physics ground - trimesh collider matching visual terrain
    this.createTerrainCollider(geometry, ground.rotation);
  }

  generateIrregularAlphaMap(seed) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    // Simple seeded random for reproducible blob shapes
    let s = seed;
    const seededRandom = () => {
      s = (s * 16807 + 0) % 2147483647;
      return s / 2147483647;
    };

    // Generate random sinusoidal perturbations for the blob outline
    const numOctaves = 6;
    const perturbations = [];
    for (let i = 0; i < numOctaves; i++) {
      perturbations.push({
        frequency: Math.floor(seededRandom() * 4) + 2,
        amplitude: seededRandom() * 0.25 + 0.08,
        phase: seededRandom() * Math.PI * 2
      });
    }

    const cx = size / 2;
    const cy = size / 2;
    const baseRadius = size * 0.38;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        // Compute perturbed radius at this angle
        let radiusMod = 0;
        for (const p of perturbations) {
          radiusMod += p.amplitude * Math.sin(p.frequency * angle + p.phase);
        }
        const effectiveRadius = baseRadius * (1 + radiusMod);

        // Normalized distance (0 = center, 1 = edge of blob)
        const t = dist / effectiveRadius;

        // Smooth falloff with a soft inner region
        let alpha;
        if (t < 0.45) {
          alpha = 1.0;
        } else if (t < 1.0) {
          const fade = (t - 0.45) / 0.55;
          alpha = 1.0 - fade * fade * (3 - 2 * fade); // smoothstep
        } else {
          alpha = 0;
        }

        const idx = (y * size + x) * 4;
        const val = Math.floor(alpha * 255);
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return new THREE.CanvasTexture(canvas);
  }

  getTerrainHeight(worldX, worldZ) {
    // The terrain is a PlaneGeometry(200, 200, 50, 50) rotated -PI/2 around X.
    // Local space: X from -100 to 100, Y from -100 to 100, 51 vertices per axis.
    // After rotation: world X = local X, world Z = -local Y.
    // So: local X = worldX, local Y = -worldZ.
    // Heights at grid vertices use: sin(localX * 0.05) * cos(localY * 0.05) * 2
    //
    // The mesh linearly interpolates between grid vertices (4 units apart).
    // Using the raw analytical formula causes mismatch on slopes.
    // Bilinear interpolation of grid vertex heights matches the actual rendered surface.

    const localX = worldX;
    const localY = -worldZ;

    // Grid coordinates (50 segments, 51 vertices, spacing = 4 units)
    const gridX = (localX + 100) / 4;
    const gridY = (localY + 100) / 4;

    const ix = Math.max(0, Math.min(49, Math.floor(gridX)));
    const iy = Math.max(0, Math.min(49, Math.floor(gridY)));

    const fx = gridX - ix;
    const fy = gridY - iy;

    // Height at a grid vertex
    const h = (gx, gy) => {
      const lx = gx * 4 - 100;
      const ly = gy * 4 - 100;
      return Math.sin(lx * 0.05) * Math.cos(ly * 0.05) * 2;
    };

    const h00 = h(ix, iy);
    const h10 = h(ix + 1, iy);
    const h01 = h(ix, iy + 1);
    const h11 = h(ix + 1, iy + 1);

    // Bilinear interpolation to match the actual mesh surface
    return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) +
           h01 * (1 - fx) * fy + h11 * fx * fy;
  }

  createSnowPatches() {
    const basePath = import.meta.env.BASE_URL;
    const patchCount = 25;

    // Generate several irregular alpha maps for variety
    const alphaMaps = [];
    for (let i = 0; i < 5; i++) {
      alphaMaps.push(this.generateIrregularAlphaMap(i * 7919 + 42));
    }

    // Load snow textures
    const snowDiffuse = this.textureLoader.load(`${basePath}textures/terrain/snow_field/snow_field_aerial_col_4k.jpg`);
    const snowRoughness = this.textureLoader.load(`${basePath}textures/terrain/snow_field/snow_field_aerial_rough_4k.jpg`);
    snowDiffuse.colorSpace = THREE.SRGBColorSpace;

    // Configure tiling for snow textures
    [snowDiffuse, snowRoughness].forEach(texture => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(3, 3);
    });

    // Create one material per alpha map variant
    const snowMaterials = alphaMaps.map(alphaMap => {
      return new THREE.MeshStandardMaterial({
        map: snowDiffuse,
        roughnessMap: snowRoughness,
        roughness: 1.0,
        metalness: 0.0,
        transparent: true,
        alphaMap: alphaMap,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });
    });

    // Load EXR normal map for snow asynchronously
    this.exrLoader.load(`${basePath}textures/terrain/snow_field/snow_field_aerial_nor_gl_4k.exr`, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(3, 3);
      snowMaterials.forEach(mat => {
        mat.normalMap = texture;
        mat.needsUpdate = true;
      });
    });

    for (let i = 0; i < patchCount; i++) {
      const scale = Math.random() * 10 + 5;
      const x = (Math.random() - 0.5) * 180;
      const z = (Math.random() - 0.5) * 180;
      const rotAngle = Math.random() * Math.PI * 2;

      // Subdivided plane so we can conform each vertex to terrain height
      const patchGeo = new THREE.PlaneGeometry(2, 2, 16, 16);
      const positions = patchGeo.attributes.position.array;
      const cosR = Math.cos(rotAngle);
      const sinR = Math.sin(rotAngle);

      for (let v = 0; v < positions.length; v += 3) {
        const lx = positions[v];
        const ly = positions[v + 1];

        // Account for mesh rotation.z when computing world position
        // Full transform: scale → rotateZ → rotateX(-PI/2) → translate
        // Result: worldX = x + s*(lx*cosR - ly*sinR)
        //         worldY = lz  (vertex Z becomes world Y)
        //         worldZ = z - s*(lx*sinR + ly*cosR)
        const worldX = x + scale * (lx * cosR - ly * sinR);
        const worldZ = z - scale * (lx * sinR + ly * cosR);
        const terrainHeight = this.getTerrainHeight(worldX, worldZ);

        // Set vertex Z so it lands exactly on the terrain surface
        // (mesh position.y = 0, scale.z = 1, so worldY = localZ directly)
        positions[v + 2] = terrainHeight + 0.05;
      }

      patchGeo.attributes.position.needsUpdate = true;
      patchGeo.computeVertexNormals();

      // Pick a random material variant
      const mat = snowMaterials[Math.floor(Math.random() * snowMaterials.length)];
      const patch = new THREE.Mesh(patchGeo, mat);

      patch.position.set(x, 0, z);
      patch.rotation.x = -Math.PI / 2;
      patch.rotation.z = rotAngle;
      patch.scale.set(scale, scale, 1);

      patch.receiveShadow = true;
      this.scene.add(patch);
    }
  }

  createTerrainCollider(geometry, rotation) {
    // Get vertices from geometry
    const positionAttr = geometry.attributes.position;
    const vertices = new Float32Array(positionAttr.count * 3);

    // Apply rotation to transform from local to world space
    const rotationMatrix = new THREE.Matrix4().makeRotationX(rotation.x);
    const tempVec = new THREE.Vector3();

    for (let i = 0; i < positionAttr.count; i++) {
      tempVec.set(
        positionAttr.getX(i),
        positionAttr.getY(i),
        positionAttr.getZ(i)
      );
      tempVec.applyMatrix4(rotationMatrix);

      vertices[i * 3] = tempVec.x;
      vertices[i * 3 + 1] = tempVec.y;
      vertices[i * 3 + 2] = tempVec.z;
    }

    // Get indices (triangles)
    const indices = new Uint32Array(geometry.index.array);

    // Create trimesh collider
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const trimeshDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    this.world.createCollider(trimeshDesc, groundBody);
  }

  createObstacles() {
    // Base geometries to pick from for variety
    const baseGeometries = [
      new THREE.DodecahedronGeometry(2, 1),
      new THREE.DodecahedronGeometry(2, 2),
      new THREE.IcosahedronGeometry(2, 1),
      new THREE.IcosahedronGeometry(2, 2)
    ];

    // Load rock_wall_02 textures for boulders
    const basePath = import.meta.env.BASE_URL;
    const rockDiffuseMap = this.textureLoader.load(`${basePath}textures/rocks/rock_wall_02/rock_wall_02_diff_4k.jpg`);
    const rockRoughnessMap = this.textureLoader.load(`${basePath}textures/rocks/rock_wall_02/rock_wall_02_rough_4k.jpg`);

    // Set color space for diffuse map (critical for correct colors)
    rockDiffuseMap.colorSpace = THREE.SRGBColorSpace;

    // Configure texture for rocks (less tiling since rocks are smaller)
    [rockDiffuseMap, rockRoughnessMap].forEach(texture => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 1);
    });

    const rockMaterial = new THREE.MeshStandardMaterial({
      map: rockDiffuseMap,
      roughnessMap: rockRoughnessMap,
      roughness: 1.0,
      metalness: 0.0
    });

    // Load EXR normal map for rocks asynchronously
    this.exrLoader.load(`${basePath}textures/rocks/rock_wall_02/rock_wall_02_nor_gl_4k.exr`, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 1);
      rockMaterial.normalMap = texture;
      rockMaterial.needsUpdate = true;
    });

    const tempNormal = new THREE.Vector3();

    for (let i = 0; i < 20; i++) {
      // Pick a random base geometry and clone it for unique perturbation
      const baseGeo = baseGeometries[Math.floor(Math.random() * baseGeometries.length)];
      const rockGeo = baseGeo.clone();

      // Perturb each vertex along its normal for an organic, lumpy shape
      const positions = rockGeo.attributes.position;
      const normals = rockGeo.attributes.normal;
      const perturbStrength = 0.3 + Math.random() * 0.4; // 0.3-0.7 displacement range

      for (let v = 0; v < positions.count; v++) {
        tempNormal.set(
          normals.getX(v),
          normals.getY(v),
          normals.getZ(v)
        ).normalize();

        // Random displacement along the normal (-perturbStrength to +perturbStrength)
        const displacement = (Math.random() - 0.5) * 2 * perturbStrength;

        positions.setX(v, positions.getX(v) + tempNormal.x * displacement);
        positions.setY(v, positions.getY(v) + tempNormal.y * displacement);
        positions.setZ(v, positions.getZ(v) + tempNormal.z * displacement);
      }

      rockGeo.computeVertexNormals();

      const rock = new THREE.Mesh(rockGeo, rockMaterial);
      const rx = (Math.random() - 0.5) * 150;
      const rz = (Math.random() - 0.5) * 150;

      // Non-uniform scale for varied proportions (flat, tall, elongated)
      const baseScale = Math.random() * 1.5 + 0.5;
      const scaleX = baseScale * (0.7 + Math.random() * 0.6);
      const scaleY = baseScale * (0.5 + Math.random() * 0.7);
      const scaleZ = baseScale * (0.7 + Math.random() * 0.6);

      // Place rock on the terrain surface, partially embedded
      const terrainY = this.getTerrainHeight(rx, rz);
      rock.position.set(rx, terrainY + scaleY * 0.8, rz);
      rock.scale.set(scaleX, scaleY, scaleZ);
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);

      // Physics for rock - use average scale for collision sphere
      const avgScale = (scaleX + scaleY + scaleZ) / 3;
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(rock.position.x, rock.position.y, rock.position.z);
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.ball(avgScale * 1.5);
      this.world.createCollider(colliderDesc, body);
    }
  }
}
