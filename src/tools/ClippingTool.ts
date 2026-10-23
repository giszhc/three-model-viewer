import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ModelLoader } from '../loaders/ModelLoader';
import { findSnapPoint } from '../utils/snapping';
import { AxisSectionState, ClippingAxis, SectioningState } from '../types';
import { EventEmitter } from '../core/EventEmitter';

interface PlaneWidget {
  axis: ClippingAxis;
  group: THREE.Group;
  mesh: THREE.Mesh;
  border: THREE.LineSegments;
  arrowGroup: THREE.Group;
  hitMeshes: THREE.Object3D[];
  label: CSS2DObject;
  labelText: HTMLDivElement;
  meshMat: THREE.MeshBasicMaterial;
  borderMat: THREE.LineBasicMaterial;
  arrowMat: THREE.MeshBasicMaterial;
  normal: THREE.Vector3;
  baseColor: number;
  borderColor: number;
  position: number;
  inverted: boolean;
  enabled: boolean;
}

export class ClippingTool {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private modelLoader: ModelLoader;
  private controls: OrbitControls | TrackballControls | null = null;
  private emitter: EventEmitter | null = null;

  // Active Three.js Clipping Planes
  private planeX: THREE.Plane;
  private planeY: THREE.Plane;
  private planeZ: THREE.Plane;
  private customPlane: THREE.Plane | null = null;

  // Sectioning States matching CAD / Digital3DCloud standard:
  // 1. isEnabled: Default FALSE. Only show when user turns on sectioning.
  private isEnabled: boolean = false;
  // 2. activeAxis: Recently focused axis for quick reference
  private activeAxis: ClippingAxis = 'x';
  // 3. helperVisible: Whether the translucent helper planes are visible
  private helperVisible: boolean = true;

  // Group containing the 3 plane widgets
  private planesGroup: THREE.Group;
  private interactive: boolean = false;
  private widgets: Partial<Record<ClippingAxis, PlaneWidget>> = {};

  // Dragging State with Screen-Projection Math (zero jitter, zero stickiness, no unwanted rotation)
  private isDraggingPlane: boolean = false;
  private draggedWidget: PlaneWidget | null = null;
  private dragStartPointer: THREE.Vector2 = new THREE.Vector2();
  private dragStartPosition: number = 0;
  private dragScreenAxis: THREE.Vector2 = new THREE.Vector2();
  private dragScreenAxisLenSq: number = 0;
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private hoveredAxis: ClippingAxis | null = null;

  // Custom 2-point knife cutting state
  private isPickingCustomPoints: boolean = false;
  private customPoints: THREE.Vector3[] = [];
  private customMarkersGroup: THREE.Group;

  // Cached model bounding box
  private modelBox: THREE.Box3 = new THREE.Box3();

  // Bound event listeners
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerMoveDragBound: (e: PointerEvent) => void;
  private onPointerUpDragBound: (e: PointerEvent) => void;
  private onDoubleClickBound: (e: MouseEvent) => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    container: HTMLElement,
    modelLoader: ModelLoader,
    controls?: OrbitControls | TrackballControls,
    emitter?: EventEmitter
  ) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.modelLoader = modelLoader;
    this.controls = controls || null;
    this.emitter = emitter || null;

    // Initialize inactive planes far away
    this.planeX = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100000);
    this.planeY = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100000);
    this.planeZ = new THREE.Plane(new THREE.Vector3(0, 0, -1), 100000);

    // Group for the cutting plane widgets (HIDDEN by default!)
    this.planesGroup = new THREE.Group();
    this.planesGroup.name = 'gmv-interactive-clipping-planes';
    this.planesGroup.visible = false;
    this.scene.add(this.planesGroup);

    // Custom 2-point marker group
    this.customMarkersGroup = new THREE.Group();
    this.customMarkersGroup.name = 'gmv-custom-clip-markers';
    this.scene.add(this.customMarkersGroup);

    // Bind event handlers
    this.onPointerDownBound = this.handlePointerDown.bind(this);
    this.onPointerMoveBound = this.handlePointerMove.bind(this);
    this.onPointerMoveDragBound = this.handlePointerMoveDrag.bind(this);
    this.onPointerUpDragBound = this.handlePointerUpDrag.bind(this);
    this.onDoubleClickBound = this.handleDoubleClick.bind(this);

    // Use CAPTURE phase on pointerdown to intercept clicks on clipping planes
    // BEFORE TrackballControls can start a rotation gesture!
    this.container.addEventListener('pointerdown', this.onPointerDownBound, { capture: true });
    this.container.addEventListener('pointermove', this.onPointerMoveBound);
    this.container.addEventListener('dblclick', this.onDoubleClickBound, { capture: true });
  }

  public setControls(controls: OrbitControls | TrackballControls): void {
    this.controls = controls;
  }

  public setEmitter(emitter: EventEmitter): void {
    this.emitter = emitter;
  }

  public setInteractive(interactive: boolean): void {
    this.interactive = interactive && this.isEnabled;
    if (!this.interactive && this.container.style.cursor === 'grab') {
      this.container.style.cursor = 'default';
    }
  }

  /**
   * Initializes or updates bounds from loaded model
   */
  public setModelBounds(box: THREE.Box3): void {
    this.modelBox.copy(box);
    this.rebuildPlaneWidgets();
    this.resetAll();
  }

  /**
   * Builds the 3 interactive clipping planes strictly fitting inside the model's bounding box
   */
  private rebuildPlaneWidgets(): void {
    this.clearPlaneWidgets();

    const size = new THREE.Vector3(2, 2, 2);
    const center = new THREE.Vector3(0, 0, 0);
    if (!this.modelBox.isEmpty()) {
      this.modelBox.getSize(size);
      this.modelBox.getCenter(center);
    }

    // STRICT BOUNDING BOX DIMENSIONS:
    // Slicing planes MUST NEVER exceed the bounding box boundary!
    const sx = Math.max(0.001, size.x);
    const sy = Math.max(0.001, size.y);
    const sz = Math.max(0.001, size.z);

    // 1. X Plane (YZ cross section, perpendicular to X): width = sz, height = sy
    this.widgets.x = this.createPlaneWidget('x', 0xef4444, 0xf87171, sz, sy, center);

    // 2. Y Plane (XZ cross section, perpendicular to Y): width = sx, height = sz
    this.widgets.y = this.createPlaneWidget('y', 0x10b981, 0x34d399, sx, sz, center);

    // 3. Z Plane (XY cross section, perpendicular to Z): width = sx, height = sy
    this.widgets.z = this.createPlaneWidget('z', 0x3b82f6, 0x60a5fa, sx, sy, center);

    // Default: X axis is enabled when sectioning is turned on; Y and Z can be toggled on simultaneously
    if (this.widgets.x) this.widgets.x.enabled = true;
    if (this.widgets.y) this.widgets.y.enabled = false;
    if (this.widgets.z) this.widgets.z.enabled = false;

    // Apply visibility states
    this.updateWidgetsVisibility();
  }

  private createPlaneWidget(
    axis: ClippingAxis,
    baseColor: number,
    borderColor: number,
    w: number,
    h: number,
    center: THREE.Vector3
  ): PlaneWidget {
    const group = new THREE.Group();
    group.name = `gmv-clip-plane-${axis}`;

    // 1. Translucent Plane Mesh:
    // Exactly matches the cross section of the bounding box.
    const geom = new THREE.PlaneGeometry(w, h);
    const meshMat = new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, meshMat);
    mesh.userData = { axis };
    mesh.renderOrder = 999;
    group.add(mesh);

    // 2. High-visibility outline frame strictly on the bounding box boundary
    const edges = new THREE.EdgesGeometry(geom);
    const borderMat = new THREE.LineBasicMaterial({
      color: borderColor,
      transparent: true,
      opacity: 0.85,
    });
    const border = new THREE.LineSegments(edges, borderMat);
    group.add(border);

    // 3. Center Sectioning Handle (compact, elegant, strictly inside bounding box)
    const arrowGroup = new THREE.Group();
    const handleScale = Math.min(w, h) * 0.045;
    const arrowMat = new THREE.MeshBasicMaterial({
      color: borderColor,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });

    // Center Sphere
    const sphereGeom = new THREE.SphereGeometry(handleScale * 0.5, 16, 16);
    const centerSphere = new THREE.Mesh(sphereGeom, arrowMat);
    centerSphere.userData = { axis };
    arrowGroup.add(centerSphere);

    // Thin Shaft along normal
    const shaftGeom = new THREE.CylinderGeometry(handleScale * 0.12, handleScale * 0.12, handleScale * 1.8, 12);
    shaftGeom.rotateX(Math.PI / 2);
    const shaftMesh = new THREE.Mesh(shaftGeom, arrowMat);
    shaftMesh.userData = { axis };
    arrowGroup.add(shaftMesh);

    // Positive Arrow Cone
    const coneGeom1 = new THREE.ConeGeometry(handleScale * 0.35, handleScale * 0.65, 16);
    coneGeom1.rotateX(Math.PI / 2);
    coneGeom1.translate(0, 0, handleScale * 1.1);
    const coneMesh1 = new THREE.Mesh(coneGeom1, arrowMat);
    coneMesh1.userData = { axis };
    arrowGroup.add(coneMesh1);

    // Negative Arrow Cone
    const coneGeom2 = new THREE.ConeGeometry(handleScale * 0.35, handleScale * 0.65, 16);
    coneGeom2.rotateX(-Math.PI / 2);
    coneGeom2.translate(0, 0, -handleScale * 1.1);
    const coneMesh2 = new THREE.Mesh(coneGeom2, arrowMat);
    coneMesh2.userData = { axis };
    arrowGroup.add(coneMesh2);

    arrowGroup.renderOrder = 1000;
    group.add(arrowGroup);

    // All clickable meshes for raycasting
    const hitMeshes = [mesh, centerSphere, shaftMesh, coneMesh1, coneMesh2];

    // 4. Ergonomic Corner CSS2D badge positioned well inside the plane boundary
    const div = document.createElement('div');
    div.className = `gmv-plane-badge gmv-plane-badge-${axis}`;
    div.textContent = `${axis.toUpperCase()} 剖切面`;
    const label = new CSS2DObject(div);
    label.position.set((w / 2) * 0.68, (h / 2) * 0.68, 0);
    group.add(label);

    let normal = new THREE.Vector3(1, 0, 0);

    if (axis === 'x') {
      group.rotation.y = Math.PI / 2;
      group.position.set(center.x, center.y, center.z);
      normal = new THREE.Vector3(1, 0, 0);
    } else if (axis === 'y') {
      group.rotation.x = -Math.PI / 2;
      group.position.set(center.x, center.y, center.z);
      normal = new THREE.Vector3(0, 1, 0);
    } else {
      group.rotation.set(0, 0, 0);
      group.position.set(center.x, center.y, center.z);
      normal = new THREE.Vector3(0, 0, 1);
    }

    this.planesGroup.add(group);

    return {
      axis,
      group,
      mesh,
      border,
      arrowGroup,
      hitMeshes,
      label,
      labelText: div,
      meshMat,
      borderMat,
      arrowMat,
      normal,
      baseColor,
      borderColor,
      position: center[axis],
      inverted: false,
      enabled: false,
    };
  }

  private clearPlaneWidgets(): void {
    (['x', 'y', 'z'] as ClippingAxis[]).forEach((axis) => {
      const widget = this.widgets[axis];
      if (widget) {
        widget.mesh.geometry.dispose();
        widget.meshMat.dispose();
        widget.border.geometry.dispose();
        widget.borderMat.dispose();
        widget.arrowMat.dispose();
        this.planesGroup.remove(widget.group);
      }
    });
    this.widgets = {};
  }

  // ==========================================
  // Visibility & Direction Controls (Multi-Axis Capable)
  // ==========================================

  private updateWidgetsVisibility(): void {
    this.planesGroup.visible = this.isEnabled && this.helperVisible;
    this.interactive = this.isEnabled;

    (['x', 'y', 'z'] as ClippingAxis[]).forEach((axis) => {
      const w = this.widgets[axis];
      if (w) {
        // Multi-axis support: Any enabled axis will show its translucent helper plane
        w.group.visible = this.isEnabled && this.helperVisible && w.enabled;
      }
    });
  }

  /**
   * 1. 开启 / 关闭 剖切总开关 (Enable/Disable Sectioning)
   */
  public setSectioningEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.updateWidgetsVisibility();

    if (enabled) {
      // Ensure at least one axis is enabled if all were disabled
      const hasAnyAxis = (['x', 'y', 'z'] as ClippingAxis[]).some((a) => this.widgets[a]?.enabled);
      if (!hasAnyAxis) {
        const defaultW = this.widgets[this.activeAxis] || this.widgets.x;
        if (defaultW) defaultW.enabled = true;
      }

      // Re-apply positions for all active axes
      (['x', 'y', 'z'] as ClippingAxis[]).forEach((axis) => {
        const w = this.widgets[axis];
        if (w && w.enabled) {
          this.setPlanePositionExplicit(axis, w.position);
        } else {
          this.disableAxisInternal(axis);
        }
      });
    } else {
      // Disabling sectioning clears all cuts from the model
      this.disableAllAxesPlanes();
    }

    this.applyPlanes();
    this.emitSectioningState();
  }

  public getSectioningEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * 2. 独立开启或关闭某个轴的剖切 (Multi-Axis Toggle)
   * 支持 X、Y、Z 任意多轴同时开启与同时剖切！
   */
  public setAxisEnabled(axis: ClippingAxis, enabled: boolean): void {
    const w = this.widgets[axis];
    if (!w) return;

    w.enabled = enabled;
    if (enabled) {
      this.activeAxis = axis;
      if (this.isEnabled) {
        this.setPlanePositionExplicit(axis, w.position);
      }
    } else {
      this.disableAxisInternal(axis);
    }

    this.updateWidgetsVisibility();
    this.applyPlanes();
    this.emitSectioningState();
  }

  public toggleAxis(axis: ClippingAxis, enabled?: boolean): boolean {
    const w = this.widgets[axis];
    const newState = enabled !== undefined ? enabled : !(w?.enabled);
    this.setAxisEnabled(axis, newState);
    return newState;
  }

  public isAxisEnabled(axis: ClippingAxis): boolean {
    return !!(this.widgets[axis]?.enabled);
  }

  /**
   * 设置激活/聚焦的轴向 (兼容已有调用)
   */
  public setSectioningAxis(axis: ClippingAxis): void {
    this.activeAxis = axis;
    const w = this.widgets[axis];
    if (w && !w.enabled) {
      w.enabled = true;
      if (this.isEnabled) {
        this.setPlanePositionExplicit(axis, w.position);
      }
    }
    this.updateWidgetsVisibility();
    this.emitSectioningState();
  }

  public getSectioningAxis(): ClippingAxis {
    return this.activeAxis;
  }

  /**
   * 3. 隐藏 / 显示 剖切辅助面 (Hide Sectional Plane while keeping the cut)
   */
  public setSectioningHelperVisible(visible: boolean): void {
    this.helperVisible = visible;
    this.updateWidgetsVisibility();
    this.emitSectioningState();
  }

  public getSectioningHelperVisible(): boolean {
    return this.helperVisible;
  }

  /**
   * 4. 独立反向某轴剖切 (Reverse Sectioning for a specific axis or active axis)
   */
  public setAxisReverse(axis: ClippingAxis, reverse: boolean): void {
    const widget = this.widgets[axis];
    if (widget) {
      widget.inverted = reverse;
      if (this.isEnabled && widget.enabled) {
        this.setPlanePositionExplicit(axis, widget.position);
      } else {
        const min = this.modelBox.min[axis];
        const max = this.modelBox.max[axis];
        const range = max - min;
        const progress = range > 0 ? (widget.position - min) / range : 0.5;
        widget.labelText.textContent = `${axis.toUpperCase()} 剖切面 ${(progress * 100).toFixed(0)}%${reverse ? ' (反向)' : ''}`;
      }
    }
    this.emitSectioningState();
  }

  public setSectioningReverse(reverse: boolean): void {
    this.setAxisReverse(this.activeAxis, reverse);
  }

  public getSectioningReverse(): boolean {
    return !!(this.widgets[this.activeAxis]?.inverted);
  }

  public invertAxis(axis: ClippingAxis): boolean {
    const w = this.widgets[axis];
    if (!w) return false;
    this.setAxisReverse(axis, !w.inverted);
    return w.inverted;
  }

  /**
   * 5. 重置剖切面至中心位置与默认正向状态
   */
  public resetSectioning(axis?: ClippingAxis): void {
    const center = new THREE.Vector3();
    const isEmpty = this.modelBox.isEmpty();
    if (!isEmpty) {
      this.modelBox.getCenter(center);
    } else {
      center.set(0, 0, 0);
    }

    // 1. 清除任何自定义 2 点切刀平面
    this.clearCustomPlane();

    // 2. 目标轴
    const targetAxes: ClippingAxis[] = axis ? [axis] : (['x', 'y', 'z'] as ClippingAxis[]);

    targetAxes.forEach((a) => {
      const widget = this.widgets[a];
      if (widget) {
        widget.position = center[a];
        widget.inverted = false;
        widget.group.position.set(center.x, center.y, center.z);
        if (!axis) {
          // 全局重置时，默认激活 X 轴，关闭 Y/Z 轴
          widget.enabled = a === 'x';
        }
        const min = isEmpty ? -1 : this.modelBox.min[a];
        const max = isEmpty ? 1 : this.modelBox.max[a];
        const range = max - min;
        const progress = range > 0 && !isNaN(widget.position) ? Math.max(0, Math.min(1, (widget.position - min) / range)) : 0.5;
        widget.labelText.textContent = `${a.toUpperCase()} 剖切面 ${(progress * 100).toFixed(0)}%`;
      }
    });

    this.activeAxis = axis || 'x';
    this.helperVisible = true;
    this.isEnabled = true; // 确保剖切开启，立即可见中心剖切面！

    // 3. 重新设置所有轴向的平面方程
    (['x', 'y', 'z'] as ClippingAxis[]).forEach((a) => {
      const widget = this.widgets[a];
      if (widget && widget.enabled) {
        this.setPlanePositionExplicit(a, widget.position);
      } else {
        this.disableAxisInternal(a);
      }
    });

    this.updateWidgetsVisibility();
    this.applyPlanes();
    this.emitSectioningState();
  }

  /**
   * 获取多轴综合剖切状态
   */
  public getSectioningState(): SectioningState {
    const isEmpty = this.modelBox.isEmpty();
    const minX = isEmpty ? -1 : this.modelBox.min.x;
    const maxX = isEmpty ? 1 : this.modelBox.max.x;
    const minY = isEmpty ? -1 : this.modelBox.min.y;
    const maxY = isEmpty ? 1 : this.modelBox.max.y;
    const minZ = isEmpty ? -1 : this.modelBox.min.z;
    const maxZ = isEmpty ? 1 : this.modelBox.max.z;

    const calcProg = (pos: number, min: number, max: number) => {
      const range = max - min;
      if (isNaN(pos) || range <= 0) return 0.5;
      return Math.max(0, Math.min(1, (pos - min) / range));
    };

    const wx = this.widgets.x;
    const wy = this.widgets.y;
    const wz = this.widgets.z;

    const axes: Record<ClippingAxis, AxisSectionState> = {
      x: {
        enabled: wx?.enabled ?? false,
        inverted: wx?.inverted ?? false,
        position: wx?.position ?? 0,
        progress: calcProg(wx?.position ?? 0, minX, maxX),
      },
      y: {
        enabled: wy?.enabled ?? false,
        inverted: wy?.inverted ?? false,
        position: wy?.position ?? 0,
        progress: calcProg(wy?.position ?? 0, minY, maxY),
      },
      z: {
        enabled: wz?.enabled ?? false,
        inverted: wz?.inverted ?? false,
        position: wz?.position ?? 0,
        progress: calcProg(wz?.position ?? 0, minZ, maxZ),
      },
    };

    const activeW = this.widgets[this.activeAxis];
    const curAxisProg = axes[this.activeAxis]?.progress ?? 0.5;
    const curAxisPos = activeW?.position ?? 0;
    const curAxisInv = activeW?.inverted ?? false;

    return {
      enabled: this.isEnabled,
      axes,
      helperVisible: this.helperVisible,
      axis: this.activeAxis,
      isReverse: curAxisInv,
      progress: curAxisProg,
      position: curAxisPos,
    };
  }

  private emitSectioningState(): void {
    if (this.emitter) {
      this.emitter.emit('sectioning:change', this.getSectioningState());
    }
  }

  // ==========================================
  // Direct 3D Mouse Press & Drag Handling
  // Multi-Axis Pick: Pick and drag ANY active axis plane directly in 3D!
  // ==========================================

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // Only left mouse button

    if (this.isPickingCustomPoints) {
      this.handleCustomPointPick(e);
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    if (!this.interactive || !this.isEnabled || !this.helperVisible) return;

    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);

    // Multi-Axis Pick: test against ALL currently enabled & visible plane widgets
    const candidateWidgets = (['x', 'y', 'z'] as ClippingAxis[])
      .map((axis) => this.widgets[axis])
      .filter((w): w is PlaneWidget => !!(w && w.enabled && w.group.visible));

    if (candidateWidgets.length === 0) return;

    let closestHit: { widget: PlaneWidget; distance: number } | null = null;

    for (const widget of candidateWidgets) {
      const intersects = this.raycaster.intersectObjects(widget.hitMeshes, true);
      if (intersects.length > 0) {
        const dist = intersects[0].distance;
        if (!closestHit || dist < closestHit.distance) {
          closestHit = { widget, distance: dist };
        }
      }
    }

    if (closestHit) {
      // CRITICAL: Stop event propagation in capture phase so TrackballControls NEVER starts rotating!
      e.stopImmediatePropagation();
      e.preventDefault();

      const activeWidget = closestHit.widget;
      this.activeAxis = activeWidget.axis;
      this.isDraggingPlane = true;
      this.draggedWidget = activeWidget;

      // Disable camera controls and clear any internal Trackball state immediately
      if (this.controls) {
        this.controls.enabled = false;
        if ('state' in this.controls) {
          (this.controls as any).state = -1;
          if ((this.controls as any)._moveCurr && (this.controls as any)._movePrev) {
            (this.controls as any)._moveCurr.copy((this.controls as any)._movePrev);
          }
        }
      }

      this.container.style.cursor = 'grabbing';
      activeWidget.meshMat.opacity = 0.65;
      activeWidget.arrowMat.opacity = 1.0;

      // Record start pointer client coordinates
      this.dragStartPointer.set(e.clientX, e.clientY);
      this.dragStartPosition = activeWidget.position;

      // Project the 3D unit axis vector into 2D screen space to enable smooth, jitter-free 1:1 dragging
      const axisVector = new THREE.Vector3();
      if (activeWidget.axis === 'x') axisVector.set(1, 0, 0);
      else if (activeWidget.axis === 'y') axisVector.set(0, 1, 0);
      else axisVector.set(0, 0, 1);

      const p0 = activeWidget.group.position.clone();
      const p1 = activeWidget.group.position.clone().add(axisVector);

      const ndc0 = p0.project(this.camera);
      const screen0 = new THREE.Vector2(
        ((ndc0.x + 1) * rect.width) / 2,
        ((-ndc0.y + 1) * rect.height) / 2
      );

      const ndc1 = p1.project(this.camera);
      const screen1 = new THREE.Vector2(
        ((ndc1.x + 1) * rect.width) / 2,
        ((-ndc1.y + 1) * rect.height) / 2
      );

      this.dragScreenAxis.subVectors(screen1, screen0);
      this.dragScreenAxisLenSq = this.dragScreenAxis.lengthSq();

      // Register global drag listeners in capture phase for buttery-smooth tracking
      window.addEventListener('pointermove', this.onPointerMoveDragBound, { capture: true });
      window.addEventListener('pointerup', this.onPointerUpDragBound, { capture: true });
    }
  }

  private handlePointerMoveDrag(e: PointerEvent): void {
    if (!this.isDraggingPlane || !this.draggedWidget) return;

    e.stopImmediatePropagation();
    e.preventDefault();

    const deltaMouse = new THREE.Vector2(
      e.clientX - this.dragStartPointer.x,
      e.clientY - this.dragStartPointer.y
    );

    let deltaUnits = 0;
    if (this.dragScreenAxisLenSq > 25) {
      // Axis is tilted on screen: project mouse movement directly onto the screen axis direction
      deltaUnits = this.dragScreenAxis.dot(deltaMouse) / this.dragScreenAxisLenSq;
    } else {
      // Axis is viewed almost directly face-on: drag vertically to adjust depth
      const size = new THREE.Vector3();
      this.modelBox.getSize(size);
      const axisSpan = Math.max(0.1, size[this.draggedWidget.axis]);
      deltaUnits = (-deltaMouse.y / 280) * axisSpan;
    }

    const min = this.modelBox.min[this.draggedWidget.axis];
    const max = this.modelBox.max[this.draggedWidget.axis];

    let newPos = this.dragStartPosition + deltaUnits;
    newPos = Math.max(min, Math.min(max, newPos));

    this.setPlanePositionExplicit(this.draggedWidget.axis, newPos);
  }

  private handlePointerUpDrag(e: PointerEvent): void {
    if (!this.isDraggingPlane) return;

    e.stopImmediatePropagation();
    e.preventDefault();

    this.isDraggingPlane = false;

    if (this.draggedWidget) {
      this.draggedWidget.meshMat.opacity = 0.25;
      this.draggedWidget.arrowMat.opacity = 0.9;
      this.draggedWidget = null;
    }

    this.container.style.cursor = 'default';

    window.removeEventListener('pointermove', this.onPointerMoveDragBound, { capture: true });
    window.removeEventListener('pointerup', this.onPointerUpDragBound, { capture: true });

    // CRITICAL: Restore camera controls in requestAnimationFrame to prevent lingering pointerup
    // from triggering unwanted camera momentum or spinning!
    requestAnimationFrame(() => {
      if (this.controls) {
        if ('state' in this.controls) {
          (this.controls as any).state = -1;
          if ((this.controls as any)._moveCurr && (this.controls as any)._movePrev) {
            (this.controls as any)._moveCurr.copy((this.controls as any)._movePrev);
          }
        }
        this.controls.enabled = true;
      }
    });
  }

  /**
   * Hover highlighting across all enabled planes
   */
  private handlePointerMove(e: PointerEvent): void {
    if (this.isDraggingPlane) return;
    if (this.isPickingCustomPoints) return;
    if (!this.interactive || !this.isEnabled || !this.helperVisible) return;

    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);

    const candidateWidgets = (['x', 'y', 'z'] as ClippingAxis[])
      .map((axis) => this.widgets[axis])
      .filter((w): w is PlaneWidget => !!(w && w.enabled && w.group.visible));

    let hoveredHitAxis: ClippingAxis | null = null;

    for (const widget of candidateWidgets) {
      const intersects = this.raycaster.intersectObjects(widget.hitMeshes, true);
      if (intersects.length > 0) {
        hoveredHitAxis = widget.axis;
        break;
      }
    }

    this.setHoveredAxis(hoveredHitAxis);
    if (hoveredHitAxis) {
      this.container.style.cursor = 'grab';
    } else if (this.container.style.cursor === 'grab') {
      this.container.style.cursor = 'default';
    }
  }

  private setHoveredAxis(axis: ClippingAxis | null): void {
    if (this.hoveredAxis === axis) return;
    this.hoveredAxis = axis;

    (['x', 'y', 'z'] as ClippingAxis[]).forEach((a) => {
      const w = this.widgets[a];
      if (w) {
        if (a === axis) {
          w.meshMat.opacity = 0.52;
          w.borderMat.opacity = 1.0;
          w.arrowMat.opacity = 1.0;
        } else {
          w.meshMat.opacity = 0.25;
          w.borderMat.opacity = 0.85;
          w.arrowMat.opacity = 0.9;
        }
      }
    });
  }

  /**
   * Double click on any plane quickly flips/inverts slicing direction of that specific plane
   */
  private handleDoubleClick(e: MouseEvent): void {
    if (!this.interactive || !this.isEnabled || !this.helperVisible) return;

    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);

    const candidateWidgets = (['x', 'y', 'z'] as ClippingAxis[])
      .map((axis) => this.widgets[axis])
      .filter((w): w is PlaneWidget => !!(w && w.enabled && w.group.visible));

    for (const widget of candidateWidgets) {
      const intersects = this.raycaster.intersectObjects(widget.hitMeshes, true);
      if (intersects.length > 0) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.invertAxis(widget.axis);
        break;
      }
    }
  }

  // ==========================================
  // Slicing Calculation & Updates
  // ==========================================

  public setPlanePositionExplicit(axis: ClippingAxis, pos: number): void {
    const widget = this.widgets[axis];
    if (!widget) return;

    widget.position = pos;

    if (axis === 'x') {
      widget.group.position.x = pos;
      if (widget.inverted) {
        this.planeX.set(new THREE.Vector3(1, 0, 0), -pos);
      } else {
        this.planeX.set(new THREE.Vector3(-1, 0, 0), pos);
      }
    } else if (axis === 'y') {
      widget.group.position.y = pos;
      if (widget.inverted) {
        this.planeY.set(new THREE.Vector3(0, 1, 0), -pos);
      } else {
        this.planeY.set(new THREE.Vector3(0, -1, 0), pos);
      }
    } else if (axis === 'z') {
      widget.group.position.z = pos;
      if (widget.inverted) {
        this.planeZ.set(new THREE.Vector3(0, 0, 1), -pos);
      } else {
        this.planeZ.set(new THREE.Vector3(0, 0, -1), pos);
      }
    }

    widget.enabled = true;
    this.applyPlanes();

    const min = this.modelBox.min[axis];
    const max = this.modelBox.max[axis];
    const range = max - min;
    const progress = range > 0 ? (pos - min) / range : 0.5;
    widget.labelText.textContent = `${axis.toUpperCase()} 剖切面 ${(progress * 100).toFixed(0)}%${widget.inverted ? ' (反向)' : ''}`;

    this.emitSectioningState();

    if (this.emitter) {
      this.emitter.emit('clipping:change', {
        axis,
        position: pos,
        progress,
        inverted: widget.inverted,
        enabled: true,
      });
    }
  }

  public setAxisProgress(axis: ClippingAxis, progress: number): void {
    const min = this.modelBox.min[axis];
    const max = this.modelBox.max[axis];
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const pos = min + clampedProgress * (max - min);
    this.setPlanePositionExplicit(axis, pos);
  }

  public getAxisProgress(axis: ClippingAxis): number {
    const widget = this.widgets[axis];
    if (!widget) return 0.5;
    const min = this.modelBox.min[axis];
    const max = this.modelBox.max[axis];
    const range = max - min;
    return range > 0 ? Math.max(0, Math.min(1, (widget.position - min) / range)) : 0.5;
  }

  private disableAxisInternal(axis: ClippingAxis): void {
    if (axis === 'x') {
      this.planeX.set(new THREE.Vector3(-1, 0, 0), 100000);
    } else if (axis === 'y') {
      this.planeY.set(new THREE.Vector3(0, -1, 0), 100000);
    } else if (axis === 'z') {
      this.planeZ.set(new THREE.Vector3(0, 0, -1), 100000);
    }
  }

  private disableAllAxesPlanes(): void {
    (['x', 'y', 'z'] as ClippingAxis[]).forEach((a) => {
      this.disableAxisInternal(a);
    });
  }

  // Backwards compatibility helper methods
  public setAxisClipping(axis: ClippingAxis, progress: number, inverted: boolean = false): void {
    this.activeAxis = axis;
    const widget = this.widgets[axis];
    if (widget) {
      widget.inverted = inverted;
      widget.enabled = true;
    }
    this.setSectioningEnabled(true);
    this.setAxisProgress(axis, progress);
  }

  public disableAxis(axis: ClippingAxis): void {
    this.setAxisEnabled(axis, false);
  }

  public getAxisState(axis: ClippingAxis): {
    enabled: boolean;
    progress: number;
    inverted: boolean;
    position: number;
  } {
    const widget = this.widgets[axis];
    if (!widget) {
      return { enabled: false, progress: 0.5, inverted: false, position: 0 };
    }
    const min = this.modelBox.min[axis];
    const max = this.modelBox.max[axis];
    const range = max - min;
    const progress = range > 0 ? (widget.position - min) / range : 0.5;
    return {
      enabled: this.isEnabled && widget.enabled,
      progress,
      inverted: widget.inverted,
      position: widget.position,
    };
  }

  public setPlanesVisible(visible: boolean): void {
    this.setSectioningHelperVisible(visible);
  }

  public getPlanesVisible(): boolean {
    return this.helperVisible;
  }

  // ==========================================
  // Custom 2-Point Plane Slicing (Knife Cut)
  // ==========================================

  public startCustomClip(): void {
    this.cancelCustomClip();
    this.isPickingCustomPoints = true;
    this.customPoints = [];
    this.container.style.cursor = 'crosshair';
  }

  public cancelCustomClip(): void {
    this.isPickingCustomPoints = false;
    this.container.style.cursor = 'default';
    this.clearCustomMarkers();
  }

  public clearCustomPlane(): void {
    this.customPlane = null;
    this.clearCustomMarkers();
    this.applyPlanes();
  }

  public invertCustomClip(): boolean {
    if (this.customPlane) {
      this.customPlane.negate();
      this.applyPlanes();
      return true;
    }
    return false;
  }

  public hasCustomPlane(): boolean {
    return this.customPlane !== null;
  }

  private handleCustomPointPick(e: PointerEvent): void {
    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Only clicks on model surface
    const snap = findSnapPoint(
      mouse,
      this.camera,
      this.modelLoader.getMeshes(),
      15,
      rect.width,
      rect.height
    );

    if (!snap.hit || !snap.point) {
      return;
    }

    this.addCustomPoint(snap.point);
  }

  private addCustomPoint(point: THREE.Vector3): void {
    this.customPoints.push(point.clone());

    const markerGeom = new THREE.SphereGeometry(1, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false });
    const marker = new THREE.Mesh(markerGeom, markerMat);
    marker.position.copy(point);
    marker.userData = { fixedScreenRadius: 5.5 };
    this.customMarkersGroup.add(marker);
    this.updateSingleMarkerScale(marker);

    if (this.customPoints.length === 2) {
      const p1 = this.customPoints[0];
      const p2 = this.customPoints[1];

      const cutLine = new THREE.Vector3().subVectors(p2, p1);
      if (cutLine.lengthSq() < 0.00001) {
        this.customPoints.pop();
        this.customMarkersGroup.remove(marker);
        return;
      }
      cutLine.normalize();

      const viewDir = new THREE.Vector3();
      this.camera.getWorldDirection(viewDir);

      let normal = new THREE.Vector3().crossVectors(cutLine, viewDir).normalize();
      if (normal.lengthSq() < 0.0001) {
        normal = new THREE.Vector3().crossVectors(cutLine, this.camera.up).normalize();
      }

      this.customPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p1);

      this.clearCustomMarkers();
      this.cancelCustomClip();
      this.applyPlanes();
    }
  }

  /**
   * Updates custom knife markers to maintain constant pixel size on screen
   */
  public updatePerFrame(viewportHeight?: number): void {
    if (this.customMarkersGroup.children.length === 0) return;
    const h = viewportHeight || this.container.clientHeight || window.innerHeight || 800;
    const vFovRad = (this.camera.fov * Math.PI) / 180;
    const camPos = this.camera.position;
    const tanHalfFov = Math.tan(vFovRad / 2);

    this.customMarkersGroup.traverse((obj) => {
      if (obj.userData && typeof obj.userData.fixedScreenRadius === 'number') {
        const radiusPx = obj.userData.fixedScreenRadius;
        const worldPos = new THREE.Vector3();
        obj.getWorldPosition(worldPos);
        const dist = worldPos.distanceTo(camPos);
        const worldRadius = (2 * dist * tanHalfFov * radiusPx) / Math.max(h, 1);
        obj.scale.setScalar(worldRadius);
      }
    });
  }

  private updateSingleMarkerScale(obj: THREE.Object3D, viewportHeight?: number): void {
    if (obj.userData && typeof obj.userData.fixedScreenRadius === 'number') {
      const radiusPx = obj.userData.fixedScreenRadius;
      const h = viewportHeight || this.container.clientHeight || window.innerHeight || 800;
      const vFovRad = (this.camera.fov * Math.PI) / 180;
      const camPos = this.camera.position;
      const tanHalfFov = Math.tan(vFovRad / 2);

      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      const dist = worldPos.distanceTo(camPos);
      const worldRadius = (2 * dist * tanHalfFov * radiusPx) / Math.max(h, 1);
      obj.scale.setScalar(worldRadius);
    }
  }

  private clearCustomMarkers(): void {
    while (this.customMarkersGroup.children.length > 0) {
      const obj = this.customMarkersGroup.children[0] as THREE.Mesh;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (obj.material as THREE.Material).dispose();
      this.customMarkersGroup.remove(obj);
    }
  }

  /**
   * Applies all currently active clipping planes to model materials simultaneously!
   */
  private applyPlanes(): void {
    const activePlanes: THREE.Plane[] = [];

    if (this.isEnabled) {
      if (this.widgets.x?.enabled) activePlanes.push(this.planeX);
      if (this.widgets.y?.enabled) activePlanes.push(this.planeY);
      if (this.widgets.z?.enabled) activePlanes.push(this.planeZ);
    }

    if (this.customPlane) activePlanes.push(this.customPlane);

    this.modelLoader.applyClippingPlanes(activePlanes);
  }

  public resetAll(): void {
    this.isEnabled = false;
    this.activeAxis = 'x';
    this.helperVisible = true;

    this.disableAllAxesPlanes();

    const center = new THREE.Vector3();
    this.modelBox.getCenter(center);

    (['x', 'y', 'z'] as ClippingAxis[]).forEach((axis) => {
      const w = this.widgets[axis];
      if (w) {
        // By default, X is primed as the first active axis once enabled
        w.enabled = axis === 'x';
        w.inverted = false;
        w.position = center[axis];
        w.group.position.set(center.x, center.y, center.z);
        w.labelText.textContent = `${axis.toUpperCase()} 剖切面`;
      }
    });

    this.updateWidgetsVisibility();
    this.clearCustomPlane();
    this.applyPlanes();
    this.emitSectioningState();
  }

  public destroy(): void {
    this.cancelCustomClip();
    this.resetAll();
    this.clearPlaneWidgets();
    this.scene.remove(this.planesGroup);
    this.scene.remove(this.customMarkersGroup);

    this.container.removeEventListener('pointerdown', this.onPointerDownBound, { capture: true });
    this.container.removeEventListener('pointermove', this.onPointerMoveBound);
    this.container.removeEventListener('dblclick', this.onDoubleClickBound, { capture: true });
    window.removeEventListener('pointermove', this.onPointerMoveDragBound, { capture: true });
    window.removeEventListener('pointerup', this.onPointerUpDragBound, { capture: true });
  }
}
