import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ModelLoader } from '../loaders/ModelLoader';
import { findSnapPoint } from '../utils/snapping';
import { compute3DPolygonArea, formatUnit } from '../utils/math';
import { EventEmitter } from '../core/EventEmitter';
import { MeasurementResult, MeasurementType } from '../types';

export class MeasurementTool {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private modelLoader: ModelLoader;
  private emitter: EventEmitter;
  private controls: OrbitControls | TrackballControls | null = null;

  private currentMode: MeasurementType = 'none';
  private unit: string = 'm';

  // Measurements container
  private measurementGroup: THREE.Group;
  private results: MeasurementResult[] = [];

  // Active interaction points for point-to-point tools
  private activePoints: THREE.Vector3[] = [];
  private activePreviewGroup: THREE.Group;
  private snapCursorMesh: THREE.Mesh;

  // Event handlers
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onDoubleClickBound: (e: MouseEvent) => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    container: HTMLElement,
    modelLoader: ModelLoader,
    emitter: EventEmitter,
    controls?: OrbitControls | TrackballControls
  ) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.modelLoader = modelLoader;
    this.emitter = emitter;
    this.controls = controls || null;

    this.measurementGroup = new THREE.Group();
    this.measurementGroup.name = 'gmv-measurements-group';
    this.scene.add(this.measurementGroup);

    this.activePreviewGroup = new THREE.Group();
    this.activePreviewGroup.name = 'gmv-measure-preview-group';
    this.scene.add(this.activePreviewGroup);

    // Glowing Snapping Cursor
    const snapGeom = new THREE.SphereGeometry(0.08, 16, 16);
    const snapMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    this.snapCursorMesh = new THREE.Mesh(snapGeom, snapMat);
    this.snapCursorMesh.visible = false;
    this.scene.add(this.snapCursorMesh);

    this.onPointerDownBound = this.handlePointerDown.bind(this);
    this.onPointerMoveBound = this.handlePointerMove.bind(this);
    this.onDoubleClickBound = this.handleDoubleClick.bind(this);
  }

  public setControls(controls: OrbitControls | TrackballControls): void {
    this.controls = controls;
  }

  public setUnit(unit: string): void {
    this.unit = unit;
  }

  public setMode(mode: MeasurementType): void {
    if (this.currentMode === mode) return;

    this.cancelActive();
    this.currentMode = mode;

    if (mode === 'none') {
      this.container.style.cursor = 'default';
      this.snapCursorMesh.visible = false;
      this.removeListeners();
    } else {
      this.container.style.cursor = 'crosshair';
      this.addListeners();
      this.emitter.emit('measure:start', mode);
    }
  }

  public getMode(): MeasurementType {
    return this.currentMode;
  }

  private addListeners(): void {
    this.removeListeners();
    this.container.addEventListener('pointerdown', this.onPointerDownBound, { capture: true });
    this.container.addEventListener('pointermove', this.onPointerMoveBound);
    this.container.addEventListener('dblclick', this.onDoubleClickBound);
  }

  private removeListeners(): void {
    this.container.removeEventListener('pointerdown', this.onPointerDownBound, { capture: true });
    this.container.removeEventListener('pointermove', this.onPointerMoveBound);
    this.container.removeEventListener('dblclick', this.onDoubleClickBound);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.currentMode === 'none') return;

    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const snap = findSnapPoint(
      mouse,
      this.camera,
      this.modelLoader.getMeshes(),
      15,
      rect.width,
      rect.height
    );

    // Rule: Click & Snapping strictly allowed on model only
    if (!snap.hit || !snap.point) {
      this.container.style.cursor = 'not-allowed';
      this.snapCursorMesh.visible = false;
      return;
    }

    this.container.style.cursor = 'crosshair';
    this.snapCursorMesh.visible = true;
    this.snapCursorMesh.position.copy(snap.point);

    if (snap.isVertexSnapped) {
      (this.snapCursorMesh.material as THREE.MeshBasicMaterial).color.setHex(0xf43f5e);
      this.snapCursorMesh.scale.setScalar(1.4);
    } else {
      (this.snapCursorMesh.material as THREE.MeshBasicMaterial).color.setHex(0x38bdf8);
      this.snapCursorMesh.scale.setScalar(1.0);
    }

    // Dynamic Line Preview while moving mouse
    if (this.activePoints.length > 0) {
      this.updateDynamicPreview(snap.point);
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.currentMode === 'none') return;
    if (e.button !== 0) return; // Left mouse button only

    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const snap = findSnapPoint(
      mouse,
      this.camera,
      this.modelLoader.getMeshes(),
      15,
      rect.width,
      rect.height
    );

    // STRICT CHECK: Model outside clicks are completely ignored!
    if (!snap.hit || !snap.point) {
      return;
    }

    const clickedPoint = snap.point.clone();
    this.activePoints.push(clickedPoint);
    this.emitter.emit('measure:change', [...this.activePoints]);

    // Check completion criteria for single-shot measurements
    if (this.currentMode === 'distance' && this.activePoints.length === 2) {
      this.finishDistanceMeasurement();
    } else if (this.currentMode === 'height' && this.activePoints.length === 2) {
      this.finishHeightMeasurement();
    } else if (this.currentMode === 'angle' && this.activePoints.length === 3) {
      this.finishAngleMeasurement();
    }
  }

  private handleDoubleClick(_e: MouseEvent): void {
    if (this.currentMode === 'area' && this.activePoints.length >= 3) {
      this.finishAreaMeasurement();
    }
  }

  // ==========================================
  // Dynamic Preview
  // ==========================================

  private updateDynamicPreview(currentPoint: THREE.Vector3): void {
    this.clearActivePreview();

    const points = [...this.activePoints, currentPoint];
    if (points.length < 2) return;

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.2,
      gapSize: 0.1,
      depthTest: false,
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    this.activePreviewGroup.add(line);
  }

  // ==========================================
  // Measurements Execution (Single-Shot: Exit after each measurement)
  // ==========================================

  private finishDistanceMeasurement(): void {
    const p1 = this.activePoints[0];
    const p2 = this.activePoints[1];
    const distance = p1.distanceTo(p2);
    const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

    const group = new THREE.Group();

    // 1. Line
    const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2, depthTest: false });
    const line = new THREE.Line(geom, mat);
    group.add(line);

    // 2. End Spheres
    this.addEndSphere(group, p1, 0x3b82f6);
    this.addEndSphere(group, p2, 0x3b82f6);

    // 3. CSS2D Label
    const div = document.createElement('div');
    div.className = 'gmv-measure-badge distance';
    div.innerHTML = `<span>距离:</span> <strong>${formatUnit(distance, this.unit)}</strong>`;
    const label = new CSS2DObject(div);
    label.position.copy(midPoint);
    group.add(label);

    this.measurementGroup.add(group);

    const result: MeasurementResult = {
      id: `dist_${Date.now()}`,
      type: 'distance',
      value: distance,
      formattedValue: formatUnit(distance, this.unit),
      unit: this.unit,
      points: [p1, p2],
    };

    this.results.push(result);
    this.emitter.emit('measure:complete', result);
    this.cancelActive();
    this.setMode('none'); // Single-shot: automatically exit mode
  }

  private finishHeightMeasurement(): void {
    const p1 = this.activePoints[0];
    const p2 = this.activePoints[1];

    const verticalHeight = Math.abs(p2.y - p1.y);
    const horizontalDistance = new THREE.Vector2(p1.x, p1.z).distanceTo(new THREE.Vector2(p2.x, p2.z));
    const totalDistance = p1.distanceTo(p2);

    const group = new THREE.Group();

    // Direct connecting line
    const directGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const directMat = new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 0.15, gapSize: 0.08, depthTest: false });
    const directLine = new THREE.Line(directGeom, directMat);
    directLine.computeLineDistances();
    group.add(directLine);

    // Orthogonal right triangle lines
    const corner = new THREE.Vector3(p2.x, p1.y, p2.z);

    const hGeom = new THREE.BufferGeometry().setFromPoints([p1, corner]);
    const hMat = new THREE.LineBasicMaterial({ color: 0x10b981, depthTest: false });
    const hLine = new THREE.Line(hGeom, hMat);
    group.add(hLine);

    const vGeom = new THREE.BufferGeometry().setFromPoints([corner, p2]);
    const vMat = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 2, depthTest: false });
    const vLine = new THREE.Line(vGeom, vMat);
    group.add(vLine);

    this.addEndSphere(group, p1, 0x10b981);
    this.addEndSphere(group, p2, 0xef4444);
    this.addEndSphere(group, corner, 0xfacc15, 0.04);

    // Height badge
    const vMid = new THREE.Vector3().addVectors(corner, p2).multiplyScalar(0.5);
    const div = document.createElement('div');
    div.className = 'gmv-measure-badge height';
    div.innerHTML = `
      <div><span>高差 (ΔH):</span> <strong>${formatUnit(verticalHeight, this.unit)}</strong></div>
      <div style="font-size:10px;opacity:0.85;">水平: ${formatUnit(horizontalDistance, this.unit)} · 直线: ${formatUnit(totalDistance, this.unit)}</div>
    `;
    const label = new CSS2DObject(div);
    label.position.copy(vMid);
    group.add(label);

    this.measurementGroup.add(group);

    const result: MeasurementResult = {
      id: `height_${Date.now()}`,
      type: 'height',
      value: verticalHeight,
      formattedValue: formatUnit(verticalHeight, this.unit),
      unit: this.unit,
      points: [p1, p2],
      extra: {
        verticalHeight,
        horizontalDistance,
      },
    };

    this.results.push(result);
    this.emitter.emit('measure:complete', result);
    this.cancelActive();
    this.setMode('none'); // Single-shot: automatically exit mode
  }

  private finishAreaMeasurement(): void {
    if (this.activePoints.length < 3) return;

    const points = [...this.activePoints];
    const area = compute3DPolygonArea(points);

    const group = new THREE.Group();

    // Outline polygon
    const loopPoints = [...points, points[0]];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(loopPoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x8b5cf6, linewidth: 2, depthTest: false });
    const line = new THREE.Line(lineGeom, lineMat);
    group.add(line);

    points.forEach((p) => this.addEndSphere(group, p, 0x8b5cf6));

    // Centroid
    const centroid = new THREE.Vector3();
    points.forEach((p) => centroid.add(p));
    centroid.divideScalar(points.length);

    // CSS2D Label
    const div = document.createElement('div');
    div.className = 'gmv-measure-badge area';
    div.innerHTML = `<span>面积:</span> <strong>${formatUnit(area, `${this.unit}²`)}</strong>`;
    const label = new CSS2DObject(div);
    label.position.copy(centroid);
    group.add(label);

    this.measurementGroup.add(group);

    const result: MeasurementResult = {
      id: `area_${Date.now()}`,
      type: 'area',
      value: area,
      formattedValue: formatUnit(area, `${this.unit}²`),
      unit: `${this.unit}²`,
      points,
      extra: {
        area,
      },
    };

    this.results.push(result);
    this.emitter.emit('measure:complete', result);
    this.cancelActive();
    this.setMode('none'); // Single-shot: automatically exit mode
  }

  private finishAngleMeasurement(): void {
    if (this.activePoints.length !== 3) return;

    const p1 = this.activePoints[0];
    const vertex = this.activePoints[1];
    const p2 = this.activePoints[2];

    const v1 = new THREE.Vector3().subVectors(p1, vertex).normalize();
    const v2 = new THREE.Vector3().subVectors(p2, vertex).normalize();

    let dot = v1.dot(v2);
    dot = Math.max(-1, Math.min(1, dot));
    const angleRad = Math.acos(dot);
    const angleDeg = THREE.MathUtils.radToDeg(angleRad);

    const group = new THREE.Group();

    // Lines
    const geom1 = new THREE.BufferGeometry().setFromPoints([vertex, p1]);
    const geom2 = new THREE.BufferGeometry().setFromPoints([vertex, p2]);
    const mat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2, depthTest: false });
    group.add(new THREE.Line(geom1, mat));
    group.add(new THREE.Line(geom2, mat));

    this.addEndSphere(group, p1, 0xf59e0b);
    this.addEndSphere(group, p2, 0xf59e0b);
    this.addEndSphere(group, vertex, 0xef4444, 0.08);

    // Small Arc indication
    const arcRadius = Math.min(p1.distanceTo(vertex), p2.distanceTo(vertex)) * 0.35 || 0.4;
    const arcPoints: THREE.Vector3[] = [];
    const segments = 16;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const arcVec = new THREE.Vector3().copy(v1).lerp(v2, t).normalize().multiplyScalar(arcRadius);
      arcPoints.push(new THREE.Vector3().addVectors(vertex, arcVec));
    }
    const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false });
    group.add(new THREE.Line(arcGeom, arcMat));

    // Label position
    const midDir = new THREE.Vector3().addVectors(v1, v2).normalize();
    const labelPos = vertex.clone().add(midDir.multiplyScalar(arcRadius * 1.3));

    const div = document.createElement('div');
    div.className = 'gmv-measure-badge angle';
    div.innerHTML = `<span>角度:</span> <strong>${angleDeg.toFixed(1)}°</strong>`;
    const label = new CSS2DObject(div);
    label.position.copy(labelPos);
    group.add(label);

    this.measurementGroup.add(group);

    const result: MeasurementResult = {
      id: `angle_${Date.now()}`,
      type: 'angle',
      value: angleDeg,
      formattedValue: `${angleDeg.toFixed(1)}°`,
      unit: '°',
      points: [p1, vertex, p2],
      extra: {
        angleDegree: angleDeg,
      },
    };

    this.results.push(result);
    this.emitter.emit('measure:complete', result);
    this.cancelActive();
    this.setMode('none'); // Single-shot: automatically exit mode
  }

  private addEndSphere(group: THREE.Group, pos: THREE.Vector3, color: number, scale: number = 0.06): void {
    const geom = new THREE.SphereGeometry(scale, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const sphere = new THREE.Mesh(geom, mat);
    sphere.position.copy(pos);
    group.add(sphere);
  }

  public undoLastPoint(): void {
    if (this.activePoints.length > 0) {
      this.activePoints.pop();
      this.clearActivePreview();
      this.emitter.emit('measure:change', [...this.activePoints]);
    }
  }

  public cancelActive(): void {
    this.activePoints = [];
    this.clearActivePreview();
  }

  private clearActivePreview(): void {
    while (this.activePreviewGroup.children.length > 0) {
      const obj = this.activePreviewGroup.children[0];
      this.disposeObjectHierarchy(obj);
      this.activePreviewGroup.remove(obj);
    }
  }

  /**
   * Completely clears ALL measurements and CSS2D DOM elements
   */
  public clearAll(): void {
    this.cancelActive();

    while (this.measurementGroup.children.length > 0) {
      const group = this.measurementGroup.children[0];
      this.disposeObjectHierarchy(group);
      this.measurementGroup.remove(group);
    }

    this.snapCursorMesh.visible = false;
    this.results = [];
    this.emitter.emit('measure:clear');
  }

  private disposeObjectHierarchy(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      // Clean up CSS2D HTML elements from DOM tree
      if ((child as any).isCSS2DObject && (child as CSS2DObject).element) {
        const el = (child as CSS2DObject).element;
        if (el && el.parentElement) {
          el.parentElement.removeChild(el);
        } else if (el) {
          el.remove();
        }
      }

      if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
        const item = child as THREE.Mesh;
        if (item.geometry) item.geometry.dispose();
        if (item.material) {
          if (Array.isArray(item.material)) item.material.forEach((m) => m.dispose());
          else item.material.dispose();
        }
      }
    });
  }

  public getResults(): MeasurementResult[] {
    return [...this.results];
  }

  public destroy(): void {
    this.removeListeners();
    this.clearAll();
    this.scene.remove(this.measurementGroup);
    this.scene.remove(this.activePreviewGroup);
    this.scene.remove(this.snapCursorMesh);
  }
}
