// Pure editing operations on levels / projects.
import type { Level, Project, Wall, Vec2, Room, Opening, RoomType, Item } from './types';
import { uid } from './types';
import { dist, projectToSegment, wallLength, wallDir, near, cross, dot, sub, add, mul, pointInPolygon, absArea, sideOfWall, centroid } from './geometry';

export const ROOM_DEFAULTS: Record<RoomType, { label: string; floor: string; color: string }> = {
  living: { label: 'Living Room', floor: 'oak', color: '#F3E9DC' },
  kitchen: { label: 'Kitchen', floor: 'tile-light', color: '#E8F0E6' },
  dining: { label: 'Dining', floor: 'oak', color: '#F5EEDF' },
  bedroom: { label: 'Bedroom', floor: 'walnut', color: '#E7ECF5' },
  bathroom: { label: 'Bathroom', floor: 'tile-grey', color: '#E3EFF3' },
  wc: { label: 'WC', floor: 'tile-grey', color: '#E3EFF3' },
  office: { label: 'Office', floor: 'oak', color: '#EEEAF5' },
  hall: { label: 'Hallway', floor: 'oak', color: '#F1F0EC' },
  garage: { label: 'Garage', floor: 'concrete', color: '#ECECEC' },
  laundry: { label: 'Laundry', floor: 'tile-light', color: '#E9F1F1' },
  storage: { label: 'Storage', floor: 'concrete', color: '#EFEDE8' },
  closet: { label: 'Closet', floor: 'oak', color: '#F2EEE6' },
  balcony: { label: 'Balcony', floor: 'deck', color: '#EEF2E6' },
  terrace: { label: 'Terrace', floor: 'deck', color: '#EEF2E6' },
  basement: { label: 'Recreation', floor: 'carpet', color: '#ECE9F2' },
  utility: { label: 'Utility', floor: 'concrete', color: '#ECECEC' },
  other: { label: 'Room', floor: 'oak', color: '#F0EEEA' },
};

export function guessRoomType(name: string): RoomType {
  const n = name.toLowerCase();
  const table: [RegExp, RoomType][] = [
    [/bath|shower|ensuite|en-suite/, 'bathroom'], [/\bwc\b|toilet|powder/, 'wc'], [/kitchen|kitchenette/, 'kitchen'],
    [/dining/, 'dining'], [/living|lounge|family|great room|sitting/, 'living'], [/bed|master|guest|nursery|kids/, 'bedroom'],
    [/office|study|den|library|work/, 'office'], [/hall|corridor|entry|foyer|landing|lobby|mudroom/, 'hall'], [/garage|carport/, 'garage'],
    [/laundry|utility room/, 'laundry'], [/storage|store|pantry/, 'storage'], [/closet|wardrobe|walk-in|dressing/, 'closet'],
    [/balcony/, 'balcony'], [/terrace|patio|deck|porch/, 'terrace'], [/rec|play|gym|cinema|theater|basement|media|games/, 'basement'],
    [/utility|mechanical|boiler/, 'utility'],
  ];
  for (const [re, t] of table) if (re.test(n)) return t;
  return 'other';
}

export function emptyLevel(name: string, elevation: number, height = 2.7): Level {
  return { id: uid('lvl'), name, elevation, height, slab: 0.25, walls: [], openings: [], rooms: [], items: [], roofs: [], labels: [], dims: [] };
}

export function newProject(name = 'Untitled home'): Project {
  const ground = emptyLevel('Ground floor', 0);
  return {
    version: 1, id: uid('prj'), name, levels: [ground], activeLevelId: ground.id,
    settings: {
      units: 'metric', wallThickness: 0.15, wallHeight: 2.7,
      exteriorWallColor: '#F4F1EA', interiorWallColor: '#FAFAF7', groundColor: '#A9C29A', showGround: true,
    },
    customModels: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
}

const isCollinear = (w: Wall, a: Vec2, b: Vec2, tol = 0.03) => {
  const d = wallDir(w);
  const n = { x: -d.y, y: d.x };
  return Math.abs(dot(sub(a, w.a), n)) < tol && Math.abs(dot(sub(b, w.a), n)) < tol;
};

/**
 * Add a wall segment, avoiding duplicating parts already covered by collinear walls.
 * Returns the ids of created walls.
 */
export function addWallMerged(level: Level, a: Vec2, b: Vec2, thickness: number, extra: Partial<Wall> = {}): string[] {
  const L = dist(a, b);
  if (L < 0.05) return [];
  const d = mul(sub(b, a), 1 / L);
  // covered intervals along a→b
  const covered: [number, number][] = [];
  for (const w of level.walls) {
    if (!isCollinear(w, a, b)) continue;
    const s = dot(sub(w.a, a), d), e = dot(sub(w.b, a), d);
    const lo = Math.max(0, Math.min(s, e)), hi = Math.min(L, Math.max(s, e));
    if (hi - lo > 0.02) {
      covered.push([lo, hi]);
      if (thickness > w.thickness && extra.exterior) { w.thickness = thickness; w.exterior = true; }
    }
  }
  covered.sort((x, y) => x[0] - y[0]);
  const free: [number, number][] = [];
  let cur = 0;
  for (const [s, e] of covered) { if (s > cur + 0.02) free.push([cur, s]); cur = Math.max(cur, e); }
  if (cur < L - 0.02) free.push([cur, L]);
  const ids: string[] = [];
  for (const [s, e] of free) {
    const w: Wall = { id: uid('w'), a: add(a, mul(d, s)), b: add(a, mul(d, e)), thickness, ...extra };
    level.walls.push(w);
    ids.push(w.id);
  }
  return ids;
}

/** Split walls at T-junctions created by other walls' endpoints so openings/colors stay local. */
export function splitWallAt(level: Level, wall: Wall, p: Vec2): [Wall, Wall] | null {
  const pr = projectToSegment(p, wall.a, wall.b);
  if (pr.t < 0.05 || pr.t > wallLength(wall) - 0.05) return null;
  const w2: Wall = { ...wall, id: uid('w'), a: pr.point, b: wall.b };
  wall.b = pr.point;
  // move openings beyond split to w2
  for (const o of level.openings) if (o.wallId === wall.id && o.t > pr.t) { o.wallId = w2.id; o.t -= pr.t; }
  level.walls.push(w2);
  return [wall, w2];
}

/** Move a wall endpoint and drag connected endpoints along. */
export function moveWallEndpoint(level: Level, wall: Wall, end: 'a' | 'b', to: Vec2) {
  const from = { ...wall[end] };
  for (const w of level.walls) {
    if (w === wall) continue;
    if (near(w.a, from, 0.02)) w.a = { ...to };
    if (near(w.b, from, 0.02)) w.b = { ...to };
  }
  for (const r of level.rooms) r.points = r.points.map((p) => (near(p, from, 0.08) ? { ...to } : p));
  wall[end] = { ...to };
}

export function deleteWall(level: Level, id: string) {
  level.walls = level.walls.filter((w) => w.id !== id);
  level.openings = level.openings.filter((o) => o.wallId !== id);
}

/** Add rectangular room with walls. */
export function addRectRoom(level: Level, x: number, y: number, w: number, d: number, type: RoomType, name?: string, thickness = 0.15, exterior = false): Room {
  const pts = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
  return addPolygonRoom(level, pts, type, name, thickness, exterior);
}

export function addPolygonRoom(level: Level, pts: Vec2[], type: RoomType, name?: string, thickness = 0.15, exterior = false): Room {
  for (let i = 0; i < pts.length; i++) addWallMerged(level, pts[i], pts[(i + 1) % pts.length], thickness, exterior ? { exterior: true } : {});
  const def = ROOM_DEFAULTS[type];
  const room: Room = { id: uid('room'), name: name ?? def.label, type, points: pts.map((p) => ({ ...p })), floor: def.floor };
  level.rooms.push(room);
  return room;
}

/** Find the wall (and t) that best represents the boundary between two points/rooms near point p. */
export function wallNear(level: Level, p: Vec2, tol = 0.3) {
  let best: { wall: Wall; t: number; d: number } | null = null;
  for (const w of level.walls) {
    const pr = projectToSegment(p, w.a, w.b);
    if (pr.distance < tol && (!best || pr.distance < best.d)) best = { wall: w, t: pr.t, d: pr.distance };
  }
  return best;
}

export const OPENING_DEFAULTS: Record<Opening['kind'], { width: number; height: number; sill: number; label: string }> = {
  door: { width: 0.9, height: 2.1, sill: 0, label: 'Door' },
  frontDoor: { width: 1.0, height: 2.2, sill: 0, label: 'Front door' },
  doubleDoor: { width: 1.5, height: 2.1, sill: 0, label: 'Double door' },
  slidingDoor: { width: 2.2, height: 2.2, sill: 0, label: 'Sliding door' },
  garageDoor: { width: 2.6, height: 2.2, sill: 0, label: 'Garage door' },
  window: { width: 1.2, height: 1.3, sill: 0.9, label: 'Window' },
  wideWindow: { width: 2.2, height: 1.5, sill: 0.7, label: 'Wide window' },
  fixedWindow: { width: 0.8, height: 2.1, sill: 0.1, label: 'Floor window' },
  opening: { width: 1.2, height: 2.2, sill: 0, label: 'Opening' },
};

/** Clamp an opening's t so it stays within its wall. Returns false if it doesn't fit. */
export function fitOpening(o: Opening, w: Wall) {
  const L = wallLength(w);
  if (o.width > L - 0.1) o.width = Math.max(0.4, L - 0.1);
  o.t = Math.max(o.width / 2 + 0.05, Math.min(L - o.width / 2 - 0.05, o.t));
  return o.width >= 0.4;
}

export function openingOverlaps(level: Level, o: Opening) {
  return level.openings.some((x) => x.id !== o.id && x.wallId === o.wallId && Math.abs(x.t - o.t) < (x.width + o.width) / 2 + 0.05);
}

export function addOpening(level: Level, wallId: string, kind: Opening['kind'], t: number, opts: Partial<Opening> = {}): Opening | null {
  const w = level.walls.find((x) => x.id === wallId);
  if (!w) return null;
  const def = OPENING_DEFAULTS[kind];
  const o: Opening = { id: uid('op'), wallId, kind, t, width: def.width, height: def.height, sill: def.sill, ...opts };
  if (!fitOpening(o, w)) return null;
  if (openingOverlaps(level, o)) return null;
  level.openings.push(o);
  return o;
}

/** Shared boundary segment between two rooms (longest), if any. */
export function sharedEdge(a: Room, b: Room, tol = 0.08) {
  let best: { p: Vec2; q: Vec2; len: number } | null = null;
  for (let i = 0; i < a.points.length; i++) {
    const p1 = a.points[i], p2 = a.points[(i + 1) % a.points.length];
    const d = sub(p2, p1); const L = dist(p1, p2); if (L < 0.1) continue;
    const u = mul(d, 1 / L);
    for (let j = 0; j < b.points.length; j++) {
      const q1 = b.points[j], q2 = b.points[(j + 1) % b.points.length];
      if (Math.abs(cross(u, sub(q1, p1))) > tol || Math.abs(cross(u, sub(q2, p1))) > tol) continue;
      const s = dot(sub(q1, p1), u), e = dot(sub(q2, p1), u);
      const lo = Math.max(0, Math.min(s, e)), hi = Math.min(L, Math.max(s, e));
      if (hi - lo > 0.3 && (!best || hi - lo > best.len)) best = { p: add(p1, mul(u, lo)), q: add(p1, mul(u, hi)), len: hi - lo };
    }
  }
  return best;
}

/** Place an opening at the middle of a segment (finds the wall that covers it). */
export function openingOnSegment(level: Level, p: Vec2, q: Vec2, kind: Opening['kind'], opts: Partial<Opening> = {}, at = 0.5): Opening | null {
  const mid = { x: p.x + (q.x - p.x) * at, y: p.y + (q.y - p.y) * at };
  const hit = wallNear(level, mid, 0.1);
  if (!hit) return null;
  const segLen = dist(p, q);
  const def = OPENING_DEFAULTS[kind];
  const width = Math.min(opts.width ?? def.width, segLen - 0.2);
  if (width < 0.6) return null;
  return addOpening(level, hit.wall.id, kind, hit.t, { ...opts, width });
}

/** Rooms adjacent (sharing a wall) to a room. */
export function roomNeighbors(level: Level, r: Room) {
  return level.rooms.filter((o) => o.id !== r.id && sharedEdge(r, o));
}

/** Walls on the room's boundary (segments overlapping polygon edges). */
export function roomWalls(level: Level, r: Room) {
  const res: Wall[] = [];
  for (const w of level.walls) {
    for (let i = 0; i < r.points.length; i++) {
      const p = r.points[i], q = r.points[(i + 1) % r.points.length];
      const L = dist(p, q); if (L < 0.05) continue;
      const u = mul(sub(q, p), 1 / L);
      if (Math.abs(cross(u, sub(w.a, p))) > 0.05 || Math.abs(cross(u, sub(w.b, p))) > 0.05) continue;
      const s = dot(sub(w.a, p), u), e = dot(sub(w.b, p), u);
      if (Math.min(L, Math.max(s, e)) - Math.max(0, Math.min(s, e)) > 0.1) { res.push(w); break; }
    }
  }
  return res;
}

/** Paint the walls of a room on the side facing the room. */
export function paintRoomWalls(level: Level, r: Room, color: string) {
  const c = centroid(r.points);
  for (const w of roomWalls(level, r)) {
    if (sideOfWall(w, c) > 0) w.colorLeft = color; else w.colorRight = color;
  }
}

/** Items inside a room polygon. */
export function itemsInRoom(level: Level, r: Room) {
  return level.items.filter((it) => pointInPolygon({ x: it.x, y: it.y }, r.points));
}

export function levelArea(level: Level) {
  return level.rooms.filter((r) => r.type !== 'terrace' && r.type !== 'balcony').reduce((s, r) => s + absArea(r.points), 0);
}

export function cloneItem(it: Item): Item { return { ...it, id: uid('it'), x: it.x + 0.3, y: it.y + 0.3 }; }

/** Sort levels by elevation and return the level directly above the given one. */
export function levelAbove(p: Project, levelId: string) {
  const sorted = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const i = sorted.findIndex((l) => l.id === levelId);
  return i >= 0 ? sorted[i + 1] : undefined;
}

export function addLevel(p: Project, where: 'above' | 'below'): Project {
  const sorted = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  if (where === 'above') {
    const top = sorted[sorted.length - 1];
    const lvl = emptyLevel(top.elevation < 0 ? 'Ground floor' : `Floor ${sorted.filter((l) => l.elevation >= 0).length}`, top.elevation + top.height + top.slab, top.height);
    // copy exterior walls as a starting point
    lvl.walls = outerWalls(top).map((w) => ({ ...w, id: uid('w'), exterior: true }));
    p.levels.push(lvl); p.activeLevelId = lvl.id;
  } else {
    const bottom = sorted[0];
    const h = 2.5;
    const lvl = emptyLevel('Basement', bottom.elevation - h - bottom.slab, h);
    lvl.walls = outerWalls(bottom).map((w) => ({ ...w, id: uid('w'), exterior: true }));
    p.levels.push(lvl); p.activeLevelId = lvl.id;
  }
  return p;
}

/** Walls on the building's outline: flagged exterior, or with a room on only one side. */
export function outerWalls(level: Level) {
  return level.walls.filter((w) => {
    if (w.kind === 'railing') return false;
    if (w.exterior) return true;
    const L = dist(w.a, w.b); if (L < 0.05) return false;
    const n = { x: -(w.b.y - w.a.y) / L, y: (w.b.x - w.a.x) / L };
    const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    const off = w.thickness / 2 + 0.1;
    const l = level.rooms.some((r) => pointInPolygon(add(m, mul(n, off)), r.points));
    const r = level.rooms.some((r2) => pointInPolygon(add(m, mul(n, -off)), r2.points));
    return l !== r;
  });
}

export function totalArea(p: Project) { return p.levels.reduce((s, l) => s + levelArea(l), 0); }
export function roomsAreaFor(r: Room) { return absArea(r.points); }
