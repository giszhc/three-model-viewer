import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import * as TWEEN from '@tweenjs/tween.js';
import { ViewerOptions } from '../types';

export class SceneManager {
  public container: HTMLElement;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public labelRenderer: CSS2DRenderer;
  public controls: TrackballControls | OrbitControls;
  public lightsGroup: THREE.Group;
  public gridHelper: THREE.GridHelper;
  public tweenGroup: TWEEN.Group;
  public onBeforeRender?: () => void;

  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isDestroyed: boolean = false;

  constructor(options: ViewerOptions) {
    this.container = options.container;

    // 1. Scene
    this.scene = new THREE.Scene();
    if (options.background !== undefined && options.background !== null) {
      if (typeof options.background === 'string' || typeof options.background === 'number') {
        this.scene.background = new THREE.Color(options.background);
      }
    } else {
      this.scene.background = new THREE.Color(0x181c24); // Modern dark slate
    }

    // 2. Camera
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(
      options.cameraFov ?? 45,
      width / height,
      options.cameraNear ?? 0.1,
      options.cameraFar ?? 5000
    );
    this.camera.position.set(10, 10, 10);

    // 3. WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: options.antialias ?? true,
      alpha: options.alpha ?? false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true; // Crucial for slicing tool
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    // 4. CSS2D Label Renderer (for measurements & dimensions)
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(width, height);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.labelRenderer.domElement.style.width = '100%';
    this.labelRenderer.domElement.style.height = '100%';
    this.labelRenderer.domElement.className = 'gmv-css2d-container';
    this.container.appendChild(this.labelRenderer.domElement);

    // 5. Controls: TrackballControls gives infinite unconstrained 360° rotation without pole limits
    const controlsType = options.controlsType ?? 'trackball';
    if (controlsType === 'orbit') {
      const orbit = new OrbitControls(this.camera, this.renderer.domElement);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.05;
      orbit.screenSpacePanning = true;
      this.controls = orbit;
    } else {
      const tb = new TrackballControls(this.camera, this.renderer.domElement);
      tb.rotateSpeed = 2.5;
      tb.zoomSpeed = 1.2;
      tb.panSpeed = 0.8;
      tb.staticMoving = false;
      tb.dynamicDampingFactor = 0.15;
      this.controls = tb;
    }

    // 6. Tween Group
    this.tweenGroup = new TWEEN.Group();

    // 7. Lighting System
    this.lightsGroup = new THREE.Group();
    this.lightsGroup.name = 'gmv-lights-group';
    this.initLights();
    this.scene.add(this.lightsGroup);

    // 8. Grid Helper
    this.gridHelper = new THREE.GridHelper(50, 50, 0x4a5568, 0x2d3748);
    this.gridHelper.name = 'gmv-grid-helper';
    this.gridHelper.position.y = 0;
    this.gridHelper.visible = false;
    this.scene.add(this.gridHelper);

    // 9. Event listeners & Resize
    this.initResizeObserver();
    this.startAnimationLoop();

    // Ensure immediate crisp sizing once DOM layout settles
    requestAnimationFrame(() => this.handleResize());
    setTimeout(() => this.handleResize(), 50);
  }

  private initLights(): void {
    // 1. Hemisphere Light & Ambient Light for all-around illumination
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x475569, 1.0);
    hemiLight.position.set(0, 50, 0);
    this.lightsGroup.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.lightsGroup.add(ambientLight);

    // 2. Multi-angle Key/Fill lights
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(50, 100, 50);
    this.lightsGroup.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight2.position.set(-50, 50, -50);
    this.lightsGroup.add(dirLight2);

    // 3. Headlight attached to camera (always illuminates the view from camera!)
    const headlight = new THREE.DirectionalLight(0xffffff, 0.9);
    headlight.position.set(0, 0, 1);
    this.camera.add(headlight);
    this.scene.add(this.camera);
  }

  private initResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
    });
    this.resizeObserver.observe(this.container);
  }

  public handleResize(): void {
    if (this.isDestroyed || !this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);

    if ('handleResize' in this.controls && typeof (this.controls as unknown as { handleResize: () => void }).handleResize === 'function') {
      (this.controls as unknown as { handleResize: () => void }).handleResize();
    }
  }

  private startAnimationLoop(): void {
    const animate = () => {
      if (this.isDestroyed) return;

      this.animationFrameId = requestAnimationFrame(animate);

      // Update Tween animations
      this.tweenGroup.update();

      // Update Controls
      this.controls.update();

      // Hook before render (e.g. dynamic bounding box edge selection)
      if (this.onBeforeRender) {
        this.onBeforeRender();
      }

      // Render 3D and 2D Label Scenes
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  public setBackground(color: string | number | null, alpha?: boolean): void {
    if (alpha) {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
    } else if (color === null || color === undefined) {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
    } else {
      this.scene.background = new THREE.Color(color);
      this.renderer.setClearAlpha(1);
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.controls.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    if (this.labelRenderer.domElement.parentElement) {
      this.labelRenderer.domElement.parentElement.removeChild(this.labelRenderer.domElement);
    }
  }
}
