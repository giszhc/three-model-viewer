import * as THREE from 'three';

export interface SnapResult {
  hit: boolean;
  point: THREE.Vector3 | null;
  normal: THREE.Vector3 | null;
  isVertexSnapped: boolean;
  distanceToVertex: number;
}

/**
 * Finds intersection on model and optionally snaps to the nearest vertex
 * of the intersected face if within the screen-space pixel threshold.
 */
export function findSnapPoint(
  mouse: THREE.Vector2, // Normalized Device Coordinates (-1 to 1)
  camera: THREE.Camera,
  modelMeshes: THREE.Mesh[],
  snapPixelThreshold: number = 15,
  viewportWidth: number = 800,
  viewportHeight: number = 600
): SnapResult {
  if (!modelMeshes || modelMeshes.length === 0) {
    return { hit: false, point: null, normal: null, isVertexSnapped: false, distanceToVertex: Infinity };
  }

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  // Set firstHitOnly for three-mesh-bvh if available
  (raycaster as unknown as { firstHitOnly: boolean }).firstHitOnly = true;

  const intersects = raycaster.intersectObjects(modelMeshes, true);

  if (intersects.length === 0) {
    return { hit: false, point: null, normal: null, isVertexSnapped: false, distanceToVertex: Infinity };
  }

  const hit = intersects[0];
  const hitPoint = hit.point.clone();
  const faceNormal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
  if (hit.object) {
    faceNormal.transformDirection(hit.object.matrixWorld);
  }

  // Check vertices of the hit face for vertex snapping
  let closestVertex: THREE.Vector3 | null = null;
  let minScreenDist = snapPixelThreshold;

  if (hit.face && hit.object && (hit.object as THREE.Mesh).geometry) {
    const mesh = hit.object as THREE.Mesh;
    const geometry = mesh.geometry;
    const posAttr = geometry.attributes.position;

    if (posAttr) {
      const vIndices = [hit.face.a, hit.face.b, hit.face.c];
      const vWorld = new THREE.Vector3();
      const vScreen = new THREE.Vector3();

      for (const idx of vIndices) {
        vWorld.fromBufferAttribute(posAttr, idx).applyMatrix4(mesh.matrixWorld);
        vScreen.copy(vWorld).project(camera);

        // Convert NDC to screen pixels
        const screenX = ((vScreen.x + 1) * 0.5) * viewportWidth;
        const screenY = ((-vScreen.y + 1) * 0.5) * viewportHeight;

        const mouseScreenX = ((mouse.x + 1) * 0.5) * viewportWidth;
        const mouseScreenY = ((-mouse.y + 1) * 0.5) * viewportHeight;

        const screenDist = Math.hypot(screenX - mouseScreenX, screenY - mouseScreenY);

        if (screenDist < minScreenDist) {
          minScreenDist = screenDist;
          closestVertex = vWorld.clone();
        }
      }
    }
  }

  if (closestVertex) {
    return {
      hit: true,
      point: closestVertex,
      normal: faceNormal,
      isVertexSnapped: true,
      distanceToVertex: minScreenDist,
    };
  }

  return {
    hit: true,
    point: hitPoint,
    normal: faceNormal,
    isVertexSnapped: false,
    distanceToVertex: Infinity,
  };
}
