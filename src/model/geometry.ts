import type { Vec2, Wall, Level, Room, Opening } from './types';

export const EPS = 1e-6;
export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const near = (a: Vec2, b: Vec2, tol = 0.02) => dist(a, b) <= tol;
export const round = (n: number, step = 0.01) => Math.round(n / step) * step;

export const wallLength = (w: Wall) => dist(w.a, w.b);
export const wallDir = (w: Wall) => norm(sub(w.b, w.a));
/** Unit normal pointing to the wall's "left" (+z of the local wall box). */
export const wallNormal = (w: Wall): Vec2 => { const d = wallDir(w); return { x: -d.y, y: d.x }; };
export const wallAngle = (w: Wall) => Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
export const pointOnWall = (w: Wall, t: number): Vec2 => add(w.a, mul(wallDir(w), t));

/** Projection of point p onto segment ab. Returns param t in meters along ab, clamped, closest point and distance. */
export function projectToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a);
  const L = len(ab);
  if (L < EPS) return { t: 0, point: a, distance: dist(p, a), u: 0 };
  const u = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (L * L)));
  const point = lerp2(a, b, u);
  return { t: u * L, point, distance: dist(p, point), u };
}

/** Four corners of the wall's footprint polygon (no joint handling). */
export function wallPolygon(w: Wall, extendA = 0, extendB = 0): Vec2[] {
  const d = wallDir(w);
  const n = wallNormal(w);
  const h = w.thickness / 2;
  const a = sub(w.a, mul(d, extendA));
  const b = add(w.b, mul(d, extendB));
  return [add(a, mul(n, h)), add(b, mul(n, h)), sub(b, mul(n, h)), sub(a, mul(n, h))];
}

/** How much to extend each wall end so corners close (half thickness of the thickest wall meeting at that endpoint). */
export function wallExtensions(w: Wall, walls: Wall[]) {
  let ea = 0, eb = 0;
  for (const o of walls) {
    if (o.id === w.id || o.kind === 'invisible') continue;
    const touchA = near(o.a, w.a) || near(o.b, w.a);
    const touchB = near(o.a, w.b) || near(o.b, w.b);
    const parallel = Math.abs(cross(wallDir(w), wallDir(o))) < 0.05;
    if (parallel) continue;
    if (touchA) ea = Math.max(ea, o.thickness / 2);
    if (touchB) eb = Math.max(eb, o.thickness / 2);
  }
  return { ea, eb };
}

export function polygonArea(pts: Vec2[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; }
  return s / 2;
}
export const absArea = (pts: Vec2[]) => Math.abs(polygonArea(pts));

export function centroid(pts: Vec2[]): Vec2 {
  const A = polygonArea(pts);
  if (Math.abs(A) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), v(0, 0));
    return mul(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** A label point that is guaranteed inside the polygon (pole of inaccessibility approximation). */
export function labelPoint(pts: Vec2[]): Vec2 {
  const c = centroid(pts);
  if (pointInPolygon(c, pts)) return c;
  const b = bounds(pts);
  let best = c, bestD = -1;
  const N = 16;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const p = v(b.minX + (b.maxX - b.minX) * i / N, b.minY + (b.maxY - b.minY) * j / N);
    if (!pointInPolygon(p, pts)) continue;
    let dmin = Infinity;
    for (let k = 0; k < pts.length; k++) dmin = Math.min(dmin, projectToSegment(p, pts[k], pts[(k + 1) % pts.length]).distance);
    if (dmin > bestD) { bestD = dmin; best = p; }
  }
  return best;
}

export function pointInPolygon(p: Vec2, pts: Vec2[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function bounds(pts: Vec2[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function levelBounds(level: Level) {
  const pts: Vec2[] = [];
  for (const w of level.walls) pts.push(w.a, w.b);
  for (const r of level.rooms) pts.push(...r.points);
  for (const it of level.items) pts.push(v(it.x - it.w / 2, it.y - it.d / 2), v(it.x + it.w / 2, it.y + it.d / 2));
  if (!pts.length) return null;
  return bounds(pts);
}

export function perimeter(pts: Vec2[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

/** Segment intersection; returns params along both segments if they intersect. */
export function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < -1e-4 || t > 1 + 1e-4 || u < -1e-4 || u > 1 + 1e-4) return null;
  return { t, u, p: add(a, mul(r, t)) };
}

/**
 * Detect enclosed regions formed by walls (planar graph faces).
 * Returns polygons (CCW in plan coordinates) for each bounded face.
 */
export function detectRooms(walls: Wall[], minArea = 0.8): Vec2[][] {
  const segs = walls.filter((w) => w.kind !== 'railing').map((w) => [w.a, w.b] as [Vec2, Vec2]);
  // 1. split segments at intersections / T-junctions
  const cuts: number[][] = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i], [c, d] = segs[j];
      const hit = segIntersect(a, b, c, d);
      if (hit) { cuts[i].push(hit.t); cuts[j].push(hit.u); continue; }
      // T junction tolerance: endpoint close to the other segment
      for (const [p, k, other] of [[c, j, i], [d, j, i], [a, i, j], [b, i, j]] as [Vec2, number, number][]) {
        const [oa, ob] = segs[other];
        const pr = projectToSegment(p, oa, ob);
        if (pr.distance < 0.06) cuts[other].push(pr.u);
        void k;
      }
    }
  }
  // 2. node merge
  const nodes: Vec2[] = [];
  const nodeId = (p: Vec2) => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) < 0.06) return i;
    nodes.push(p); return nodes.length - 1;
  };
  const edgeSet = new Set<string>();
  const adj: Map<number, number[]> = new Map();
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(Math.max(0, Math.min(1, t)) * 1e5) / 1e5))].sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const p = lerp2(a, b, ts[k]), q = lerp2(a, b, ts[k + 1]);
      if (dist(p, q) < 0.05) continue;
      const u = nodeId(p), w = nodeId(q);
      if (u === w) continue;
      const key = u < w ? `${u}-${w}` : `${w}-${u}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(w)) adj.set(w, []);
      adj.get(u)!.push(w); adj.get(w)!.push(u);
    }
  });
  // prune dangling edges (degree 1) iteratively
  let changed = true;
  while (changed) {
    changed = false;
    for (const [n, list] of adj) {
      if (list.length === 1) {
        const m = list[0];
        adj.delete(n);
        const l2 = adj.get(m);
        if (l2) l2.splice(l2.indexOf(n), 1);
        changed = true;
      } else if (list.length === 0) { adj.delete(n); changed = true; }
    }
  }
  // sort neighbors by angle
  for (const [n, list] of adj) {
    const p = nodes[n];
    list.sort((a, b) => Math.atan2(nodes[a].y - p.y, nodes[a].x - p.x) - Math.atan2(nodes[b].y - p.y, nodes[b].x - p.x));
  }
  // 3. traverse faces: for half edge u->w, next is w->x where x is the neighbor after u in clockwise order around w
  const visited = new Set<string>();
  const faces: Vec2[][] = [];
  for (const [u, list] of adj) {
    for (const w of list) {
      const start = `${u}>${w}`;
      if (visited.has(start)) continue;
      const poly: number[] = [];
      let a = u, b = w, guard = 0;
      while (guard++ < 2000) {
        const key = `${a}>${b}`;
        if (visited.has(key)) break;
        visited.add(key);
        poly.push(a);
        const nb = adj.get(b)!;
        const idx = nb.indexOf(a);
        const next = nb[(idx - 1 + nb.length) % nb.length];
        a = b; b = next;
      }
      if (poly.length >= 3) faces.push(poly.map((i) => nodes[i]));
    }
  }
  // bounded faces have positive signed area with this traversal (y-down plan coords) — keep those
  const out = faces
    .map((f) => simplifyPolygon(f))
    .filter((f) => f.length >= 3 && polygonArea(f) > minArea);
  return out;
}

/** Remove collinear and duplicate points. */
export function simplifyPolygon(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length], p = pts[i], next = pts[(i + 1) % pts.length];
    if (dist(prev, p) < 1e-3) continue;
    if (Math.abs(cross(norm(sub(p, prev)), norm(sub(next, p)))) < 1e-3 && dot(sub(p, prev), sub(next, p)) > 0) continue;
    out.push(p);
  }
  return out;
}

/** Inset of room polygon by half wall thickness for nicer visuals (approx: offset edges). */
export function offsetPolygon(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  const sign = polygonArea(pts) > 0 ? 1 : -1;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const d1 = norm(sub(p1, p0)), d2 = norm(sub(p2, p1));
    // inward normal for positive (y-down, CW visual) polygon
    const n1 = mul({ x: -d1.y, y: d1.x }, sign), n2 = mul({ x: -d2.y, y: d2.x }, sign);
    const bis = norm(add(n1, n2));
    const c = dot(bis, n1) || 1;
    out.push(add(p1, mul(bis, d / c)));
  }
  return out;
}

/** Openings positioned along a wall, sorted, as [start,end] intervals in meters from wall.a */
export function openingIntervals(w: Wall, openings: Opening[]) {
  return openings
    .filter((o) => o.wallId === w.id)
    .map((o) => ({ o, s: o.t - o.width / 2, e: o.t + o.width / 2 }))
    .sort((x, y) => x.s - y.s);
}

export function roomArea(r: Room) { return absArea(r.points); }

export function formatLength(m: number, units: 'metric' | 'imperial' = 'metric') {
  if (units === 'imperial') {
    const inches = m / 0.0254;
    const ft = Math.floor(inches / 12);
    const inch = Math.round(inches - ft * 12);
    return inch === 12 ? `${ft + 1}′` : `${ft}′${inch ? ` ${inch}″` : ''}`;
  }
  return m >= 10 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`;
}
export function formatArea(m2: number, units: 'metric' | 'imperial' = 'metric') {
  if (units === 'imperial') return `${Math.round(m2 * 10.7639)} ft²`;
  return `${m2 < 10 ? m2.toFixed(1) : Math.round(m2)} m²`;
}

/** Find wall nearest to p within tolerance. */
export function nearestWall(p: Vec2, walls: Wall[], tol = 0.4) {
  let best: { wall: Wall; t: number; distance: number; point: Vec2 } | null = null;
  for (const w of walls) {
    const pr = projectToSegment(p, w.a, w.b);
    if (pr.distance <= Math.max(tol, w.thickness / 2) && (!best || pr.distance < best.distance)) best = { wall: w, t: pr.t, distance: pr.distance, point: pr.point };
  }
  return best;
}

/** Room containing point. */
export function roomAt(p: Vec2, rooms: Room[]) {
  let best: Room | null = null;
  for (const r of rooms) if (pointInPolygon(p, r.points) && (!best || absArea(r.points) < absArea(best.points))) best = r;
  return best;
}

/** Whether point is on the +normal side of a wall. */
export function sideOfWall(w: Wall, p: Vec2) { return dot(sub(p, w.a), wallNormal(w)) >= 0 ? 1 : -1; }
