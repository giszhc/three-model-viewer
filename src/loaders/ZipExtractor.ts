import JSZip from 'jszip';
import * as THREE from 'three';

export interface ExtractedZipContent {
  format: 'obj' | 'gltf' | 'glb';
  objContent?: string | ArrayBuffer;
  objFileName?: string;
  mtlContent?: string | null;
  mtlFileName?: string | null;
  gltfContent?: string | ArrayBuffer;
  gltfFileName?: string;
  blobUrls: Map<string, string>;
  loadingManager: THREE.LoadingManager;
  dispose: () => void;
}

export type ProgressCallback = (percent: number, message: string) => void;

export class ZipExtractor {
  public static async extract(
    source: File | Blob | ArrayBuffer | string,
    onProgress?: ProgressCallback
  ): Promise<ExtractedZipContent> {
    let arrayBuffer: ArrayBuffer;

    onProgress?.(5, '正在读取压缩包文件流...');

    if (typeof source === 'string') {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Failed to fetch zip file: ${response.statusText}`);
      }
      arrayBuffer = await response.arrayBuffer();
    } else if (source instanceof Blob || source instanceof File) {
      arrayBuffer = await source.arrayBuffer();
    } else {
      arrayBuffer = source;
    }

    onProgress?.(15, '正在解压 ZIP 文件包...');
    const zip = await JSZip.loadAsync(arrayBuffer);
    const blobUrls = new Map<string, string>();

    let glbZipEntry: JSZip.JSZipObject | null = null;
    let gltfZipEntry: JSZip.JSZipObject | null = null;
    let objZipEntry: JSZip.JSZipObject | null = null;
    let mtlZipEntry: JSZip.JSZipObject | null = null;

    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tga', '.dds', '.hdr', '.svg', '.ktx2'];

    // 1. Identify files in ZIP
    const files = Object.keys(zip.files);
    const totalFiles = files.length || 1;

    for (let i = 0; i < files.length; i++) {
      const filename = files[i];
      const entry = zip.files[filename];
      if (entry.dir) continue;

      // Filter out Mac / system hidden files
      if (filename.includes('__MACOSX') || filename.split('/').pop()?.startsWith('._')) {
        continue;
      }

      const lower = filename.toLowerCase();
      const baseName = filename.split('/').pop() || filename;
      const currentPercent = Math.round(20 + (i / totalFiles) * 35); // 20% -> 55%

      // Model formats detection (GLB / GLTF / OBJ / MTL)
      if (lower.endsWith('.glb') && !glbZipEntry) {
        glbZipEntry = entry;
        onProgress?.(currentPercent, `找到 GLB 二进制模型: ${baseName}`);
      } else if (lower.endsWith('.gltf') && !gltfZipEntry) {
        gltfZipEntry = entry;
        onProgress?.(currentPercent, `找到 GLTF 场景定义: ${baseName}`);
      } else if (lower.endsWith('.obj') && !objZipEntry) {
        objZipEntry = entry;
        onProgress?.(currentPercent, `找到 OBJ 网格模型: ${baseName}`);
      } else if (lower.endsWith('.mtl') && !mtlZipEntry) {
        mtlZipEntry = entry;
        onProgress?.(currentPercent, `找到 MTL 材质定义: ${baseName}`);
      }

      // Buffer bin files for GLTF
      if (lower.endsWith('.bin')) {
        onProgress?.(currentPercent, `加载二进制缓冲区: ${baseName}`);
        const blob = await entry.async('blob');
        const objectUrl = URL.createObjectURL(blob);
        blobUrls.set(filename, objectUrl);
        blobUrls.set(baseName, objectUrl);
        blobUrls.set(baseName.toLowerCase(), objectUrl);
      }

      // Check for image textures
      const isImage = imageExtensions.some((ext) => lower.endsWith(ext));
      if (isImage) {
        onProgress?.(currentPercent, `加载贴图资源: ${baseName}`);
        const blob = await entry.async('blob');
        const objectUrl = URL.createObjectURL(blob);
        blobUrls.set(filename, objectUrl);
        blobUrls.set(baseName, objectUrl);
        blobUrls.set(baseName.toLowerCase(), objectUrl);
      }
    }

    onProgress?.(60, 'ZIP 资源索引提取完毕，准备解析三维模型网格...');

    // Priority: GLB > GLTF > OBJ
    let format: 'obj' | 'gltf' | 'glb';
    if (glbZipEntry) {
      format = 'glb';
    } else if (gltfZipEntry) {
      format = 'gltf';
    } else if (objZipEntry) {
      format = 'obj';
    } else {
      // Clean up created URLs if no model found
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
      throw new Error('ZIP 压缩包中未检测到支持的 3D 模型文件（需要包含 .glb, .gltf 或 .obj 文件）');
    }

    let objContent: string | ArrayBuffer | undefined;
    let objFileName: string | undefined;
    let mtlContent: string | null = null;
    let mtlFileName: string | null = null;
    let gltfContent: string | ArrayBuffer | undefined;
    let gltfFileName: string | undefined;

    if (format === 'glb') {
      gltfContent = await glbZipEntry!.async('arraybuffer');
      gltfFileName = glbZipEntry!.name;
    } else if (format === 'gltf') {
      gltfContent = await gltfZipEntry!.async('string');
      gltfFileName = gltfZipEntry!.name;
    } else {
      objContent = await objZipEntry!.async('string');
      objFileName = objZipEntry!.name;
      if (mtlZipEntry) {
        mtlContent = await mtlZipEntry.async('string');
        mtlFileName = mtlZipEntry.name;
      }
    }

    // Setup Three.js LoadingManager to intercept and resolve binary/texture URLs
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((url: string) => {
      const cleanUrl = decodeURIComponent(url).replace(/^\.\//, '');
      const baseName = cleanUrl.split('/').pop()?.split('\\').pop() || cleanUrl;

      if (blobUrls.has(url)) return blobUrls.get(url)!;
      if (blobUrls.has(cleanUrl)) return blobUrls.get(cleanUrl)!;
      if (blobUrls.has(baseName)) return blobUrls.get(baseName)!;

      // Case-insensitive fallback
      const lowerBase = baseName.toLowerCase();
      for (const [key, blobUrl] of blobUrls.entries()) {
        if (key.toLowerCase() === lowerBase || key.toLowerCase().endsWith('/' + lowerBase)) {
          return blobUrl;
        }
      }

      return url;
    });

    const dispose = () => {
      blobUrls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      blobUrls.clear();
    };

    return {
      format,
      objContent,
      objFileName,
      mtlContent,
      mtlFileName,
      gltfContent,
      gltfFileName,
      blobUrls,
      loadingManager,
      dispose,
    };
  }
}
