import JSZip from 'jszip';
import * as THREE from 'three';

export interface ExtractedZipContent {
  objContent: string | ArrayBuffer;
  objFileName: string;
  mtlContent: string | null;
  mtlFileName: string | null;
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

    onProgress?.(5, '正在读取文件字节流...');

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

    let objZipEntry: JSZip.JSZipObject | null = null;
    let mtlZipEntry: JSZip.JSZipObject | null = null;

    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tga', '.dds'];

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
      const currentPercent = Math.round(20 + (i / totalFiles) * 35); // 20% -> 55%

      // Find OBJ file (prefer top-level or first found)
      if (lower.endsWith('.obj') && !objZipEntry) {
        objZipEntry = entry;
        onProgress?.(currentPercent, `找到模型文件: ${filename.split('/').pop()}`);
      } else if (lower.endsWith('.mtl') && !mtlZipEntry) {
        mtlZipEntry = entry;
        onProgress?.(currentPercent, `找到材质定义: ${filename.split('/').pop()}`);
      }

      // Check for image textures
      const isImage = imageExtensions.some((ext) => lower.endsWith(ext));
      if (isImage) {
        const baseName = filename.split('/').pop() || filename;
        onProgress?.(currentPercent, `加载贴图: ${baseName}`);
        const blob = await entry.async('blob');
        const objectUrl = URL.createObjectURL(blob);
        // Store full path, simple filename, and lowercase versions for robust lookup
        blobUrls.set(filename, objectUrl);
        blobUrls.set(baseName, objectUrl);
        blobUrls.set(baseName.toLowerCase(), objectUrl);
      }
    }

    onProgress?.(60, '提取完成，准备解析三维几何网格...');

    if (!objZipEntry) {
      // Clean up created URLs if no OBJ found
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
      throw new Error('No .obj file found in the zip archive.');
    }

    const objContent = await objZipEntry.async('string');
    const objFileName = objZipEntry.name;

    let mtlContent: string | null = null;
    let mtlFileName: string | null = null;

    if (mtlZipEntry) {
      mtlContent = await mtlZipEntry.async('string');
      mtlFileName = mtlZipEntry.name;
    }

    // 2. Setup Three.js LoadingManager to intercept and resolve texture URLs
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((url: string) => {
      // Decode URL if encoded
      const cleanUrl = decodeURIComponent(url);
      const baseName = cleanUrl.split('/').pop()?.split('\\').pop() || cleanUrl;

      if (blobUrls.has(cleanUrl)) {
        return blobUrls.get(cleanUrl)!;
      }
      if (blobUrls.has(baseName)) {
        return blobUrls.get(baseName)!;
      }

      // Case-insensitive fallback
      for (const [key, blobUrl] of blobUrls.entries()) {
        if (key.toLowerCase() === baseName.toLowerCase()) {
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
      objContent,
      objFileName,
      mtlContent,
      mtlFileName,
      blobUrls,
      loadingManager,
      dispose,
    };
  }
}
