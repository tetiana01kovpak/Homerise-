// Project → three.js scene graph. Pure function of the project (plus caches), used by the 3D view and exporters.
import * as THREE from 'three';
import type { Project, Level, Wall, Opening, Room, Item, Roof, Vec2 } from '../model/types';
import { wallLength, wallAngle, wallNormal, wallExtensions, pointInPolygon, add, mul, centroid } from '../model/geometry';
import { floorMaterial, colorMaterial, glassMaterial, roofTexture } from './materials';
import { getCatalogItem } from '../catalog';

export interface BuildOptions {
  activeLevelId?: string;
  /** 'all' = every level; 'upto' = levels up to and including active (RoomSketcher style) ; 'only' = just the active level */
  levels?: 'all' | 'upto' | 'only';
  wallMode?: 'full' | 'cut' | 'low';
  showRoof?: boolean;
  showFurniture?: boolean;
  /** For exports: skip transparent glass and tiny decorative parts. */
  forExport?: boolean;
  customModels?: Map<string, THREE.Object3D>;
}

const FRAME = '#FFFFFF';
const DOOR = '#F3F1EC';
const FRONT_DOOR = '#3C4147';

export function tag(o: THREE.Object3D, kind: string, id: string, levelId: string) {
  o.userData = { ...o.userData, kind, id, levelId };
  o.traverse((c) => { if (c !== o) c.userData = { ...c.userData, kind, id, levelId }; });
  return o;
}

function setShadow(o: THREE.Object3D, cast = true, receive = true) {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
}

/** Which side (+1 left/normal, -1 right) of an exterior wall faces outdoors. */
function outdoorSide(w: Wall, rooms: Room[]) {
  const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
  const n = wallNormal(w);
  const off = w.thickness / 2 + 0.08;
  const inL = rooms.some((r) => r.type !== 'terrace' && r.type !== 'balcony' && pointInPolygon(add(mid, mul(n, off)), r.points));
  const inR = rooms.some((r) => r.type !== 'terrace' && r.type !== 'balcony' && pointInPolygon(add(mid, mul(n, -off)), r.points));
  if (inL && !inR) return -1;
  if (inR && !inL) return 1;
  return 0;
}

function wallMaterials(w: Wall, p: Project, rooms: Room[]) {
  const s = p.settings;
  let left = w.colorLeft ?? s.interiorWallColor;
  let right = w.colorRight ?? s.interiorWallColor;
  if (w.exterior) {
    const side = outdoorSide(w, rooms);
    if (side === 1) left = w.colorLeft ?? s.exteriorWallColor;
    else if (side === -1) right = w.colorRight ?? s.exteriorWallColor;
    else { left = w.colorLeft ?? s.exteriorWallColor; right = w.colorRight ?? s.exteriorWallColor; }
  }
  const cap = colorMaterial(w.exterior ? '#E6E2DA' : '#EDEBE6', { roughness: 0.9 });
  const capTop = colorMaterial('#3B4048', { roughness: 0.7 });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z ; local +z = wall normal (left side)
  return [cap, cap, capTop, cap, colorMaterial(left, { roughness: 0.92 }), colorMaterial(right, { roughness: 0.92 })];
}

function wallPiece(w: Wall, s: number, e: number, y0: number, y1: number, mats: THREE.Material[]) {
  const L = e - s, H = y1 - y0;
  if (L <= 0.005 || H <= 0.005) return null;
  const g = new THREE.BoxGeometry(L, H, w.thickness);
  const m = new THREE.Mesh(g, mats);
  const ang = wallAngle(w);
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };
  const cx = w.a.x + dir.x * (s + L / 2), cy = w.a.y + dir.y * (s + L / 2);
  m.position.set(cx, y0 + H / 2, cy);
  m.rotation.y = -ang;
  return m;
}

function openingMesh(o: Opening, w: Wall, H: number): THREE.Object3D {
  const g = new THREE.Group();
  const T = w.thickness;
  const frameM = colorMaterial(FRAME, { roughness: 0.5 });
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z); g.add(mesh); return mesh;
  };
  const W = o.width, oh = Math.min(o.height, H - o.sill), sill = o.sill;
  const f = 0.06; // frame width
  const isWindow = o.kind.includes('indow');
  if (o.kind === 'opening') {
    // slim casing only
    box(-W / 2 + 0.01, sill + oh / 2, 0, 0.02, oh, T + 0.02, frameM);
    box(W / 2 - 0.01, sill + oh / 2, 0, 0.02, oh, T + 0.02, frameM);
    box(0, sill + oh - 0.01, 0, W, 0.02, T + 0.02, frameM);
  } else if (isWindow || o.kind === 'slidingDoor') {
    const depth = Math.min(0.08, T * 0.6);
    // frame
    box(-W / 2 + f / 2, sill + oh / 2, 0, f, oh, depth, frameM);
    box(W / 2 - f / 2, sill + oh / 2, 0, f, oh, depth, frameM);
    box(0, sill + oh - f / 2, 0, W, f, depth, frameM);
    box(0, sill + f / 2, 0, W, f, depth, frameM);
    const panes = o.kind === 'slidingDoor' ? 2 : o.kind === 'fixedWindow' ? 1 : W > 1.6 ? 3 : 2;
    for (let i = 1; i < panes; i++) box(-W / 2 + (W * i) / panes, sill + oh / 2, 0, 0.045, oh - f, depth * 0.9, frameM);
    if (o.kind === 'window' && oh > 1.1) box(0, sill + oh * 0.72, 0, W - f, 0.035, depth * 0.8, frameM);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - f * 2, oh - f * 2), glassMaterial());
    glass.position.set(0, sill + oh / 2, 0); glass.userData.glass = true; g.add(glass);
    // window sill outside and inside
    if (isWindow && sill > 0.2) { box(0, sill - 0.015, 0, W + 0.1, 0.03, T + 0.06, colorMaterial('#E9E6E0', { roughness: 0.6 })); }
  } else if (o.kind === 'garageDoor') {
    const pm = colorMaterial('#E7E7E5', { roughness: 0.55, metalness: 0.1 });
    box(0, sill + oh / 2, 0, W, oh, 0.05, pm);
    const groove = colorMaterial('#C9C9C6', { roughness: 0.6 });
    for (let i = 1; i < 5; i++) { box(0, sill + (oh * i) / 5, 0.03, W - 0.02, 0.02, 0.01, groove); box(0, sill + (oh * i) / 5, -0.03, W - 0.02, 0.02, 0.01, groove); }
    box(-W / 2 - 0.03, oh / 2, 0, 0.06, oh, T + 0.02, frameM); box(W / 2 + 0.03, oh / 2, 0, 0.06, oh, T + 0.02, frameM);
  } else {
    // swing doors
    const leafM = colorMaterial(o.kind === 'frontDoor' ? FRONT_DOOR : DOOR, { roughness: 0.55 });
    const depth = T + 0.02;
    box(-W / 2 + 0.025, oh / 2, 0, 0.05, oh, depth, frameM);
    box(W / 2 - 0.025, oh / 2, 0, 0.05, oh, depth, frameM);
    box(0, oh - 0.025, 0, W, 0.05, depth, frameM);
    const leaves = o.kind === 'doubleDoor' ? 2 : 1;
    const lw = (W - 0.1) / leaves;
    const handleM = colorMaterial('#9A9EA3', { roughness: 0.3, metalness: 0.8 });
    for (let i = 0; i < leaves; i++) {
      const x = -W / 2 + 0.05 + lw * (i + 0.5);
      box(x, (oh - 0.05) / 2, 0, lw - 0.006, oh - 0.05, 0.04, leafM);
      const hx = leaves === 2 ? (i === 0 ? x + lw / 2 - 0.08 : x - lw / 2 + 0.08) : (o.hinge === 'left' ? x + lw / 2 - 0.08 : x - lw / 2 + 0.08);
      box(hx, 1.0, 0.04, 0.12, 0.02, 0.02, handleM); box(hx, 1.0, -0.04, 0.12, 0.02, 0.02, handleM);
      if (o.kind === 'frontDoor') { const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.12, oh * 0.6), glassMaterial()); gl.position.set(x + lw * 0.25, oh * 0.55, 0.021); g.add(gl); }
    }
  }
  const L = wallLength(w);
  const ang = wallAngle(w);
  const pos = add(w.a, mul({ x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L }, o.t));
  g.position.set(pos.x, 0, pos.y);
  g.rotation.y = -ang;
  return g;
}

function buildWalls(level: Level, p: Project, opts: BuildOptions) {
  const grp = new THREE.Group(); grp.name = 'walls';
  const visibleWalls = level.walls.filter((w) => w.kind !== 'invisible');
  for (const w of visibleWalls) {
    const fullH = w.height ?? level.height;
    let H = fullH;
    if (opts.wallMode === 'cut') H = Math.min(fullH, w.exterior ? fullH : 1.2);
    if (opts.wallMode === 'low') H = Math.min(fullH, 0.35);
    const L = wallLength(w);
    const wg = new THREE.Group();
    if (w.kind === 'railing') {
      const m = colorMaterial('#5A6068', { roughness: 0.4, metalness: 0.6 });
      const glass = glassMaterial();
      const rail = wallPiece({ ...w, thickness: 0.05 }, 0, L, H - 0.05, H, [m, m, m, m, m, m]);
      if (rail) wg.add(rail);
      const pane = wallPiece({ ...w, thickness: 0.012 }, 0.03, L - 0.03, 0.05, H - 0.07, [glass, glass, glass, glass, glass, glass]);
      if (pane) { pane.userData.glass = true; wg.add(pane); }
      tag(wg, 'wall', w.id, level.id); grp.add(wg); continue;
    }
    const mats = wallMaterials(w, p, level.rooms);
    const { ea, eb } = wallExtensions(w, visibleWalls);
    const ops = level.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.t - b.t);
    let cur = -ea;
    for (const o of ops) {
      const s = Math.max(cur, o.t - o.width / 2), e = Math.min(L, o.t + o.width / 2);
      const piece = wallPiece(w, cur, s, 0, H, mats); if (piece) wg.add(piece);
      if (o.sill > 0.001) { const below = wallPiece(w, s, e, 0, Math.min(o.sill, H), mats); if (below) wg.add(below); }
      const top = o.sill + o.height;
      if (top < H) { const above = wallPiece(w, s, e, top, H, mats); if (above) wg.add(above); }
      cur = e;
      if (H > o.sill + 0.05) {
        const om = openingMesh({ ...o, height: Math.min(o.height, H - o.sill) }, w, H);
        if (opts.forExport) om.traverse((c) => { if (c.userData.glass) c.visible = false; });
        tag(om, 'opening', o.id, level.id); wg.add(om);
      }
    }
    const last = wallPiece(w, cur, L + eb, 0, H, mats); if (last) wg.add(last);
    tag(wg, 'wall', w.id, level.id);
    wg.children.forEach((c) => { if (c.userData.kind === 'opening') return; c.userData.kind = 'wall'; });
    grp.add(wg);
  }
  setShadow(grp);
  return grp;
}

/** Stair holes (rectangles) cut into this level's floor, from stairs on the level below. */
function stairHoles(level: Level, below?: Level): Vec2[][] {
  if (!below) return [];
  return below.items.filter((i) => i.catalogId.startsWith('stair-')).map((it) => {
    const c = Math.cos(it.rotation), s = Math.sin(it.rotation);
    const pts = [[-it.w / 2, -it.d / 2], [it.w / 2, -it.d / 2], [it.w / 2, it.d / 2], [-it.w / 2, it.d / 2]];
    return pts.map(([x, y]) => ({ x: it.x + x * c - y * s, y: it.y + x * s + y * c }));
  });
}

function shapeFrom(points: Vec2[], holes: Vec2[][] = []) {
  const sh = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
  return sh;
}

function buildFloors(level: Level, below: Level | undefined, isLowest: boolean) {
  const grp = new THREE.Group(); grp.name = 'floors';
  const holes = stairHoles(level, below);
  for (const r of level.rooms) {
    const rh = holes.filter((h) => pointInPolygon(centroid(h), r.points));
    const sh = shapeFrom(r.points, rh);
    const outdoor = r.type === 'terrace' || r.type === 'balcony';
    // finished floor
    const g = new THREE.ShapeGeometry(sh);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, floorMaterial(r.floor));
    m.position.y = 0.012;
    m.receiveShadow = true;
    tag(m, 'room', r.id, level.id);
    grp.add(m);
    // structural slab under it
    const slabDepth = outdoor && isLowest ? 0.15 : isLowest ? 0.3 : level.slab;
    const sg = new THREE.ExtrudeGeometry(sh, { depth: slabDepth, bevelEnabled: false });
    sg.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(sg, colorMaterial(isLowest ? '#CFCBC4' : '#E9E6E0', { roughness: 0.95 }));
    slab.position.y = -slabDepth + 0.01;
    slab.receiveShadow = true; slab.castShadow = !isLowest;
    tag(slab, 'room', r.id, level.id);
    grp.add(slab);
  }
  return grp;
}

export function roofGeometry(r: Roof): { geom: THREE.BufferGeometry; height: number } {
  const o = r.overhang;
  const a = Math.tan((Math.max(0, r.pitch) * Math.PI) / 180);
  const x0 = r.x - o, x1 = r.x + r.w + o, z0 = r.y - o, z1 = r.y + r.d + o;
  const W = x1 - x0, D = z1 - z0;
  const yb = -o * a; // eave height relative to wall top
  const pos: number[] = [];
  const groups: [number, number, number][] = []; // start, count, material
  const tri = (p: number[][], mat: number) => {
    const start = pos.length / 3;
    for (const v of p) pos.push(v[0], v[1], v[2]);
    const last = groups[groups.length - 1];
    if (last && last[2] === mat && last[0] + last[1] === start) last[1] += 3; else groups.push([start, 3, mat]);
  };
  const quad = (p: number[][], mat: number) => { tri([p[0], p[1], p[2]], mat); tri([p[0], p[2], p[3]], mat); };
  let height = 0;
  if (r.kind === 'flat') {
    const t = 0.28;
    const P = (x: number, y: number, z: number) => [x, y, z];
    const y0 = 0, y1 = t;
    // box with outward normals (CCW seen from outside)
    quad([P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)], 0);
    quad([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], 1);
    quad([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], 1);
    quad([P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], 1);
    quad([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], 1);
    quad([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], 1);
    height = t;
  } else {
    // generic solid: compute in a frame where the ridge runs along local X (length Lx) and slope across local Z (Dz)
    const alongX = r.ridge === 'x';
    const Lx = alongX ? W : D, Dz = alongX ? D : W;
    const map = (u: number, y: number, v: number): number[] => (alongX ? [x0 + u, y, z0 + v] : [x0 + v, y, z0 + u]);
    const rise = r.kind === 'shed' ? Dz * a : (Dz / 2) * a;
    height = rise + yb;
    const B = yb;
    const top = B + rise;
    const Q: number[][][] = [];
    if (r.kind === 'gable') {
      Q.push([map(0, B, 0), map(0, top, Dz / 2), map(Lx, top, Dz / 2), map(Lx, B, 0)].map((x) => x)); // slope near v=0
      Q.push([map(Lx, B, Dz), map(Lx, top, Dz / 2), map(0, top, Dz / 2), map(0, B, Dz)]);
      const ends = [[map(0, B, Dz), map(0, top, Dz / 2), map(0, B, 0)], [map(Lx, B, 0), map(Lx, top, Dz / 2), map(Lx, B, Dz)]];
      Q.forEach((q) => quad(q, 0));
      ends.forEach((e) => tri(e, 1));
      quad([map(0, B, 0), map(Lx, B, 0), map(Lx, B, Dz), map(0, B, Dz)], 1);
    } else if (r.kind === 'hip') {
      const inset = Math.min(Dz / 2, Lx / 2);
      const r0 = map(inset, top, Dz / 2), r1 = map(Lx - inset, top, Dz / 2);
      quad([map(0, B, 0), r0, r1, map(Lx, B, 0)], 0);
      quad([map(Lx, B, Dz), r1, r0, map(0, B, Dz)], 0);
      tri([map(0, B, Dz), r0, map(0, B, 0)], 0);
      tri([map(Lx, B, 0), r1, map(Lx, B, Dz)], 0);
      quad([map(0, B, 0), map(Lx, B, 0), map(Lx, B, Dz), map(0, B, Dz)], 1);
    } else {
      // shed: low at v=0, high at v=Dz
      quad([map(0, B, 0), map(0, top, Dz), map(Lx, top, Dz), map(Lx, B, 0)], 0);
      quad([map(Lx, B, Dz), map(Lx, top, Dz), map(0, top, Dz), map(0, B, Dz)], 1);
      tri([map(0, B, Dz), map(0, top, Dz), map(0, B, 0)], 1);
      tri([map(Lx, B, 0), map(Lx, top, Dz), map(Lx, B, Dz)], 1);
      quad([map(0, B, 0), map(Lx, B, 0), map(Lx, B, Dz), map(0, B, Dz)], 1);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // fix winding so normals face outward (relative to the solid's centroid)
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) c.add(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]));
  c.multiplyScalar(3 / pos.length);
  const arr = geom.attributes.position.array as Float32Array;
  for (let i = 0; i < arr.length; i += 9) {
    const A = new THREE.Vector3(arr[i], arr[i + 1], arr[i + 2]), Bv = new THREE.Vector3(arr[i + 3], arr[i + 4], arr[i + 5]), C = new THREE.Vector3(arr[i + 6], arr[i + 7], arr[i + 8]);
    const n = new THREE.Vector3().subVectors(Bv, A).cross(new THREE.Vector3().subVectors(C, A));
    const m = A.clone().add(Bv).add(C).multiplyScalar(1 / 3);
    if (n.dot(m.sub(c)) < 0) { for (let k = 0; k < 3; k++) { const t = arr[i + 3 + k]; arr[i + 3 + k] = arr[i + 6 + k]; arr[i + 6 + k] = t; } }
  }
  for (const [s, n, m] of groups) geom.addGroup(s, n, m);
  geom.computeVertexNormals();
  // planar UVs in meters (for shingle texture)
  const uv: number[] = [];
  const nrm = geom.attributes.normal.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const nx = Math.abs(nrm[i]), nz = Math.abs(nrm[i + 2]);
    uv.push(nx > nz ? arr[i + 2] : arr[i], arr[i + 1] * 1.4 + (nx > nz ? arr[i] : arr[i + 2]) * 0.6);
  }
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { geom, height };
}

function buildRoofs(level: Level, p: Project) {
  const grp = new THREE.Group(); grp.name = 'roofs';
  for (const r of level.roofs) {
    const { geom } = roofGeometry(r);
    const tex = r.kind === 'flat' ? null : roofTexture(r.color);
    const top = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : r.color, ...(tex ? { map: tex } : {}), roughness: 0.8 });
    const side = colorMaterial(r.kind === 'gable' ? p.settings.exteriorWallColor : '#E8E5DF', { roughness: 0.85 });
    const m = new THREE.Mesh(geom, [top, side]);
    m.position.y = r.base ?? level.height;
    setShadow(m);
    tag(m, 'roof', r.id, level.id);
    grp.add(m);
  }
  return grp;
}

const itemCache = new Map<string, THREE.Object3D>();
export function buildItemObject(it: Item, customModels?: Map<string, THREE.Object3D>): THREE.Object3D {
  if (it.catalogId.startsWith('custom:')) {
    const src = customModels?.get(it.catalogId.slice(7));
    const g = new THREE.Group();
    if (src) {
      const c = src.clone(true);
      const box = new THREE.Box3().setFromObject(c);
      const size = box.getSize(new THREE.Vector3());
      c.scale.set(it.w / (size.x || 1), it.h / (size.y || 1), it.d / (size.z || 1));
      const b2 = new THREE.Box3().setFromObject(c);
      const ctr = b2.getCenter(new THREE.Vector3());
      c.position.set(-ctr.x, -b2.min.y, -ctr.z);
      g.add(c);
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d), colorMaterial('#B8C4D6', { transparent: true, opacity: 0.6 }));
      m.position.y = it.h / 2; g.add(m);
    }
    setShadow(g);
    return g;
  }
  const def = getCatalogItem(it.catalogId);
  const key = `${it.catalogId}|${it.w.toFixed(3)}|${it.d.toFixed(3)}|${it.h.toFixed(3)}|${it.color ?? ''}`;
  let base = itemCache.get(key);
  if (!base) {
    if (def) { try { base = def.build({ w: it.w, d: it.d, h: it.h, color: it.color ?? def.defaultColor }); } catch (e) { console.warn('item build failed', it.catalogId, e); } }
    if (!base) { base = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d), colorMaterial(it.color ?? '#C8C2B8')); base.position.y = it.h / 2; const g = new THREE.Group(); g.add(base); base = g; }
    setShadow(base);
    base.traverse((c) => { c.userData.cached = true; });
    if (itemCache.size > 600) itemCache.clear();
    itemCache.set(key, base);
  }
  return base.clone(true);
}

function buildItems(level: Level, opts: BuildOptions) {
  const grp = new THREE.Group(); grp.name = 'items';
  for (const it of level.items) {
    const o = buildItemObject(it, opts.customModels);
    const wrap = new THREE.Group();
    wrap.add(o);
    wrap.position.set(it.x, it.elevation, it.y);
    wrap.rotation.y = -it.rotation;
    if (opts.forExport) wrap.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.Material | undefined; if (m && (m as THREE.MeshStandardMaterial).transparent && (m as THREE.MeshStandardMaterial).opacity < 0.5) c.visible = false; });
    tag(wrap, 'item', it.id, level.id);
    grp.add(wrap);
  }
  return grp;
}

export function buildLevel(p: Project, level: Level, opts: BuildOptions, below?: Level, isLowest = false, showRoof = true) {
  const g = new THREE.Group();
  g.name = `level:${level.id}`;
  g.userData.levelId = level.id;
  g.add(buildFloors(level, below, isLowest));
  g.add(buildWalls(level, p, opts));
  if (opts.showFurniture !== false) g.add(buildItems(level, opts));
  if (showRoof) g.add(buildRoofs(level, p));
  g.position.y = level.elevation;
  return g;
}

export function visibleLevels(p: Project, opts: BuildOptions) {
  const sorted = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const active = sorted.find((l) => l.id === (opts.activeLevelId ?? p.activeLevelId)) ?? sorted[0];
  const mode = opts.levels ?? 'upto';
  return sorted.filter((l) => l.visible !== false && (mode === 'all' || (mode === 'only' ? l.id === active.id : l.elevation <= active.elevation + 1e-6)));
}

/** Build the house (no ground / lights). */
export function buildHouse(p: Project, opts: BuildOptions = {}) {
  const root = new THREE.Group(); root.name = 'house';
  const sorted = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const vis = visibleLevels(p, opts);
  const topVisible = vis[vis.length - 1];
  for (const l of vis) {
    const idx = sorted.indexOf(l);
    const isTop = l === topVisible;
    // roofs of a level are shown if roof is enabled and either it's not the top visible level (lower roofs like garages) or showRoof
    const show = opts.showRoof !== false && (isTop ? opts.showRoof === true || opts.levels === 'all' : true);
    root.add(buildLevel(p, l, opts, sorted[idx - 1], idx === 0, show));
  }
  return root;
}

export function houseBounds(p: Project) {
  const g = buildHouse(p, { levels: 'all', showFurniture: false, showRoof: false });
  return new THREE.Box3().setFromObject(g);
}
