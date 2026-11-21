import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Level, Vec2, Wall, Opening, Item, Room } from '../model/types';
import type { PlanShape as PlanShapeLike } from '../catalog/types';
import { useStore, activeLevel } from '../state/store';
import { wallPolygon, wallExtensions, wallLength, wallAngle, projectToSegment, dist, labelPoint, absArea, formatArea, formatLength, pointInPolygon, nearestWall, detectRooms, centroid, levelBounds, sub, add, mul, norm, wallNormal, dot } from '../model/geometry';
import { addWallMerged, addPolygonRoom, ROOM_DEFAULTS, OPENING_DEFAULTS, addOpening, moveWallEndpoint, fitOpening, openingOverlaps, guessRoomType } from '../model/ops';
import { snapToWall, itemCorners, planToLocal } from '../model/place';
import { getCatalogItem } from '../catalog';
import { uid } from '../model/types';
import type { RoomType, OpeningKind } from '../model/types';

interface View { s: number; ox: number; oy: number }
type Drag =
  | { t: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { t: 'item'; id: string; off: Vec2; moved: boolean; altFree: boolean }
  | { t: 'rotate'; id: string }
  | { t: 'resize'; id: string; corner: [number, number] }
  | { t: 'wall'; id: string; start: Vec2; a0: Vec2; b0: Vec2; moved: boolean }
  | { t: 'wallEnd'; id: string; end: 'a' | 'b' }
  | { t: 'opening'; id: string; moved: boolean }
  | { t: 'room'; id: string; start: Vec2; moved: boolean; snapshot: string }
  | { t: 'roomRect'; start: Vec2 }
  | { t: 'label'; id: string; off: Vec2 }
  | { t: 'roofRect'; start: Vec2 };

const WALL_FILL = '#2A2E35';
const SEL = '#2F6BFF';

export default function Plan2D() {
  const project = useStore((s) => s.project);
  const tool = useStore((s) => s.tool);
  const placing = useStore((s) => s.placing);
  const selection = useStore((s) => s.selection);
  const fitNonce = useStore((s) => s.fitNonce);
  const units = project.settings.units;
  const level = activeLevel(project);
  const below = useMemo(() => {
    const sorted = [...project.levels].sort((a, b) => a.elevation - b.elevation);
    const i = sorted.findIndex((l) => l.id === level.id);
    return i > 0 ? sorted[i - 1] : undefined;
  }, [project.levels, level.id]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ s: 50, ox: 200, oy: 150 });
  const viewRef = useRef(view); viewRef.current = view;
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [snapInfo, setSnapInfo] = useState<{ p: Vec2; kind: string; guides?: { x?: number; y?: number } } | null>(null);
  const [chain, setChain] = useState<Vec2[]>([]); // wall / polygon drawing
  const [typed, setTyped] = useState('');
  const drag = useRef<Drag | null>(null);
  const [rectPreview, setRectPreview] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  // ---------- size / fit
  useEffect(() => {
    const el = svgRef.current?.parentElement; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fit = useCallback(() => {
    const b = levelBounds({ ...level, items: [] }) ?? levelBounds(level) ?? (below ? levelBounds({ ...below, items: [] }) : null);
    const el = svgRef.current?.parentElement;
    const W = el?.clientWidth ?? size.w, H = el?.clientHeight ?? size.h;
    if (!b) { setView({ s: 50, ox: W / 2 - 5 * 50, oy: H / 2 - 4 * 50 }); return; }
    const pad = 90;
    const s = Math.min((W - pad * 2) / Math.max(b.w, 1), (H - pad * 2) / Math.max(b.h, 1), 140);
    setView({ s, ox: W / 2 - (b.minX + b.w / 2) * s, oy: H / 2 - (b.minY + b.h / 2) * s });
  }, [level, below, size.w, size.h]);
  const userMoved = useRef(false);
  useEffect(() => { userMoved.current = false; const id = requestAnimationFrame(fit); return () => cancelAnimationFrame(id); }, [fitNonce, level.id]); // eslint-disable-line
  // keep the plan framed when the pane resizes (view switch, panels) until the user pans/zooms
  useEffect(() => { if (!userMoved.current) { const id = requestAnimationFrame(fit); return () => cancelAnimationFrame(id); } }, [size.w, size.h]); // eslint-disable-line

  const toWorld = (cx: number, cy: number): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.ox) / v.s, y: (cy - r.top - v.oy) / v.s };
  };
  const px = (m: number) => m / view.s; // pixels → meters

  // ---------- snapping
  const gridStep = view.s > 120 ? 0.05 : view.s > 40 ? 0.1 : 0.25;
  const snap = (p: Vec2, opts: { from?: Vec2; grid?: boolean } = {}) => {
    const tol = px(12);
    const pts: Vec2[] = [];
    for (const w of level.walls) pts.push(w.a, w.b);
    for (const r of level.rooms) pts.push(...r.points);
    if (below) for (const w of below.walls) pts.push(w.a, w.b);
    let best: Vec2 | null = null, bd = tol;
    for (const q of pts) { const d = dist(p, q); if (d < bd) { bd = d; best = q; } }
    if (best) { setSnapInfo({ p: best, kind: 'point' }); return { ...best }; }
    // angle snapping
    let q = { ...p };
    if (opts.from) {
      const d = sub(p, opts.from); const L = Math.hypot(d.x, d.y);
      const ang = Math.atan2(d.y, d.x);
      const step = Math.PI / 12;
      const snapped = Math.round(ang / step) * step;
      if (Math.abs(snapped - ang) < 0.07) q = { x: opts.from.x + Math.cos(snapped) * L, y: opts.from.y + Math.sin(snapped) * L };
    }
    // wall projection
    const nw = nearestWall(q, level.walls, px(10));
    if (nw && nw.distance < px(10)) { setSnapInfo({ p: nw.point, kind: 'wall' }); return { ...nw.point }; }
    // alignment guides with existing points
    const guides: { x?: number; y?: number } = {};
    let gx: number | undefined, gy: number | undefined, dx = px(8), dy = px(8);
    for (const pt of pts) { if (Math.abs(pt.x - q.x) < dx) { dx = Math.abs(pt.x - q.x); gx = pt.x; } if (Math.abs(pt.y - q.y) < dy) { dy = Math.abs(pt.y - q.y); gy = pt.y; } }
    if (gx !== undefined) { q.x = gx; guides.x = gx; }
    if (gy !== undefined) { q.y = gy; guides.y = gy; }
    if (opts.grid !== false) {
      if (gx === undefined) q.x = Math.round(q.x / gridStep) * gridStep;
      if (gy === undefined) q.y = Math.round(q.y / gridStep) * gridStep;
    }
    setSnapInfo(guides.x !== undefined || guides.y !== undefined ? { p: q, kind: 'guide', guides } : null);
    return q;
  };

  const update = useStore((s) => s.update);
  const store = useStore;

  // ---------- auto rooms after drawing walls
  const autoRooms = (lv: Level) => {
    const faces = detectRooms(lv.walls);
    for (const f of faces) {
      const c = labelPoint(f);
      const existing = lv.rooms.find((r) => pointInPolygon(c, r.points));
      if (existing) {
        // update polygon if this face is a refinement of the room (room was split by new walls)
        if (Math.abs(absArea(existing.points) - absArea(f)) > 0.3 && absArea(f) < absArea(existing.points)) {
          const others = faces.filter((g) => g !== f && pointInPolygon(labelPoint(g), existing.points));
          if (others.length) existing.points = f.map((p) => ({ ...p }));
        }
        continue;
      }
      lv.rooms.push({ id: uid('room'), name: 'Room', type: 'other', points: f.map((p) => ({ ...p })), floor: ROOM_DEFAULTS.other.floor });
    }
  };

  const commitWall = (a: Vec2, b: Vec2) => {
    if (dist(a, b) < 0.05) return;
    update((p) => { const lv = activeLevel(p); addWallMerged(lv, a, b, p.settings.wallThickness); autoRooms(lv); });
  };

  // ---------- pointer handlers
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    const kind = target?.dataset.kind, id = target?.dataset.id;
    if (e.button === 1 || spaceDown || tool === 'pan' || e.button === 2 && tool === 'select') {
      drag.current = { t: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy, moved: false }; return;
    }
    if (e.button === 2) { // right click ends chains
      if (chain.length) { finishChain(); }
      return;
    }
    const st = store.getState();
    if (tool === 'wall') {
      const p = snap(w, { from: chain[chain.length - 1] });
      if (chain.length) {
        const last = chain[chain.length - 1];
        if (typed) { const L = parseFloat(typed) / (units === 'imperial' ? 3.28084 : 1); const d = norm(sub(p, last)); const q = add(last, mul(d, L)); commitWall(last, q); setChain([...chain, q]); setTyped(''); return; }
        commitWall(last, p);
        if (dist(p, chain[0]) < 0.01 || level.walls.some((x) => dist(x.a, p) < 0.01 || dist(x.b, p) < 0.01) && chain.length > 1) { setChain([]); return; }
        setChain([...chain, p]);
      } else setChain([p]);
      return;
    }
    if (tool === 'room') {
      const p = snap(w);
      if (chain.length) {
        if (dist(p, chain[0]) < px(14) && chain.length >= 3) { finishPolygonRoom(chain); return; }
        setChain([...chain, p]); return;
      }
      drag.current = { t: 'roomRect', start: p }; setRectPreview({ a: p, b: p }); return;
    }
    if (tool === 'roof') { const p = snap(w); drag.current = { t: 'roofRect', start: p }; setRectPreview({ a: p, b: p }); return; }
    if (tool === 'door' || tool === 'window') { placeOpening(w); return; }
    if (tool === 'item' && placing?.catalogId) { placeItem(w, e.altKey); return; }
    if (tool === 'measure') {
      const p = snap(w);
      if (chain.length) { update((pr) => { activeLevel(pr).dims.push({ id: uid('dim'), a: chain[0], b: p, offset: 0 }); }); setChain([]); } else setChain([p]);
      return;
    }
    if (tool === 'label') {
      const text = 'Label';
      const lid = uid('lbl');
      update((pr) => { activeLevel(pr).labels.push({ id: lid, x: w.x, y: w.y, text }); });
      st.select({ kind: 'label', id: lid }); st.setTool('select');
      return;
    }
    // select tool
    if (kind === 'rotate' && id) { st.checkpoint(); drag.current = { t: 'rotate', id }; return; }
    if (kind === 'resize' && id) { st.checkpoint(); drag.current = { t: 'resize', id, corner: [Number(target!.dataset.cx), Number(target!.dataset.cy)] }; return; }
    if (kind === 'wallEnd' && id) { st.checkpoint(); drag.current = { t: 'wallEnd', id, end: target!.dataset.end as 'a' | 'b' }; return; }
    if (kind === 'item' && id) {
      const it = level.items.find((x) => x.id === id)!;
      st.select({ kind: 'item', id }); st.checkpoint();
      drag.current = { t: 'item', id, off: { x: it.x - w.x, y: it.y - w.y }, moved: false, altFree: e.altKey };
      return;
    }
    if (kind === 'opening' && id) { st.select({ kind: 'opening', id }); st.checkpoint(); drag.current = { t: 'opening', id, moved: false }; return; }
    if (kind === 'wall' && id) {
      const wl = level.walls.find((x) => x.id === id)!;
      st.select({ kind: 'wall', id }); st.checkpoint();
      drag.current = { t: 'wall', id, start: w, a0: { ...wl.a }, b0: { ...wl.b }, moved: false }; return;
    }
    if (kind === 'label' && id) { const l = level.labels.find((x) => x.id === id)!; st.select({ kind: 'label', id }); st.checkpoint(); drag.current = { t: 'label', id, off: { x: l.x - w.x, y: l.y - w.y } }; return; }
    if (kind === 'dim' && id) { st.select({ kind: 'dim', id }); return; }
    if (kind === 'roof' && id) { st.select({ kind: 'roof', id }); return; }
    if (kind === 'room' && id) { st.select({ kind: 'room', id }); drag.current = { t: 'room', id, start: w, moved: false, snapshot: JSON.stringify(st.project) }; return; }
    st.select(null);
    drag.current = { t: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    setCursor(w);
    const d = drag.current;
    if (!d) {
      if (tool === 'wall' || tool === 'room' || tool === 'measure' || tool === 'roof') snap(w, { from: tool === 'wall' ? chain[chain.length - 1] : undefined });
      else setSnapInfo(null);
      return;
    }
    const st = store.getState();
    if (d.t === 'pan') { d.moved = true; userMoved.current = true; setView((v) => ({ ...v, ox: d.ox + e.clientX - d.sx, oy: d.oy + e.clientY - d.sy })); return; }
    if (d.t === 'roomRect' || d.t === 'roofRect') { setRectPreview({ a: d.start, b: snap(w) }); return; }
    if (d.t === 'item') {
      d.moved = true;
      update((p) => {
        const lv = activeLevel(p); const it = lv.items.find((x) => x.id === d.id); if (!it) return;
        let nx = w.x + d.off.x, ny = w.y + d.off.y;
        if (!e.altKey) { nx = Math.round(nx / 0.05) * 0.05; ny = Math.round(ny / 0.05) * 0.05; }
        it.x = nx; it.y = ny;
        const def = getCatalogItem(it.catalogId);
        if (!e.altKey && !it.catalogId.startsWith('stair-') && !/rug|tree|car|pool|lamp-ceiling|pendant/.test(it.catalogId) && def?.category !== 'outdoor') {
          const s = snapToWall(lv, it, 0.25, true);
          if (s) { it.x = s.x; it.y = s.y; }
        }
      }, { commit: false });
      return;
    }
    if (d.t === 'rotate') {
      update((p) => {
        const it = activeLevel(p).items.find((x) => x.id === d.id); if (!it) return;
        let a = Math.atan2(w.y - it.y, w.x - it.x) + Math.PI / 2;
        if (!e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        it.rotation = a;
      }, { commit: false });
      return;
    }
    if (d.t === 'resize') {
      update((p) => {
        const it = activeLevel(p).items.find((x) => x.id === d.id); if (!it) return;
        const l = planToLocal(it, w);
        const nw = Math.max(0.1, Math.round(Math.abs(l.x) * 2 / 0.05) * 0.05), nd = Math.max(0.1, Math.round(Math.abs(l.y) * 2 / 0.05) * 0.05);
        if (e.shiftKey) { const k = Math.max(nw / it.w, nd / it.d); it.w *= k; it.d *= k; it.h *= k; } else { it.w = nw; it.d = nd; }
      }, { commit: false });
      return;
    }
    if (d.t === 'wall') {
      d.moved = true;
      update((p) => {
        const lv = activeLevel(p); const wl = lv.walls.find((x) => x.id === d.id); if (!wl) return;
        const n = wallNormal({ ...wl, a: d.a0, b: d.b0 });
        let k = dot(sub(w, d.start), n);
        k = Math.round(k / gridStep) * gridStep;
        moveWallEndpoint(lv, wl, 'a', add(d.a0, mul(n, k)));
        moveWallEndpoint(lv, wl, 'b', add(d.b0, mul(n, k)));
      }, { commit: false });
      return;
    }
    if (d.t === 'wallEnd') {
      const wl = level.walls.find((x) => x.id === d.id); if (!wl) return;
      const other = d.end === 'a' ? wl.b : wl.a;
      const q = snap(w, { from: other });
      update((p) => { const lv = activeLevel(p); const x = lv.walls.find((y) => y.id === d.id); if (x) moveWallEndpoint(lv, x, d.end, q); }, { commit: false });
      return;
    }
    if (d.t === 'opening') {
      d.moved = true;
      update((p) => {
        const lv = activeLevel(p); const o = lv.openings.find((x) => x.id === d.id); if (!o) return;
        const nw = nearestWall(w, lv.walls.filter((x) => x.kind !== 'railing'), 0.6);
        if (!nw) return;
        const prev = { wallId: o.wallId, t: o.t };
        o.wallId = nw.wall.id; o.t = Math.round(nw.t / 0.05) * 0.05;
        fitOpening(o, nw.wall);
        if (openingOverlaps(lv, o)) { o.wallId = prev.wallId; o.t = prev.t; }
      }, { commit: false });
      return;
    }
    if (d.t === 'label') { update((p) => { const l = activeLevel(p).labels.find((x) => x.id === d.id); if (l) { l.x = w.x + d.off.x; l.y = w.y + d.off.y; } }, { commit: false }); return; }
    if (d.t === 'room') {
      const delta = sub(w, d.start);
      const dd = { x: Math.round(delta.x / gridStep) * gridStep, y: Math.round(delta.y / gridStep) * gridStep };
      if (!d.moved && Math.hypot(dd.x, dd.y) < 0.1) return;
      if (!d.moved) { st.checkpoint(); d.moved = true; }
      // move from snapshot each time to avoid drift
      const base = JSON.parse(d.snapshot);
      const lv = activeLevel(base) as Level;
      const room = lv.rooms.find((r) => r.id === d.id)!;
      const onBoundary = (pt: Vec2, r: Room) => r.points.some((q, i) => projectToSegment(pt, q, r.points[(i + 1) % r.points.length]).distance < 0.03);
      const others = lv.rooms.filter((r) => r.id !== room.id);
      const movedWalls = new Set(lv.walls.filter((wl) => onBoundary(wl.a, room) && onBoundary(wl.b, room) && !others.some((o) => onBoundary(wl.a, o) && onBoundary(wl.b, o))).map((x) => x.id));
      const inside = new Set(lv.items.filter((it) => pointInPolygon(it, room.points)).map((x) => x.id));
      update((p) => {
        const L = activeLevel(p);
        const r = L.rooms.find((x) => x.id === d.id)!;
        r.points = room.points.map((q) => ({ x: q.x + dd.x, y: q.y + dd.y }));
        for (const wl of L.walls) if (movedWalls.has(wl.id)) { const src = lv.walls.find((x) => x.id === wl.id)!; wl.a = add(src.a, dd); wl.b = add(src.b, dd); }
        for (const it of L.items) if (inside.has(it.id)) { const src = lv.items.find((x) => x.id === it.id)!; it.x = src.x + dd.x; it.y = src.y + dd.y; }
      }, { commit: false });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.t === 'roomRect') {
      setRectPreview(null);
      const b = snap(toWorld(e.clientX, e.clientY));
      const a = d.start;
      if (Math.abs(b.x - a.x) < 0.5 || Math.abs(b.y - a.y) < 0.5) { setChain([a]); return; } // start polygon mode
      const type = (placing?.roomType as RoomType) ?? 'other';
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      let rid = '';
      update((p) => { const lv = activeLevel(p); rid = addPolygonRoom(lv, [{ x, y }, { x: Math.max(a.x, b.x), y }, { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }, { x, y: Math.max(a.y, b.y) }], type, undefined, p.settings.wallThickness).id; });
      store.getState().select({ kind: 'room', id: rid });
      return;
    }
    if (d.t === 'roofRect') {
      setRectPreview(null);
      const b = snap(toWorld(e.clientX, e.clientY)); const a = d.start;
      if (Math.abs(b.x - a.x) < 1 || Math.abs(b.y - a.y) < 1) return;
      const rid = uid('roof');
      update((p) => { const w = Math.abs(b.x - a.x), dd = Math.abs(b.y - a.y); activeLevel(p).roofs.push({ id: rid, kind: 'gable', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, d: dd, pitch: 30, overhang: 0.4, ridge: w >= dd ? 'x' : 'y', color: '#4A4F57' }); });
      store.getState().select({ kind: 'roof', id: rid }); store.getState().set({ view3d: { ...store.getState().view3d, showRoof: true } });
      return;
    }
    if ((d.t === 'item' || d.t === 'wall' || d.t === 'opening') && !d.moved) {
      // no-op: selection only; remove the checkpoint we pushed
      const st = store.getState(); st.set({ past: st.past.slice(0, -1) });
    }
    if (d.t === 'wall' || d.t === 'wallEnd') update((p) => { const lv = activeLevel(p); for (const o of lv.openings) { const wl = lv.walls.find((x) => x.id === o.wallId); if (wl) fitOpening(o, wl); } }, { commit: false });
  };

  const finishChain = () => { if (tool === 'room' && chain.length >= 3) finishPolygonRoom(chain); setChain([]); setTyped(''); };
  const finishPolygonRoom = (pts: Vec2[]) => {
    const type = (placing?.roomType as RoomType) ?? 'other';
    update((p) => { addPolygonRoom(activeLevel(p), pts, type, undefined, p.settings.wallThickness); });
    setChain([]);
  };

  const placeOpening = (w: Vec2) => {
    const kind = (placing?.openingKind ?? (tool === 'door' ? 'door' : 'window')) as OpeningKind;
    const nw = nearestWall(w, level.walls.filter((x) => x.kind !== 'railing'), 0.6);
    if (!nw) { store.getState().toast('Click on a wall to place it', 'info'); return; }
    let oid = '';
    update((p) => { const lv = activeLevel(p); const o = addOpening(lv, nw.wall.id, kind, Math.round(nw.t / 0.05) * 0.05); if (o) oid = o.id; });
    if (!oid) store.getState().toast('Not enough space on this wall', 'error');
  };

  const placeItem = (w: Vec2, free: boolean) => {
    const def = getCatalogItem(placing!.catalogId!);
    const custom = placing!.catalogId!.startsWith('custom:') ? project.customModels.find((m) => `custom:${m.id}` === placing!.catalogId) : undefined;
    if (!def && !custom) return;
    const size = def ? def.size : { w: custom!.w, d: custom!.d, h: custom!.h };
    const it: Item = { id: uid('it'), catalogId: placing!.catalogId!, x: w.x, y: w.y, rotation: 0, elevation: def?.elevation ?? 0, w: size.w, d: size.d, h: size.h, color: undefined, name: def?.name ?? custom?.name };
    if (!free && def && def.category !== 'outdoor' && !/rug|tree|car|pool/.test(def.id)) { const s = snapToWall(level, it, 0.6); if (s) { it.x = s.x; it.y = s.y; it.rotation = s.rotation; } }
    update((p) => { activeLevel(p).items.push(it); });
    store.getState().select({ kind: 'item', id: it.id });
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    userMoved.current = true;
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    setView((v) => { const s = Math.max(4, Math.min(600, v.s * k)); const f = s / v.s; return { s, ox: mx - (mx - v.ox) * f, oy: my - (my - v.oy) * f }; });
  };

  // keyboard for drawing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable]')) return;
      if (e.code === 'Space') { setSpaceDown(e.type === 'keydown'); return; }
      if (e.type !== 'keydown') return;
      if (e.key === 'Escape') { if (chain.length) { finishChain(); e.stopPropagation(); } }
      if (e.key === 'Enter' && chain.length && tool !== 'wall') finishChain();
      if (tool === 'wall' && chain.length && /^[0-9.]$/.test(e.key)) { setTyped((t) => t + e.key); e.preventDefault(); }
      if (tool === 'wall' && chain.length && e.key === 'Backspace') { setTyped((t) => t.slice(0, -1)); e.preventDefault(); }
      if (tool === 'wall' && chain.length && e.key === 'Enter' && typed && cursor) {
        const last = chain[chain.length - 1];
        const L = parseFloat(typed) / (units === 'imperial' ? 3.28084 : 1);
        const p = snap(cursor, { from: last });
        const q = add(last, mul(norm(sub(p, last)), L)); commitWall(last, q); setChain([...chain, q]); setTyped('');
      }
    };
    window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true); };
  });
  useEffect(() => { setChain([]); setTyped(''); setRectPreview(null); }, [tool]);

  // ---------- drop from library (HTML5 DnD)
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-homerise-item');
    if (!id) return;
    e.preventDefault();
    const prev = store.getState().placing;
    store.getState().set({ placing: { catalogId: id } });
    const w = toWorld(e.clientX, e.clientY);
    // emulate placement
    const def = getCatalogItem(id);
    const custom = id.startsWith('custom:') ? project.customModels.find((m) => `custom:${m.id}` === id) : undefined;
    const size = def ? def.size : custom ? { w: custom.w, d: custom.d, h: custom.h } : null;
    if (size) {
      const it: Item = { id: uid('it'), catalogId: id, x: w.x, y: w.y, rotation: 0, elevation: def?.elevation ?? 0, w: size.w, d: size.d, h: size.h, name: def?.name ?? custom?.name };
      if (def && def.category !== 'outdoor' && !/rug|tree|car|pool/.test(def.id)) { const s = snapToWall(level, it, 0.6); if (s) { it.x = s.x; it.y = s.y; it.rotation = s.rotation; } }
      update((p) => { activeLevel(p).items.push(it); });
      store.getState().select({ kind: 'item', id: it.id });
    }
    store.getState().set({ placing: prev });
  };

  // ---------- rendering helpers
  const T = (p: Vec2) => `${p.x * view.s + view.ox},${p.y * view.s + view.oy}`;
  const sx = (x: number) => x * view.s + view.ox, sy = (y: number) => y * view.s + view.oy;
  const poly = (pts: Vec2[]) => pts.map(T).join(' ');

  const lineW = Math.max(1, Math.min(2, view.s / 60));
  const fontSize = Math.max(10, Math.min(15, view.s / 4.5));

  const ghostOpening = useMemo(() => {
    if ((tool !== 'door' && tool !== 'window') || !cursor) return null;
    const nw = nearestWall(cursor, level.walls.filter((x) => x.kind !== 'railing'), 0.6);
    if (!nw) return null;
    const kind = (placing?.openingKind ?? (tool === 'door' ? 'door' : 'window')) as OpeningKind;
    const def = OPENING_DEFAULTS[kind];
    const o: Opening = { id: 'ghost', wallId: nw.wall.id, kind, t: Math.round(nw.t / 0.05) * 0.05, width: def.width, height: def.height, sill: def.sill };
    fitOpening(o, nw.wall);
    return { o, w: nw.wall, bad: openingOverlaps(level, o) };
  }, [tool, cursor, level, placing]);

  const ghostItem = useMemo(() => {
    if (tool !== 'item' || !placing?.catalogId || !cursor) return null;
    const def = getCatalogItem(placing.catalogId);
    const custom = placing.catalogId.startsWith('custom:') ? project.customModels.find((m) => `custom:${m.id}` === placing.catalogId) : undefined;
    if (!def && !custom) return null;
    const size = def ? def.size : { w: custom!.w, d: custom!.d, h: custom!.h };
    const it: Item = { id: 'ghost', catalogId: placing.catalogId, x: cursor.x, y: cursor.y, rotation: 0, elevation: 0, w: size.w, d: size.d, h: size.h };
    if (def && def.category !== 'outdoor' && !/rug|tree|car|pool/.test(def.id)) { const s = snapToWall(level, it, 0.6); if (s) { it.x = s.x; it.y = s.y; it.rotation = s.rotation; } }
    return it;
  }, [tool, placing, cursor, level, project.customModels]);

  const selItem = selection?.kind === 'item' ? level.items.find((i) => i.id === selection.id) : undefined;
  const selWall = selection?.kind === 'wall' ? level.walls.find((w) => w.id === selection.id) : undefined;

  const cursorStyle = drag.current?.t === 'pan' || spaceDown || tool === 'pan' ? 'grabbing' : tool === 'select' ? 'default' : 'crosshair';

  // overall dimensions
  const lb = levelBounds({ ...level, items: [] });

  return (
    <div className="plan2d" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg ref={svgRef} width={size.w} height={size.h} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)} onWheel={onWheel} onDoubleClick={() => finishChain()} onContextMenu={(e) => e.preventDefault()} style={{ cursor: cursorStyle, touchAction: 'none' }} data-testid="plan-svg">
        <defs>
          <pattern id="gridMinor" width={view.s * (view.s > 40 ? 0.1 : 0.5)} height={view.s * (view.s > 40 ? 0.1 : 0.5)} patternUnits="userSpaceOnUse" x={view.ox} y={view.oy}>
            <path d={`M ${view.s * (view.s > 40 ? 0.1 : 0.5)} 0 L 0 0 0 ${view.s * (view.s > 40 ? 0.1 : 0.5)}`} fill="none" stroke="var(--grid-minor)" strokeWidth="1" />
          </pattern>
          <pattern id="gridMajor" width={view.s} height={view.s} patternUnits="userSpaceOnUse" x={view.ox} y={view.oy}>
            <rect width={view.s} height={view.s} fill="url(#gridMinor)" />
            <path d={`M ${view.s} 0 L 0 0 0 ${view.s}`} fill="none" stroke="var(--grid-major)" strokeWidth="1" />
          </pattern>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#9aa3ad" strokeWidth="1" /></pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#gridMajor)" />
        {project.trace?.[level.id] && (() => { const t = project.trace![level.id]; return <image href={t.dataUrl} x={sx(t.x)} y={sy(t.y)} width={t.width * t.metersPerPixel * view.s} height={t.height * t.metersPerPixel * view.s} opacity={t.opacity} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />; })()}
        {/* level below ghost */}
        {below && <g opacity={0.18} style={{ pointerEvents: 'none' }}>{below.walls.map((w) => <polygon key={w.id} points={poly(wallPolygon(w))} fill="#59606b" />)}</g>}
        {/* rooms */}
        <g>
          {level.rooms.map((r) => {
            const sel = selection?.kind === 'room' && selection.id === r.id;
            return <polygon key={r.id} data-kind="room" data-id={r.id} points={poly(r.points)} fill={ROOM_DEFAULTS[r.type]?.color ?? '#eee'} stroke={sel ? SEL : 'none'} strokeWidth={sel ? 2 : 0} className="room-poly" />;
          })}
        </g>
        {/* roofs (outline) */}
        <g>{level.roofs.map((r) => { const sel = selection?.kind === 'roof' && selection.id === r.id; return <rect key={r.id} data-kind="roof" data-id={r.id} x={sx(r.x - r.overhang)} y={sy(r.y - r.overhang)} width={(r.w + 2 * r.overhang) * view.s} height={(r.d + 2 * r.overhang) * view.s} fill={tool === 'roof' || sel ? 'rgba(74,79,87,0.10)' : 'none'} stroke={sel ? SEL : '#8a8f96'} strokeDasharray="6 5" strokeWidth={sel ? 2 : 1} style={{ pointerEvents: tool === 'roof' || sel ? 'all' : 'none' }} />; })}</g>
        {/* items below walls for rugs */}
        <g>{[...level.items].sort((a, b) => (/rug/.test(a.catalogId) ? -1 : 0) - (/rug/.test(b.catalogId) ? -1 : 0) || a.elevation - b.elevation).map((it) => <ItemSymbol key={it.id} it={it} s={view.s} T={T} selected={selection?.id === it.id} />)}</g>
        {/* walls */}
        <g>{level.walls.filter((w) => w.kind !== 'invisible').map((w) => {
          const { ea, eb } = wallExtensions(w, level.walls);
          const sel = selWall?.id === w.id;
          if (w.kind === 'railing') return <polygon key={w.id} data-kind="wall" data-id={w.id} points={poly(wallPolygon(w, 0, 0))} fill="#fff" stroke={sel ? SEL : '#6b7280'} strokeWidth={lineW} />;
          return <polygon key={w.id} data-kind="wall" data-id={w.id} points={poly(wallPolygon(w, ea, eb))} fill={sel ? '#2b4fb8' : WALL_FILL} stroke={sel ? SEL : WALL_FILL} strokeWidth={0.6} className="wall-poly" />;
        })}</g>
        {/* openings */}
        <g>{level.openings.map((o) => { const w = level.walls.find((x) => x.id === o.wallId); if (!w) return null; return <OpeningSymbol key={o.id} o={o} w={w} T={T} s={view.s} selected={selection?.id === o.id} />; })}</g>
        {ghostOpening && <g opacity={0.75} style={{ pointerEvents: 'none' }}><OpeningSymbol o={ghostOpening.o} w={ghostOpening.w} T={T} s={view.s} selected={false} ghost bad={ghostOpening.bad} /></g>}
        {/* room labels */}
        <g style={{ pointerEvents: 'none' }}>{level.rooms.map((r) => {
          const lp = labelPoint(r.points);
          const a = absArea(r.points);
          if (a * view.s * view.s < 1800) return null;
          return <g key={r.id} transform={`translate(${sx(lp.x)},${sy(lp.y)})`} className="room-label">
            <text y={-2} textAnchor="middle" fontSize={fontSize} fontWeight={600} fill="#1f2328">{r.name}</text>
            <text y={fontSize + 1} textAnchor="middle" fontSize={fontSize * 0.82} fill="#6b7078">{formatArea(a, units)}</text>
          </g>;
        })}</g>
        {/* dimensions */}
        <g>{level.dims.map((dm) => <DimLine key={dm.id} id={dm.id} a={dm.a} b={dm.b} T={T} s={view.s} units={units} selected={selection?.id === dm.id} />)}</g>
        {lb && level.walls.length > 0 && <g style={{ pointerEvents: 'none' }} opacity={0.75}>
          <DimLine a={{ x: lb.minX, y: lb.minY - 0.9 }} b={{ x: lb.maxX, y: lb.minY - 0.9 }} T={T} s={view.s} units={units} />
          <DimLine a={{ x: lb.minX - 0.9, y: lb.maxY }} b={{ x: lb.minX - 0.9, y: lb.minY }} T={T} s={view.s} units={units} />
        </g>}
        {/* labels */}
        <g>{level.labels.map((l) => <text key={l.id} data-kind="label" data-id={l.id} x={sx(l.x)} y={sy(l.y)} fontSize={(l.size ?? 1) * fontSize * 1.1} textAnchor="middle" fill={selection?.id === l.id ? SEL : '#1f2328'} fontWeight={500} style={{ cursor: 'move' }}>{l.text}</text>)}</g>
        {/* selected wall measurement + handles */}
        {selWall && <g>
          <DimLine a={add(selWall.a, mul(wallNormal(selWall), selWall.thickness / 2 + 0.35))} b={add(selWall.b, mul(wallNormal(selWall), selWall.thickness / 2 + 0.35))} T={T} s={view.s} units={units} />
          {(['a', 'b'] as const).map((end) => <circle key={end} data-kind="wallEnd" data-id={selWall.id} data-end={end} cx={sx(selWall[end].x)} cy={sy(selWall[end].y)} r={7} fill="#fff" stroke={SEL} strokeWidth={2} style={{ cursor: 'move' }} />)}
        </g>}
        {/* selected item handles */}
        {selItem && <ItemHandles it={selItem} T={T} s={view.s} />}
        {/* ghost item */}
        {ghostItem && <g opacity={0.6} style={{ pointerEvents: 'none' }}><ItemSymbol it={ghostItem} s={view.s} T={T} selected={false} /></g>}
        {/* drawing previews */}
        {tool === 'wall' && chain.length > 0 && cursor && (() => {
          const last = chain[chain.length - 1];
          let p = snapInfo?.p ?? cursor;
          if (typed) { const L = parseFloat(typed) / (units === 'imperial' ? 3.28084 : 1); if (L > 0) p = add(last, mul(norm(sub(p, last)), L)); }
          const tmp: Wall = { id: 'tmp', a: last, b: p, thickness: project.settings.wallThickness };
          const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
          const ang = (wallAngle(tmp) * 180) / Math.PI;
          return <g style={{ pointerEvents: 'none' }}>
            {chain.slice(0, -1).map((q, i) => <line key={i} x1={sx(q.x)} y1={sy(q.y)} x2={sx(chain[i + 1].x)} y2={sy(chain[i + 1].y)} stroke={SEL} strokeWidth={1} />)}
            <polygon points={poly(wallPolygon(tmp))} fill="rgba(47,107,255,0.35)" stroke={SEL} strokeWidth={1.5} />
            <g transform={`translate(${sx(mid.x)},${sy(mid.y)}) rotate(${ang > 90 || ang < -90 ? ang + 180 : ang})`}>
              <rect x={-34} y={-30} width={68} height={20} rx={10} fill={SEL} />
              <text y={-16} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff">{typed ? `${typed}${units === 'imperial' ? ' ft' : ' m'}` : formatLength(dist(last, p), units)}</text>
            </g>
          </g>;
        })()}
        {(tool === 'room' || tool === 'measure') && chain.length > 0 && cursor && <g style={{ pointerEvents: 'none' }}>
          <polyline points={poly([...chain, snapInfo?.p ?? cursor])} fill={tool === 'room' ? 'rgba(47,107,255,0.08)' : 'none'} stroke={SEL} strokeWidth={2} strokeDasharray={tool === 'measure' ? '5 4' : undefined} />
          {tool === 'measure' && <DimLine a={chain[0]} b={snapInfo?.p ?? cursor} T={T} s={view.s} units={units} />}
          {chain.map((q, i) => <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r={i === 0 ? 6 : 3.5} fill={i === 0 ? '#fff' : SEL} stroke={SEL} strokeWidth={2} />)}
        </g>}
        {rectPreview && (() => {
          const x = Math.min(rectPreview.a.x, rectPreview.b.x), y = Math.min(rectPreview.a.y, rectPreview.b.y);
          const w = Math.abs(rectPreview.b.x - rectPreview.a.x), h = Math.abs(rectPreview.b.y - rectPreview.a.y);
          return <g style={{ pointerEvents: 'none' }}>
            <rect x={sx(x)} y={sy(y)} width={w * view.s} height={h * view.s} fill="rgba(47,107,255,0.10)" stroke={SEL} strokeWidth={tool === 'roof' ? 2 : project.settings.wallThickness * view.s} strokeOpacity={tool === 'roof' ? 1 : 0.55} strokeDasharray={tool === 'roof' ? '6 4' : undefined} />
            <text x={sx(x + w / 2)} y={sy(y + h / 2)} textAnchor="middle" fontSize={13} fontWeight={600} fill={SEL}>{formatLength(w, units)} × {formatLength(h, units)}</text>
            <text x={sx(x + w / 2)} y={sy(y + h / 2) + 16} textAnchor="middle" fontSize={11} fill={SEL}>{formatArea(w * h, units)}</text>
          </g>;
        })()}
        {/* snap indicators */}
        {snapInfo && tool !== 'select' && <g style={{ pointerEvents: 'none' }}>
          {snapInfo.guides?.x !== undefined && <line x1={sx(snapInfo.guides.x)} x2={sx(snapInfo.guides.x)} y1={0} y2={size.h} stroke="#ff4d8d" strokeDasharray="4 4" strokeWidth={1} />}
          {snapInfo.guides?.y !== undefined && <line y1={sy(snapInfo.guides.y)} y2={sy(snapInfo.guides.y)} x1={0} x2={size.w} stroke="#ff4d8d" strokeDasharray="4 4" strokeWidth={1} />}
          {snapInfo.kind !== 'guide' && <circle cx={sx(snapInfo.p.x)} cy={sy(snapInfo.p.y)} r={6} fill="none" stroke={snapInfo.kind === 'point' ? '#ff4d8d' : '#16a34a'} strokeWidth={2} />}
        </g>}
      </svg>
      <ScaleBar s={view.s} units={units} />
      <div className="zoom-ctl">
        <button title="Zoom out" onClick={() => setView((v) => { const s = Math.max(4, v.s / 1.25), cx = size.w / 2, cy = size.h / 2, f = s / v.s; return { s, ox: cx - (cx - v.ox) * f, oy: cy - (cy - v.oy) * f }; })}>−</button>
        <button title="Fit to screen (F)" onClick={fit} className="fit">Fit</button>
        <button title="Zoom in" onClick={() => setView((v) => { const s = Math.min(600, v.s * 1.25), cx = size.w / 2, cy = size.h / 2, f = s / v.s; return { s, ox: cx - (cx - v.ox) * f, oy: cy - (cy - v.oy) * f }; })}>+</button>
      </div>
      <ToolHint tool={tool} chain={chain.length} typed={typed} />
    </div>
  );
}

function ToolHint({ tool, chain, typed }: { tool: string; chain: number; typed: string }) {
  const hints: Record<string, string> = {
    wall: chain ? `Click to continue · type a length${typed ? ` (${typed})` : ''} + Enter · Esc / double-click to finish` : 'Click to start a wall · walls snap to corners, angles and guides',
    room: chain ? 'Click to add corners · click the first point to close' : 'Drag to draw a rectangular room · click (no drag) for a custom shape',
    door: 'Hover a wall and click to place', window: 'Hover a wall and click to place',
    item: 'Click to place · items snap against walls (hold Alt for free placement)',
    measure: chain ? 'Click the end point' : 'Click two points to measure', label: 'Click to add a text label', roof: 'Drag a rectangle to add a roof',
    pan: 'Drag to pan',
  };
  if (!hints[tool]) return null;
  return <div className="tool-hint">{hints[tool]}</div>;
}

function ScaleBar({ s, units }: { s: number; units: 'metric' | 'imperial' }) {
  const target = 110 / s;
  const steps = units === 'imperial' ? [0.3048, 0.6096, 1.524, 3.048, 6.096, 15.24, 30.48] : [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
  const m = steps.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  return <div className="scale-bar"><div style={{ width: m * s }} /><span>{units === 'imperial' ? `${Math.round(m / 0.3048)} ft` : m < 1 ? `${m * 100} cm` : `${m} m`}</span></div>;
}

function DimLine({ a, b, T, s, units, id, selected }: { a: Vec2; b: Vec2; T: (p: Vec2) => string; s: number; units: 'metric' | 'imperial'; id?: string; selected?: boolean }) {
  const L = dist(a, b);
  if (L < 0.05) return null;
  const d = norm(sub(b, a)); const n = { x: -d.y, y: d.x };
  const tick = 5 / s;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI; if (ang > 90 || ang < -90) ang += 180;
  const [mx, my] = T(mid).split(',').map(Number);
  const col = selected ? SEL : '#5b6470';
  return <g data-kind={id ? 'dim' : undefined} data-id={id} style={{ cursor: id ? 'pointer' : undefined }}>
    <polyline points={[T(add(a, mul(n, tick))), T(add(a, mul(n, -tick)))].join(' ')} stroke={col} strokeWidth={1} />
    <polyline points={[T(add(b, mul(n, tick))), T(add(b, mul(n, -tick)))].join(' ')} stroke={col} strokeWidth={1} />
    <polyline points={[T(a), T(b)].join(' ')} stroke={col} strokeWidth={1} />
    {id && <polyline points={[T(a), T(b)].join(' ')} stroke="transparent" strokeWidth={10} />}
    <g transform={`translate(${mx},${my}) rotate(${ang})`}><rect x={-30} y={-17} width={60} height={15} rx={4} fill="var(--canvas-bg)" opacity={0.9} /><text y={-5.5} textAnchor="middle" fontSize={11} fill={col} fontWeight={500}>{formatLength(L, units)}</text></g>
  </g>;
}

function OpeningSymbol({ o, w, T, s, selected, ghost, bad }: { o: Opening; w: Wall; T: (p: Vec2) => string; s: number; selected: boolean; ghost?: boolean; bad?: boolean }) {
  const L = wallLength(w);
  const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
  const n = { x: -d.y, y: d.x };
  const c = add(w.a, mul(d, o.t));
  const hw = o.width / 2, ht = w.thickness / 2 + 0.01;
  const p1 = add(c, mul(d, -hw)), p2 = add(c, mul(d, hw));
  const rect = [add(p1, mul(n, ht)), add(p2, mul(n, ht)), add(p2, mul(n, -ht)), add(p1, mul(n, -ht))];
  const col = bad ? '#e5484d' : selected || ghost ? SEL : '#2A2E35';
  const sw = Math.max(1, s / 70);
  const isWin = o.kind.includes('indow');
  const els: React.ReactNode[] = [<polygon key="bg" points={rect.map(T).join(' ')} fill={ghost ? 'rgba(47,107,255,0.15)' : '#fff'} stroke={selected ? SEL : 'none'} strokeWidth={1.5} />];
  if (isWin) {
    const inset = w.thickness * 0.18;
    els.push(<polyline key="l1" points={[T(add(p1, mul(n, inset))), T(add(p2, mul(n, inset)))].join(' ')} stroke={col} strokeWidth={sw} />);
    els.push(<polyline key="l2" points={[T(add(p1, mul(n, -inset))), T(add(p2, mul(n, -inset)))].join(' ')} stroke={col} strokeWidth={sw} />);
    els.push(<polyline key="l3" points={[T(p1), T(p2)].join(' ')} stroke={col} strokeWidth={sw * 0.6} />);
    els.push(<polyline key="e1" points={[T(rect[0]), T(rect[3])].join(' ')} stroke={col} strokeWidth={sw} />);
    els.push(<polyline key="e2" points={[T(rect[1]), T(rect[2])].join(' ')} stroke={col} strokeWidth={sw} />);
  } else if (o.kind === 'slidingDoor') {
    const off = w.thickness * 0.15;
    els.push(<polyline key="s1" points={[T(add(p1, mul(n, off))), T(add(add(c, mul(d, 0.08)), mul(n, off)))].join(' ')} stroke={col} strokeWidth={sw * 1.6} />);
    els.push(<polyline key="s2" points={[T(add(add(c, mul(d, -0.08)), mul(n, -off))), T(add(p2, mul(n, -off)))].join(' ')} stroke={col} strokeWidth={sw * 1.6} />);
  } else if (o.kind === 'garageDoor') {
    els.push(<polyline key="g" points={[T(p1), T(p2)].join(' ')} stroke={col} strokeWidth={sw} strokeDasharray="6 4" />);
  } else if (o.kind === 'opening') {
    els.push(<polyline key="o1" points={[T(rect[0]), T(rect[3])].join(' ')} stroke={col} strokeWidth={sw} />);
    els.push(<polyline key="o2" points={[T(rect[1]), T(rect[2])].join(' ')} stroke={col} strokeWidth={sw} />);
  } else {
    const leaves = o.kind === 'doubleDoor' ? 2 : 1;
    const side = o.flip ? -1 : 1;
    const nn = mul(n, side);
    const hingeLeft = o.hinge !== 'right';
    const draw = (hinge: Vec2, tip: Vec2, key: string) => {
      const r = dist(hinge, tip);
      const open = add(hinge, mul(nn, r));
      const [hx, hy] = T(hinge).split(',').map(Number);
      const [tx, ty] = T(tip).split(',').map(Number);
      const [ox, oy] = T(open).split(',').map(Number);
      const cr = cross2({ x: tx - hx, y: ty - hy }, { x: ox - hx, y: oy - hy });
      els.push(<line key={key + 'l'} x1={hx} y1={hy} x2={ox} y2={oy} stroke={col} strokeWidth={sw * 1.4} />);
      els.push(<path key={key + 'a'} d={`M ${tx} ${ty} A ${r * s} ${r * s} 0 0 ${cr > 0 ? 1 : 0} ${ox} ${oy}`} fill="none" stroke={col} strokeWidth={sw * 0.7} strokeDasharray="3 3" />);
    };
    if (leaves === 2) { draw(p1, c, 'a'); draw(p2, c, 'b'); }
    else if (hingeLeft) draw(p1, p2, 'a'); else draw(p2, p1, 'a');
  }
  return <g data-kind={ghost ? undefined : 'opening'} data-id={o.id} style={{ cursor: 'move' }}>{els}</g>;
}
const cross2 = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;

function shapeToSvg(sh: PlanShapeLike, k: number, i: number, color: string) {
  const stroke = '#3d434c';
  const sw = Math.max(0.6, Math.min(1.4, k / 70));
  const fill = sh.t !== 'line' && sh.fill ? color : 'none';
  switch (sh.t) {
    case 'rect': return <rect key={i} x={sh.x * k} y={sh.y * k} width={sh.w * k} height={sh.h * k} rx={(sh.r ?? 0) * k} fill={fill} stroke={stroke} strokeWidth={sw} />;
    case 'circle': return <circle key={i} cx={sh.cx * k} cy={sh.cy * k} r={sh.r * k} fill={fill} stroke={stroke} strokeWidth={sw} />;
    case 'line': return <line key={i} x1={sh.x1 * k} y1={sh.y1 * k} x2={sh.x2 * k} y2={sh.y2 * k} stroke={stroke} strokeWidth={sw} />;
    case 'path': return <path key={i} d={scalePath(sh.d, k)} fill={fill} stroke={stroke} strokeWidth={sw} />;
  }
}
/** Scale an SVG path's coordinates (keeps arc rotation and flags intact). */
function scalePath(d: string, k: number) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let cmd = '', idx = 0;
  for (const t of tokens) {
    if (/^[a-zA-Z]$/.test(t)) { cmd = t; idx = 0; out.push(t); continue; }
    const n = parseFloat(t);
    const keep = (cmd === 'A' || cmd === 'a') && [2, 3, 4].includes(idx % 7);
    out.push(keep ? t : String(+(n * k).toFixed(3)));
    idx++;
  }
  return out.join(' ');
}

function ItemSymbol({ it, s, T, selected }: { it: Item; s: number; T: (p: Vec2) => string; selected: boolean }) {
  const def = getCatalogItem(it.catalogId);
  const [cx, cy] = T({ x: it.x, y: it.y }).split(',').map(Number);
  const deg = (it.rotation * 180) / Math.PI;
  const shapes = useMemo(() => { try { return def?.plan?.(it.w, it.d) ?? null; } catch { return null; } }, [def, it.w, it.d]);
  const isRug = /rug/.test(it.catalogId);
  const outdoor = def?.category === 'outdoor';
  const fillColor = isRug ? (it.color ?? def?.defaultColor ?? '#ddd') + '55' : outdoor ? '#E3EEDC' : '#FFFFFF';
  return (
    <g data-kind="item" data-id={it.id} transform={`translate(${cx},${cy}) rotate(${deg})`} style={{ cursor: 'move' }} className="item-sym">
      <rect x={(-it.w / 2) * s} y={(-it.d / 2) * s} width={it.w * s} height={it.d * s} rx={Math.min(it.w, it.d) * s * (shapes ? 0.02 : 0.08)} fill={shapes ? (isRug ? fillColor : 'rgba(255,255,255,0.9)') : fillColor} stroke={shapes ? 'none' : '#3d434c'} strokeWidth={Math.max(0.6, s / 70)} />
      {shapes && shapes.map((sh, i) => shapeToSvg(sh as PlanShapeLike, s, i, fillColor))}
      {!shapes && it.w * s > 40 && <text textAnchor="middle" y={4} fontSize={Math.min(11, it.w * s / 8)} fill="#6b7078" style={{ pointerEvents: 'none' }}>{it.name ?? def?.name ?? 'Item'}</text>}
      {selected && <rect x={(-it.w / 2) * s - 3} y={(-it.d / 2) * s - 3} width={it.w * s + 6} height={it.d * s + 6} fill="none" stroke={SEL} strokeWidth={1.5} rx={3} />}
    </g>
  );
}

function ItemHandles({ it, T, s }: { it: Item; T: (p: Vec2) => string; s: number }) {
  const corners = itemCorners(it);
  const rotP = { x: it.x - Math.sin(it.rotation) * (-it.d / 2 - 22 / s), y: it.y + Math.cos(it.rotation) * (-it.d / 2 - 22 / s) };
  const [rx, ry] = T(rotP).split(',').map(Number);
  const [tx, ty] = T({ x: it.x - Math.sin(it.rotation) * (-it.d / 2), y: it.y + Math.cos(it.rotation) * (-it.d / 2) }).split(',').map(Number);
  const signs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return <g>
    <line x1={tx} y1={ty} x2={rx} y2={ry} stroke={SEL} strokeWidth={1.5} />
    <circle data-kind="rotate" data-id={it.id} cx={rx} cy={ry} r={7} fill={SEL} stroke="#fff" strokeWidth={2} style={{ cursor: 'grab' }} />
    {corners.map((c, i) => { const [x, y] = T(c).split(',').map(Number); return <rect key={i} data-kind="resize" data-id={it.id} data-cx={signs[i][0]} data-cy={signs[i][1]} x={x - 5} y={y - 5} width={10} height={10} rx={2} fill="#fff" stroke={SEL} strokeWidth={1.5} style={{ cursor: 'nwse-resize' }} />; })}
  </g>;
}

export { guessRoomType, centroid };
