import * as THREE from 'three';

export type CameraView =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'isometric'
  | 'isometric-back';

export type MeasurementType = 'distance' | 'area' | 'height' | 'angle' | 'none';

export type AutoRotateAxis = 'x' | 'y';
export type AutoRotateDirection = 'clockwise' | 'counter-clockwise';
export type RotationLockAxis = 'x' | 'y' | 'z' | null;

export interface AutoRotateOptions {
  enabled: boolean;
  axis: AutoRotateAxis;
  direction: AutoRotateDirection;
  speed: number;
}

export type ClippingAxis = 'x' | 'y' | 'z';

export interface ViewerOptions {
  container: HTMLElement;
  background?: string | number | null;
  alpha?: boolean;
  antialias?: boolean;
  cameraFov?: number;
  cameraNear?: number;
  cameraFar?: number;
  showBoundingBox?: boolean; // default: false (默认隐藏范围框及尺寸线)
  unit?: string; // e.g. 'm', 'mm', 'cm'
  controlsType?: 'trackball' | 'orbit'; // default: 'trackball' for infinite 360° unconstrained rotation
  dracoDecoderPath?: string; // Optional custom Draco decoder path (default: https://www.gstatic.com/draco/versioned/decoders/1.5.7/)
  ktx2TranscoderPath?: string; // Optional custom KTX2 Basis transcoder path (default: https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/basis/)
}

export interface ModelLoadResult {
  model: THREE.Group;
  box: THREE.Box3;
  size: THREE.Vector3;
  center: THREE.Vector3;
  vertexCount: number;
  faceCount: number;
  animations?: THREE.AnimationClip[];
  format?: 'obj' | 'gltf' | 'glb' | 'sample';
}

export interface MeasurementResult {
  id: string;
  type: MeasurementType;
  value: number; // raw value in model units
  formattedValue: string;
  unit: string;
  points: THREE.Vector3[];
  extra?: {
    horizontalDistance?: number;
    verticalHeight?: number;
    angleDegree?: number;
    area?: number;
  };
}

export interface ExportImageOptions {
  scale?: number | 'original'; // 1, 2, 4 or 'original'
  originalQuality?: boolean; // Export at model's actual original texture size (1:1 贴图原画质)
  targetSize?: { width: number; height: number }; // Optional custom target dimensions
  modelOnly?: boolean; // Only export model + background, hiding helpers/measurements/grid/clipping planes (default: true)
  type?: 'image/png' | 'image/jpeg';
  quality?: number; // 0 to 1
  download?: boolean;
  filename?: string;
  background?: string | null;
}

export interface ClippingOptions {
  axis?: ClippingAxis;
  value?: number; // normalized 0 to 1
  inverted?: boolean;
}

export interface ClippingChangeEvent {
  axis?: ClippingAxis;
  position?: number;
  progress?: number;
  inverted?: boolean;
  enabled?: boolean;
  axisClipping?: Record<ClippingAxis, number>;
  customPlaneActive?: boolean;
}

export interface AxisSectionState {
  enabled: boolean;
  inverted: boolean;
  progress: number;
  position: number;
}

export interface SectioningState {
  enabled: boolean;
  axes: Record<ClippingAxis, AxisSectionState>;
  helperVisible: boolean;
  axis?: ClippingAxis;
  isReverse?: boolean;
  progress?: number;
  position?: number;
}

export type ModelDisplayStyle = 'solid' | 'wireframe';

export interface PointsOptions {
  size?: number;
  color?: string | number;
  sizeAttenuation?: boolean;
  opacity?: number;
}

export interface BoundingBoxOptions {
  visible: boolean;
  showDimensions?: boolean;
  color?: string | number;
  unit?: string;
}

export type ViewerEvents = {
  'load:start': (url: string | File) => void;
  'load:progress': (progress: number, message: string) => void;
  'load:success': (result: ModelLoadResult) => void;
  'load:error': (error: Error) => void;
  'measure:start': (type: MeasurementType) => void;
  'measure:change': (points: THREE.Vector3[]) => void;
  'measure:complete': (result: MeasurementResult) => void;
  'measure:clear': () => void;
  'clipping:change': (info: ClippingChangeEvent) => void;
  'sectioning:change': (state: SectioningState) => void;
  'view:change': (view: CameraView) => void;
  'texture:toggle': (hasTexture: boolean) => void;
  'autorotate:change': (options: AutoRotateOptions) => void;
  'axislock:change': (lockedAxis: RotationLockAxis) => void;
  'style:change': (style: ModelDisplayStyle) => void;
  'pointsize:change'?: (size: number) => void;
  'animation:play'?: (name: string) => void;
  'animation:pause'?: () => void;
  'animation:stop'?: () => void;
  'animation:speed'?: (speed: number) => void;
};
