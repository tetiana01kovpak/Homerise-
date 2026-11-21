// Converts vectorized floor-plan data (offline CV or Claude vision) into a Homerise project.
import type { Project, Level, Vec2, Wall, OpeningKind, RoomType } from './types';
import { uid } from './types';
import { newProject, addOpening, ROOM_DEFAULTS, guessRoomType, OPENING_DEFAULTS } from './ops';
import { detectRooms, labelPoint, pointInPolygon, dist, projectToSegment, absArea, wallNormal, add, mul, bounds } from './geometry';
import { decomposeRects } from './spec';

export interface PlanVector {
  walls: { a: Vec2; b: Vec2; thickness: number }[];
  openings: { at: Vec2; width: number; kind: OpeningKind | 'door' | 'window' }[];
  rooms?: { name: string; type?: RoomType; at?: Vec2; points?: Vec2[] }[];
}

/** Snap endpoints together, straighten near-axis walls, drop slivers. */
export function cleanWalls(walls: PlanVector['walls']) {
  const ws = walls.map((w) => ({ a: { ...w.a }, b: { ...w.b }, thickness: Math.max(0.08, Math.min(0.5, w.thickness)) })).filter((w) => dist(w.a, w.b) > 0.15);
  // straighten
  for (const w of ws) {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    const ang = Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2);
    if (ang < 0.06 || ang > Math.PI / 2 - 0.06) {
      if (Math.abs(dx) > Math.abs(dy)) { const y = (w.a.y + w.b.y) / 2; w.a.y = y; w.b.y = y; } else { const x = (w.a.x + w.b.x) / 2; w.a.x = x; w.b.x = x; }
    }
  }
  // cluster endpoints
  const pts: Vec2[] = ws.flatMap((w) => [w.a, w.b]);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (dist(pts[i], pts[j]) < 0.18) { const m = { x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2 }; pts[i].x = pts[j].x = m.x; pts[i].y = pts[j].y = m.y; }
  }
  // extend endpoints that nearly touch another wall's body (T junctions)
  for (const w of ws) for (const end of ['a', 'b'] as const) {
    const p = w[end];
    for (const o of ws) {
      if (o === w) continue;
      const pr = projectToSegment(p, o.a, o.b);
      if (pr.distance > 0.01 && pr.distance < 0.25 && pr.u > 0.02 && pr.u < 0.98) { p.x = pr.point.x; p.y = pr.point.y; break; }
    }
  }
  return ws.filter((w) => dist(w.a, w.b) > 0.15);
}

export function vectorToProject(v: PlanVector, name = 'Imported plan', opts: { furnish?: (p: Project) => void; roof?: boolean } = {}): Project {
  const p = newProject(name);
  const level: Level = p.levels[0];
  const walls = cleanWalls(v.walls);
  // normalize so the plan starts near the origin
  const b = bounds(walls.flatMap((w) => [w.a, w.b]));
  const shift = (q: Vec2) => ({ x: +(q.x - b.minX).toFixed(3), y: +(q.y - b.minY).toFixed(3) });
  for (const w of walls) level.walls.push({ id: uid('w'), a: shift(w.a), b: shift(w.b), thickness: +w.thickness.toFixed(3) });
  // rooms
  const faces = detectRooms(level.walls, 1.2);
  const named = (v.rooms ?? []).map((r) => ({ ...r, at: r.at ? shift(r.at) : r.points ? labelPoint(r.points.map(shift)) : undefined }));
  for (const f of faces) {
    const hit = named.find((r) => r.at && pointInPolygon(r.at, f));
    const type: RoomType = hit?.type ?? (hit ? guessRoomType(hit.name) : absArea(f) < 3 ? 'storage' : 'other');
    level.rooms.push({ id: uid('room'), name: hit?.name ?? ROOM_DEFAULTS[type].label, type, points: f, floor: ROOM_DEFAULTS[type].floor });
  }
  // exterior walls: one side outside every room
  for (const w of level.walls) {
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    const n = wallNormal(w);
    const l = level.rooms.some((r) => pointInPolygon(add(mid, mul(n, w.thickness / 2 + 0.1)), r.points));
    const r = level.rooms.some((r2) => pointInPolygon(add(mid, mul(n, -w.thickness / 2 - 0.1)), r2.points));
    if (l !== r) { w.exterior = true; w.thickness = Math.max(w.thickness, 0.2); }
  }
  // openings
  let frontPlaced = false;
  for (const o of v.openings) {
    const at = shift(o.at);
    let best: { w: Wall; t: number; d: number } | null = null;
    for (const w of level.walls) { const pr = projectToSegment(at, w.a, w.b); if (pr.distance < 0.5 && (!best || pr.distance < best.d)) best = { w, t: pr.t, d: pr.distance }; }
    if (!best) continue;
    let kind = o.kind as OpeningKind;
    if (kind === 'door' && best.w.exterior && !frontPlaced) { kind = 'frontDoor'; frontPlaced = true; }
    const def = OPENING_DEFAULTS[kind] ?? OPENING_DEFAULTS.door;
    addOpening(level, best.w.id, kind, best.t, { width: Math.max(0.5, Math.min(o.width || def.width, 3.5)) });
  }
  // roof over the footprint (rectangular decomposition of room bounding boxes)
  if (opts.roof !== false && level.rooms.length) {
    const rects = level.rooms.map((r) => { const bb = bounds(r.points); return { name: r.name, x: bb.minX, y: bb.minY, w: bb.w, d: bb.h }; });
    for (const r of decomposeRects(rects, [])) level.roofs.push({ id: uid('roof'), kind: 'gable', x: r.x, y: r.y, w: r.w, d: r.d, pitch: 28, overhang: 0.4, ridge: r.w >= r.d ? 'x' : 'y', color: '#4A4F57' });
  }
  if (opts.furnish) opts.furnish(p);
  return p;
}
