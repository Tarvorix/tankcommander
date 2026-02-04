# Tank Command Project Lessons

## Three.js Bone Animation - Critical Fix (2026-02-05)

**Problem**: Warhound Titan model was deformed when animating bones. Multiple failed attempts using Euler rotations and model flips.

**What DIDN'T work**:
- Rotating the model with `this.model.rotation.x = Math.PI` to flip upside-down rig
- Using an intermediate `orientationGroup` with rotation flip
- Storing base Euler rotations and adding swing values to `bone.rotation.x`
- Using `quaternion.setFromEuler()` directly

**What WORKED (ChatGPT Codex solution)**:
1. **Remove manual rig flips** - Don't use `orientationGroup.rotation.x = Math.PI` to flip the whole rig
2. **Preserve bind pose with quaternion snapshots** - Store the original bone quaternions at load time, not Euler rotations
3. **Apply quaternion deltas from bind pose** - For hip walk swing and spine/turret twist, apply quaternion deltas from the stored bind pose quaternions instead of writing to Euler `rotation.x/y`

**Key insight**: Euler rotations cause deformation drift in rigged models. Always use quaternion math for bone animation in Three.js to prevent skeleton deformation.

**Files affected**: `src/Warhound.js`
- Line ~20: Store bind pose quaternions
- Line ~95: Preserve skeleton bind pose with quaternion snapshots
- Line ~217: Hip walk swing uses quaternion deltas
- Line ~237: Spine/turret twist uses quaternion deltas
