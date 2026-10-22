import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { ZipExtractor, ExtractedZipContent } from './ZipExtractor';
import { ModelLoadResult, ModelDisplayStyle } from '../types';

// Setup three-mesh-bvh acceleration
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface ManagedMeshMaterial {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material | THREE.Material[];
  plainMaterial: THREE.Material;
  points?: THREE.Points;
  pointsMaterial?: THREE.PointsMaterial;
}

export class ModelLoader {
  private currentZipContent: ExtractedZipContent | null = null;
  private managedMaterials: ManagedMeshMaterial[] = [];
  private isTextureEnabled: boolean = true;
  private displayStyle: ModelDisplayStyle = 'solid';
  private pointSize: number = 2.5;
  private pointColor: number = 0x38bdf8;
  private currentClippingPlanes: THREE.Plane[] = [];

  /**
   * Load model from a ZIP file containing .obj, .mtl, and image textures
   */
  public async loadZip(
    source: File | Blob | ArrayBuffer | string,
    onProgress?: (percent: number, message: string) => void
  ): Promise<ModelLoadResult> {
    this.cleanup();

    const zipContent = await ZipExtractor.extract(source, onProgress);
    this.currentZipContent = zipContent;

    const { objContent, mtlContent, loadingManager } = zipContent;

    onProgress?.(65, '正在解析材质与贴图数据...');
    let materialsCreator: MTLLoader.MaterialCreator | null = null;
    if (mtlContent) {
      const mtlLoader = new MTLLoader(loadingManager);
      materialsCreator = mtlLoader.parse(mtlContent, '');
      materialsCreator.preload();
    }

    onProgress?.(75, '正在解析 OBJ 网格几何数据...');
    const objLoader = new OBJLoader(loadingManager);
    if (materialsCreator) {
      objLoader.setMaterials(materialsCreator);
    }

    const text = typeof objContent === 'string' ? objContent : new TextDecoder().decode(objContent);
    const modelGroup = objLoader.parse(text);

    onProgress?.(88, '正在建立空间 BVH 加速结构与几何居中...');
    const result = this.postProcessModel(modelGroup);

    onProgress?.(100, '加载完成');
    return result;
  }

  /**
   * Load model directly from OBJ and optional MTL URLs
   */
  public async loadOBJ(
    objUrl: string,
    mtlUrl?: string,
    onProgress?: (percent: number, message: string) => void
  ): Promise<ModelLoadResult> {
    this.cleanup();

    onProgress?.(20, '正在加载材质定义...');
    let materialsCreator: MTLLoader.MaterialCreator | null = null;
    if (mtlUrl) {
      const mtlLoader = new MTLLoader();
      materialsCreator = await mtlLoader.loadAsync(mtlUrl);
      materialsCreator.preload();
    }

    onProgress?.(50, '正在加载 OBJ 模型几何数据...');
    const objLoader = new OBJLoader();
    if (materialsCreator) {
      objLoader.setMaterials(materialsCreator);
    }

    const modelGroup = await objLoader.loadAsync(objUrl, (xhr) => {
      if (xhr.lengthComputable && xhr.total > 0) {
        const p = Math.round(50 + (xhr.loaded / xhr.total) * 35);
        onProgress?.(p, `正在传输模型数据 (${Math.round((xhr.loaded / xhr.total) * 100)}%)...`);
      }
    });

    onProgress?.(88, '正在建立空间 BVH 加速结构与几何居中...');
    const result = this.postProcessModel(modelGroup);

    onProgress?.(100, '加载完成');
    return result;
  }

  /**
   * Post-process loaded model:
   * - Build BVH acceleration trees on all meshes
   * - Count vertices & faces
   * - Cache original materials and prepare clay/white-model materials
   * - Calculate bounding box and center
   */
  public postProcessModel(group: THREE.Group): ModelLoadResult {
    let vertexCount = 0;
    let faceCount = 0;
    this.managedMaterials = [];

    const enhanceTexture = (tex: THREE.Texture | null) => {
      if (tex) {
        tex.anisotropy = 16;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      }
    };

    // Helper to ensure materials are visible, sharp and two-sided
    const ensureVisibleMaterial = (mat: THREE.Material) => {
      mat.side = THREE.DoubleSide; // Critical: avoid invisible faces due to inverted normals
      mat.needsUpdate = true;
      if ('color' in mat) {
        const m = mat as THREE.MeshStandardMaterial;
        enhanceTexture(m.map);
        if ('normalMap' in m) enhanceTexture(m.normalMap);
        if ('bumpMap' in m) enhanceTexture(m.bumpMap);

        // If diffuse color is black or very dark without texture, brighten it
        if (!m.map && m.color && m.color.getHex() < 0x222222) {
          m.color.setHex(0xb0b8c4);
        }
      }
    };

    // 1. Initial pass: calculate original bounds and center
    const initialBox = new THREE.Box3().setFromObject(group);
    const origCenter = new THREE.Vector3();
    const origSize = new THREE.Vector3();
    initialBox.getCenter(origCenter);
    initialBox.getSize(origSize);

    // 2. Process meshes, center geometries to (0,0,0) and ensure visible materials
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(ensureVisibleMaterial);
          } else {
            ensureVisibleMaterial(mesh.material);
          }
        } else {
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xb0b8c4,
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide,
          });
        }

        const geom = mesh.geometry;
        if (geom) {
          // Center geometry around (0, 0, 0)
          geom.translate(-origCenter.x, -origCenter.y, -origCenter.z);

          // Ensure normals exist
          if (!geom.attributes.normal) {
            geom.computeVertexNormals();
          }

          // Build BVH for raycasting acceleration and snapping
          if (geom.computeBoundsTree) {
            geom.computeBoundsTree();
          }

          // Vertex & face counting
          if (geom.attributes.position) {
            vertexCount += geom.attributes.position.count;
          }
          if (geom.index) {
            faceCount += geom.index.count / 3;
          } else if (geom.attributes.position) {
            faceCount += geom.attributes.position.count / 3;
          }

          // Create a clean clay material for texture toggling
          const plainMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide,
          });

          // Create corresponding Points for point-cloud display style
          const hasVertexColors = !!geom.attributes.color;
          const pointsMat = new THREE.PointsMaterial({
            color: hasVertexColors ? 0xffffff : this.pointColor,
            size: this.pointSize,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.9,
            vertexColors: hasVertexColors,
          });

          if (this.currentClippingPlanes.length > 0) {
            pointsMat.clippingPlanes = this.currentClippingPlanes;
            pointsMat.clipShadows = true;
          }

          const points = new THREE.Points(geom, pointsMat);
          points.visible = this.displayStyle === 'points';
          points.castShadow = false;
          points.receiveShadow = false;
          mesh.add(points);

          const managedItem: ManagedMeshMaterial = {
            mesh,
            originalMaterial: mesh.material,
            plainMaterial: plainMat,
            points,
            pointsMaterial: pointsMat,
          };

          this.applyStyleToItem(managedItem);
          this.managedMaterials.push(managedItem);
        }
      }
    });

    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
    group.updateMatrixWorld(true);

    // Compute updated bounding box (centered at 0,0,0)
    const box = new THREE.Box3().setFromObject(group);

    return {
      model: group,
      box,
      size: origSize,
      center: origCenter,
      vertexCount,
      faceCount: Math.round(faceCount),
    };
  }

  /**
   * Internal helper to apply display style (solid/wireframe/points) to a managed mesh
   */
  private applyStyleToItem(item: ManagedMeshMaterial): void {
    const curMat = this.isTextureEnabled ? item.originalMaterial : item.plainMaterial;
    item.mesh.material = curMat;

    const setMatProps = (mat: THREE.Material) => {
      if (this.displayStyle === 'solid') {
        mat.visible = true;
        if ('wireframe' in mat) (mat as THREE.MeshStandardMaterial).wireframe = false;
      } else if (this.displayStyle === 'wireframe') {
        mat.visible = true;
        if ('wireframe' in mat) (mat as THREE.MeshStandardMaterial).wireframe = true;
      } else if (this.displayStyle === 'points') {
        // Hide surface rendering while keeping mesh.visible = true so BVH & snapping remain active
        mat.visible = false;
      }
      mat.needsUpdate = true;
    };

    if (Array.isArray(curMat)) {
      curMat.forEach(setMatProps);
    } else {
      setMatProps(curMat);
    }

    if (item.points) {
      item.points.visible = this.displayStyle === 'points';
      if (item.pointsMaterial) {
        item.pointsMaterial.visible = this.displayStyle === 'points';
      }
    }
  }

  /**
   * Set model display style: 'solid' (实体), 'wireframe' (线框), 'points' (点云)
   */
  public setDisplayStyle(style: ModelDisplayStyle): void {
    this.displayStyle = style;
    for (const item of this.managedMaterials) {
      this.applyStyleToItem(item);
    }
  }

  public getDisplayStyle(): ModelDisplayStyle {
    return this.displayStyle;
  }

  /**
   * Adjust point size for point-cloud display style
   */
  public setPointSize(size: number): void {
    this.pointSize = Math.max(0.1, size);
    for (const item of this.managedMaterials) {
      if (item.pointsMaterial) {
        item.pointsMaterial.size = this.pointSize;
        item.pointsMaterial.needsUpdate = true;
      }
    }
  }

  public getPointSize(): number {
    return this.pointSize;
  }

  /**
   * Adjust point color for point-cloud display style
   */
  public setPointColor(color: THREE.ColorRepresentation): void {
    this.pointColor = typeof color === 'string' ? new THREE.Color(color).getHex() : Number(color);
    for (const item of this.managedMaterials) {
      if (item.pointsMaterial && !item.pointsMaterial.vertexColors) {
        item.pointsMaterial.color.set(this.pointColor);
        item.pointsMaterial.needsUpdate = true;
      }
    }
  }

  /**
   * Toggle texture on/off
   */
  public toggleTexture(showTexture: boolean): void {
    this.isTextureEnabled = showTexture;
    for (const item of this.managedMaterials) {
      this.applyStyleToItem(item);
    }
  }

  public getTextureState(): boolean {
    return this.isTextureEnabled;
  }

  /**
   * Retrieve all meshes of the model for raycasting and snapping
   */
  public getMeshes(): THREE.Mesh[] {
    return this.managedMaterials.map((m) => m.mesh);
  }

  /**
   * Apply clipping planes to all materials (surface and point cloud)
   */
  public applyClippingPlanes(planes: THREE.Plane[]): void {
    this.currentClippingPlanes = planes;
    for (const item of this.managedMaterials) {
      const applyToMat = (mat: THREE.Material) => {
        mat.clippingPlanes = planes.length > 0 ? planes : null;
        mat.clipShadows = true;
        mat.needsUpdate = true;
      };

      if (Array.isArray(item.originalMaterial)) {
        item.originalMaterial.forEach(applyToMat);
      } else {
        applyToMat(item.originalMaterial);
      }
      applyToMat(item.plainMaterial);

      if (item.pointsMaterial) {
        applyToMat(item.pointsMaterial);
      }
    }
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    if (this.currentZipContent) {
      this.currentZipContent.dispose();
      this.currentZipContent = null;
    }

    for (const item of this.managedMaterials) {
      if (item.plainMaterial) {
        item.plainMaterial.dispose();
      }
      if (item.pointsMaterial) {
        item.pointsMaterial.dispose();
      }
      if (item.points) {
        item.mesh.remove(item.points);
      }
      if (item.mesh.geometry && item.mesh.geometry.disposeBoundsTree) {
        item.mesh.geometry.disposeBoundsTree();
      }
    }
    this.managedMaterials = [];
  }
}
