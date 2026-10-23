import * as THREE from 'three';
import { ExportImageOptions } from '../types';

export class ScreenshotTool {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private getModel: () => THREE.Object3D | null;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    getModel?: () => THREE.Object3D | null
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.getModel = getModel || (() => null);
  }

  /**
   * Finds the maximum original texture resolution from meshes in the scene
   */
  public getSceneMaxTextureSize(): { width: number; height: number } | null {
    let maxWidth = 0;
    let maxHeight = 0;

    this.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const checkMat = (mat: THREE.Material) => {
          if ('map' in mat) {
            const m = mat as THREE.MeshStandardMaterial;
            if (m.map) {
              const img = (m.map.image || (m.map.source as unknown as { data?: { width?: number; height?: number } })?.data) as
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

        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(checkMat);
        } else if (mesh.material) {
          checkMat(mesh.material);
        }
      }
    });

    if (maxWidth > 0 && maxHeight > 0) {
      return { width: maxWidth, height: maxHeight };
    }
    return null;
  }

  /**
   * Exports high-definition screenshot of the current view.
   * Supports 'original' / originalQuality which aligns directly to the model's actual texture resolution!
   */
  public async exportImage(options: ExportImageOptions = {}): Promise<string> {
    const isOriginal = options.originalQuality === true || options.scale === 'original';
    const scale = isOriginal ? 1 : (typeof options.scale === 'number' ? options.scale : 2);
    const type = options.type ?? 'image/png';
    const quality = options.quality ?? (type === 'image/png' ? 1 : 0.95);
    const download = options.download ?? false;

    // 1. Record original dimensions
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);
    const originalPixelRatio = this.renderer.getPixelRatio();
    const originalBackground = this.scene.background;

    const aspect = originalSize.x / originalSize.y;
    let targetWidth: number;
    let targetHeight: number;

    if (options.targetSize) {
      targetWidth = options.targetSize.width;
      targetHeight = options.targetSize.height;
    } else if (isOriginal) {
      // 原画质导出：按照模型实际贴图的真实原始尺寸计算输出分辨率
      const texSize = this.getSceneMaxTextureSize();
      if (texSize && texSize.width > 0 && texSize.height > 0) {
        const maxDim = Math.max(texSize.width, texSize.height);
        if (aspect >= 1) {
          targetWidth = maxDim;
          targetHeight = Math.round(maxDim / aspect);
        } else {
          targetHeight = maxDim;
          targetWidth = Math.round(maxDim * aspect);
        }
      } else {
        // 若无贴图，回退至高质量分辨率 (至少 2048)
        const baseDim = Math.max(Math.round(originalSize.x * originalPixelRatio), 2048);
        if (aspect >= 1) {
          targetWidth = baseDim;
          targetHeight = Math.round(baseDim / aspect);
        } else {
          targetHeight = baseDim;
          targetWidth = Math.round(baseDim * aspect);
        }
      }
    } else {
      targetWidth = Math.round(originalSize.x * scale);
      targetHeight = Math.round(originalSize.y * scale);
    }

    const filename = options.filename ?? `model-${isOriginal ? `texture-original-${targetWidth}x${targetHeight}` : `${scale}x`}-${Date.now()}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
    const modelOnly = options.modelOnly ?? true;

    // Track objects hidden during export
    const hiddenObjects: { obj: THREE.Object3D; wasVisible: boolean }[] = [];

    // Apply custom background if specified
    if (options.background !== undefined) {
      if (options.background === null) {
        this.scene.background = null;
        this.renderer.setClearAlpha(0);
      } else {
        this.scene.background = new THREE.Color(options.background);
        this.renderer.setClearAlpha(1);
      }
    }

    try {
      // If modelOnly is requested (default: true), hide all auxiliary scene objects (grid, bbox, measurements, clipping planes/helpers)
      if (modelOnly) {
        const currentModel = this.getModel();
        const isKeep = (obj: THREE.Object3D): boolean => {
          // Keep all lights and light groups so model illumination is preserved
          if ((obj as any).isLight) return true;
          if (obj.name === 'gmv-lights-group') return true;
          if (obj.children && obj.children.some((c: any) => c.isLight)) return true;

          // Keep the current model
          if (currentModel && (obj === currentModel || obj.uuid === currentModel.uuid)) return true;
          if (obj.name === 'gmv-current-model') return true;

          // Hide all other scene-level helpers/measurements/grids/planes
          return false;
        };

        for (const child of this.scene.children) {
          if (!isKeep(child) && child.visible) {
            hiddenObjects.push({ obj: child, wasVisible: true });
            child.visible = false;
          }
        }
      }

      this.renderer.setPixelRatio(1);
      this.renderer.setSize(targetWidth, targetHeight, false);
      this.camera.aspect = targetWidth / targetHeight;
      this.camera.updateProjectionMatrix();

      // Scale any fixed-screen-size markers proportionally to the target high-res height
      const vFovRad = (this.camera.fov * Math.PI) / 180;
      const camPos = this.camera.position;
      const tanHalfFov = Math.tan(vFovRad / 2);
      this.scene.traverse((obj) => {
        if (obj.userData && typeof obj.userData.fixedScreenRadius === 'number') {
          const radiusPx = obj.userData.fixedScreenRadius;
          const worldPos = new THREE.Vector3();
          obj.getWorldPosition(worldPos);
          const dist = worldPos.distanceTo(camPos);
          const worldRadius = (2 * dist * tanHalfFov * radiusPx) / Math.max(targetHeight, 1);
          obj.scale.setScalar(worldRadius);
        }
      });

      // Render crisp frame
      this.renderer.render(this.scene, this.camera);

      // Extract data URL
      const dataUrl = this.renderer.domElement.toDataURL(type, quality);

      // 3. Trigger download if requested
      if (download) {
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      return dataUrl;
    } finally {
      // Restore any auxiliary objects that were hidden for model-only export
      if (hiddenObjects.length > 0) {
        for (const { obj, wasVisible } of hiddenObjects) {
          obj.visible = wasVisible;
        }
      }

      // 4. Restore original renderer and camera setup
      this.scene.background = originalBackground;
      this.renderer.setPixelRatio(originalPixelRatio);
      this.renderer.setSize(originalSize.x, originalSize.y, true);
      this.camera.aspect = originalSize.x / originalSize.y;
      this.camera.updateProjectionMatrix();

      // Restore markers for original screen height
      const origH = originalSize.y;
      const vFovRad = (this.camera.fov * Math.PI) / 180;
      const camPos = this.camera.position;
      const tanHalfFov = Math.tan(vFovRad / 2);
      this.scene.traverse((obj) => {
        if (obj.userData && typeof obj.userData.fixedScreenRadius === 'number') {
          const radiusPx = obj.userData.fixedScreenRadius;
          const worldPos = new THREE.Vector3();
          obj.getWorldPosition(worldPos);
          const dist = worldPos.distanceTo(camPos);
          const worldRadius = (2 * dist * tanHalfFov * radiusPx) / Math.max(origH, 1);
          obj.scale.setScalar(worldRadius);
        }
      });

      this.renderer.render(this.scene, this.camera);
    }
  }
}
