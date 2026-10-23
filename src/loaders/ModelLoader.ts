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
}

export class ModelLoader {
  private currentZipContent: ExtractedZipContent | null = null;
  private managedMaterials: ManagedMeshMaterial[] = [];
  private isTextureEnabled: boolean = true;
  private displayStyle: ModelDisplayStyle = 'solid';
  private plainColor: number = 0x4c8cd6; // Digital3DCloud / 先临三维标准数模扫描蓝
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
            color: this.plainColor,
            roughness: 0.45,
            metalness: 0.12,
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

          // Create Digital3DCloud standard CAD/scan blue material for texture toggling
          const plainMat = new THREE.MeshStandardMaterial({
            color: this.plainColor,
            roughness: 0.45,
            metalness: 0.12,
            side: THREE.DoubleSide,
            clippingPlanes: this.currentClippingPlanes.length > 0 ? this.currentClippingPlanes : null,
            clipShadows: true,
          });

          const managedItem: ManagedMeshMaterial = {
            mesh,
            originalMaterial: mesh.material,
            plainMaterial: plainMat,
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
   * Internal helper to apply display style (solid/wireframe) to a managed mesh
   */
  private applyStyleToItem(item: ManagedMeshMaterial): void {
    const curMat = this.isTextureEnabled ? item.originalMaterial : item.plainMaterial;
    item.mesh.material = curMat;

    const setMatProps = (mat: THREE.Material) => {
      mat.visible = true;
      if ('wireframe' in mat) {
        (mat as THREE.MeshStandardMaterial).wireframe = (this.displayStyle === 'wireframe');
      }
      mat.needsUpdate = true;
    };

    if (Array.isArray(curMat)) {
      curMat.forEach(setMatProps);
    } else {
      setMatProps(curMat);
    }
  }

  /**
   * Set model display style: 'solid' (实体), 'wireframe' (线框)
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
   * Set color for non-texture display (defaults to Digital3DCloud standard CAD blue 0x4c8cd6)
   */
  public setPlainColor(color: THREE.ColorRepresentation): void {
    this.plainColor = typeof color === 'string' ? new THREE.Color(color).getHex() : Number(color);
    for (const item of this.managedMaterials) {
      if (item.plainMaterial && 'color' in item.plainMaterial) {
        (item.plainMaterial as THREE.MeshStandardMaterial).color.set(this.plainColor);
        item.plainMaterial.needsUpdate = true;
      }
    }
  }

  public getPlainColor(): number {
    return this.plainColor;
  }

  /**
   * Retrieves the maximum original texture resolution (width & height) from the model's materials
   */
  public getModelTextureSize(): { width: number; height: number } | null {
    let maxWidth = 0;
    let maxHeight = 0;

    const inspectMat = (mat: THREE.Material) => {
      if ('map' in mat && (mat as THREE.MeshStandardMaterial).map) {
        const tex = (mat as THREE.MeshStandardMaterial).map;
        if (tex) {
          const img = (tex.image || (tex.source as unknown as { data?: { width?: number; height?: number } })?.data) as
            | { width?: number; height?: number }
            | undefined;
          if (img) {
            const w = img.width || 0;
            const h = img.height || 0;
            if (w > 0 && h > 0 && w * h > maxWidth * maxHeight) {
              maxWidth = w;
              maxHeight = h;
            }
          }
        }
      }
    };

    for (const item of this.managedMaterials) {
      if (Array.isArray(item.originalMaterial)) {
        item.originalMaterial.forEach(inspectMat);
      } else if (item.originalMaterial) {
        inspectMat(item.originalMaterial);
      }
    }

    if (maxWidth > 0 && maxHeight > 0) {
      return { width: maxWidth, height: maxHeight };
    }
    return null;
  }

  /**
   * Retrieve all meshes of the model for raycasting and snapping
   */
  public getMeshes(): THREE.Mesh[] {
    return this.managedMaterials.map((m) => m.mesh);
  }

  /**
   * Apply clipping planes to all materials
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
      if (item.mesh.geometry && item.mesh.geometry.disposeBoundsTree) {
        item.mesh.geometry.disposeBoundsTree();
      }
    }
    this.managedMaterials = [];
  }
}
