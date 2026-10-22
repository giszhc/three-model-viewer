import * as THREE from 'three';

/**
 * Calculates the exact signed volume of a 3D Mesh using divergence theorem.
 * Works accurately for closed (watertight) meshes.
 */
export function computeMeshVolume(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry) return 0;

  const position = geometry.attributes.position;
  if (!position) return 0;

  let totalVolume = 0;
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const p3 = new THREE.Vector3();

  mesh.updateMatrixWorld(true);
  const matrixWorld = mesh.matrixWorld;

  if (geometry.index) {
    const indices = geometry.index;
    for (let i = 0; i < indices.count; i += 3) {
      const i1 = indices.getX(i);
      const i2 = indices.getX(i + 1);
      const i3 = indices.getX(i + 2);

      p1.fromBufferAttribute(position, i1).applyMatrix4(matrixWorld);
      p2.fromBufferAttribute(position, i2).applyMatrix4(matrixWorld);
      p3.fromBufferAttribute(position, i3).applyMatrix4(matrixWorld);

      totalVolume += signedVolumeOfTriangle(p1, p2, p3);
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      p1.fromBufferAttribute(position, i).applyMatrix4(matrixWorld);
      p2.fromBufferAttribute(position, i + 1).applyMatrix4(matrixWorld);
      p3.fromBufferAttribute(position, i + 2).applyMatrix4(matrixWorld);

      totalVolume += signedVolumeOfTriangle(p1, p2, p3);
    }
  }

  return Math.abs(totalVolume);
}

/**
 * Computes the total volume of all meshes inside a Group or Object3D
 */
export function computeGroupVolume(root: THREE.Object3D): { meshVolume: number; bboxVolume: number } {
  let meshVolume = 0;
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshVolume += computeMeshVolume(child as THREE.Mesh);
    }
  });

  const bbox = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const bboxVolume = size.x * size.y * size.z;

  return { meshVolume, bboxVolume };
}

function signedVolumeOfTriangle(p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3): number {
  return p1.dot(p2.clone().cross(p3)) / 6.0;
}

/**
 * Calculates the area of a 3D polygon defined by an array of 3D vertices using Newell's method.
 */
export function compute3DPolygonArea(points: THREE.Vector3[]): number {
  const n = points.length;
  if (n < 3) return 0;

  const normal = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < n; i++) {
    const current = points[i];
    const next = points[(i + 1) % n];

    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }

  return normal.length() * 0.5;
}

/**
 * Formats numeric value with unit
 */
export function formatUnit(value: number, unit: string = 'm', decimals: number = 2): string {
  if (Math.abs(value) < 0.001) {
    return `0.00 ${unit}`;
  }
  return `${value.toFixed(decimals)} ${unit}`;
}
