import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import * as TWEEN from '@tweenjs/tween.js';
import { AutoRotateAxis, AutoRotateDirection, AutoRotateOptions, CameraView, RotationLockAxis } from '../types';

export class CameraTool {
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | TrackballControls;
  private tweenGroup: TWEEN.Group;
  private currentTween: TWEEN.Tween<{ t: number }> | null = null;

  // Auto-Rotation State (Default: X-axis rotation, clockwise)
  private isAutoRotating: boolean = false;
  private autoRotateAxis: AutoRotateAxis = 'x';
  private autoRotateDirection: AutoRotateDirection = 'clockwise';
  private autoRotateSpeed: number = 1.0;

  // Axis Rotation Lock State
  private lockedAxis: RotationLockAxis = null;
  private lockedPitchAngle: number = 0;
  private lockedYawAngle: number = 0;

  constructor(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls | TrackballControls,
    tweenGroup?: TWEEN.Group
  ) {
    this.camera = camera;
    this.controls = controls;
    this.tweenGroup = tweenGroup || new TWEEN.Group();
  }

  // ==========================================
  // Auto-Rotation Controls
  // ==========================================

  public setAutoRotate(
    enabled: boolean,
    axis?: AutoRotateAxis,
    direction?: AutoRotateDirection,
    speed?: number
  ): void {
    this.isAutoRotating = enabled;
    if (axis !== undefined) this.autoRotateAxis = axis;
    if (direction !== undefined) this.autoRotateDirection = direction;
    if (speed !== undefined) this.autoRotateSpeed = speed;
  }

  public toggleAutoRotate(): boolean {
    this.isAutoRotating = !this.isAutoRotating;
    return this.isAutoRotating;
  }

  public setAutoRotateAxis(axis: AutoRotateAxis): void {
    this.autoRotateAxis = axis;
  }

  public setAutoRotateDirection(direction: AutoRotateDirection): void {
    this.autoRotateDirection = direction;
  }

  public setAutoRotateSpeed(speed: number): void {
    this.autoRotateSpeed = Math.max(0.1, Math.min(10, speed));
  }

  public getAutoRotateState(): AutoRotateOptions {
    return {
      enabled: this.isAutoRotating,
      axis: this.autoRotateAxis,
      direction: this.autoRotateDirection,
      speed: this.autoRotateSpeed,
    };
  }

  // ==========================================
  // Axis Rotation Lock Controls (X / Y / Z Lock)
  // ==========================================

  public setLockedAxis(axis: RotationLockAxis): void {
    this.lockedAxis = axis;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const radius = offset.length();

    if (radius > 0.0001) {
      this.lockedPitchAngle = Math.asin(Math.max(-1, Math.min(1, offset.y / radius)));
      this.lockedYawAngle = Math.atan2(offset.z, offset.x);
    }
  }

  public getLockedAxis(): RotationLockAxis {
    return this.lockedAxis;
  }

  /**
   * Called each frame in render loop to apply auto-rotation and axis lock constraints
   */
  public updatePerFrame(): void {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const radius = offset.length();

    // 1. Auto-rotation logic
    if (this.isAutoRotating && radius > 0.001) {
      const dirSign = this.autoRotateDirection === 'clockwise' ? 1 : -1;
      const angle = 0.008 * this.autoRotateSpeed * dirSign;

      if (this.autoRotateAxis === 'x') {
        // Rotate around world X axis (1, 0, 0)
        const rotAxis = new THREE.Vector3(1, 0, 0);
        offset.applyAxisAngle(rotAxis, angle);
        this.camera.up.applyAxisAngle(rotAxis, angle);
      } else {
        // Rotate around world Y axis (0, 1, 0)
        const rotAxis = new THREE.Vector3(0, 1, 0);
        offset.applyAxisAngle(rotAxis, angle);
        this.camera.up.applyAxisAngle(rotAxis, angle);
      }

      this.camera.position.copy(target).add(offset);
      this.camera.lookAt(target);
    }

    // 2. Axis Rotation Lock Constraints
    if (this.lockedAxis && radius > 0.001) {
      const currentOffset = this.camera.position.clone().sub(target);
      const curRadius = currentOffset.length();

      if (this.lockedAxis === 'x') {
        // Lock X-rotation (Pitch locked, can only revolve horizontally around world Y)
        const hRadius = curRadius * Math.cos(this.lockedPitchAngle);
        const targetY = curRadius * Math.sin(this.lockedPitchAngle);
        const angleXZ = Math.atan2(currentOffset.z, currentOffset.x);
        currentOffset.x = hRadius * Math.cos(angleXZ);
        currentOffset.y = targetY;
        currentOffset.z = hRadius * Math.sin(angleXZ);
        this.camera.position.copy(target).add(currentOffset);
      } else if (this.lockedAxis === 'y') {
        // Lock Y-rotation (Yaw locked, can only pitch vertically in the locked azimuth plane)
        const curY = currentOffset.y;
        const hRadius = Math.sqrt(Math.max(0, curRadius * curRadius - curY * curY));
        currentOffset.x = hRadius * Math.cos(this.lockedYawAngle);
        currentOffset.z = hRadius * Math.sin(this.lockedYawAngle);
        this.camera.position.copy(target).add(currentOffset);
      } else if (this.lockedAxis === 'z') {
        // Lock Z-rotation (Roll locked, camera remains strictly upright without tilting)
        this.camera.up.set(0, 1, 0);
      }

      this.camera.lookAt(target);
    }
  }

  /**
   * Smoothly transitions the camera to one of the 8 standard view orientations
   */
  public setView(
    view: CameraView,
    targetObject: THREE.Object3D,
    duration: number = 600
  ): Promise<void> {
    return new Promise((resolve) => {
      // 1. Calculate bounding sphere of target
      const box = new THREE.Box3().setFromObject(targetObject);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);

      const center = sphere.center.clone();
      const radius = Math.max(sphere.radius, 1);

      // Adjust camera near and far to prevent clipping large/small models
      this.camera.near = Math.max(0.01, radius / 500);
      this.camera.far = Math.max(10000, radius * 50);
      this.camera.updateProjectionMatrix();

      // Fit distance based on FOV
      const fovRad = (this.camera.fov * Math.PI) / 180;
      const fitDistance = (radius / Math.sin(fovRad / 2)) * 1.15;

      // 2. Determine target direction vector and up vector for the view
      const dir = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);

      switch (view) {
        case 'front': // Front (+Z)
          dir.set(0, 0, 1);
          break;
        case 'back': // Back (-Z)
          dir.set(0, 0, -1);
          break;
        case 'left': // Left (-X)
          dir.set(-1, 0, 0);
          break;
        case 'right': // Right (+X)
          dir.set(1, 0, 0);
          break;
        case 'top': // Top (+Y)
          dir.set(0, 1, 0.0001); // Slight offset to prevent gimbal lock
          up.set(0, 0, -1);
          break;
        case 'bottom': // Bottom (-Y)
          dir.set(0, -1, 0.0001);
          up.set(0, 0, 1);
          break;
        case 'isometric': // Isometric Front-Right-Top
          dir.set(1, 1, 1).normalize();
          break;
        case 'isometric-back': // Isometric Back-Left-Top
          dir.set(-1, 1, -1).normalize();
          break;
      }

      const targetCamPos = center.clone().add(dir.multiplyScalar(fitDistance));

      // 3. Stop any existing tween
      if (this.currentTween) {
        this.currentTween.stop();
        this.currentTween = null;
      }

      this.camera.up.copy(up);

      // If duration is 0, apply view immediately without animation
      if (duration <= 0) {
        this.camera.position.copy(targetCamPos);
        this.controls.target.copy(center);
        this.controls.update();
        resolve();
        return;
      }

      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();

      // Interpolate both camera position and target
      const animData = { t: 0 };
      this.currentTween = new TWEEN.Tween(animData, this.tweenGroup)
        .to({ t: 1 }, duration)
        .easing(TWEEN.Easing.Cubic.Out)
        .onUpdate(() => {
          this.camera.position.lerpVectors(startPos, targetCamPos, animData.t);
          this.controls.target.lerpVectors(startTarget, center, animData.t);
          this.controls.update();
        })
        .onComplete(() => {
          this.camera.position.copy(targetCamPos);
          this.controls.target.copy(center);
          this.controls.update();
          this.currentTween = null;
          resolve();
        })
        .start();
    });
  }

  /**
   * Fits camera to view the whole object from current angle
   */
  public fitToObject(object: THREE.Object3D, duration: number = 500): Promise<void> {
    return new Promise((resolve) => {
      const box = new THREE.Box3().setFromObject(object);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);

      const center = sphere.center;
      const radius = Math.max(sphere.radius, 1);

      // Adjust camera near and far to prevent clipping large/small models
      this.camera.near = Math.max(0.01, radius / 500);
      this.camera.far = Math.max(10000, radius * 50);
      this.camera.updateProjectionMatrix();

      const fovRad = (this.camera.fov * Math.PI) / 180;
      const fitDistance = (radius / Math.sin(fovRad / 2)) * 1.15;

      const currentDir = this.camera.position.clone().sub(this.controls.target).normalize();
      const targetCamPos = center.clone().add(currentDir.multiplyScalar(fitDistance));

      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();

      const animData = { t: 0 };
      new TWEEN.Tween(animData, this.tweenGroup)
        .to({ t: 1 }, duration)
        .easing(TWEEN.Easing.Cubic.Out)
        .onUpdate(() => {
          this.camera.position.lerpVectors(startPos, targetCamPos, animData.t);
          this.controls.target.lerpVectors(startTarget, center, animData.t);
          this.controls.update();
        })
        .onComplete(() => {
          this.camera.position.copy(targetCamPos);
          this.controls.target.copy(center);
          this.controls.update();
          resolve();
        })
        .start();
    });
  }
}
