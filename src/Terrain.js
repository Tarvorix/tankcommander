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

  createSnowPatches() {
    const basePath = import.meta.env.BASE_URL;
    const patchCount = 25;

    // Generate a radial alpha gradient texture via canvas for soft edges
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = 256;
    alphaCanvas.height = 256;
    const ctx = alphaCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.75, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    const alphaTexture = new THREE.CanvasTexture(alphaCanvas);

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

    const snowMaterial = new THREE.MeshStandardMaterial({
      map: snowDiffuse,
      roughnessMap: snowRoughness,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      alphaMap: alphaTexture,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });

    // Load EXR normal map for snow asynchronously
    this.exrLoader.load(`${basePath}textures/terrain/snow_field/snow_field_aerial_nor_gl_4k.exr`, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(3, 3);
      snowMaterial.normalMap = texture;
      snowMaterial.needsUpdate = true;
    });

    // Use a seeded-style random for reproducible placement
    // (Math.random is fine here since patches are decorative)
    const patchGeometry = new THREE.CircleGeometry(1, 32);

    for (let i = 0; i < patchCount; i++) {
      const patch = new THREE.Mesh(patchGeometry, snowMaterial);

      // Random position across the terrain (200x200, stay within bounds)
      const x = (Math.random() - 0.5) * 180;
      const z = (Math.random() - 0.5) * 180;

      // Sample terrain height using the same formula as createGround
      const y = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 2 + 0.05;

      patch.position.set(x, y, z);

      // Lay flat on the ground
      patch.rotation.x = -Math.PI / 2;

      // Random Y rotation for variety
      patch.rotation.z = Math.random() * Math.PI * 2;

      // Random scale between 5 and 15 units radius
      const scale = Math.random() * 10 + 5;
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
    // Add some rocks/obstacles
    const rockGeometry = new THREE.DodecahedronGeometry(2, 1);

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

    for (let i = 0; i < 20; i++) {
      const rock = new THREE.Mesh(rockGeometry, rockMaterial);
      rock.position.set(
        (Math.random() - 0.5) * 150,
        1,
        (Math.random() - 0.5) * 150
      );
      rock.scale.setScalar(Math.random() * 1.5 + 0.5);
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);

      // Physics for rock
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(rock.position.x, rock.position.y, rock.position.z);
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.ball(rock.scale.x * 1.5);
      this.world.createCollider(colliderDesc, body);
    }
  }
}
