import * as THREE from 'three';
import { init, NavMesh, NavMeshQuery } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { getPositionsAndIndices } from '@recast-navigation/three';

/**
 * Navigation mesh system using Recast/Detour for pathfinding.
 * Generates a nav mesh from the MOBA map geometry and provides
 * pathfinding queries to route heroes around obstacles.
 */
export class MOBANavSystem {
  constructor() {
    this.navMesh = null;
    this.navMeshQuery = null;
    this.ready = false;
  }

  /**
   * Build the navigation mesh from map geometry.
   * Must be called after the map and towers are created.
   * @param {MOBAMap} mobaMap - The MOBA map instance
   * @param {Array} towers - All tower instances (blue + red)
   */
  async build(mobaMap, towers) {
    // Initialize WASM module
    await init();

    // Build geometry for the nav mesh
    const meshes = this.buildNavGeometry(mobaMap, towers);

    // Extract positions and indices from Three.js meshes
    const [positions, indices] = getPositionsAndIndices(meshes);
    console.log(`Nav mesh: ${meshes.length} meshes, ${positions.length / 3} vertices, ${indices.length / 3} triangles`);

    // Generate the nav mesh with agent-appropriate settings
    const result = generateSoloNavMesh(positions, indices, {
      cs: 0.5,                     // cell size — 0.5 meter resolution (finer for tighter gaps)
      ch: 0.5,                     // cell height
      walkableSlopeAngle: 45,      // max traversable slope
      walkableHeight: 4,           // agent height in voxels (4 * ch = 2m)
      walkableClimb: 2,            // max step height in voxels
      walkableRadius: 4,           // agent radius in voxels (4 * cs = 2m clearance around obstacles)
      maxEdgeLen: 80,              // max edge length (in voxels)
      maxSimplificationError: 1.5, // how much to simplify the mesh
      minRegionArea: 8,            // remove tiny isolated areas
      mergeRegionArea: 20,         // merge small regions
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });

    if (result.success && result.navMesh) {
      this.navMesh = result.navMesh;
      this.navMeshQuery = new NavMeshQuery(this.navMesh);
      this.ready = true;
      console.log('Nav mesh built successfully — pathfinding active');
    } else {
      console.error('Nav mesh generation FAILED:', result.error || 'unknown error');
      console.warn('Pathfinding will fall back to direct movement');
    }

    // Dispose temporary geometry
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
  }

  /**
   * Build Three.js meshes representing the walkable ground and obstacles.
   * Recast will voxelize this and compute walkable areas.
   */
  buildNavGeometry(mobaMap, towers) {
    const meshes = [];
    const mat = new THREE.MeshBasicMaterial();

    // 1. Ground plane — the walkable surface
    const groundGeo = new THREE.PlaneGeometry(mobaMap.mapSize, mobaMap.mapSize);
    groundGeo.rotateX(-Math.PI / 2); // lay flat on Y=0
    const groundMesh = new THREE.Mesh(groundGeo, mat);
    groundMesh.position.set(0, 0, 0);
    groundMesh.updateMatrixWorld(true);
    meshes.push(groundMesh);

    // 2. Obstacle geometry from map (rocks, pillars, base walls)
    // These are tall boxes/cylinders that recast will identify as non-walkable
    for (const obstacleMesh of mobaMap.obstacleMeshes) {
      // Clone so we don't modify originals
      const clone = obstacleMesh.clone();
      clone.updateMatrixWorld(true);
      meshes.push(clone);
    }

    // 3. Tower geometry
    for (const tower of towers) {
      if (!tower.mesh) continue;
      // Create a simple box at tower position
      const towerBox = new THREE.Mesh(
        new THREE.BoxGeometry(6, 12, 6),
        mat
      );
      towerBox.position.copy(tower.position);
      towerBox.position.y = 6;
      towerBox.updateMatrixWorld(true);
      meshes.push(towerBox);
    }

    return meshes;
  }

  /**
   * Find a path from start to end, avoiding obstacles.
   * Returns an array of waypoints as THREE.Vector3.
   * Falls back to direct path if nav mesh is unavailable.
   */
  findPath(start, end) {
    if (!this.ready || !this.navMeshQuery) {
      return [new THREE.Vector3(end.x, end.y || 0, end.z)];
    }

    const result = this.navMeshQuery.computePath(
      { x: start.x, y: start.y || 0, z: start.z },
      { x: end.x, y: end.y || 0, z: end.z },
      {
        halfExtents: { x: 10, y: 5, z: 10 },
        maxPathPolys: 256,
        maxStraightPathPoints: 64,
      }
    );

    if (result.success && result.path && result.path.length > 0) {
      const waypoints = result.path.map(p => new THREE.Vector3(p.x, p.y, p.z));
      console.log(`Nav path: ${waypoints.length} waypoints`);
      return waypoints;
    }

    if (result.error) {
      console.warn('Nav path failed:', result.error);
    }

    // Fallback: direct path
    console.log('Nav path: fallback to direct');
    return [new THREE.Vector3(end.x, end.y || 0, end.z)];
  }

  /**
   * Find the closest navigable point to a given position.
   * Useful for snapping click positions to the nav mesh.
   */
  closestPoint(position) {
    if (!this.ready || !this.navMeshQuery) {
      return new THREE.Vector3(position.x, position.y || 0, position.z);
    }

    const result = this.navMeshQuery.findClosestPoint(
      { x: position.x, y: position.y || 0, z: position.z },
      { halfExtents: { x: 10, y: 5, z: 10 } }
    );

    if (result.success) {
      return new THREE.Vector3(result.point.x, result.point.y, result.point.z);
    }

    return new THREE.Vector3(position.x, position.y || 0, position.z);
  }

  dispose() {
    if (this.navMeshQuery) {
      this.navMeshQuery.destroy();
      this.navMeshQuery = null;
    }
    if (this.navMesh) {
      this.navMesh.destroy();
      this.navMesh = null;
    }
    this.ready = false;
  }
}
