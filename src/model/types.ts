// Homerise core data model. Units: meters. Plan space: x → right, y → down.
// 3D space: plan x → world X, plan y → world Z, world Y is up.

export type Vec2 = { x: number; y: number };

export type OpeningKind =
  | 'door' | 'doubleDoor' | 'slidingDoor' | 'garageDoor' | 'frontDoor'
  | 'window' | 'wideWindow' | 'fixedWindow' | 'opening';

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** Override level wall height. */
  height?: number;
  /** Paint / material on the left (a→b, left side) and right side. */
  colorLeft?: string;
  colorRight?: string;
  exterior?: boolean;
  /** Half-wall / railing style */
  kind?: 'wall' | 'railing' | 'invisible';
}

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance from wall.a to opening center, meters. */
  t: number;
  width: number;
  height: number;
  /** Bottom elevation from floor. */
  sill: number;
  /** Door swing side / which face the door opens toward. */
  flip?: boolean;
  hinge?: 'left' | 'right';
}

export type RoomType =
  | 'living' | 'kitchen' | 'dining' | 'bedroom' | 'bathroom' | 'wc' | 'office'
  | 'hall' | 'garage' | 'laundry' | 'storage' | 'closet' | 'balcony' | 'terrace'
  | 'basement' | 'utility' | 'other';

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  points: Vec2[];
  floor: string; // material id
  ceilingColor?: string;
  showCeiling?: boolean;
}

export interface Item {
  id: string;
  catalogId: string; // built-in catalog id or "custom:<modelId>"
  x: number;
  y: number;
  rotation: number; // radians, about vertical axis (plan clockwise positive)
  elevation: number;
  w: number;
  d: number;
  h: number;
  color?: string;
  name?: string;
}

export type RoofKind = 'gable' | 'hip' | 'flat' | 'shed';

export interface Roof {
  id: string;
  kind: RoofKind;
  /** Axis-aligned rectangle the roof covers (before overhang). */
  x: number; y: number; w: number; d: number;
  pitch: number; // degrees
  overhang: number;
  /** For gable/shed: ridge runs along this axis. */
  ridge: 'x' | 'y';
  color: string;
  /** Base elevation override relative to level elevation (defaults to level height). */
  base?: number;
}

export interface Label { id: string; x: number; y: number; text: string; size?: number }
export interface Dimension { id: string; a: Vec2; b: Vec2; offset: number }

export interface Level {
  id: string;
  name: string;
  /** Elevation of finished floor relative to ground (m). Basements are negative. */
  elevation: number;
  /** Floor-to-ceiling height. */
  height: number;
  slab: number;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  roofs: Roof[];
  labels: Label[];
  dims: Dimension[];
  visible?: boolean;
}

export interface TraceImage {
  dataUrl: string;
  /** World position of top-left corner and meters per pixel. */
  x: number; y: number;
  metersPerPixel: number;
  opacity: number;
  width: number; height: number;
}

export interface CustomModelMeta {
  id: string;
  name: string;
  format: string;
  /** Natural size after normalization (m). */
  w: number; d: number; h: number;
  category: string;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  levels: Level[];
  activeLevelId: string;
  settings: {
    units: 'metric' | 'imperial';
    wallThickness: number;
    wallHeight: number;
    exteriorWallColor: string;
    interiorWallColor: string;
    groundColor: string;
    showGround: boolean;
  };
  trace?: Record<string, TraceImage>; // keyed by level id
  customModels: CustomModelMeta[];
  createdAt: number;
  updatedAt: number;
}

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
