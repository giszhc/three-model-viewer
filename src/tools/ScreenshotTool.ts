import * as THREE from 'three';
import { ExportImageOptions } from '../types';

export class ScreenshotTool {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
  }

  /**
   * Exports high-definition screenshot of the current view
   */
  public async exportImage(options: ExportImageOptions = {}): Promise<string> {
    const scale = options.scale ?? 2;
    const type = options.type ?? 'image/png';
    const quality = options.quality ?? 0.95;
    const download = options.download ?? false;
    const filename = options.filename ?? `model-render-${Date.now()}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;

    // 1. Record original dimensions
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);
    const originalPixelRatio = this.renderer.getPixelRatio();
    const originalBackground = this.scene.background;

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
      // 2. Temporarily set higher resolution
      const targetWidth = Math.round(originalSize.x * scale);
      const targetHeight = Math.round(originalSize.y * scale);

      this.renderer.setPixelRatio(1);
      this.renderer.setSize(targetWidth, targetHeight, false);
      this.camera.aspect = targetWidth / targetHeight;
      this.camera.updateProjectionMatrix();

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
      // 4. Restore original renderer and camera setup
      this.scene.background = originalBackground;
      this.renderer.setPixelRatio(originalPixelRatio);
      this.renderer.setSize(originalSize.x, originalSize.y, true);
      this.camera.aspect = originalSize.x / originalSize.y;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
    }
  }
}
