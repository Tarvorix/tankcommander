import { init, NavMeshQuery } from 'recast-navigation';
import { threeToSoloNavMesh } from '@recast-navigation/three';

/**
 * Runtime navmesh generation and pathfinding for infantry soldiers.
 * Uses recast-navigation to build a navigation mesh from the terrain
 * ground plane and rock obstacle meshes, then provides path queries.
 */
export class NavMeshSystem {
  constructor() {
    this.navMesh = null;
    this.navMeshQuery = null;
    this.ready = false;
  }

  /**
   * Initialize WASM and generate navmesh from terrain geometry.
   * Call after terrain + obstacles are fully created.
   * @param {import('./Terrain.js').Terrain} terrain
   * @returns {Promise<boolean>} true if navmesh was successfully generated
   */
  async build(terrain) {
    // Initialize recast-navigation WASM module
    await init();

    // Collect all geometry: ground plane + rock obstacles
    const meshes = [];
    if (terrain.groundMesh) {
      meshes.push(terrain.groundMesh);
    }
    if (terrain.obstacleMeshes && terrain.obstacleMeshes.length > 0) {
      meshes.push(...terrain.obstacleMeshes);
    }

    if (meshes.length === 0) {
      console.error('NavMeshSystem: No meshes provided for navmesh generation');
      return false;
    }

    // Infantry-tuned navmesh configuration
    // Cell units: walkableHeight, walkableClimb, walkableRadius, maxEdgeLen are in cell counts
    // World units: cs, ch, walkableSlopeAngle, maxSimplificationError, detailSampleDist, detailSampleMaxError
    const config = {
      cs: 1.0,                    // Cell size (1m — good balance for 400x400 map)
      ch: 0.2,                    // Cell height (20cm vertical resolution)
      walkableSlopeAngle: 45,     // Max traversable slope in degrees
      walkableHeight: 10,         // Agent height: ceil(1.83m / 0.2) = 10 cells
      walkableClimb: 3,           // Max step-up: ceil(0.5m / 0.2) = 3 cells
      walkableRadius: 1,          // Agent radius: ceil(0.5m / 1.0) = 1 cell
      maxEdgeLen: 12,             // Max edge length in cells
      maxSimplificationError: 1.3,// Max deviation from detail mesh surface
      minRegionArea: 8,           // Min walkable region area (cells^2)
      mergeRegionArea: 20,        // Merge regions smaller than this (cells^2)
      maxVertsPerPoly: 6,         // Verts per nav polygon
      detailSampleDist: 6,        // Detail mesh sampling distance
      detailSampleMaxError: 1     // Detail mesh max sampling error
    };

    console.log('NavMeshSystem: Generating navmesh from', meshes.length, 'meshes...');
    const startTime = performance.now();

    const result = threeToSoloNavMesh(meshes, config);

    const elapsed = (performance.now() - startTime).toFixed(1);

    if (!result.success) {
      console.error('NavMeshSystem: Generation failed:', result.error);
      return false;
    }

    this.navMesh = result.navMesh;
    this.navMeshQuery = new NavMeshQuery(this.navMesh);
    this.ready = true;

    console.log(`NavMeshSystem: Navmesh generated in ${elapsed}ms`);
    return true;
  }

  /**
   * Find a path from start to end position using the navmesh.
   * Returns an array of waypoints [{x,y,z}, ...] or null if no path found.
   *
   * @param {THREE.Vector3|{x:number,y:number,z:number}} startPos
   * @param {THREE.Vector3|{x:number,y:number,z:number}} endPos
   * @returns {Array<{x:number,y:number,z:number}>|null}
   */
  findPath(startPos, endPos) {
    if (!this.ready || !this.navMeshQuery) return null;

    const start = { x: startPos.x, y: startPos.y, z: startPos.z };
    const end = { x: endPos.x, y: endPos.y, z: endPos.z };

    // halfExtents defines the search volume around start/end to find nearest nav poly
    // Generous Y extent to handle terrain height variation
    const result = this.navMeshQuery.computePath(start, end, {
      halfExtents: { x: 5, y: 10, z: 5 }
    });

    if (!result.success || result.path.length === 0) return null;

    return result.path;
  }

  /**
   * Find the closest navigable point to the given world position.
   *
   * @param {{x:number,y:number,z:number}} position
   * @returns {{x:number,y:number,z:number}|null}
   */
  findClosestPoint(position) {
    if (!this.ready || !this.navMeshQuery) return null;

    const result = this.navMeshQuery.findClosestPoint(
      { x: position.x, y: position.y, z: position.z },
      { halfExtents: { x: 10, y: 20, z: 10 } }
    );

    if (!result.success) return null;
    return result.point;
  }

  /**
   * Clean up WASM resources.
   */
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
