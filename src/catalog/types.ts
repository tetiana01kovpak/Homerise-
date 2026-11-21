import type * as THREE from 'three';

export type CatalogCategory =
  | 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'dining' | 'office'
  | 'lighting' | 'decor' | 'storage' | 'outdoor' | 'structure' | 'vehicles' | 'custom';

/** 2D plan symbol primitive, local coordinates in meters, centered on the item (x right, y toward the item's front). */
export type PlanShape =
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'path'; d: string; fill?: boolean };

export interface BuildOptions { w: number; d: number; h: number; color?: string }

export interface CatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  tags: string[];
  /** Default size in meters: w = width (x), d = depth (z / plan y), h = height. */
  size: { w: number; d: number; h: number };
  /** Default elevation (e.g. wall cabinets, pendant lamps). */
  elevation?: number;
  defaultColor?: string;
  /** Builds the 3D object. Origin at bottom-center; width along +X, depth along Z, front faces +Z. Must fit the given w/d/h box. */
  build: (o: BuildOptions) => THREE.Object3D;
  /** Optional plan symbol (top view) in local coords for size w × d. Front edge is +y. */
  plan?: (w: number, d: number) => PlanShape[];
  outdoor?: boolean;
  /** Emits light in 3D. */
  light?: boolean;
}
