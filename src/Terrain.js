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

    // Physics ground - position it so top surface is at y=0
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(0, -0.5, 0);
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.5, 100);
    this.world.createCollider(groundColliderDesc, groundBody);
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
