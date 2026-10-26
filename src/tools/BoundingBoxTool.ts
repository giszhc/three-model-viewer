import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { formatUnit } from '../utils/math';
import { BoundingBoxOptions } from '../types';

export class BoundingBoxTool {
  private scene: THREE.Scene;
  private boxGroup: THREE.Group;
  private wireframeBox: THREE.LineSegments | null = null;

  // 3 Dynamic active dimension lines
  private lineX: THREE.Line | null = null;
  private lineY: THREE.Line | null = null;
  private lineZ: THREE.Line | null = null;

  // 3 Dynamic CSS2D labels
  private labelX: CSS2DObject | null = null;
  private labelY: CSS2DObject | null = null;
  private labelZ: CSS2DObject | null = null;

  private currentModel: THREE.Object3D | null = null;
  private isVisible: boolean = false;
  private unit: string = 'm';

  // Cached local 8 corner vertices of the model's bounding box
  private localVertices: THREE.Vector3[] = [];
  private worldVertices: THREE.Vector3[] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];

  // Cached model dimensions
  private modelSize: THREE.Vector3 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.boxGroup = new THREE.Group();
    this.boxGroup.name = 'gmv-bounding-box-group';
    this.scene.add(this.boxGroup);
  }

  /**
   * Attaches bounding box to a model and initializes dynamic dimensional lines
   */
  public attachToModel(model: THREE.Object3D, options?: Partial<BoundingBoxOptions>): void {
    this.detach();
    this.currentModel = model;
    this.unit = options?.unit || 'm';

    // 1. Compute model's local bounding box accurately across hierarchies
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const invModelMatrix = model.matrixWorld.clone().invert();

    // Traverse all meshes in model to compute local bounds
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          if (!mesh.geometry.boundingBox) {
            mesh.geometry.computeBoundingBox();
          }
          if (mesh.geometry.boundingBox) {
            const relMatrix = mesh.matrixWorld.clone().premultiply(invModelMatrix);
            const meshBox = mesh.geometry.boundingBox.clone().applyMatrix4(relMatrix);
            box.union(meshBox);
          }
        }
      }
    });

    if (box.isEmpty()) {
      box.setFromObject(model);
    }

    const min = box.min;
    const max = box.max;
    box.getSize(this.modelSize);

    // 2. Generate 8 local corners
    // Index encoding: x (bit 0), y (bit 1), z (bit 2)
    this.localVertices = [
      new THREE.Vector3(min.x, min.y, min.z), // 0: 000
      new THREE.Vector3(max.x, min.y, min.z), // 1: 001 (x)
      new THREE.Vector3(min.x, max.y, min.z), // 2: 010 (y)
      new THREE.Vector3(max.x, max.y, min.z), // 3: 011 (xy)
      new THREE.Vector3(min.x, min.y, max.z), // 4: 100 (z)
      new THREE.Vector3(max.x, min.y, max.z), // 5: 101 (xz)
      new THREE.Vector3(min.x, max.y, max.z), // 6: 110 (yz)
      new THREE.Vector3(max.x, max.y, max.z), // 7: 111 (xyz)
    ];

    // 3. Create full 12-edge wireframe box
    // 12 edges indices:
    // Along X: (0,1), (2,3), (4,5), (6,7)
    // Along Y: (0,2), (1,3), (4,6), (5,7)
    // Along Z: (0,4), (1,5), (2,6), (3,7)
    const edgeIndices = [
      0, 1,  2, 3,  4, 5,  6, 7, // X edges
      0, 2,  1, 3,  4, 6,  5, 7, // Y edges
      0, 4,  1, 5,  2, 6,  3, 7  // Z edges
    ];

    const boxGeom = new THREE.BufferGeometry();
    const posBuffer = new Float32Array(edgeIndices.length * 3);
    boxGeom.setAttribute('position', new THREE.BufferAttribute(posBuffer, 3));

    const lineMaterial = new THREE.LineBasicMaterial({
      color: options?.color ? new THREE.Color(options.color) : 0x00d2ff,
      linewidth: 1,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });
    this.wireframeBox = new THREE.LineSegments(boxGeom, lineMaterial);
    this.boxGroup.add(this.wireframeBox);

    // 4. Create 3 Dynamic Colored Active Dimension Lines
    // X (Length): Red, Y (Height): Green, Z (Width): Blue
    this.lineX = this.createDynamicLine(0xef4444);
    this.lineY = this.createDynamicLine(0x10b981);
    this.lineZ = this.createDynamicLine(0x3b82f6);

    // 5. Create CSS2D Labels
    const divX = document.createElement('div');
    divX.className = 'gmv-dimension-badge dim-x';
    divX.innerHTML = `<span>长 (X):</span> <strong>${formatUnit(this.modelSize.x, this.unit)}</strong>`;
    this.labelX = new CSS2DObject(divX);
    this.boxGroup.add(this.labelX);

    const divY = document.createElement('div');
    divY.className = 'gmv-dimension-badge dim-y';
    divY.innerHTML = `<span>高 (Y):</span> <strong>${formatUnit(this.modelSize.y, this.unit)}</strong>`;
    this.labelY = new CSS2DObject(divY);
    this.boxGroup.add(this.labelY);

    const divZ = document.createElement('div');
    divZ.className = 'gmv-dimension-badge dim-z';
    divZ.innerHTML = `<span>宽 (Z):</span> <strong>${formatUnit(this.modelSize.z, this.unit)}</strong>`;
    this.labelZ = new CSS2DObject(divZ);
    this.boxGroup.add(this.labelZ);

    this.setVisible(options?.visible ?? false);
  }

  private createDynamicLine(color: number): THREE.Line {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color,
      linewidth: 3,
      depthTest: false,
    });
    const line = new THREE.Line(geom, mat);
    this.boxGroup.add(line);
    return line;
  }

  /**
   * Updates bounding box and selects the CURRENT front-facing 3 edges dynamically
   * based on the model's current rotation and camera perspective!
   */
  public update(camera: THREE.Camera): void {
    if (!this.isVisible || !this.currentModel || this.localVertices.length < 8) return;

    this.currentModel.updateMatrixWorld(true);
    const matrix = this.currentModel.matrixWorld;

    // 1. Transform all 8 local corners to world coordinates
    for (let i = 0; i < 8; i++) {
      this.worldVertices[i].copy(this.localVertices[i]).applyMatrix4(matrix);
    }

    // 2. Update 12-edges wireframe box positions
    if (this.wireframeBox) {
      const edgeIndices = [
        0, 1,  2, 3,  4, 5,  6, 7, // X edges
        0, 2,  1, 3,  4, 6,  5, 7, // Y edges
        0, 4,  1, 5,  2, 6,  3, 7  // Z edges
      ];
      const posAttr = this.wireframeBox.geometry.attributes.position;
      let ptr = 0;
      for (const idx of edgeIndices) {
        const v = this.worldVertices[idx];
        posAttr.setXYZ(ptr++, v.x, v.y, v.z);
      }
      posAttr.needsUpdate = true;
    }

    // 3. Find the corner vertex CLOSEST to the camera in world space
    // Out of the 8 corners, the closest corner faces the user!
    let bestCorner = 0;
    let minDistance = Infinity;
    const camPos = camera.position;

    for (let i = 0; i < 8; i++) {
      const dist = this.worldVertices[i].distanceTo(camPos);
      if (dist < minDistance) {
        minDistance = dist;
        bestCorner = i;
      }
    }

    // 4. From bestCorner, the 3 connected edges along X, Y, Z are:
    // Neighbor along X: bestCorner ^ 1 (flips bit 0)
    // Neighbor along Y: bestCorner ^ 2 (flips bit 1)
    // Neighbor along Z: bestCorner ^ 4 (flips bit 2)
    const cornerV = this.worldVertices[bestCorner];
    const neighborX = this.worldVertices[bestCorner ^ 1];
    const neighborY = this.worldVertices[bestCorner ^ 2];
    const neighborZ = this.worldVertices[bestCorner ^ 4];

    // 5. Update the 3 active dimension lines
    this.updateLine(this.lineX, cornerV, neighborX);
    this.updateLine(this.lineY, cornerV, neighborY);
    this.updateLine(this.lineZ, cornerV, neighborZ);

    // 6. Update CSS2D label positions to midpoints of the current 3 front edges
    if (this.labelX) {
      this.labelX.position.copy(cornerV).add(neighborX).multiplyScalar(0.5);
    }
    if (this.labelY) {
      this.labelY.position.copy(cornerV).add(neighborY).multiplyScalar(0.5);
    }
    if (this.labelZ) {
      this.labelZ.position.copy(cornerV).add(neighborZ).multiplyScalar(0.5);
    }
  }

  private updateLine(line: THREE.Line | null, p1: THREE.Vector3, p2: THREE.Vector3): void {
    if (!line) return;
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, p1.x, p1.y, p1.z);
    pos.setXYZ(1, p2.x, p2.y, p2.z);
    pos.needsUpdate = true;
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.boxGroup.visible = visible;
  }

  public getVisible(): boolean {
    return this.isVisible;
  }

  public setUnit(unit: string): void {
    this.unit = unit;
    if (this.currentModel) {
      this.attachToModel(this.currentModel, { visible: this.isVisible, unit });
    }
  }

  public detach(): void {
    if (this.wireframeBox) {
      this.wireframeBox.geometry.dispose();
      (this.wireframeBox.material as THREE.Material).dispose();
      this.boxGroup.remove(this.wireframeBox);
      this.wireframeBox = null;
    }

    if (this.lineX) {
      this.lineX.geometry.dispose();
      (this.lineX.material as THREE.Material).dispose();
      this.boxGroup.remove(this.lineX);
      this.lineX = null;
    }
    if (this.lineY) {
      this.lineY.geometry.dispose();
      (this.lineY.material as THREE.Material).dispose();
      this.boxGroup.remove(this.lineY);
      this.lineY = null;
    }
    if (this.lineZ) {
      this.lineZ.geometry.dispose();
      (this.lineZ.material as THREE.Material).dispose();
      this.boxGroup.remove(this.lineZ);
      this.lineZ = null;
    }

    if (this.labelX) {
      this.boxGroup.remove(this.labelX);
      this.labelX = null;
    }
    if (this.labelY) {
      this.boxGroup.remove(this.labelY);
      this.labelY = null;
    }
    if (this.labelZ) {
      this.boxGroup.remove(this.labelZ);
      this.labelZ = null;
    }

    this.localVertices = [];
    this.currentModel = null;
  }

  public destroy(): void {
    this.detach();
    this.scene.remove(this.boxGroup);
  }
}
