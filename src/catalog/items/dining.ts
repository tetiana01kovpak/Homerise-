import * as THREE from 'three';
import type { CatalogItem, PlanShape } from '../types';
import { C, M, P, clamp } from '../materials';
import { buildChair, planChair, buildTable, buildCabinet, planCabinet } from '../parts';

type Layout = 'rect4' | 'rect6' | 'round4';

function setDims(w: number, d: number, layout: Layout) {
  const chairD = clamp(Math.min(w, d) * 0.3, 0.38, 0.52);
  const chairOut = chairD * 0.55;
  if (layout === 'round4') {
    const tD = Math.min(w, d) - 2 * chairOut;
    const chairW = Math.min(0.46, tD * 0.45);
    return { chairD, chairOut, chairW, perSide: 1 };
  }
  const perSide = layout === 'rect4' ? 2 : 3;
  const chairW = Math.min(0.46, (w / perSide) * 0.82);
  return { chairD, chairOut, chairW, perSide };
}

/** Positions (center x, z) + facing direction for each chair. */
function chairSpots(w: number, d: number, layout: Layout): { x: number; z: number; fx: number; fz: number }[] {
  const s = setDims(w, d, layout);
  const out: { x: number; z: number; fx: number; fz: number }[] = [];
  if (layout === 'round4') {
    out.push({ x: 0, z: d / 2 - s.chairD / 2, fx: 0, fz: -1 });
    out.push({ x: 0, z: -d / 2 + s.chairD / 2, fx: 0, fz: 1 });
    out.push({ x: w / 2 - s.chairD / 2, z: 0, fx: -1, fz: 0 });
    out.push({ x: -w / 2 + s.chairD / 2, z: 0, fx: 1, fz: 0 });
    return out;
  }
  for (let i = 0; i < s.perSide; i++) {
    const x = -w / 2 + (w / s.perSide) * (i + 0.5);
    out.push({ x, z: d / 2 - s.chairD / 2, fx: 0, fz: -1 });
    out.push({ x, z: -d / 2 + s.chairD / 2, fx: 0, fz: 1 });
  }
  return out;
}

function buildDiningSet(w: number, d: number, h: number, layout: Layout, color?: string, outdoor = false): THREE.Group {
  const g = new THREE.Group();
  const s = setDims(w, d, layout);
  const th = Math.min(0.76, h * 0.86);
  if (layout === 'round4') {
    const tD = Math.min(w, d) - 2 * s.chairOut;
    g.add(buildTable(tD, tD, th, { color: outdoor ? undefined : color, round: true, pedestal: true, metalLegs: outdoor, topM: outdoor ? M.wood(C.lightOak) : undefined }));
  } else {
    g.add(buildTable(w, d - 2 * s.chairOut, th, { color: outdoor ? undefined : color }));
  }
  for (const c of chairSpots(w, d, layout)) {
    const ch = buildChair(s.chairW, s.chairD, h, { upholstered: !outdoor, color: outdoor ? undefined : C.greige, metal: outdoor });
    ch.rotation.y = Math.atan2(c.fx, c.fz);
    ch.position.set(c.x, 0, c.z);
    g.add(ch);
  }
  return g;
}

function planDiningSet(w: number, d: number, layout: Layout): PlanShape[] {
  const s = setDims(w, d, layout);
  const out: PlanShape[] = [];
  for (const c of chairSpots(w, d, layout)) out.push(...planChair(c.x, c.z, s.chairW, s.chairD, c.fx, c.fz));
  if (layout === 'round4') out.push(P.circle(0, 0, (Math.min(w, d) - 2 * s.chairOut) / 2, false));
  else out.push(P.rect(0, 0, w, d - 2 * s.chairOut));
  return out;
}

export { buildDiningSet, planDiningSet };

export const diningItems: CatalogItem[] = [
  {
    id: 'dining-table', name: 'Dining table', category: 'dining', tags: ['table', 'dining table', 'kitchen table'],
    size: { w: 1.6, d: 0.9, h: 0.75 }, defaultColor: C.oak,
    build: (o) => buildTable(o.w, o.d, o.h, { color: o.color }),
    plan: (w, d) => [P.rect(0, 0, w, d)],
  },
  {
    id: 'dining-set-4', name: 'Dining table with 4 chairs', category: 'dining', tags: ['table', 'dining', 'chairs', 'set', '4 seats'],
    size: { w: 1.3, d: 1.4, h: 0.86 }, defaultColor: C.oak,
    build: (o) => buildDiningSet(o.w, o.d, o.h, 'rect4', o.color), plan: (w, d) => planDiningSet(w, d, 'rect4'),
  },
  {
    id: 'dining-set-6', name: 'Dining table with 6 chairs', category: 'dining', tags: ['table', 'dining', 'chairs', 'set', '6 seats'],
    size: { w: 1.9, d: 1.5, h: 0.86 }, defaultColor: C.oak,
    build: (o) => buildDiningSet(o.w, o.d, o.h, 'rect6', o.color), plan: (w, d) => planDiningSet(w, d, 'rect6'),
  },
  {
    id: 'dining-set-round', name: 'Round dining table with 4 chairs', category: 'dining', tags: ['table', 'dining', 'round', 'chairs', 'set'],
    size: { w: 1.7, d: 1.7, h: 0.86 }, defaultColor: C.oak,
    build: (o) => buildDiningSet(o.w, o.d, o.h, 'round4', o.color), plan: (w, d) => planDiningSet(w, d, 'round4'),
  },
  {
    id: 'dining-table-round', name: 'Dining table, round', category: 'dining', tags: ['table', 'round', 'dining table'],
    size: { w: 1.1, d: 1.1, h: 0.75 }, defaultColor: C.oak,
    build: (o) => buildTable(o.w, o.d, o.h, { color: o.color, round: true, pedestal: true }),
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2)],
  },
  {
    id: 'dining-chair', name: 'Dining chair', category: 'dining', tags: ['chair', 'dining chair', 'seat'],
    size: { w: 0.46, d: 0.5, h: 0.86 }, defaultColor: C.greige,
    build: (o) => buildChair(o.w, o.d, o.h, { upholstered: true, color: o.color }),
    plan: (w, d) => planChair(0, 0, w, d),
  },
  {
    id: 'dining-chair-wood', name: 'Wooden chair', category: 'dining', tags: ['chair', 'wooden chair', 'seat'],
    size: { w: 0.45, d: 0.5, h: 0.82 }, defaultColor: C.oak,
    build: (o) => buildChair(o.w, o.d, o.h, { wood: o.color ?? C.oak }),
    plan: (w, d) => planChair(0, 0, w, d),
  },
  {
    id: 'sideboard', name: 'Sideboard', category: 'dining', tags: ['sideboard', 'buffet', 'credenza', 'cabinet', 'storage'],
    size: { w: 1.6, d: 0.45, h: 0.8 }, defaultColor: C.walnut,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.wood(o.color ?? C.walnut), front: M.wood(o.color ?? C.walnut), legs: Math.min(0.18, o.h * 0.22), doors: Math.max(2, Math.round(o.w / 0.5)), drawers: 1, drawerZone: 0.22, handle: M.brass() }),
    plan: (w, d) => planCabinet(w, d, Math.max(2, Math.round(w / 0.5))),
  },
];
