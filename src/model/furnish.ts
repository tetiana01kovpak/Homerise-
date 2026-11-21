// Rule-based interior designer: furnishes rooms realistically (respects doors, windows, clearances).
// Used offline and as the executor for Claude's "furnish" tool.
import type { Project, Level, Room, Item, Vec2 } from './types';
import { uid } from './types';
import { bounds, absArea, pointInPolygon, projectToSegment, wallLength } from './geometry';
import { getCatalogItem } from '../catalog';
import { itemsInRoom } from './ops';

type Side = 'top' | 'bottom' | 'left' | 'right';
interface Rect { x0: number; y0: number; x1: number; y1: number }
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const overlaps = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.y0 < b.y1 - m && a.y1 > b.y0 + m;

interface Ctx {
  level: Level;
  room: Room;
  b: ReturnType<typeof bounds>;
  /** inner face inset per side */
  inset: Record<Side, number>;
  occupied: Rect[];
  windows: Record<Side, [number, number][]>; // along-side intervals (u)
  doors: Record<Side, [number, number][]>;
  out: Item[];
}

function sideInfo(c: Ctx, s: Side) {
  const { b } = c;
  const len = s === 'top' || s === 'bottom' ? b.w : b.h;
  return { len, horizontal: s === 'top' || s === 'bottom' };
}

/** Rect + transform for an item of size w×d placed against side s at along-position u (center), with gap from wall. */
function placement(c: Ctx, s: Side, u: number, w: number, d: number, gap = 0) {
  const { b, inset } = c;
  const off = inset[s] + gap + d / 2;
  let x = 0, y = 0, rot = 0;
  if (s === 'top') { x = b.minX + u; y = b.minY + off; rot = 0; }
  if (s === 'bottom') { x = b.maxX - u; y = b.maxY - off; rot = Math.PI; }
  if (s === 'left') { x = b.minX + off; y = b.maxY - u; rot = -Math.PI / 2; }
  if (s === 'right') { x = b.maxX - off; y = b.minY + u; rot = Math.PI / 2; }
  const horiz = s === 'top' || s === 'bottom';
  const hw = horiz ? w / 2 : d / 2, hd = horiz ? d / 2 : w / 2;
  return { x, y, rot, rect: { x0: x - hw, y0: y - hd, x1: x + hw, y1: y + hd } };
}

/** Along-coordinate of a point on side s. */
function uOf(c: Ctx, s: Side, p: Vec2) {
  const { b } = c;
  if (s === 'top') return p.x - b.minX;
  if (s === 'bottom') return b.maxX - p.x;
  if (s === 'left') return b.maxY - p.y;
  return p.y - b.minY;
}

function makeCtx(level: Level, room: Room): Ctx {
  const b = bounds(room.points);
  const inset: Record<Side, number> = { top: 0.08, bottom: 0.08, left: 0.08, right: 0.08 };
  const windows: Ctx['windows'] = { top: [], bottom: [], left: [], right: [] };
  const doors: Ctx['doors'] = { top: [], bottom: [], left: [], right: [] };
  const occupied: Rect[] = [];
  const sideLine = (s: Side): [Vec2, Vec2] => s === 'top' ? [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }] : s === 'bottom' ? [{ x: b.minX, y: b.maxY }, { x: b.maxX, y: b.maxY }] : s === 'left' ? [{ x: b.minX, y: b.minY }, { x: b.minX, y: b.maxY }] : [{ x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }];
  for (const s of SIDES) {
    const [p, q] = sideLine(s);
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const w = level.walls.find((x) => projectToSegment(mid, x.a, x.b).distance < 0.05);
    inset[s] = (w ? w.thickness / 2 : 0.06) + 0.02;
  }
  const cctx = { level, room, b, inset, occupied, windows, doors, out: [] } as Ctx;
  for (const o of level.openings) {
    const w = level.walls.find((x) => x.id === o.wallId); if (!w) continue;
    const L = wallLength(w);
    const cpt = { x: w.a.x + ((w.b.x - w.a.x) * o.t) / L, y: w.a.y + ((w.b.y - w.a.y) * o.t) / L };
    for (const s of SIDES) {
      const [p, q] = sideLine(s);
      const pr = projectToSegment(cpt, p, q);
      if (pr.distance > 0.06 || pr.u <= 0 || pr.u >= 1) continue;
      const u = uOf(cctx, s, cpt);
      const iv: [number, number] = [u - o.width / 2, u + o.width / 2];
      if (o.kind.includes('indow')) windows[s].push(iv);
      else {
        doors[s].push(iv);
        // swing / passage clearance into the room
        const depth = o.kind === 'garageDoor' ? 1.0 : o.kind === 'opening' || o.kind === 'slidingDoor' ? 0.9 : o.width + 0.15;
        const z = placement(cctx, s, u, o.width + 0.2, depth, -cctx.inset[s]);
        occupied.push(z.rect);
      }
    }
  }
  return cctx;
}

function insideRoom(c: Ctx, r: Rect) {
  const pts = [{ x: r.x0 + 0.02, y: r.y0 + 0.02 }, { x: r.x1 - 0.02, y: r.y0 + 0.02 }, { x: r.x1 - 0.02, y: r.y1 - 0.02 }, { x: r.x0 + 0.02, y: r.y1 - 0.02 }];
  return pts.every((p) => pointInPolygon(p, c.room.points)) && r.x0 >= c.b.minX + 0.05 && r.x1 <= c.b.maxX - 0.05 && r.y0 >= c.b.minY + 0.05 && r.y1 <= c.b.maxY - 0.05;
}

interface PlaceOpts { tall?: boolean; gap?: number; u?: number; align?: 'center' | 'start' | 'end'; clearFront?: number; elevation?: number; color?: string; noOccupy?: boolean; h?: number }

function add(c: Ctx, id: string, x: number, y: number, rot: number, w: number, d: number, o: PlaceOpts = {}) {
  const def = getCatalogItem(id);
  if (!def) return null;
  const it: Item = { id: uid('it'), catalogId: id, x: round(x), y: round(y), rotation: rot, elevation: o.elevation ?? def.elevation ?? 0, w, d, h: o.h ?? def.size.h, color: o.color, name: def.name };
  c.out.push(it);
  return it;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Try to place an item against a side. Searches along the side for a free spot. */
function against(c: Ctx, id: string, sides: Side[], o: PlaceOpts = {}, sizeOverride?: { w?: number; d?: number }) {
  const def = getCatalogItem(id); if (!def) return null;
  const w = sizeOverride?.w ?? def.size.w, d = sizeOverride?.d ?? def.size.d;
  for (const s of sides) {
    const { len } = sideInfo(c, s);
    if (len < w + 0.1) continue;
    const lo = w / 2 + 0.05, hi = len - w / 2 - 0.05;
    const start = o.u ?? (o.align === 'start' ? lo : o.align === 'end' ? hi : len / 2);
    const cands: number[] = [];
    for (let k = 0; k <= 60; k++) { const du = Math.ceil(k / 2) * 0.1 * (k % 2 ? 1 : -1); const u = start + du; if (u >= lo - 1e-6 && u <= hi + 1e-6) cands.push(u); }
    for (const u of cands) {
      const pl = placement(c, s, u, w, d, o.gap ?? 0);
      if (!insideRoom(c, pl.rect)) continue;
      if (c.occupied.some((r) => overlaps(r, pl.rect, 0.01))) continue;
      if (o.tall && c.windows[s].some(([a, b]) => u + w / 2 > a - 0.05 && u - w / 2 < b + 0.05)) continue;
      if (c.doors[s].some(([a, b]) => u + w / 2 > a - 0.1 && u - w / 2 < b + 0.1)) continue;
      // clearance in front
      if (o.clearFront) {
        const fr = placement(c, s, u, w, o.clearFront, (o.gap ?? 0) + d);
        if (!insideRoom(c, fr.rect) || c.occupied.some((r) => overlaps(r, fr.rect, 0.01))) continue;
      }
      const it = add(c, id, pl.x, pl.y, pl.rot, w, d, o);
      if (it && !o.noOccupy) c.occupied.push(pl.rect);
      return it ? { it, side: s, u, rect: pl.rect } : null;
    }
  }
  return null;
}

/** Place an item at a free spot near the room center (e.g. dining sets). */
function centered(c: Ctx, id: string, o: PlaceOpts & { rot?: number; near?: Vec2 } = {}, size?: { w: number; d: number }) {
  const def = getCatalogItem(id); if (!def) return null;
  const w = size?.w ?? def.size.w, d = size?.d ?? def.size.d;
  const rot = o.rot ?? (c.b.w >= c.b.h ? 0 : Math.PI / 2);
  const horiz = Math.abs(Math.sin(rot)) < 0.5;
  const hw = horiz ? w / 2 : d / 2, hd = horiz ? d / 2 : w / 2;
  const cx0 = o.near?.x ?? c.b.minX + c.b.w / 2, cy0 = o.near?.y ?? c.b.minY + c.b.h / 2;
  for (let k = 0; k < 120; k++) {
    const ang = k * 2.39996, r = 0.12 * Math.sqrt(k);
    const x = cx0 + Math.cos(ang) * r, y = cy0 + Math.sin(ang) * r;
    const rect = { x0: x - hw, y0: y - hd, x1: x + hw, y1: y + hd };
    if (!insideRoom(c, rect) || c.occupied.some((q) => overlaps(q, rect, 0.01))) continue;
    const it = add(c, id, x, y, rot, w, d, o);
    if (it && !o.noOccupy) c.occupied.push(rect);
    return it ? { it, rect } : null;
  }
  return null;
}

const opposite = (s: Side): Side => ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[s];
/** Sides ordered: longest free wall first, preferring walls without doors. */
function rankSides(c: Ctx, prefer?: (s: Side) => number) {
  return [...SIDES].sort((a, b) => score(b) - score(a));
  function score(s: Side) {
    const { len } = sideInfo(c, s);
    const doorLen = c.doors[s].reduce((t, [x, y]) => t + (y - x), 0);
    return len - doorLen * 2.5 - (c.doors[s].length ? 1.5 : 0) + (prefer?.(s) ?? 0);
  }
}
const doorSide = (c: Ctx) => SIDES.find((s) => c.doors[s].length) as Side | undefined;
const windowSides = (c: Ctx) => SIDES.filter((s) => c.windows[s].length);

// ---------------- recipes ----------------
function bedroom(c: Ctx) {
  const A = absArea(c.room.points);
  const small = Math.min(c.b.w, c.b.h);
  const bedId = A >= 15 && small >= 3.6 ? 'bed-king' : A >= 12.5 ? 'bed-queen' : A >= 9 && small >= 2.8 ? 'bed-double' : 'bed-single';
  const ds = doorSide(c);
  const sides = rankSides(c, (s) => (ds && s === opposite(ds) ? 2 : 0) + (c.windows[s].length ? -0.6 : 0));
  const bedDef = getCatalogItem(bedId)!;
  let bed = against(c, bedId, sides, { clearFront: 0.6 });
  if (!bed) bed = against(c, 'bed-single', sides, { clearFront: 0.5 });
  if (bed) {
    // nightstands on both sides
    for (const sgn of [-1, 1]) {
      const ns = getCatalogItem('nightstand')!;
      const u = bed.u + sgn * (bed.it.w / 2 + ns.size.w / 2 + 0.03);
      const r = against(c, 'nightstand', [bed.side], { u, noOccupy: false });
      if (r && Math.abs(r.u - u) > 0.05) { c.out.pop(); c.occupied.pop(); }
      else if (r) {
        const lamp = getCatalogItem('table-lamp');
        if (lamp) add(c, 'table-lamp', r.it.x, r.it.y, r.it.rotation, lamp.size.w, lamp.size.d, { elevation: ns.size.h });
      }
    }
    void bedDef;
  }
  const ward = against(c, A > 12 ? 'wardrobe-3' : 'wardrobe-2', rankSides(c, (s) => (bed && s === bed.side ? -5 : 0)), { tall: true, clearFront: 0.6 });
  if (!ward) against(c, 'dresser', rankSides(c), { clearFront: 0.5 });
  if (A > 13) against(c, 'dresser', rankSides(c, (s) => (bed && s === bed.side ? -5 : 0)), { clearFront: 0.6 });
  if (A > 10) { const rug = centered(c, 'rug-rect', { noOccupy: true, near: bed ? footOf(bed.it, 0.35) : undefined, rot: bed?.it.rotation }, { w: 2.0, d: 1.4 }); void rug; }
  against(c, 'plant-large', rankSides(c), { align: 'start' });
}
const footOf = (it: Item, k: number): Vec2 => ({ x: it.x - Math.sin(it.rotation) * (it.d * k), y: it.y + Math.cos(it.rotation) * (it.d * k) });

function living(c: Ctx, opts: { tv?: boolean } = {}) {
  const A = absArea(c.room.points);
  const sofaId = A >= 24 && Math.min(c.b.w, c.b.h) >= 3.6 ? 'sofa-l' : A >= 14 ? 'sofa-3' : 'sofa-2';
  const ds = doorSide(c);
  const ws = windowSides(c);
  // sofa on a long wall without doors; TV on the opposite wall
  const sides = rankSides(c, (s) => (ds && s === ds ? -3 : 0) + (ws.includes(s) ? -0.5 : 0));
  let sofa = against(c, sofaId, sides, { clearFront: 1.2 });
  if (!sofa && sofaId !== 'sofa-2') sofa = against(c, 'sofa-2', sides, { clearFront: 1.0 });
  if (sofa) {
    const opp = opposite(sofa.side);
    if (opts.tv !== false) {
      const tvs = against(c, 'tv-stand', [opp], { u: sideInfo(c, opp).len - sofa.u });
      if (tvs) { const tv = getCatalogItem('tv'); if (tv) add(c, 'tv', tvs.it.x, tvs.it.y, tvs.it.rotation, tv.size.w, tv.size.d, { elevation: getCatalogItem('tv-stand')!.size.h }); }
    }
    const front = footOf(sofa.it, 0.5 + 0.45 / sofa.it.d + 0.3);
    const ct = getCatalogItem('coffee-table')!;
    const ctPos = { x: sofa.it.x - Math.sin(sofa.it.rotation) * (sofa.it.d / 2 + 0.45 + ct.size.d / 2), y: sofa.it.y + Math.cos(sofa.it.rotation) * (sofa.it.d / 2 + 0.45 + ct.size.d / 2) };
    void front;
    const r = { x0: ctPos.x - ct.size.w / 2, y0: ctPos.y - ct.size.d / 2, x1: ctPos.x + ct.size.w / 2, y1: ctPos.y + ct.size.d / 2 };
    const rot = sofa.it.rotation;
    const horiz = Math.abs(Math.sin(rot)) < 0.5;
    const rr = horiz ? r : { x0: ctPos.x - ct.size.d / 2, y0: ctPos.y - ct.size.w / 2, x1: ctPos.x + ct.size.d / 2, y1: ctPos.y + ct.size.w / 2 };
    if (insideRoom(c, rr) && !c.occupied.some((q) => overlaps(q, rr, 0.01))) { add(c, 'coffee-table', ctPos.x, ctPos.y, rot, ct.size.w, ct.size.d); c.occupied.push(rr); }
    const rugW = Math.min(sofa.it.w + 0.6, 3), rugD = 2;
    const rugPos = { x: sofa.it.x - Math.sin(rot) * (sofa.it.d / 2 + 0.6), y: sofa.it.y + Math.cos(rot) * (sofa.it.d / 2 + 0.6) };
    const rugRect = horiz ? { x0: rugPos.x - rugW / 2, y0: rugPos.y - rugD / 2, x1: rugPos.x + rugW / 2, y1: rugPos.y + rugD / 2 } : { x0: rugPos.x - rugD / 2, y0: rugPos.y - rugW / 2, x1: rugPos.x + rugD / 2, y1: rugPos.y + rugW / 2 };
    if (insideRoom(c, rugRect)) add(c, 'rug-rect', rugPos.x, rugPos.y, rot, rugW, rugD);
    // armchair beside the sofa, angled toward the table
    const ac = against(c, 'armchair', [sofa.side], { u: sofa.u + sofa.it.w / 2 + 0.6, clearFront: 0.5 });
    void ac;
    against(c, 'floor-lamp', [sofa.side], { u: sofa.u - sofa.it.w / 2 - 0.3 });
  }
  if (A > 16) against(c, 'bookshelf', rankSides(c, (s) => (sofa && (s === sofa.side || s === opposite(sofa.side)) ? -4 : 0)), { tall: true, clearFront: 0.5 });
  against(c, 'plant-large', rankSides(c), { align: 'end' });
}

function kitchen(c: Ctx, withDining: boolean) {
  const A = absArea(c.room.points);
  const ds = doorSide(c);
  const sides = rankSides(c, (s) => (ds && s === ds ? -4 : 0));
  // counter run along the best wall
  const s = sides[0];
  const len = sideInfo(c, s).len;
  // free interval on that side avoiding doors
  const blocks = [...c.doors[s]].sort((a, b) => a[0] - b[0]);
  let a = 0.06, best: [number, number] = [0, 0];
  for (const [x, y] of [...blocks, [len, len] as [number, number]]) { if (x - 0.1 - a > best[1] - best[0]) best = [a, x - 0.1]; a = y + 0.1; }
  const run = Math.max(0, best[1] - best[0]);
  const seq: string[] = [];
  const W = (id: string) => getCatalogItem(id)?.size.w ?? 0.6;
  if (run >= 1.8) {
    let remaining = run;
    const want = ['fridge', 'kitchen-base-cabinet', 'kitchen-sink-cabinet', 'dishwasher', 'kitchen-drawer-cabinet', 'stove', 'kitchen-base-cabinet', 'kitchen-base-cabinet', 'kitchen-base-cabinet'];
    for (const id of want) { if (W(id) <= remaining + 1e-6) { seq.push(id); remaining -= W(id); } }
    let u = best[0];
    for (const id of seq) {
      const def = getCatalogItem(id)!;
      const pl = placement(c, s, u + def.size.w / 2, def.size.w, def.size.d);
      const tall = id === 'fridge';
      const blockedByWindow = tall && c.windows[s].some(([x, y]) => u + def.size.w > x && u < y);
      if (!blockedByWindow && insideRoom(c, pl.rect) && !c.occupied.some((q) => overlaps(q, pl.rect, 0.01))) {
        add(c, id, pl.x, pl.y, pl.rot, def.size.w, def.size.d);
        c.occupied.push(pl.rect);
        // wall cabinets above (not over windows / fridge)
        const overWindow = c.windows[s].some(([x, y]) => u + def.size.w > x - 0.05 && u < y + 0.05);
        if (!tall && !overWindow) {
          if (id === 'stove' && getCatalogItem('range-hood')) { const h = getCatalogItem('range-hood')!; const p2 = placement(c, s, u + def.size.w / 2, h.size.w, h.size.d); add(c, 'range-hood', p2.x, p2.y, p2.rot, h.size.w, h.size.d); }
          else { const wc = getCatalogItem('kitchen-wall-cabinet')!; const p2 = placement(c, s, u + def.size.w / 2, def.size.w, wc.size.d); add(c, 'kitchen-wall-cabinet', p2.x, p2.y, p2.rot, def.size.w, wc.size.d); }
        }
      }
      u += def.size.w;
    }
    // clearance in front of the counter
    const fr = placement(c, s, (best[0] + best[1]) / 2, run, 1.0, 0.62);
    c.occupied.push(fr.rect);
  }
  if (!withDining && A >= 15 && Math.min(c.b.w, c.b.h) >= 3.6) {
    const isl = centered(c, 'kitchen-island', { rot: s === 'top' || s === 'bottom' ? 0 : Math.PI / 2 });
    if (isl) {
      const st = getCatalogItem('bar-stool');
      if (st) for (const k of [-1, 0, 1]) {
        const rot = isl.it.rotation + Math.PI;
        const along = { x: Math.cos(isl.it.rotation), y: Math.sin(isl.it.rotation) };
        const back = { x: Math.sin(isl.it.rotation), y: -Math.cos(isl.it.rotation) };
        const off = isl.it.d / 2 + 0.25;
        const p = { x: isl.it.x + along.x * k * 0.55 - back.x * off, y: isl.it.y + along.y * k * 0.55 - back.y * off };
        if (Math.abs(k * 0.55) + 0.2 < isl.it.w / 2) add(c, 'bar-stool', p.x, p.y, rot, st.size.w, st.size.d);
      }
    }
  }
  if (withDining) dining(c);
}

function dining(c: Ctx) {
  const A = absArea(c.room.points);
  const small = Math.min(c.b.w, c.b.h);
  const id = A >= 13 && small >= 3.2 ? 'dining-set-6' : small >= 2.8 ? 'dining-set-4' : 'dining-set-round';
  const r = centered(c, id) ?? centered(c, 'dining-set-4') ?? centered(c, 'dining-set-round');
  if (r) { const pl = getCatalogItem('pendant-lamp'); if (pl) add(c, 'pendant-lamp', r.it.x, r.it.y, r.it.rotation, pl.size.w, pl.size.d, { elevation: Math.max(1.6, c.level.height - pl.size.h) }); }
  if (A > 11) against(c, 'sideboard', rankSides(c), { clearFront: 0.6 });
  against(c, 'plant-small', rankSides(c), { align: 'start' });
}

function bathroom(c: Ctx) {
  const A = absArea(c.room.points);
  const ds = doorSide(c);
  const long = Math.max(c.b.w, c.b.h), short = Math.min(c.b.w, c.b.h);
  const sides = rankSides(c, (s) => (ds && s === opposite(ds) ? 2 : 0));
  // tub along the far wall if it fits, otherwise a shower in a corner
  let wet = null as ReturnType<typeof against>;
  if (A >= 5 && long >= 2.3) {
    const sFar = SIDES.filter((s) => sideInfo(c, s).len >= 1.75).sort((a, b) => (ds && a === opposite(ds) ? -1 : 0) - (ds && b === opposite(ds) ? -1 : 0));
    wet = against(c, 'bathtub', sFar, { align: 'start' });
  }
  if (!wet) wet = against(c, 'shower-square', sides, { align: 'end' });
  const van = against(c, A >= 7 && long >= 2.6 ? 'vanity-double' : 'vanity-single', sides, { clearFront: 0.6 }) ?? against(c, 'pedestal-sink', sides, { clearFront: 0.5 });
  if (van) { const m = getCatalogItem('mirror'); if (m) add(c, 'mirror', van.it.x - Math.sin(van.it.rotation) * (-van.it.d / 2 + m.size.d / 2), van.it.y + Math.cos(van.it.rotation) * (-van.it.d / 2 + m.size.d / 2), van.it.rotation, Math.min(m.size.w, van.it.w), m.size.d, { elevation: m.elevation ?? 1.2 }); }
  against(c, 'toilet', sides, { clearFront: 0.55 });
  if (short >= 1.5) against(c, 'towel-rail', rankSides(c), { tall: false, noOccupy: true });
}

function wc(c: Ctx) {
  const sides = rankSides(c);
  against(c, 'toilet', sides, { clearFront: 0.5 });
  against(c, 'pedestal-sink', sides, { clearFront: 0.4 });
}

function office(c: Ctx) {
  const ws = windowSides(c);
  const sides = rankSides(c, (s) => (ws.includes(s) ? 3 : 0));
  const desk = against(c, 'desk', sides, { clearFront: 0.9 });
  if (desk) {
    const ch = getCatalogItem('office-chair')!;
    const p = { x: desk.it.x - Math.sin(desk.it.rotation) * (desk.it.d / 2 + 0.35), y: desk.it.y + Math.cos(desk.it.rotation) * (desk.it.d / 2 + 0.35) };
    add(c, 'office-chair', p.x, p.y, desk.it.rotation + Math.PI, ch.size.w, ch.size.d);
    const mon = getCatalogItem('monitor'); if (mon) add(c, 'monitor', desk.it.x - Math.sin(desk.it.rotation) * (-desk.it.d / 2 + 0.18), desk.it.y + Math.cos(desk.it.rotation) * (-desk.it.d / 2 + 0.18), desk.it.rotation, mon.size.w, mon.size.d, { elevation: getCatalogItem('desk')!.size.h });
  }
  against(c, 'office-bookcase', rankSides(c, (s) => (desk && s === desk.side ? -4 : 0)), { tall: true, clearFront: 0.5 });
  against(c, 'filing-cabinet', rankSides(c), {});
  against(c, 'plant-large', rankSides(c), { align: 'end' });
}

function laundry(c: Ctx) {
  const sides = rankSides(c);
  const wm = against(c, 'washing-machine', sides, { clearFront: 0.6 });
  if (wm) against(c, 'dryer', [wm.side], { u: wm.u + wm.it.w + 0.02, clearFront: 0.6 });
  against(c, 'shelving-unit', rankSides(c, (s) => (wm && s === wm.side ? -3 : 0)), { tall: true });
}

function garage(c: Ctx) {
  const car = getCatalogItem('car-suv') ?? getCatalogItem('car-sedan');
  const n = c.b.w > 5.5 ? 2 : 1;
  const vertical = c.b.h >= c.b.w * 0.9 || n === 2;
  for (let i = 0; i < n; i++) {
    if (!car) break;
    const x = c.b.minX + (c.b.w * (i + 0.5)) / n;
    const y = c.b.minY + c.b.h / 2 + 0.2;
    const rot = vertical ? 0 : Math.PI / 2;
    const id = i === 0 ? 'car-suv' : 'car-sedan';
    const d = getCatalogItem(id)!;
    const rect = vertical ? { x0: x - d.size.w / 2, y0: y - d.size.d / 2, x1: x + d.size.w / 2, y1: y + d.size.d / 2 } : { x0: x - d.size.d / 2, y0: y - d.size.w / 2, x1: x + d.size.d / 2, y1: y + d.size.w / 2 };
    // slide along the long axis until clear of door clearances
    for (const dy of [0, -0.3, 0.3, -0.6, 0.6, -0.9, 0.9]) {
      const r2 = vertical ? { ...rect, y0: rect.y0 + dy, y1: rect.y1 + dy } : { ...rect, x0: rect.x0 + dy, x1: rect.x1 + dy };
      if (insideRoom(c, r2) && !c.occupied.some((q) => overlaps(q, r2, 0.01))) { add(c, id, vertical ? x : x + dy, vertical ? y + dy : y, rot, d.size.w, d.size.d); c.occupied.push(r2); break; }
    }
  }
  against(c, 'shelving-unit', rankSides(c), { tall: true });
  against(c, 'bicycle', rankSides(c), {});
}

function hall(c: Ctx, isEntry: boolean) {
  const A = absArea(c.room.points);
  if (isEntry) { against(c, 'shoe-cabinet', rankSides(c), {}); against(c, 'coat-rack', rankSides(c), {}); }
  if (A > 6) against(c, 'plant-large', rankSides(c), { align: 'start' });
}

function storage(c: Ctx) { against(c, 'shelving-unit', rankSides(c), { tall: true }); against(c, 'shelving-unit', rankSides(c), { tall: true }); }

function recreation(c: Ctx, name: string) {
  if (/gym/i.test(name)) { /* media + gym combo */ }
  living(c, { tv: true });
}

function terrace(c: Ctx) {
  centered(c, 'outdoor-dining-set');
  against(c, 'sun-lounger', rankSides(c), {});
  against(c, 'plant-large', rankSides(c), { align: 'end' });
}
function balcony(c: Ctx) { against(c, 'lawn-chair', rankSides(c), {}); against(c, 'plant-small', rankSides(c), {}); }

export function furnishRoom(level: Level, room: Room, opts: { replace?: boolean } = {}) {
  if (opts.replace) { const ids = new Set(itemsInRoom(level, room).filter((i) => !i.catalogId.startsWith('stair-')).map((i) => i.id)); level.items = level.items.filter((i) => !ids.has(i.id)); }
  const c = makeCtx(level, room);
  // existing items in the room occupy space (stairs, user items)
  for (const it of itemsInRoom(level, room)) {
    const horiz = Math.abs(Math.sin(it.rotation)) < 0.5;
    const hw = horiz ? it.w / 2 : it.d / 2, hd = horiz ? it.d / 2 : it.w / 2;
    c.occupied.push({ x0: it.x - hw - 0.1, y0: it.y - hd - 0.1, x1: it.x + hw + 0.1, y1: it.y + hd + 0.1 });
    if (it.catalogId.startsWith('stair-')) {
      // keep the landing area in front of the stairs clear
      c.occupied.push({ x0: it.x - hw - 0.4, y0: it.y - hd - 1, x1: it.x + hw + 0.4, y1: it.y + hd + 1 });
    }
  }
  const t = room.type;
  if (t === 'bedroom') bedroom(c);
  else if (t === 'living') living(c);
  else if (t === 'kitchen') kitchen(c, /dining/i.test(room.name) || absArea(room.points) > 22);
  else if (t === 'dining') dining(c);
  else if (t === 'bathroom') bathroom(c);
  else if (t === 'wc') wc(c);
  else if (t === 'office') office(c);
  else if (t === 'laundry') laundry(c);
  else if (t === 'garage') garage(c);
  else if (t === 'hall') hall(c, /entry|foyer/i.test(room.name) || level.openings.some((o) => o.kind === 'frontDoor' && c.doors && SIDES.some((s) => c.doors[s].length) && roomHasFrontDoor(level, room)));
  else if (t === 'storage' || t === 'closet' || t === 'utility') storage(c);
  else if (t === 'basement') recreation(c, room.name);
  else if (t === 'terrace') terrace(c);
  else if (t === 'balcony') balcony(c);
  else if (t === 'other' && absArea(room.points) > 9) living(c);
  level.items.push(...c.out);
  return c.out.length;
}

function roomHasFrontDoor(level: Level, room: Room) {
  return level.openings.some((o) => {
    if (o.kind !== 'frontDoor') return false;
    const w = level.walls.find((x) => x.id === o.wallId); if (!w) return false;
    const L = wallLength(w);
    const p = { x: w.a.x + ((w.b.x - w.a.x) * o.t) / L, y: w.a.y + ((w.b.y - w.a.y) * o.t) / L };
    return room.points.some((q, i) => projectToSegment(p, q, room.points[(i + 1) % room.points.length]).distance < 0.1);
  });
}

export function furnishLevel(level: Level, opts: { onlyEmpty?: boolean; replace?: boolean } = {}) {
  let n = 0;
  for (const r of level.rooms) {
    if (opts.onlyEmpty && itemsInRoom(level, r).some((i) => !i.catalogId.startsWith('stair-'))) continue;
    n += furnishRoom(level, r, { replace: opts.replace });
  }
  return n;
}

export function furnishProject(p: Project, opts: { onlyEmpty?: boolean; replace?: boolean } = {}) {
  let n = 0;
  for (const l of p.levels) n += furnishLevel(l, opts);
  return n;
}

/** Trees, hedges, path lights, driveway car, and a pool when requested. */
export function landscapeProject(p: Project, features: string[] = []) {
  const ground = p.levels.find((l) => Math.abs(l.elevation) < 0.01);
  if (!ground || !ground.rooms.length) return;
  const b = bounds(ground.rooms.flatMap((r) => r.points));
  const items: Item[] = [];
  const put = (id: string, x: number, y: number, rot = 0, scale = 1) => {
    const d = getCatalogItem(id); if (!d) return;
    items.push({ id: uid('it'), catalogId: id, x, y, rotation: rot, elevation: 0, w: d.size.w * scale, d: d.size.d * scale, h: d.size.h * scale, name: d.name });
  };
  const doorX = (kind: string) => {
    const o = ground.openings.find((x) => x.kind === kind); if (!o) return null;
    const w = ground.walls.find((x) => x.id === o.wallId)!; const L = wallLength(w);
    return { x: w.a.x + ((w.b.x - w.a.x) * o.t) / L, y: w.a.y + ((w.b.y - w.a.y) * o.t) / L, width: o.width };
  };
  const front = doorX('frontDoor'), gar = doorX('garageDoor');
  // trees framing the house
  put('tree-deciduous', b.minX - 3.2, b.maxY + 3.5, 0, 1.1);
  put('tree-conifer', b.maxX + 3.5, b.minY - 2.5, 0, 1.0);
  put('tree-deciduous', b.minX - 4, b.minY - 4.5, 0.5, 1.25);
  if (b.w > 14) put('tree-deciduous', b.maxX + 4.5, b.maxY + 4.5, 1, 0.9);
  // shrubs along the front facade, skipping doors
  for (let x = b.minX + 0.8; x < b.maxX - 0.5; x += 1.6) {
    if (front && Math.abs(x - front.x) < 1.4) continue;
    if (gar && Math.abs(x - gar.x) < gar.width / 2 + 0.9) continue;
    put('bush', x, b.maxY + 0.75, 0, 0.8);
  }
  if (front) { put('lamp-post', front.x + 1.8, b.maxY + 3.2); put('mailbox', front.x - 1.6, b.maxY + 5.2); }
  if (gar) put('car-sedan', gar.x, b.maxY + 3.6, 0);
  // terrace / garden
  const terraceRoom = ground.rooms.find((r) => r.type === 'terrace');
  if (features.includes('pool')) {
    const pool = getCatalogItem('swimming-pool');
    const ty = terraceRoom ? bounds(terraceRoom.points).minY : b.minY;
    if (pool) put('swimming-pool', b.minX + b.w / 2, ty - 1.2 - pool.size.d / 2, 0);
    put('sun-lounger', b.minX + b.w / 2 + (pool?.size.w ?? 8) / 2 + 1.2, ty - 3, Math.PI / 2);
    put('sun-lounger', b.minX + b.w / 2 + (pool?.size.w ?? 8) / 2 + 1.2, ty - 4.2, Math.PI / 2);
    put('parasol', b.minX + b.w / 2 + (pool?.size.w ?? 8) / 2 + 2.6, ty - 3.6);
  } else {
    put('flower-bed', b.minX + b.w * 0.75, b.minY - (terraceRoom ? 4.6 : 1.6));
  }
  ground.items.push(...items);
}
