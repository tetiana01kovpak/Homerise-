// HouseSpec: a compact, AI-friendly description of a house (rooms as rectangles per level).
// Both the offline generator and Claude produce HouseSpecs; specToProject turns them into full projects.
import type { Project, Level, Room, Vec2, RoomType, RoofKind, Roof, Wall } from './types';
import { uid } from './types';
import { newProject, emptyLevel, addWallMerged, ROOM_DEFAULTS, guessRoomType, sharedEdge, openingOnSegment, OPENING_DEFAULTS, addOpening } from './ops';
import { dist, pointInPolygon, wallLength, projectToSegment, wallNormal, add, mul } from './geometry';

export interface SpecRoom { name: string; type?: RoomType; x: number; y: number; w: number; d: number }
export interface SpecConnection { a: string; b: string; kind?: 'door' | 'opening' | 'doubleDoor' | 'slidingDoor' | 'frontDoor' | 'garageDoor' }
export interface SpecLevel {
  name: string;
  height?: number;
  rooms: SpecRoom[];
  connections?: SpecConnection[];
}
export interface HouseSpec {
  name: string;
  /** Levels ordered bottom → top. A level named like "basement" is placed below ground. */
  levels: SpecLevel[];
  roof?: { kind: RoofKind; pitch?: number; overhang?: number; color?: string };
  /** Stairs footprint (same position on every level it connects). */
  stairs?: { x: number; y: number; w: number; d: number; dir?: 'up' | 'down' | 'left' | 'right' };
  /** Which side of the plan faces the street (front door / garage door go there). Default "bottom" (max y). */
  front?: 'top' | 'bottom' | 'left' | 'right';
  exteriorColor?: string;
  furnish?: boolean;
  landscape?: boolean;
  style?: string;
  /** Extra features such as "pool". */
  features?: string[];
}

const EXT_T = 0.3, INT_T = 0.12;
const OUTDOOR: RoomType[] = ['terrace', 'balcony'];

function rectPts(r: SpecRoom): Vec2[] { return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.d }, { x: r.x, y: r.y + r.d }]; }
const isIndoor = (r?: Room | null) => !!r && !OUTDOOR.includes(r.type);

/** Room on the given side of a point (tiny offset). */
function roomAtPoint(rooms: Room[], p: Vec2) {
  for (const r of rooms) if (pointInPolygon(p, r.points)) return r;
  return null;
}

/** Remove overlaps by clipping later rooms against earlier ones (axis aligned), snap to 5cm. */
export function sanitizeSpec(spec: HouseSpec): HouseSpec {
  const s: HouseSpec = JSON.parse(JSON.stringify(spec));
  const snap = (n: number) => Math.round(n * 20) / 20;
  for (const lvl of s.levels) {
    lvl.rooms = lvl.rooms.filter((r) => r && isFinite(r.x) && isFinite(r.y) && r.w > 0.3 && r.d > 0.3);
    for (const r of lvl.rooms) { r.x = snap(r.x); r.y = snap(r.y); r.w = snap(r.w); r.d = snap(r.d); r.type = r.type ?? guessRoomType(r.name); }
    // clip overlaps: shrink the later room along the axis of smallest penetration
    for (let i = 0; i < lvl.rooms.length; i++) for (let j = 0; j < i; j++) {
      const a = lvl.rooms[j], b = lvl.rooms[i];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
      if (ox <= 0.01 || oy <= 0.01) continue;
      if (ox < oy) { if (b.x < a.x) b.w = a.x - b.x; else { const e = b.x + b.w; b.x = a.x + a.w; b.w = e - b.x; } }
      else { if (b.y < a.y) b.d = a.y - b.y; else { const e = b.y + b.d; b.y = a.y + a.d; b.d = e - b.y; } }
    }
    lvl.rooms = lvl.rooms.filter((r) => r.w > 0.5 && r.d > 0.5);
    // unique names
    const seen = new Map<string, number>();
    for (const r of lvl.rooms) { const n = seen.get(r.name) ?? 0; seen.set(r.name, n + 1); if (n) r.name = `${r.name} ${n + 1}`; }
  }
  return s;
}

/** Build wall pieces from room rectangles, classified as interior / exterior / railing. */
function buildWalls(level: Level) {
  const rooms = level.rooms;
  // collect all edges, split at every room vertex lying on them
  const verts: Vec2[] = rooms.flatMap((r) => r.points);
  const pieces: [Vec2, Vec2][] = [];
  for (const r of rooms) {
    for (let i = 0; i < r.points.length; i++) {
      const p = r.points[i], q = r.points[(i + 1) % r.points.length];
      const L = dist(p, q);
      const ts = [0, L];
      for (const v of verts) {
        const pr = projectToSegment(v, p, q);
        if (pr.distance < 0.02 && pr.t > 0.02 && pr.t < L - 0.02) ts.push(pr.t);
      }
      ts.sort((a, b) => a - b);
      for (let k = 0; k < ts.length - 1; k++) {
        if (ts[k + 1] - ts[k] < 0.03) continue;
        const u = { x: (q.x - p.x) / L, y: (q.y - p.y) / L };
        pieces.push([add(p, mul(u, ts[k])), add(p, mul(u, ts[k + 1]))]);
      }
    }
  }
  for (const [a, b] of pieces) {
    const tmp: Wall = { id: '', a, b, thickness: 0 };
    const n = wallNormal(tmp);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const left = roomAtPoint(rooms, add(mid, mul(n, 0.05)));
    const right = roomAtPoint(rooms, add(mid, mul(n, -0.05)));
    const inL = isIndoor(left), inR = isIndoor(right);
    if (inL && inR) addWallMerged(level, a, b, INT_T);
    else if (inL || inR) addWallMerged(level, a, b, EXT_T, { exterior: true });
    else if (left || right) {
      // outdoor room edge: railing on balconies / upper terraces only
      if (level.elevation > 0.5) addWallMerged(level, a, b, 0.06, { kind: 'railing', height: 1.05 });
    }
  }
}

/** Exterior edges of a room (segments with no indoor room on the other side), with outward normal. */
export function exteriorEdges(level: Level, r: Room) {
  const out: { p: Vec2; q: Vec2; len: number; normal: Vec2 }[] = [];
  const others = level.rooms.filter((o) => o.id !== r.id);
  for (let i = 0; i < r.points.length; i++) {
    const p = r.points[i], q = r.points[(i + 1) % r.points.length];
    const L = dist(p, q); if (L < 0.5) continue;
    const u = { x: (q.x - p.x) / L, y: (q.y - p.y) / L };
    let n = { x: -u.y, y: u.x };
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    if (pointInPolygon(add(mid, mul(n, 0.05)), r.points)) n = mul(n, -1);
    // sample along the edge to find free runs
    const STEP = 0.1;
    let runStart: number | null = null;
    for (let t = 0; t <= L + 1e-6; t += STEP) {
      const s = add(add(p, mul(u, Math.min(t, L))), mul(n, 0.1));
      const outside = !others.some((o) => isIndoor(o) && pointInPolygon(s, o.points));
      if (outside && runStart === null) runStart = t;
      if ((!outside || t + STEP > L + 1e-6) && runStart !== null) {
        const end = outside ? L : t - STEP;
        if (end - runStart > 0.6) out.push({ p: add(p, mul(u, runStart)), q: add(p, mul(u, end)), len: end - runStart, normal: n });
        runStart = null;
      }
    }
  }
  return out;
}

const facing = (n: Vec2, front: HouseSpec['front']) => {
  const f = front ?? 'bottom';
  const target = f === 'bottom' ? { x: 0, y: 1 } : f === 'top' ? { x: 0, y: -1 } : f === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
  return n.x * target.x + n.y * target.y;
};

function addDoors(level: Level, spec: HouseSpec, sl: SpecLevel, isEntryLevel: boolean) {
  const byName = new Map(level.rooms.map((r) => [r.name.toLowerCase(), r] as const));
  const connected = new Set<string>();
  const link = (a: Room, b: Room, kind: SpecConnection['kind'] = 'door') => {
    const e = sharedEdge(a, b);
    if (!e) return false;
    const open = kind === 'opening';
    const width = open ? Math.min(e.len - 0.3, Math.max(1.2, e.len * 0.6)) : OPENING_DEFAULTS[kind!].width;
    // place doors near an end (more realistic, frees walls for furniture); openings centered
    const at = open || e.len < 1.6 ? 0.5 : Math.min(0.5, (width / 2 + 0.25) / e.len);
    const o = openingOnSegment(level, e.p, e.q, kind!, { width }, at) ?? openingOnSegment(level, e.p, e.q, kind!, { width }, 0.5);
    if (o) { connected.add(a.id); connected.add(b.id); }
    return !!o;
  };
  // explicit connections
  for (const c of sl.connections ?? []) {
    const a = byName.get(c.a.toLowerCase());
    if (!a) continue;
    if (c.b.toLowerCase() === 'outside') { addExteriorDoor(level, a, c.kind ?? 'frontDoor', spec.front); connected.add(a.id); continue; }
    const b = byName.get(c.b.toLowerCase());
    if (b) link(a, b, c.kind ?? 'door');
  }
  // automatic connectivity: BFS from hub rooms, connect unreachable rooms to reachable neighbours
  const rooms = level.rooms.filter((r) => isIndoor(r));
  const hubOrder: RoomType[] = ['hall', 'living', 'dining', 'kitchen', 'basement', 'office', 'other'];
  const hub = [...rooms].sort((a, b) => hubOrder.indexOf(a.type) - hubOrder.indexOf(b.type) + (hubOrder.indexOf(a.type) === -1 ? 99 : 0))[0];
  if (!hub) return;
  const adjacency = new Map<string, Set<string>>();
  const doorsOf = (r: Room) => adjacency.get(r.id) ?? new Set<string>();
  const recompute = () => {
    adjacency.clear();
    for (const a of rooms) for (const b of rooms) {
      if (a.id >= b.id) continue;
      const e = sharedEdge(a, b); if (!e) continue;
      const has = level.openings.some((o) => {
        const w = level.walls.find((x) => x.id === o.wallId)!;
        const c = add(w.a, mul({ x: (w.b.x - w.a.x) / wallLength(w), y: (w.b.y - w.a.y) / wallLength(w) }, o.t));
        return projectToSegment(c, e.p, e.q).distance < 0.12;
      });
      if (has) { if (!adjacency.has(a.id)) adjacency.set(a.id, new Set()); if (!adjacency.has(b.id)) adjacency.set(b.id, new Set()); adjacency.get(a.id)!.add(b.id); adjacency.get(b.id)!.add(a.id); }
    }
  };
  const pref = (from: Room, to: Room) => {
    // prefer connecting private rooms to halls, wet rooms to halls/bedrooms, public rooms with openings
    const pub: RoomType[] = ['living', 'dining', 'kitchen'];
    let s = 0;
    if (to.type === 'hall') s += 10;
    if (from.type === 'bathroom' && to.type === 'bedroom') s += 6;
    if (from.type === 'closet' && to.type === 'bedroom') s += 12;
    if (pub.includes(from.type) && pub.includes(to.type)) s += 8;
    if (from.type === 'bedroom' && to.type === 'living') s += 4;
    if (from.type === 'garage' && (to.type === 'hall' || to.type === 'laundry' || to.type === 'utility' || to.type === 'kitchen')) s += 6;
    if (to.type === 'bathroom' || to.type === 'wc' || to.type === 'closet' || to.type === 'garage') s -= 20;
    if (to.type === 'bedroom' && from.type !== 'bathroom' && from.type !== 'closet') s -= 8;
    return s + (sharedEdge(from, to)?.len ?? 0) * 0.1;
  };
  for (let guard = 0; guard < 40; guard++) {
    recompute();
    const reach = new Set<string>([hub.id]);
    const q = [hub.id];
    while (q.length) { const id = q.shift()!; for (const n of adjacency.get(id) ?? []) if (!reach.has(n)) { reach.add(n); q.push(n); } }
    const un = rooms.filter((r) => !reach.has(r.id));
    if (!un.length) break;
    let best: { a: Room; b: Room; s: number } | null = null;
    for (const a of un) for (const b of rooms) {
      if (!reach.has(b.id) || !sharedEdge(a, b)) continue;
      const s = pref(a, b);
      if (!best || s > best.s) best = { a, b, s };
    }
    if (!best) {
      // connect unreachable components among themselves to grow
      const a = un[0];
      const nb = rooms.find((b) => b.id !== a.id && !doorsOf(a).has(b.id) && sharedEdge(a, b));
      if (!nb) break;
      link(a, nb, 'door');
      continue;
    }
    const pub: RoomType[] = ['living', 'dining', 'kitchen', 'hall'];
    const kind = pub.includes(best.a.type) && pub.includes(best.b.type) && best.a.type !== 'hall' ? 'opening' : 'door';
    if (!link(best.a, best.b, kind)) break;
  }
  // front door
  if (isEntryLevel && !level.openings.some((o) => o.kind === 'frontDoor')) {
    const entry = rooms.find((r) => r.type === 'hall' && exteriorEdges(level, r).some((e) => facing(e.normal, spec.front) > 0.5))
      ?? rooms.find((r) => r.type === 'living' && exteriorEdges(level, r).some((e) => facing(e.normal, spec.front) > 0.5))
      ?? rooms.find((r) => r.type === 'hall') ?? rooms.find((r) => r.type === 'living') ?? rooms[0];
    if (entry) addExteriorDoor(level, entry, 'frontDoor', spec.front);
  }
  // garages: garage door
  for (const g of level.rooms.filter((r) => r.type === 'garage')) addExteriorDoor(level, g, 'garageDoor', spec.front);
}

function addExteriorDoor(level: Level, room: Room, kind: NonNullable<SpecConnection['kind']>, front: HouseSpec['front']) {
  const edges = exteriorEdges(level, room).sort((a, b) => facing(b.normal, front) - facing(a.normal, front) || b.len - a.len);
  for (const e of edges) {
    const def = OPENING_DEFAULTS[kind];
    if (e.len < def.width + 0.3) continue;
    const width = kind === 'garageDoor' ? Math.min(e.len - 0.6, e.len > 5.4 ? 4.8 : 2.6) : def.width;
    if (openingOnSegment(level, e.p, e.q, kind, { width })) return true;
  }
  return false;
}

function addWindows(level: Level) {
  for (const r of level.rooms) {
    if (!isIndoor(r) || r.type === 'closet' || r.type === 'storage' || r.type === 'utility') continue;
    if (r.type === 'garage') continue;
    const edges = exteriorEdges(level, r).sort((a, b) => b.len - a.len);
    const below = level.elevation < -0.5;
    edges.forEach((e, idx) => {
      if (idx > 2) return;
      let kind: 'window' | 'wideWindow' | 'slidingDoor' = 'window';
      const opts: Record<string, number> = {};
      if (below) { opts.sill = level.height - 0.6; opts.height = 0.45; }
      else if (r.type === 'bathroom' || r.type === 'wc') { opts.width = 0.7; opts.height = 0.7; opts.sill = 1.4; }
      else if (r.type === 'hall') { opts.width = 0.8; }
      else if (r.type === 'living' && idx === 0 && e.len > 3.2 && level.elevation < 0.5) kind = 'slidingDoor';
      else if ((r.type === 'living' || r.type === 'dining' || r.type === 'bedroom') && e.len > 3.4) kind = 'wideWindow';
      const def = OPENING_DEFAULTS[kind];
      const w = opts.width ?? def.width;
      const count = r.type === 'bathroom' || r.type === 'wc' || r.type === 'hall' || below ? 1 : Math.max(1, Math.min(3, Math.floor(e.len / (w + 1.6))));
      if (idx > 0 && (r.type === 'bathroom' || r.type === 'wc' || r.type === 'hall')) return;
      for (let k = 0; k < count; k++) {
        const at = (k + 0.5) / count;
        const wall = level.walls.find((x) => x.exterior && projectToSegment({ x: e.p.x + (e.q.x - e.p.x) * at, y: e.p.y + (e.q.y - e.p.y) * at }, x.a, x.b).distance < 0.05);
        if (!wall) continue;
        const pr = projectToSegment({ x: e.p.x + (e.q.x - e.p.x) * at, y: e.p.y + (e.q.y - e.p.y) * at }, wall.a, wall.b);
        addOpening(level, wall.id, kind, pr.t, { ...opts, width: Math.min(w, e.len / count - 0.5) });
      }
    });
  }
}

/** Greedy rectangle decomposition of the cells covered by `inc` rects and not by `exc` rects. */
export function decomposeRects(inc: SpecRoom[], exc: SpecRoom[]) {
  const xs = [...new Set([...inc, ...exc].flatMap((r) => [r.x, r.x + r.w]).map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
  const ys = [...new Set([...inc, ...exc].flatMap((r) => [r.y, r.y + r.d]).map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
  const inside = (rs: SpecRoom[], x: number, y: number) => rs.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.d);
  const W = xs.length - 1, H = ys.length - 1;
  const cell: boolean[][] = [];
  for (let j = 0; j < H; j++) { cell.push([]); for (let i = 0; i < W; i++) { const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2; cell[j].push(inside(inc, cx, cy) && !inside(exc, cx, cy)); } }
  const out: { x: number; y: number; w: number; d: number }[] = [];
  const area = (i0: number, j0: number, i1: number, j1: number) => (xs[i1] - xs[i0]) * (ys[j1] - ys[j0]);
  for (let guard = 0; guard < 50; guard++) {
    // find the largest full rectangle (brute force on compressed grid)
    let best: [number, number, number, number] | null = null; let bestA = 0;
    for (let j0 = 0; j0 < H; j0++) for (let i0 = 0; i0 < W; i0++) {
      if (!cell[j0][i0]) continue;
      let maxI = W;
      for (let j1 = j0; j1 < H; j1++) {
        let i1 = i0; while (i1 < maxI && cell[j1][i1]) i1++;
        maxI = i1; if (maxI === i0) break;
        const a = area(i0, j0, maxI, j1 + 1);
        if (a > bestA) { bestA = a; best = [i0, j0, maxI, j1 + 1]; }
      }
    }
    if (!best || bestA < 1) break;
    const [i0, j0, i1, j1] = best;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) cell[j][i] = false;
    out.push({ x: xs[i0], y: ys[j0], w: xs[i1] - xs[i0], d: ys[j1] - ys[j0] });
  }
  return out;
}

export function specToProject(input: HouseSpec, opts: { furnish?: (p: Project) => void; landscape?: (p: Project, features: string[]) => void } = {}): Project {
  const spec = sanitizeSpec(input);
  const p = newProject(spec.name || 'New home');
  p.levels = [];
  if (spec.exteriorColor) p.settings.exteriorWallColor = spec.exteriorColor;
  // elevations: basements below 0, the first non-basement level at 0
  const isBasement = (l: SpecLevel) => /basement|cellar|lower/i.test(l.name);
  const basements = spec.levels.filter(isBasement);
  const uppers = spec.levels.filter((l) => !isBasement(l));
  let elev = 0;
  const levelOf = new Map<SpecLevel, Level>();
  uppers.forEach((sl) => { const lv = emptyLevel(sl.name, elev, sl.height ?? 2.7); levelOf.set(sl, lv); elev += lv.height + lv.slab; });
  elev = 0;
  basements.forEach((sl) => { const h = sl.height ?? 2.5; const lv = emptyLevel(sl.name, elev - h - 0.25, h); levelOf.set(sl, lv); elev -= h + 0.25; });
  for (const sl of spec.levels) {
    const lv = levelOf.get(sl)!;
    for (const r of sl.rooms) {
      const type = r.type ?? guessRoomType(r.name);
      lv.rooms.push({ id: uid('room'), name: r.name, type, points: rectPts(r), floor: ROOM_DEFAULTS[type].floor });
    }
    buildWalls(lv);
    p.levels.push(lv);
  }
  p.levels.sort((a, b) => a.elevation - b.elevation);
  const ground = p.levels.find((l) => Math.abs(l.elevation) < 0.01) ?? p.levels[0];
  for (const sl of spec.levels) {
    const lv = levelOf.get(sl)!;
    addDoors(lv, spec, sl, lv === ground);
    addWindows(lv);
  }
  // stairs
  if (spec.stairs && p.levels.length > 1) {
    const s = spec.stairs;
    const sorted = p.levels;
    for (let i = 0; i < sorted.length - 1; i++) {
      const lv = sorted[i];
      const along = s.d >= s.w;
      lv.items.push({
        id: uid('it'), catalogId: 'stair-straight', x: s.x + s.w / 2, y: s.y + s.d / 2,
        // rotation 0: bottom step at +y, ascending toward -y. object.rotation.y = -rotation in 3D.
        rotation: along ? (s.dir === 'down' ? Math.PI : 0) : (s.dir === 'left' ? -Math.PI / 2 : Math.PI / 2),
        elevation: 0, w: along ? s.w : s.d, d: along ? s.d : s.w, h: lv.height + lv.slab, name: 'Stairs',
      });
    }
  }
  // roofs: for each indoor level, the area not covered by the level above
  const roofKind = spec.roof?.kind ?? 'gable';
  for (let i = 0; i < p.levels.length; i++) {
    const lv = p.levels[i];
    if (lv.elevation < -0.5) continue;
    const above = p.levels[i + 1];
    const toRects = (l?: Level) => (l ? l.rooms.filter((r) => isIndoor(r)).map((r) => {
      const xs = r.points.map((q) => q.x), ys = r.points.map((q) => q.y);
      return { name: r.name, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
    }) : []);
    const rects = decomposeRects(toRects(lv), toRects(above));
    const isTop = !above;
    for (const r of rects) {
      const kind: RoofKind = isTop ? roofKind : (roofKind === 'flat' ? 'flat' : r.w * r.d < 30 ? 'shed' : roofKind);
      const roof: Roof = {
        id: uid('roof'), kind, x: r.x, y: r.y, w: r.w, d: r.d,
        pitch: kind === 'flat' ? 0 : (spec.roof?.pitch ?? (kind === 'shed' ? 15 : 32)),
        overhang: spec.roof?.overhang ?? (kind === 'flat' ? 0.15 : 0.45),
        ridge: r.w >= r.d ? 'x' : 'y',
        color: spec.roof?.color ?? (kind === 'flat' ? '#8A8D91' : '#4A4F57'),
      };
      lv.roofs.push(roof);
    }
  }
  p.activeLevelId = ground.id;
  if (spec.furnish !== false && opts.furnish) opts.furnish(p);
  if (spec.landscape !== false && opts.landscape) opts.landscape(p, spec.features ?? []);
  return p;
}

/** Turn an arbitrary project level back into a compact spec-like summary (for AI context). */
export function summarizeProject(p: Project) {
  return {
    name: p.name,
    levels: p.levels.map((l) => ({
      id: l.id, name: l.name, elevation: +l.elevation.toFixed(2), height: l.height,
      rooms: l.rooms.map((r) => {
        const xs = r.points.map((q) => q.x), ys = r.points.map((q) => q.y);
        return { id: r.id, name: r.name, type: r.type, floor: r.floor, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((n) => +n.toFixed(2)) };
      }),
      walls: l.walls.length, openings: l.openings.length,
      items: l.items.map((i) => ({ id: i.id, catalogId: i.catalogId, x: +i.x.toFixed(2), y: +i.y.toFixed(2), rot: +(i.rotation * 180 / Math.PI).toFixed(0) })),
      roofs: l.roofs.map((r) => ({ id: r.id, kind: r.kind, pitch: r.pitch })),
    })),
  };
}
