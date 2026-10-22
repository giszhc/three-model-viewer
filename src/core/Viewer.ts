import * as THREE from 'three';
import { SceneManager } from './SceneManager';
import { EventEmitter } from './EventEmitter';
import { ModelLoader } from '../loaders/ModelLoader';
import { BoundingBoxTool } from '../tools/BoundingBoxTool';
import { CameraTool } from '../tools/CameraTool';
import { ClippingTool } from '../tools/ClippingTool';
import { MeasurementTool } from '../tools/MeasurementTool';
import { ScreenshotTool } from '../tools/ScreenshotTool';
import {
  ViewerOptions,
  ModelLoadResult,
  MeasurementType,
  MeasurementResult,
  ClippingAxis,
  CameraView,
  ExportImageOptions,
  BoundingBoxOptions,
  ViewerEvents,
  AutoRotateAxis,
  AutoRotateDirection,
  AutoRotateOptions,
  RotationLockAxis,
  ModelDisplayStyle,
} from '../types';

export class Viewer extends EventEmitter {
  public sceneManager: SceneManager;
  public modelLoader: ModelLoader;
  public boundingBoxTool: BoundingBoxTool;
  public cameraTool: CameraTool;
  public clippingTool: ClippingTool;
  public measurementTool: MeasurementTool;
  public screenshotTool: ScreenshotTool;

  public currentModel: THREE.Group | null = null;
  public currentModelInfo: ModelLoadResult | null = null;
  private unit: string = 'm';

  constructor(options: ViewerOptions) {
    super();

    this.unit = options.unit || 'm';

    // 1. Core Scene Manager
    this.sceneManager = new SceneManager(options);

    // 2. Model Loader
    this.modelLoader = new ModelLoader();

    // 3. Tools
    this.boundingBoxTool = new BoundingBoxTool(this.sceneManager.scene);
    this.cameraTool = new CameraTool(
      this.sceneManager.camera,
      this.sceneManager.controls,
      this.sceneManager.tweenGroup
    );
    this.clippingTool = new ClippingTool(
      this.sceneManager.scene,
      this.sceneManager.camera,
      this.sceneManager.container,
      this.modelLoader,
      this.sceneManager.controls,
      this
    );
    this.measurementTool = new MeasurementTool(
      this.sceneManager.scene,
      this.sceneManager.camera,
      this.sceneManager.container,
      this.modelLoader,
      this,
      this.sceneManager.controls
    );
    this.measurementTool.setUnit(this.unit);

    this.screenshotTool = new ScreenshotTool(
      this.sceneManager.renderer,
      this.sceneManager.scene,
      this.sceneManager.camera
    );

    // Forward internal measurement events
    this.measurementTool.setUnit(this.unit);

    // Dynamic per-frame updates: track bounding box edges and update auto-rotation/axis lock
    this.sceneManager.onBeforeRender = () => {
      this.boundingBoxTool.update(this.sceneManager.camera);
      this.cameraTool.updatePerFrame();
    };
  }

  // ==========================================
  // Model Loading
  // ==========================================

  /**
   * Load model from a ZIP file containing .obj, .mtl and textures
   */
  public async loadZip(source: File | Blob | ArrayBuffer | string): Promise<ModelLoadResult> {
    try {
      this.emit('load:start', typeof source === 'string' ? source : 'ZIP File');
      this.clearModel();

      const onProgress = (percent: number, message: string) => {
        this.emit('load:progress', percent, message);
      };

      const result = await this.modelLoader.loadZip(source, onProgress);
      this.setupLoadedModel(result);
      this.emit('load:success', result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('load:error', error);
      throw error;
    }
  }

  /**
   * Load model directly from OBJ URL and optional MTL URL
   */
  public async loadOBJ(objUrl: string, mtlUrl?: string): Promise<ModelLoadResult> {
    try {
      this.emit('load:start', objUrl);
      this.clearModel();

      const onProgress = (percent: number, message: string) => {
        this.emit('load:progress', percent, message);
      };

      const result = await this.modelLoader.loadOBJ(objUrl, mtlUrl, onProgress);
      this.setupLoadedModel(result);
      this.emit('load:success', result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('load:error', error);
      throw error;
    }
  }

  /**
   * Loads a built-in sample geometry (convenient for immediate testing and demo playground)
   */
  public loadSampleGeometry(type: 'mechanical' | 'building' | 'torusKnot' = 'mechanical'): ModelLoadResult {
    this.clearModel();
    const group = new THREE.Group();

    if (type === 'mechanical') {
      // Create a mechanical-like assembly
      const baseGeom = new THREE.BoxGeometry(6, 1.2, 4);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
      const baseMesh = new THREE.Mesh(baseGeom, baseMat);
      baseMesh.position.y = 0.6;
      group.add(baseMesh);

      const cylinderGeom = new THREE.CylinderGeometry(1.2, 1.2, 3, 32);
      const cylinderMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.6, roughness: 0.2 });
      const cylMesh = new THREE.Mesh(cylinderGeom, cylinderMat);
      cylMesh.position.set(0, 2.7, 0);
      group.add(cylMesh);

      const ringGeom = new THREE.TorusGeometry(1.6, 0.25, 16, 40);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, metalness: 0.7, roughness: 0.2 });
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.set(0, 3.2, 0);
      group.add(ringMesh);
    } else if (type === 'building') {
      const bldgGeom = new THREE.BoxGeometry(4, 10, 4);
      const bldgMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 });
      const bldg = new THREE.Mesh(bldgGeom, bldgMat);
      bldg.position.y = 5;
      group.add(bldg);

      const roofGeom = new THREE.ConeGeometry(3, 2.5, 4);
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 });
      const roof = new THREE.Mesh(roofGeom, roofMat);
      roof.position.y = 11.25;
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
    } else {
      const torusGeom = new THREE.TorusKnotGeometry(2.5, 0.7, 100, 16);
      const torusMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, metalness: 0.5, roughness: 0.2 });
      const mesh = new THREE.Mesh(torusGeom, torusMat);
      mesh.position.y = 3;
      group.add(mesh);
    }

    const postProcessed = this.modelLoader.postProcessModel(group);
    this.setupLoadedModel(postProcessed);
    this.emit('load:success', postProcessed);
    return postProcessed;
  }

  private setupLoadedModel(result: ModelLoadResult): void {
    this.currentModel = result.model;
    this.currentModelInfo = result;

    this.sceneManager.scene.add(this.currentModel);

    // Attach dynamic dimensional bounding box
    this.boundingBoxTool.attachToModel(this.currentModel, {
      visible: true,
      unit: this.unit,
    });

    // Feed bounds to clipping tool
    this.clippingTool.setModelBounds(result.box);

    // Default view when model is loaded: Front View (前视图)
    this.cameraTool.setView('front', this.currentModel, 0);
  }

  public clearModel(): void {
    this.measurementTool.clearAll();
    this.clippingTool.resetAll();
    this.boundingBoxTool.detach();

    if (this.currentModel) {
      this.sceneManager.scene.remove(this.currentModel);
      this.currentModel = null;
    }
    this.currentModelInfo = null;
    this.modelLoader.cleanup();
  }

  // ==========================================
  // Appearance & Background
  // ==========================================

  public setBackground(color: string | number | null, alpha?: boolean): void {
    this.sceneManager.setBackground(color, alpha);
  }

  /**
   * Set model display style: 'solid' (实体), 'wireframe' (网格线框), 'points' (点云)
   */
  public setModelDisplayStyle(style: ModelDisplayStyle): void {
    this.modelLoader.setDisplayStyle(style);
    this.emit('style:change', style);
  }

  public getModelDisplayStyle(): ModelDisplayStyle {
    return this.modelLoader.getDisplayStyle();
  }

  /**
   * Set point size for point-cloud display style
   */
  public setPointSize(size: number): void {
    this.modelLoader.setPointSize(size);
    this.emit('pointsize:change', size);
  }

  public getPointSize(): number {
    return this.modelLoader.getPointSize();
  }

  public setPointColor(color: THREE.ColorRepresentation): void {
    this.modelLoader.setPointColor(color);
  }

  public toggleTexture(showTexture: boolean): void {
    this.modelLoader.toggleTexture(showTexture);
    this.emit('texture:toggle', showTexture);
  }

  public getTextureState(): boolean {
    return this.modelLoader.getTextureState();
  }

  public setGridVisible(visible: boolean): void {
    this.sceneManager.gridHelper.visible = visible;
  }

  // ==========================================
  // Bounding Box & Dimensions (L, W, H)
  // ==========================================

  public showBoundingBox(visible: boolean, options?: Partial<BoundingBoxOptions>): void {
    this.boundingBoxTool.setVisible(visible);
    if (options?.unit) {
      this.unit = options.unit;
      this.boundingBoxTool.setUnit(options.unit);
      this.measurementTool.setUnit(options.unit);
    }
  }

  public getBoundingBoxVisible(): boolean {
    return this.boundingBoxTool.getVisible();
  }

  /**
   * Rotate model around X, Y, or Z (radians).
   * Notice: The bounding box, dimension lines, and labels rotate WITH the model!
   */
  public rotateModel(rx: number = 0, ry: number = 0, rz: number = 0): void {
    if (!this.currentModel) return;
    this.currentModel.rotation.x += rx;
    this.currentModel.rotation.y += ry;
    this.currentModel.rotation.z += rz;
    this.currentModel.updateMatrixWorld(true);
  }

  // ==========================================
  // Slicing / Clipping Tools
  // ==========================================

  public setClipping(axis: ClippingAxis, progress: number, inverted: boolean = false): void {
    this.clippingTool.setAxisClipping(axis, progress, inverted);
  }

  public disableClippingAxis(axis: ClippingAxis): void {
    this.clippingTool.disableAxis(axis);
  }

  public toggleClippingAxis(axis: ClippingAxis, enabled?: boolean): boolean {
    return this.clippingTool.toggleAxis(axis, enabled);
  }

  public invertClippingAxis(axis: ClippingAxis): boolean {
    return this.clippingTool.invertAxis(axis);
  }

  public getClippingAxisState(axis: ClippingAxis) {
    return this.clippingTool.getAxisState(axis);
  }

  public setClippingPlanesVisible(visible: boolean): void {
    this.clippingTool.setPlanesVisible(visible);
  }

  public getClippingPlanesVisible(): boolean {
    return this.clippingTool.getPlanesVisible();
  }

  // Digital3DCloud Standard Multi-Axis Sectioning API
  public setSectioningEnabled(enabled: boolean): void {
    this.clippingTool.setSectioningEnabled(enabled);
  }

  public getSectioningEnabled(): boolean {
    return this.clippingTool.getSectioningEnabled();
  }

  public setSectioningAxis(axis: ClippingAxis): void {
    this.clippingTool.setSectioningAxis(axis);
  }

  public getSectioningAxis(): ClippingAxis {
    return this.clippingTool.getSectioningAxis();
  }

  public setSectioningAxisEnabled(axis: ClippingAxis, enabled: boolean): void {
    this.clippingTool.setAxisEnabled(axis, enabled);
  }

  public toggleSectioningAxis(axis: ClippingAxis, enabled?: boolean): boolean {
    return this.clippingTool.toggleAxis(axis, enabled);
  }

  public isSectioningAxisEnabled(axis: ClippingAxis): boolean {
    return this.clippingTool.isAxisEnabled(axis);
  }

  public setSectioningAxisReverse(axis: ClippingAxis, reverse: boolean): void {
    this.clippingTool.setAxisReverse(axis, reverse);
  }

  public invertSectioningAxis(axis: ClippingAxis): boolean {
    return this.clippingTool.invertAxis(axis);
  }

  public setSectioningAxisProgress(axis: ClippingAxis, progress: number): void {
    this.clippingTool.setAxisProgress(axis, progress);
  }

  public getSectioningAxisProgress(axis: ClippingAxis): number {
    return this.clippingTool.getAxisProgress(axis);
  }

  public setSectioningHelperVisible(visible: boolean): void {
    this.clippingTool.setSectioningHelperVisible(visible);
  }

  public getSectioningHelperVisible(): boolean {
    return this.clippingTool.getSectioningHelperVisible();
  }

  public setSectioningReverse(reverse: boolean): void {
    this.clippingTool.setSectioningReverse(reverse);
  }

  public getSectioningReverse(): boolean {
    return this.clippingTool.getSectioningReverse();
  }

  public resetSectioning(axis?: ClippingAxis): void {
    this.clippingTool.resetSectioning(axis);
  }

  public getSectioningState() {
    return this.clippingTool.getSectioningState();
  }

  public startCustomClip(): void {
    this.measurementTool.setMode('none'); // avoid mode collision
    this.clippingTool.startCustomClip();
  }

  public cancelCustomClip(): void {
    this.clippingTool.cancelCustomClip();
  }

  public clearCustomClip(): void {
    this.clippingTool.clearCustomPlane();
  }

  public invertCustomClip(): boolean {
    return this.clippingTool.invertCustomClip();
  }

  public hasCustomClip(): boolean {
    return this.clippingTool.hasCustomPlane();
  }

  public resetClipping(): void {
    this.clippingTool.resetAll();
  }

  // ==========================================
  // Measurement Tools
  // ==========================================

  public setMeasurementMode(mode: MeasurementType): void {
    if (mode !== 'none') {
      this.clippingTool.cancelCustomClip();
      this.clippingTool.setInteractive(false);
    } else {
      this.clippingTool.setInteractive(true);
    }
    this.measurementTool.setMode(mode);
  }

  public getMeasurementMode(): MeasurementType {
    return this.measurementTool.getMode();
  }

  public clearMeasurements(): void {
    this.measurementTool.clearAll();
  }

  public undoMeasurement(): void {
    this.measurementTool.undoLastPoint();
  }

  public getMeasurements(): MeasurementResult[] {
    return this.measurementTool.getResults();
  }

  // ==========================================
  // Camera & Views
  // ==========================================

  public async setView(view: CameraView, duration: number = 600): Promise<void> {
    if (!this.currentModel) return;
    await this.cameraTool.setView(view, this.currentModel, duration);
    this.emit('view:change', view);
  }

  public async fitView(duration: number = 500): Promise<void> {
    if (!this.currentModel) return;
    await this.cameraTool.fitToObject(this.currentModel, duration);
  }

  // ==========================================
  // Auto-Rotation & Axis Locking
  // ==========================================

  public setAutoRotate(
    enabled: boolean,
    axis?: AutoRotateAxis,
    direction?: AutoRotateDirection,
    speed?: number
  ): void {
    this.cameraTool.setAutoRotate(enabled, axis, direction, speed);
    this.emit('autorotate:change', this.cameraTool.getAutoRotateState());
  }

  public toggleAutoRotate(): boolean {
    const state = this.cameraTool.toggleAutoRotate();
    this.emit('autorotate:change', this.cameraTool.getAutoRotateState());
    return state;
  }

  public setAutoRotateAxis(axis: AutoRotateAxis): void {
    this.cameraTool.setAutoRotateAxis(axis);
    this.emit('autorotate:change', this.cameraTool.getAutoRotateState());
  }

  public setAutoRotateDirection(direction: AutoRotateDirection): void {
    this.cameraTool.setAutoRotateDirection(direction);
    this.emit('autorotate:change', this.cameraTool.getAutoRotateState());
  }

  public setAutoRotateSpeed(speed: number): void {
    this.cameraTool.setAutoRotateSpeed(speed);
    this.emit('autorotate:change', this.cameraTool.getAutoRotateState());
  }

  public getAutoRotateState(): AutoRotateOptions {
    return this.cameraTool.getAutoRotateState();
  }

  public setRotationLockedAxis(axis: RotationLockAxis): void {
    this.cameraTool.setLockedAxis(axis);
    this.emit('axislock:change', axis);
  }

  public getRotationLockedAxis(): RotationLockAxis {
    return this.cameraTool.getLockedAxis();
  }

  // ==========================================
  // High-Resolution Export
  // ==========================================

  public async exportImage(options: ExportImageOptions = {}): Promise<string> {
    return this.screenshotTool.exportImage(options);
  }

  // Typed EventEmitter helper
  public override on<K extends keyof ViewerEvents>(event: K, listener: ViewerEvents[K]): this;
  public override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  public override off<K extends keyof ViewerEvents>(event: K, listener: ViewerEvents[K]): this;
  public override off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  // ==========================================
  // Cleanup
  // ==========================================

  public destroy(): void {
    this.clearModel();
    this.measurementTool.destroy();
    this.clippingTool.destroy();
    this.sceneManager.destroy();
    this.removeAllListeners();
  }
}
