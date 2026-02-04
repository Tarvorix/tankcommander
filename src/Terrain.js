import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Terrain {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    this.createGround();
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

    const material = new THREE.MeshStandardMaterial({
      color: 0x3d5c3d,
      roughness: 0.9,
      metalness: 0.1
    });

    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Physics ground - trimesh collider matching visual terrain
    this.createTerrainCollider(geometry, ground.rotation);
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
    const rockGeometry = new THREE.DodecahedronGeometry(2, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.8
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
