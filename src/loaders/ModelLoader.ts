import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
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

export interface ModelLoaderOptions {
  dracoDecoderPath?: string;
  ktx2TranscoderPath?: string;
  renderer?: THREE.WebGLRenderer;
}

export class ModelLoader {
  private currentZipContent: ExtractedZipContent | null = null;
  private customBlobUrls: string[] = [];
  private managedMaterials: ManagedMeshMaterial[] = [];
  private isTextureEnabled: boolean = true;
  private displayStyle: ModelDisplayStyle = 'solid';
  private plainColor: number = 0x4c8cd6; // Digital3DCloud / 先临三维标准数模扫描蓝
  private currentClippingPlanes: THREE.Plane[] = [];

  // Draco & Meshopt Compression Configurations
  private dracoDecoderPath: string = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
  private dracoLoader: DRACOLoader | null = null;

  // KTX2 / Basis Universal Texture Compression Configuration
  private ktx2TranscoderPath: string = 'https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/basis/';
  private ktx2Loader: KTX2Loader | null = null;
  private renderer: THREE.WebGLRenderer | null = null;

  constructor(optionsOrDracoPath?: string | ModelLoaderOptions, renderer?: THREE.WebGLRenderer) {
    if (typeof optionsOrDracoPath === 'string') {
      this.dracoDecoderPath = optionsOrDracoPath;
      if (renderer) this.renderer = renderer;
    } else if (typeof optionsOrDracoPath === 'object' && optionsOrDracoPath !== null) {
      if (optionsOrDracoPath.dracoDecoderPath) {
        this.dracoDecoderPath = optionsOrDracoPath.dracoDecoderPath;
      }
      if (optionsOrDracoPath.ktx2TranscoderPath) {
        this.ktx2TranscoderPath = optionsOrDracoPath.ktx2TranscoderPath;
      }
      this.renderer = optionsOrDracoPath.renderer || renderer || null;
    }
  }

  /**
   * Set WebGLRenderer instance to allow KTX2Loader to query supported compressed texture formats
   */
  public setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    if (this.ktx2Loader) {
      this.ktx2Loader.detectSupport(renderer);
    }
  }

  /**
   * Set custom Draco decoder directory URL
   */
  public setDracoDecoderPath(path: string): void {
    this.dracoDecoderPath = path;
    if (this.dracoLoader) {
      this.dracoLoader.setDecoderPath(path);
    }
  }

  /**
   * Set custom KTX2 / Basis transcoder directory URL
   */
  public setKTX2TranscoderPath(path: string): void {
    this.ktx2TranscoderPath = path;
    if (this.ktx2Loader) {
      this.ktx2Loader.setTranscoderPath(path);
    }
  }

  /**
   * Internal helper to create or retrieve cached DRACOLoader
   */
  private getDracoLoader(): DRACOLoader {
    if (!this.dracoLoader) {
      this.dracoLoader = new DRACOLoader();
      this.dracoLoader.setDecoderPath(this.dracoDecoderPath);
    }
    return this.dracoLoader;
  }

  /**
   * Internal helper to create or retrieve cached KTX2Loader
   */
  private getKTX2Loader(): KTX2Loader {
    if (!this.ktx2Loader) {
      this.ktx2Loader = new KTX2Loader();
      this.ktx2Loader.setTranscoderPath(this.ktx2TranscoderPath);
      if (this.renderer) {
        this.ktx2Loader.detectSupport(this.renderer);
      } else if (typeof document !== 'undefined') {
        try {
          const canvas = document.createElement('canvas');
          const tempRenderer = new THREE.WebGLRenderer({ canvas });
          this.ktx2Loader.detectSupport(tempRenderer);
          tempRenderer.dispose();
        } catch (e) {
          console.warn('KTX2Loader: Failed to auto-detect WebGL compressed texture support', e);
        }
      }
    }
    return this.ktx2Loader;
  }

  /**
   * Internal helper to construct configured GLTFLoader
   */
  private createGLTFLoader(loadingManager?: THREE.LoadingManager): GLTFLoader {
    const gltfLoader = new GLTFLoader(loadingManager);
    gltfLoader.setDRACOLoader(this.getDracoLoader());
    gltfLoader.setKTX2Loader(this.getKTX2Loader());
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    return gltfLoader;
  }

  /**
   * Load model from a ZIP file containing .glb, .gltf, or .obj + textures
   */
  public async loadZip(
    source: File | Blob | ArrayBuffer | string,
    onProgress?: (percent: number, message: string) => void
  ): Promise<ModelLoadResult> {
    this.cleanup();

    const zipContent = await ZipExtractor.extract(source, onProgress);
    this.currentZipContent = zipContent;

    if (zipContent.format === 'glb' || zipContent.format === 'gltf') {
      onProgress?.(70, '正在解析 GLTF/GLB 网格结构与材质贴图...');
      const gltfLoader = this.createGLTFLoader(zipContent.loadingManager);
      const gltfData = zipContent.gltfContent!;

      const gltf: GLTF = await new Promise((resolve, reject) => {
        gltfLoader.parse(
          gltfData,
          '',
          (result) => resolve(result),
          (error) => reject(error)
        );
      });

      onProgress?.(88, '正在建立空间 BVH 加速结构与几何居中...');
      const result = this.postProcessModel(gltf.scene, gltf.animations, zipContent.format);

      onProgress?.(100, '加载完成');
      return result;
    }

    // Default: OBJ format in ZIP
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
    const result = this.postProcessModel(modelGroup, [], 'obj');

    onProgress?.(100, '加载完成');
    return result;
  }

  /**
   * Load GLTF / GLB model from URL or ArrayBuffer
   */
  public async loadGLTF(
    source: string | ArrayBuffer,
    loadingManager?: THREE.LoadingManager,
    onProgress?: (percent: number, message: string) => void
  ): Promise<ModelLoadResult> {
    this.cleanup();
    const gltfLoader = this.createGLTFLoader(loadingManager);

    let gltf: GLTF;
    const isGlb = typeof source === 'string' ? /\.glb(\?.*)?$/i.test(source) : false;

    if (typeof source === 'string') {
      onProgress?.(30, '正在请求 GLTF/GLB 模型数据...');
      gltf = await gltfLoader.loadAsync(source, (xhr) => {
        if (xhr.lengthComputable && xhr.total > 0) {
          const p = Math.round(30 + (xhr.loaded / xhr.total) * 50);
          onProgress?.(p, `正在传输模型数据 (${Math.round((xhr.loaded / xhr.total) * 100)}%)...`);
        }
      });
    } else {
      onProgress?.(60, '正在解析 GLTF/GLB 二进制数据流...');
      gltf = await new Promise((resolve, reject) => {
        gltfLoader.parse(
          source,
          '',
          (result) => resolve(result),
          (error) => reject(error)
        );
      });
    }

    onProgress?.(88, '正在建立空间 BVH 加速结构与几何居中...');
    const result = this.postProcessModel(gltf.scene, gltf.animations, isGlb ? 'glb' : 'gltf');
    onProgress?.(100, '加载完成');
    return result;
  }

  /**
   * Load standalone GLB binary model from File, Blob, ArrayBuffer, or online URL
   */
  public async loadGLB(
    source: string | ArrayBuffer | Blob | File,
    onProgress?: (percent: number, message: string) => void
  ): Promise<ModelLoadResult> {
    if (source instanceof Blob || source instanceof File) {
      const buffer = await source.arrayBuffer();
      return this.loadGLTF(buffer, undefined, onProgress);
    }
    return this.loadGLTF(source, undefined, onProgress);
  }

  /**
   * Load model directly from OBJ and optional MTL URLs
   */
  public async loadOBJ(
    objUrl: string,
    mtlUrl?: string,
    loadingManager?: THREE.LoadingManager,
    onProgress?: (percent: number, message: string) => void
  ): Promise<ModelLoadResult> {
    this.cleanup();

    onProgress?.(20, '正在加载材质定义...');
    let materialsCreator: MTLLoader.MaterialCreator | null = null;
    if (mtlUrl) {
      const mtlLoader = new MTLLoader(loadingManager);
      materialsCreator = await mtlLoader.loadAsync(mtlUrl);
      materialsCreator.preload();
    }

    onProgress?.(50, '正在加载 OBJ 模型几何数据...');
    const objLoader = new OBJLoader(loadingManager);
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
    const result = this.postProcessModel(modelGroup, [], 'obj');

    onProgress?.(100, '加载完成');
    return result;
  }

  /**
   * Intelligently load multiple user-selected files or drag-dropped files
   * (Supports .zip, .glb, .gltf + companion .bin / textures, .obj + .mtl / textures)
   */
  public async loadFiles(
    fileList: FileList | File[],
    onProgress?: (percent: number, message: string) => void
  ): Promise<ModelLoadResult> {
    const files = Array.from(fileList);
    if (files.length === 0) {
      throw new Error('未选择任何文件');
    }

    const zipFile = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
    if (zipFile) {
      return this.loadZip(zipFile, onProgress);
    }

    const glbFile = files.find((f) => f.name.toLowerCase().endsWith('.glb'));
    if (glbFile) {
      return this.loadGLB(glbFile, onProgress);
    }

    const gltfFile = files.find((f) => f.name.toLowerCase().endsWith('.gltf'));
    if (gltfFile) {
      onProgress?.(15, '正在建立 GLTF 关联资源映射表...');
      const blobUrls = new Map<string, string>();
      for (const file of files) {
        const url = URL.createObjectURL(file);
        this.customBlobUrls.push(url);
        blobUrls.set(file.name, url);
        blobUrls.set(file.name.toLowerCase(), url);
      }

      const loadingManager = new THREE.LoadingManager();
      loadingManager.setURLModifier((url: string) => {
        const cleanUrl = decodeURIComponent(url).replace(/^\.\//, '');
        const baseName = cleanUrl.split('/').pop()?.split('\\').pop() || cleanUrl;
        if (blobUrls.has(url)) return blobUrls.get(url)!;
        if (blobUrls.has(cleanUrl)) return blobUrls.get(cleanUrl)!;
        if (blobUrls.has(baseName)) return blobUrls.get(baseName)!;

        const lowerBase = baseName.toLowerCase();
        for (const [key, blobUrl] of blobUrls.entries()) {
          if (key.toLowerCase() === lowerBase || key.toLowerCase().endsWith('/' + lowerBase)) {
            return blobUrl;
          }
        }
        return url;
      });

      const gltfText = await gltfFile.text();
      return this.loadGLTF(gltfText, loadingManager, onProgress);
    }

    const objFile = files.find((f) => f.name.toLowerCase().endsWith('.obj'));
    if (objFile) {
      const mtlFile = files.find((f) => f.name.toLowerCase().endsWith('.mtl'));
      const blobUrls = new Map<string, string>();
      for (const file of files) {
        const url = URL.createObjectURL(file);
        this.customBlobUrls.push(url);
        blobUrls.set(file.name, url);
        blobUrls.set(file.name.toLowerCase(), url);
      }

      const loadingManager = new THREE.LoadingManager();
      loadingManager.setURLModifier((url: string) => {
        const cleanUrl = decodeURIComponent(url).replace(/^\.\//, '');
        const baseName = cleanUrl.split('/').pop()?.split('\\').pop() || cleanUrl;
        if (blobUrls.has(url)) return blobUrls.get(url)!;
        if (blobUrls.has(cleanUrl)) return blobUrls.get(cleanUrl)!;
        if (blobUrls.has(baseName)) return blobUrls.get(baseName)!;

        const lowerBase = baseName.toLowerCase();
        for (const [key, blobUrl] of blobUrls.entries()) {
          if (key.toLowerCase() === lowerBase || key.toLowerCase().endsWith('/' + lowerBase)) {
            return blobUrl;
          }
        }
        return url;
      });

      const objUrl = blobUrls.get(objFile.name)!;
      const mtlUrl = mtlFile ? blobUrls.get(mtlFile.name) : undefined;
      return this.loadOBJ(objUrl, mtlUrl, loadingManager, onProgress);
    }

    throw new Error('未识别到支持的 3D 模型文件（请提供 .glb, .gltf, .obj 或 .zip 格式）');
  }

  /**
   * Post-process loaded model:
   * - Build BVH acceleration trees on all meshes
   * - Count vertices & faces
   * - Cache original materials and prepare clay/white-model materials
   * - Center model without breaking hierarchy/animations via a root group
   */
  public postProcessModel(
    group: THREE.Group,
    animations?: THREE.AnimationClip[],
    format: 'obj' | 'gltf' | 'glb' | 'sample' = 'obj'
  ): ModelLoadResult {
    let vertexCount = 0;
    let faceCount = 0;
    this.managedMaterials = [];

    const enhanceTexture = (tex: THREE.Texture | null, isColor: boolean = true) => {
      if (tex) {
        tex.anisotropy = 16;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        if (isColor && !tex.colorSpace) {
          tex.colorSpace = THREE.SRGBColorSpace;
        }
        tex.needsUpdate = true;
      }
    };

    // Helper to ensure materials are visible, sharp and two-sided
    const ensureVisibleMaterial = (mat: THREE.Material) => {
      mat.side = THREE.DoubleSide; // Avoid invisible back faces due to inverted normals
      mat.needsUpdate = true;

      if ('color' in mat) {
        const m = mat as THREE.MeshStandardMaterial;
        enhanceTexture(m.map, true);
        if ('emissiveMap' in m) enhanceTexture(m.emissiveMap, true);
        if ('normalMap' in m) enhanceTexture(m.normalMap, false);
        if ('bumpMap' in m) enhanceTexture(m.bumpMap, false);
        if ('roughnessMap' in m) enhanceTexture(m.roughnessMap, false);
        if ('metalnessMap' in m) enhanceTexture(m.metalnessMap, false);
        if ('aoMap' in m) enhanceTexture(m.aoMap, false);

        // If diffuse color is black or very dark without texture (common in OBJ/MTL missing illumination), brighten it
        if (format === 'obj' && !m.map && m.color && m.color.getHex() < 0x222222) {
          m.color.setHex(0xb0b8c4);
        }
      }
    };

    // 1. Initial pass: calculate original bounds and center in group's initial state
    group.updateMatrixWorld(true);
    const initialBox = new THREE.Box3().setFromObject(group);
    const origCenter = new THREE.Vector3();
    const origSize = new THREE.Vector3();
    initialBox.getCenter(origCenter);
    initialBox.getSize(origSize);

    // 2. Process meshes and ensure materials
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

    // 3. Center model without destructively modifying vertex buffers (protects GLTF skinning & animations)
    const rootGroup = new THREE.Group();
    rootGroup.name = 'gmv-model-root';
    group.position.set(-origCenter.x, -origCenter.y, -origCenter.z);
    rootGroup.add(group);
    rootGroup.updateMatrixWorld(true);

    // Compute updated bounding box (centered at 0,0,0)
    const box = new THREE.Box3().setFromObject(rootGroup);

    return {
      model: rootGroup,
      box,
      size: origSize,
      center: origCenter,
      vertexCount,
      faceCount: Math.round(faceCount),
      animations: animations || [],
      format,
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

    if (this.customBlobUrls.length > 0) {
      this.customBlobUrls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      this.customBlobUrls = [];
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

  /**
   * Complete destruction of loader and transcoders
   */
  public destroy(): void {
    this.cleanup();
    if (this.dracoLoader) {
      this.dracoLoader.dispose();
      this.dracoLoader = null;
    }
    if (this.ktx2Loader) {
      this.ktx2Loader.dispose();
      this.ktx2Loader = null;
    }
  }
}
