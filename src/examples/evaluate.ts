// Objective quality checks for a generated project. Used by tests and the in-app "Plan check".
import type { Project, Level, Room } from '../model/types';
import { absArea, pointInPolygon, wallLength, projectToSegment, bounds } from '../model/geometry';
import { sharedEdge } from '../model/ops';
import { exteriorEdges } from '../model/spec';

export interface Issue { level: string; severity: 'error' | 'warn'; msg: string }
export interface Report { score: number; issues: Issue[]; stats: Record<string, number> }

const indoor = (r: Room) => r.type !== 'terrace' && r.type !== 'balcony';

function openingCenter(level: Level, oId: string) {
  const o = level.openings.find((x) => x.id === oId)!;
  const w = level.walls.find((x) => x.id === o.wallId)!;
  const L = wallLength(w);
  return { x: w.a.x + ((w.b.x - w.a.x) * o.t) / L, y: w.a.y + ((w.b.y - w.a.y) * o.t) / L, o, w };
}

export function connectivity(level: Level) {
  const rooms = level.rooms.filter(indoor);
  const adj = new Map<string, Set<string>>(rooms.map((r) => [r.id, new Set<string>()]));
  const doorsToOutside = new Set<string>();
  for (const o of level.openings) {
    if (o.kind.includes('indow')) continue;
    const { x, y, w } = openingCenter(level, o.id);
    const n = { x: -(w.b.y - w.a.y) / wallLength(w), y: (w.b.x - w.a.x) / wallLength(w) };
    const pa = { x: x + n.x * 0.3, y: y + n.y * 0.3 }, pb = { x: x - n.x * 0.3, y: y - n.y * 0.3 };
    const ra = rooms.find((r) => pointInPolygon(pa, r.points)), rb = rooms.find((r) => pointInPolygon(pb, r.points));
    if (ra && rb) { adj.get(ra.id)!.add(rb.id); adj.get(rb.id)!.add(ra.id); }
    else if (ra || rb) doorsToOutside.add((ra ?? rb)!.id);
  }
  return { adj, doorsToOutside, rooms };
}

export function evaluateProject(p: Project, opts: { requireFurniture?: boolean } = {}): Report {
  const issues: Issue[] = [];
  const stats: Record<string, number> = { rooms: 0, walls: 0, doors: 0, windows: 0, items: 0, area: 0, levels: p.levels.length, roofs: 0 };
  const ground = p.levels.find((l) => Math.abs(l.elevation) < 0.01) ?? p.levels[0];
  for (const level of p.levels) {
    const L = level.name;
    stats.rooms += level.rooms.length; stats.walls += level.walls.length; stats.items += level.items.length; stats.roofs += level.roofs.length;
    stats.doors += level.openings.filter((o) => !o.kind.includes('indow')).length;
    stats.windows += level.openings.filter((o) => o.kind.includes('indow')).length;
    stats.area += level.rooms.filter(indoor).reduce((s, r) => s + absArea(r.points), 0);
    if (level.elevation > -0.5) stats.livingArea = (stats.livingArea ?? 0) + level.rooms.filter((r) => indoor(r) && r.type !== 'garage').reduce((s, r) => s + absArea(r.points), 0);
    // overlaps
    for (let i = 0; i < level.rooms.length; i++) for (let j = i + 1; j < level.rooms.length; j++) {
      const a = bounds(level.rooms[i].points), b = bounds(level.rooms[j].points);
      const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (ox > 0.05 && oy > 0.05) issues.push({ level: L, severity: 'error', msg: `Rooms overlap: ${level.rooms[i].name} / ${level.rooms[j].name}` });
    }
    // openings valid
    for (const o of level.openings) {
      const w = level.walls.find((x) => x.id === o.wallId);
      if (!w) { issues.push({ level: L, severity: 'error', msg: `Opening ${o.id} has no wall` }); continue; }
      if (o.t - o.width / 2 < -0.01 || o.t + o.width / 2 > wallLength(w) + 0.01) issues.push({ level: L, severity: 'error', msg: `Opening ${o.kind} exceeds wall` });
      if (o.sill + o.height > (w.height ?? level.height) + 0.01) issues.push({ level: L, severity: 'error', msg: `Opening ${o.kind} taller than wall` });
    }
    // reachability
    const { adj, doorsToOutside, rooms } = connectivity(level);
    if (rooms.length) {
      const start = level === ground ? [...doorsToOutside] : rooms.filter((r) => r.type === 'hall').map((r) => r.id);
      if (level === ground && !level.openings.some((o) => o.kind === 'frontDoor')) issues.push({ level: L, severity: 'error', msg: 'No front door' });
      const seen = new Set(start.length ? start : [rooms[0].id]);
      const q = [...seen];
      while (q.length) { const id = q.shift()!; for (const n of adj.get(id) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); } }
      for (const r of rooms) if (!seen.has(r.id)) issues.push({ level: L, severity: 'error', msg: `${r.name} is not reachable` });
    }
    // windows for habitable rooms above ground
    if (level.elevation > -0.5) for (const r of level.rooms) {
      if (!['bedroom', 'living', 'kitchen', 'office', 'dining'].includes(r.type)) continue;
      const hasWin = level.openings.some((o) => {
        if (!(o.kind.includes('indow') || o.kind === 'slidingDoor')) return false;
        const c = openingCenter(level, o.id);
        return r.points.some((pt, i) => projectToSegment(c, pt, r.points[(i + 1) % r.points.length]).distance < 0.1);
      });
      const ext = exteriorEdges(level, r).length > 0;
      if (!hasWin && ext) issues.push({ level: L, severity: 'warn', msg: `${r.name} has no window` });
      if (!ext && r.type === 'bedroom') issues.push({ level: L, severity: 'warn', msg: `${r.name} has no exterior wall` });
    }
    // proportions
    for (const r of level.rooms.filter(indoor)) {
      const b = bounds(r.points);
      const ratio = Math.max(b.w, b.h) / Math.max(0.1, Math.min(b.w, b.h));
      if (r.type === 'bedroom' && (Math.min(b.w, b.h) < 2.6 || absArea(r.points) < 7.5)) issues.push({ level: L, severity: 'warn', msg: `${r.name} is small (${absArea(r.points).toFixed(1)} m²)` });
      if (r.type !== 'hall' && ratio > 3.2) issues.push({ level: L, severity: 'warn', msg: `${r.name} is very elongated (${ratio.toFixed(1)}:1)` });
    }
    // furniture inside rooms / not overlapping / not blocking doors
    for (const it of level.items) {
      if (it.catalogId.startsWith('stair-')) continue;
      const inside = level.rooms.some((r) => pointInPolygon({ x: it.x, y: it.y }, r.points));
      const outdoorOK = /tree|bush|hedge|flower|fence|pool|lounger|parasol|bbq|car|suv|lamp-post|mailbox|bench|shed|outdoor|trampoline|hot-tub|lawn|planter|plant/.test(it.catalogId);
      if (!inside && !outdoorOK) issues.push({ level: L, severity: 'warn', msg: `${it.catalogId} placed outside rooms` });
      if (it.elevation < 0.5 && !/rug|ceiling|pendant|downlight/.test(it.catalogId)) for (const o of level.openings) {
        if (o.kind.includes('indow')) continue;
        if (o.kind === 'garageDoor' && /car|suv|bicycle/.test(it.catalogId)) continue;
        const { x, y, w } = openingCenter(level, o.id);
        const L2 = wallLength(w); const d = { x: (w.b.x - w.a.x) / L2, y: (w.b.y - w.a.y) / L2 }; const n = { x: -d.y, y: d.x };
        // clearance zone: opening width × depth on both sides of the wall
        const depth = o.kind === 'door' || o.kind === 'frontDoor' || o.kind === 'doubleDoor' ? Math.min(o.width, 0.9) : 0.6;
        const zone = [-1, 1].map((sg) => [x + d.x * -o.width / 2 + n.x * sg * (w.thickness / 2), y + d.y * -o.width / 2 + n.y * sg * (w.thickness / 2), x + d.x * o.width / 2 + n.x * sg * (w.thickness / 2 + depth), y + d.y * o.width / 2 + n.y * sg * (w.thickness / 2 + depth)]);
        const ic = Math.abs(Math.cos(it.rotation)), is = Math.abs(Math.sin(it.rotation));
        const hw = (it.w * ic + it.d * is) / 2 - 0.05, hd = (it.w * is + it.d * ic) / 2 - 0.05;
        const hit = zone.some(([x0, y0, x1, y1]) => Math.min(x0, x1) < it.x + hw && Math.max(x0, x1) > it.x - hw && Math.min(y0, y1) < it.y + hd && Math.max(y0, y1) > it.y - hd);
        if (hit) issues.push({ level: L, severity: 'warn', msg: `${it.catalogId} blocks a ${o.kind}` });
      }
    }
    const nonTrivial = level.items.filter((i) => !i.catalogId.startsWith('stair-') && level.rooms.some((r) => pointInPolygon({ x: i.x, y: i.y }, r.points)));
    for (let i = 0; i < nonTrivial.length; i++) for (let j = i + 1; j < nonTrivial.length; j++) {
      const a = nonTrivial[i], b = nonTrivial[j];
      if (/rug|ceiling|pendant|art|picture|mirror|wall-cabinet|hood|sconce|clock|towel/.test(a.catalogId + b.catalogId)) continue;
      if (a.elevation >= b.elevation + b.h - 0.05 || b.elevation >= a.elevation + a.h - 0.05) continue; // stacked (e.g. TV on stand)
      const ext = (it: typeof a) => { const c = Math.abs(Math.cos(it.rotation)), s = Math.abs(Math.sin(it.rotation)); return { hw: (it.w * c + it.d * s) / 2, hd: (it.w * s + it.d * c) / 2 }; };
      const ea = ext(a), eb = ext(b);
      const ox = ea.hw + eb.hw - Math.abs(a.x - b.x), oy = ea.hd + eb.hd - Math.abs(a.y - b.y);
      const chairish = /chair|stool|nightstand|side-table|coffee|plant|lamp|ottoman|monitor|vase/.test(a.catalogId + b.catalogId);
      if (ox > 0.12 && oy > 0.12 && !chairish) issues.push({ level: L, severity: 'warn', msg: `${a.catalogId} overlaps ${b.catalogId}` });
    }
    if (opts.requireFurniture) for (const r of level.rooms) {
      if (['hall', 'closet', 'storage', 'terrace', 'balcony', 'utility'].includes(r.type)) continue;
      if (!level.items.some((it) => pointInPolygon({ x: it.x, y: it.y }, r.points))) issues.push({ level: L, severity: 'warn', msg: `${r.name} is empty` });
    }
  }
  // roofs cover the top footprint
  const tops = p.levels.filter((l) => l.elevation >= 0);
  if (tops.length && !tops.some((l) => l.roofs.length)) issues.push({ level: '-', severity: 'error', msg: 'No roof' });
  for (const l of tops) for (const r of l.rooms.filter(indoor)) {
    const c = { x: bounds(r.points).minX + bounds(r.points).w / 2, y: bounds(r.points).minY + bounds(r.points).h / 2 };
    const coveredByAbove = p.levels.some((u) => u.elevation > l.elevation && u.rooms.some((x) => indoor(x) && pointInPolygon(c, x.points)));
    const coveredByRoof = l.roofs.some((rf) => c.x >= rf.x - 0.01 && c.x <= rf.x + rf.w + 0.01 && c.y >= rf.y - 0.01 && c.y <= rf.y + rf.d + 0.01);
    if (!coveredByAbove && !coveredByRoof) issues.push({ level: l.name, severity: 'error', msg: `${r.name} has nothing above it` });
  }
  if (p.levels.length > 1 && !p.levels.some((l) => l.items.some((i) => i.catalogId.startsWith('stair-')))) issues.push({ level: '-', severity: 'error', msg: 'Multiple levels but no stairs' });
  const errors = issues.filter((i) => i.severity === 'error').length, warns = issues.length - errors;
  const score = Math.max(0, 100 - errors * 15 - warns * 3);
  return { score, issues, stats };
}

export { sharedEdge };
