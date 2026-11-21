import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PlanShape } from './types';

/* ------------------------------------------------------------------ */
/* Materials (cached + shared — callers must NOT dispose them)         */
/* ------------------------------------------------------------------ */

export interface MatOpts {
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  doubleSide?: boolean;
  flatShading?: boolean;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** Cached MeshStandardMaterial keyed by all parameters. Shared between items: never dispose. */
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const roughness = o.roughness ?? 0.7;
  const metalness = o.metalness ?? 0;
  const opacity = o.opacity ?? 1;
  const transparent = !!o.transparent || opacity < 1;
  const key = [
    color.toLowerCase(), roughness, metalness, transparent ? 1 : 0, opacity,
    o.emissive ?? '', o.emissiveIntensity ?? 1, o.doubleSide ? 1 : 0, o.flatShading ? 1 : 0,
  ].join('|');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness,
      metalness,
      transparent,
      opacity,
      side: o.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      flatShading: !!o.flatShading,
    });
    if (o.emissive) {
      m.emissive = new THREE.Color(o.emissive);
      m.emissiveIntensity = o.emissiveIntensity ?? 1;
    }
    if (transparent) m.depthWrite = false;
    m.userData.shared = true;
    m.name = `catalog:${key}`;
    matCache.set(key, m);
  }
  return m;
}

/** Soft modern Scandinavian palette. */
export const C = {
  fabric: '#b9b4aa',
  fabricLight: '#d8d2c6',
  linen: '#ece7dd',
  oak: '#c9a57b',
  lightOak: '#dcc19d',
  walnut: '#7a5a43',
  white: '#f3f1ec',
  offWhite: '#e6e1d7',
  greige: '#cfc8bc',
  charcoal: '#3b3b3e',
  black: '#1f1f21',
  chrome: '#e0e0e0',
  steel: '#a3a8ad',
  brass: '#c8a45a',
  glass: '#d4ecf3',
  water: '#3aa6d6',
  leaf: '#5f8f4e',
  leafDark: '#3e6a3c',
  bark: '#6b4a33',
  terracotta: '#c47152',
  ceramic: '#f8f8f6',
  stone: '#bdb8ae',
  concrete: '#a9a9a4',
  grass: '#6fa35a',
  soil: '#5b4333',
  sage: '#9aab93',
  blush: '#d8b6a6',
  navy: '#3d4b64',
  bulb: '#fff3d6',
} as const;

export const M = {
  fabric: (c?: string) => mat(c ?? C.fabric, { roughness: 0.95 }),
  wood: (c?: string) => mat(c ?? C.oak, { roughness: 0.6 }),
  walnut: () => mat(C.walnut, { roughness: 0.55 }),
  lacquer: (c?: string) => mat(c ?? C.white, { roughness: 0.45 }),
  matte: (c: string) => mat(c, { roughness: 0.85 }),
  plastic: (c: string) => mat(c, { roughness: 0.4 }),
  chrome: () => mat(C.chrome, { roughness: 0.15, metalness: 1 }),
  steel: () => mat(C.steel, { roughness: 0.35, metalness: 0.8 }),
  brass: () => mat(C.brass, { roughness: 0.3, metalness: 0.9 }),
  blackMetal: () => mat('#2b2b2e', { roughness: 0.45, metalness: 0.6 }),
  black: () => mat(C.black, { roughness: 0.5 }),
  glass: () => mat(C.glass, { roughness: 0.05, metalness: 0.1, opacity: 0.3 }),
  // no env map in the scene, so a fully metallic mirror renders black: use a bright glossy dielectric
  mirror: () => mat('#cdd9de', { roughness: 0.06, metalness: 0.35 }),
  water: () => mat(C.water, { roughness: 0.06, metalness: 0.1, opacity: 0.78 }),
  ceramic: () => mat(C.ceramic, { roughness: 0.15 }),
  screen: () => mat('#101215', { roughness: 0.15, metalness: 0.4 }),
  bulb: (c: string = C.bulb) => mat(c, { emissive: c, emissiveIntensity: 1.6, roughness: 0.4 }),
  shade: (c: string = C.linen) => mat(c, { roughness: 0.9, emissive: '#ffe9c2', emissiveIntensity: 0.25, doubleSide: true }),
  leaf: (c: string = C.leaf) => mat(c, { roughness: 0.85, flatShading: true }),
  bark: () => mat(C.bark, { roughness: 0.95 }),
  soil: () => mat(C.soil, { roughness: 1 }),
  grass: () => mat(C.grass, { roughness: 0.95 }),
  stone: (c: string = C.stone) => mat(c, { roughness: 0.9 }),
  concrete: () => mat(C.concrete, { roughness: 0.95 }),
};

/* ------------------------------------------------------------------ */
/* Geometry helpers. All take the BOTTOM y of the part (y = floor),     */
/* x/z are centers. Meshes cast + receive shadows.                      */
/* ------------------------------------------------------------------ */

const EPS = 1e-3;
const pos = (v: number) => Math.max(EPS, v);

export function mesh(geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

export function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = mesh(new THREE.BoxGeometry(pos(w), pos(h), pos(d)), m);
  me.position.set(x, y + h / 2, z);
  return me;
}

/** Rounded box; radius is clamped to fit. */
export function rbox(w: number, h: number, d: number, m: THREE.Material, radius = 0.03, x = 0, y = 0, z = 0, segments = 3): THREE.Mesh {
  w = pos(w); h = pos(h); d = pos(d);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2, d / 2) * 0.98);
  const geo = r < 0.002 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, segments, r);
  const me = mesh(geo, m);
  me.position.set(x, y + h / 2, z);
  return me;
}

/** Vertical cylinder (bottom at y). */
export function cyl(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20, rTop?: number, openEnded = false): THREE.Mesh {
  const me = mesh(new THREE.CylinderGeometry(pos(rTop ?? r), pos(r), pos(h), seg, 1, openEnded), m);
  me.position.set(x, y + h / 2, z);
  return me;
}

/** Horizontal rod along X, centered at (x, y, z) (y = axis height). */
export function rodX(len: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12): THREE.Mesh {
  const me = mesh(new THREE.CylinderGeometry(pos(r), pos(r), pos(len), seg), m);
  me.rotation.z = Math.PI / 2;
  me.position.set(x, y, z);
  return me;
}

/** Horizontal rod along Z, centered at (x, y, z) (y = axis height). */
export function rodZ(len: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12): THREE.Mesh {
  const me = mesh(new THREE.CylinderGeometry(pos(r), pos(r), pos(len), seg), m);
  me.rotation.x = Math.PI / 2;
  me.position.set(x, y, z);
  return me;
}

/** Rod between two points. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 10): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const me = mesh(new THREE.CylinderGeometry(pos(r), pos(r), pos(len), seg), m);
  me.position.copy(a).addScaledVector(dir, 0.5);
  if (len > 0) me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return me;
}

/** Sphere centered at (x, y, z). */
export function sphere(r: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 16): THREE.Mesh {
  const me = mesh(new THREE.SphereGeometry(pos(r), seg, Math.max(8, Math.round(seg * 0.75))), m);
  me.position.set(x, y, z);
  return me;
}

/** Ellipsoid (scaled sphere) with bottom at y. */
export function ellipsoid(rx: number, ry: number, rz: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 14): THREE.Mesh {
  const me = sphere(1, m, x, y + ry, z, seg);
  me.scale.set(pos(rx), pos(ry), pos(rz));
  return me;
}

/** Cone with bottom at y. */
export function cone(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 16): THREE.Mesh {
  const me = mesh(new THREE.ConeGeometry(pos(r), pos(h), seg), m);
  me.position.set(x, y + h / 2, z);
  return me;
}

/** Torus lying flat (in XZ plane), center at (x, y, z). */
export function ringFlat(R: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  const me = mesh(new THREE.TorusGeometry(pos(R), pos(r), 8, seg), m);
  me.rotation.x = Math.PI / 2;
  me.position.set(x, y, z);
  return me;
}

/** Torus standing upright in the XY plane (e.g. a wheel facing ±X when rotated). */
export function ringUpright(R: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 28): THREE.Mesh {
  const me = mesh(new THREE.TorusGeometry(pos(R), pos(r), 8, seg), m);
  me.position.set(x, y, z);
  return me;
}

/** Extrude a 2D shape (in XY) by depth along +Z, then rotate so the shape lies in the XZ plane (top view) with thickness upward. */
export function extrudeFlat(shape: THREE.Shape, thickness: number, m: THREE.Material, y = 0): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: pos(thickness), bevelEnabled: false, curveSegments: 16 });
  // shape (x, y) -> world (x, -z) after rotating -90° about X; extrusion goes +y.
  geo.rotateX(-Math.PI / 2);
  const me = mesh(geo, m);
  me.position.y = y;
  return me;
}

export function group(...objs: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const o of objs) g.add(o);
  return g;
}

/** Ensure every mesh in the tree casts & receives shadows. */
export function shadows<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    const me = c as THREE.Mesh;
    if (me.isMesh) { me.castShadow = true; me.receiveShadow = true; }
  });
  return o;
}

/**
 * Wraps `obj` so its bounding box exactly fills w×d×h with the origin at bottom-center.
 * Used for organic/complex shapes (trees, vehicles) modelled in arbitrary units.
 */
export function fitToBox(obj: THREE.Object3D, w: number, d: number, h: number): THREE.Group {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const size = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(obj);
  inner.position.set(-c.x, -b.min.y, -c.z);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.scale.set(w / pos(size.x), h / pos(size.y), d / pos(size.z));
  return outer;
}

/** Four legs at the corners of a w×d footprint (inset), from y0 up to y0+legH. */
export function legs4(w: number, d: number, legH: number, m: THREE.Material, opts: { inset?: number; r?: number; square?: boolean; y0?: number; taper?: number } = {}): THREE.Group {
  const r = opts.r ?? 0.02;
  const inset = opts.inset ?? r + 0.02;
  const y0 = opts.y0 ?? 0;
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - inset);
    const z = sz * (d / 2 - inset);
    g.add(opts.square ? box(r * 2, legH, r * 2, m, x, y0, z) : cyl(r * (opts.taper ?? 1), legH, m, x, y0, z, 12, r));
  }
  return g;
}

/** Simple bar handle on a front face (+Z), horizontal. */
export function handleH(len: number, m: THREE.Material, x: number, y: number, z: number): THREE.Group {
  const r = 0.006;
  return group(
    rodX(len, r, m, x, y, z + 0.022),
    rodZ(0.022, r * 0.8, m, x - len / 2 + 0.01, y, z + 0.011, 8),
    rodZ(0.022, r * 0.8, m, x + len / 2 - 0.01, y, z + 0.011, 8),
  );
}

/** Vertical bar handle on a front face (+Z). */
export function handleV(len: number, m: THREE.Material, x: number, y: number, z: number): THREE.Group {
  const r = 0.006;
  const bar = mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
  bar.position.set(x, y, z + 0.022);
  return group(
    bar,
    rodZ(0.022, r * 0.8, m, x, y - len / 2 + 0.01, z + 0.011, 8),
    rodZ(0.022, r * 0.8, m, x, y + len / 2 - 0.01, z + 0.011, 8),
  );
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* Lazy canvas textures (browser only).                                */
/* ------------------------------------------------------------------ */

const texCache = new Map<string, THREE.Texture | null>();

/** Returns a cached CanvasTexture drawn by `draw`, or null outside the browser. */
export function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.Texture | null {
  if (texCache.has(key)) return texCache.get(key) ?? null;
  let tex: THREE.Texture | null = null;
  if (typeof document !== 'undefined') {
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      if (ctx) {
        draw(ctx, size);
        tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
      }
    } catch {
      tex = null;
    }
  }
  texCache.set(key, tex);
  return tex;
}

const texMatCache = new Map<string, THREE.MeshStandardMaterial>();
/** Material using a canvas texture when available, else a flat color. */
export function texMat(key: string, fallback: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const tex = canvasTexture(key, 256, draw);
  if (!tex) return mat(fallback, o);
  let m = texMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: o.roughness ?? 0.7, metalness: o.metalness ?? 0 });
    m.userData.shared = true;
    texMatCache.set(key, m);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Plan (top view) helpers.                                             */
/* Convention: rect {x, y} is the MIN corner (SVG-like), w along x,     */
/* h along y. +y is the item's front.                                   */
/* ------------------------------------------------------------------ */

export const P = {
  /** Rectangle by center. */
  rect: (cx: number, cy: number, w: number, h: number, r?: number, fill?: boolean): PlanShape =>
    ({ t: 'rect', x: cx - w / 2, y: cy - h / 2, w, h, ...(r ? { r } : {}), ...(fill ? { fill } : {}) }),
  circle: (cx: number, cy: number, r: number, fill?: boolean): PlanShape => ({ t: 'circle', cx, cy, r, ...(fill ? { fill } : {}) }),
  line: (x1: number, y1: number, x2: number, y2: number): PlanShape => ({ t: 'line', x1, y1, x2, y2 }),
  path: (d: string, fill?: boolean): PlanShape => ({ t: 'path', d, ...(fill ? { fill } : {}) }),
  /** Polyline / polygon path from points. */
  poly: (pts: [number, number][], close = true, fill?: boolean): PlanShape => ({
    t: 'path',
    d: pts.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join(' ') + (close ? ' Z' : ''),
    ...(fill ? { fill } : {}),
  }),
  /** Circular arc path from angle a0 to a1 (radians, standard math orientation in plan coords). */
  arc: (cx: number, cy: number, r: number, a0: number, a1: number): PlanShape => {
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return { t: 'path', d: `M${n(x0)} ${n(y0)} A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(x1)} ${n(y1)}` };
  },
};

/** Number formatting for path strings. */
export const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * Rectangular frustum (box with a differently sized top), bottom at y.
 * Top face is offset by (topDx, topDz) relative to the bottom center.
 */
export function frustum(wb: number, db: number, wt: number, dt: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, topDx = 0, topDz = 0): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * pos(top ? wt : wb) + (top ? topDx : 0));
    p.setZ(i, p.getZ(i) * pos(top ? dt : db) + (top ? topDz : 0));
    p.setY(i, p.getY(i) * pos(h));
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const me = mesh(geo, m);
  me.position.set(x, y + h / 2, z);
  return me;
}

/** Ellipse plan path. */
export function planEllipse(cx: number, cy: number, rx: number, ry: number, fill?: boolean): PlanShape {
  return {
    t: 'path',
    d: `M${n(cx - rx)} ${n(cy)} A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)} A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)} Z`,
    ...(fill ? { fill } : {}),
  };
}

/** Rotate+translate local plan points. */
export function xform(pts: [number, number][], angle: number, cx: number, cy: number): [number, number][] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

/** Simple deterministic PRNG (mulberry32) for repeatable decoration. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Extrude a side profile given as (z, y) points (z toward the front, y up) across the X axis.
 * The result spans x ∈ [x0 - width/2, x0 + width/2].
 */
export function sideProfile(pts: [number, number][], width: number, m: THREE.Material, x0 = 0): THREE.Mesh {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: pos(width), bevelEnabled: false });
  // shape (u, v, t) -> world (t, v, -u) after rotating +90° about Y
  geo.rotateY(Math.PI / 2);
  geo.translate(x0 - width / 2, 0, 0);
  return mesh(geo, m);
}

/** Scales/recenters `g` horizontally (x/z only) so its footprint exactly fills w×d. Height is untouched. */
export function fitXZ<T extends THREE.Object3D>(g: T, w: number, d: number): T {
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  const s = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const kx = w / pos(s.x), kz = d / pos(s.z);
  g.scale.set(g.scale.x * kx, g.scale.y, g.scale.z * kz);
  g.position.x -= c.x * kx;
  g.position.z -= c.z * kz;
  return g;
}
