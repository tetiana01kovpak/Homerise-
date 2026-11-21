import * as THREE from 'three';
import type { CatalogItem } from '../types';
import { C, M, P, box, rbox, clamp, legs4 } from '../materials';
import { buildBed, planBed, buildCabinet, planCabinet, planWardrobe } from '../parts';

function bed(id: string, name: string, w: number, d: number, tags: string[]): CatalogItem {
  return {
    id, name, category: 'bedroom', tags: ['bed', ...tags],
    size: { w, d, h: 1.0 }, defaultColor: C.greige,
    build: (o) => buildBed(o), plan: (pw, pd) => planBed(pw, pd),
  };
}

/** Long-side bed frame (bunk / crib): length along X, front (+Z) open side. */
function buildBunk(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const wood = M.wood(color ?? C.lightOak);
  const p = clamp(w * 0.03, 0.045, 0.07);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(p, h, p, wood, sx * (w / 2 - p / 2), 0, sz * (d / 2 - p / 2)));
  const levels = [clamp(h * 0.12, 0.15, 0.3), h * 0.58];
  const mattT = clamp(h * 0.09, 0.1, 0.18);
  for (const ly of levels) {
    // side rails
    g.add(box(w - 2 * p, 0.1, 0.03, wood, 0, ly, d / 2 - 0.015));
    g.add(box(w - 2 * p, 0.1, 0.03, wood, 0, ly, -d / 2 + 0.015));
    g.add(box(0.03, 0.1, d - 2 * p, wood, w / 2 - 0.015, ly, 0));
    g.add(box(0.03, 0.1, d - 2 * p, wood, -w / 2 + 0.015, ly, 0));
    g.add(rbox(w - 2 * p, mattT, d - 2 * p, M.matte(C.white), 0.04, 0, ly + 0.06, 0));
    g.add(rbox(w * 0.6, 0.04, d - 2 * p - 0.01, M.fabric(color ? C.linen : C.sage), 0.02, w * 0.17, ly + 0.06 + mattT - 0.01, 0));
    g.add(rbox(Math.min(0.5, d * 0.5), 0.1, Math.min(0.4, d * 0.5), M.fabric(C.white), 0.04, -w / 2 + p + 0.3, ly + 0.06 + mattT, 0));
  }
  // head/foot boards
  for (const sx of [-1, 1]) {
    g.add(box(0.025, h * 0.25, d - 2 * p, wood, sx * (w / 2 - p / 2), h * 0.72, 0));
  }
  // guard rails on top bunk (back full, front partial)
  g.add(box(w - 2 * p, 0.05, 0.03, wood, 0, h - 0.08, -d / 2 + 0.015));
  g.add(box((w - 2 * p) * 0.7, 0.05, 0.03, wood, -(w - 2 * p) * 0.15, h - 0.08, d / 2 - 0.015));
  // ladder on the front right
  const lx = w / 2 - p - 0.25;
  const lw = 0.36;
  for (const sx of [-1, 1]) g.add(box(0.035, h - 0.02, 0.035, wood, lx + sx * lw / 2, 0, d / 2 - 0.0175));
  const rungs = Math.max(3, Math.round(h / 0.3));
  for (let i = 1; i < rungs; i++) g.add(box(lw, 0.025, 0.03, wood, lx, (h * i) / rungs - 0.0125, d / 2 - 0.0175));
  return g;
}

function buildCrib(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const wood = M.lacquer(color ?? C.white);
  const p = 0.045;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(p, h, p, wood, sx * (w / 2 - p / 2), 0, sz * (d / 2 - p / 2)));
  const base = h * 0.3;
  g.add(box(w - 2 * p, 0.03, d - 2 * p, wood, 0, base, 0));
  g.add(rbox(w - 2 * p - 0.01, 0.1, d - 2 * p - 0.01, M.matte(C.white), 0.03, 0, base + 0.03, 0));
  g.add(rbox(w * 0.45, 0.04, d - 2 * p - 0.02, M.fabric(C.blush), 0.02, w * 0.15, base + 0.12, 0));
  // rails
  for (const sz of [-1, 1]) {
    g.add(box(w - 2 * p, 0.04, 0.03, wood, 0, base - 0.04, sz * (d / 2 - p / 2)));
    g.add(box(w - 2 * p, 0.04, 0.03, wood, 0, h - 0.04, sz * (d / 2 - p / 2)));
    const n = Math.max(6, Math.round((w - 2 * p) / 0.085));
    for (let i = 1; i < n; i++) {
      const x = -w / 2 + p + ((w - 2 * p) * i) / n;
      g.add(box(0.02, h - 0.04 - base, 0.02, wood, x, base, sz * (d / 2 - p / 2)));
    }
  }
  for (const sx of [-1, 1]) {
    g.add(box(0.025, h - base - 0.02, d - 2 * p, wood, sx * (w / 2 - p / 2), base, 0));
  }
  return g;
}

export const bedroomItems: CatalogItem[] = [
  bed('bed-single', 'Bed, single (90×200)', 0.95, 2.08, ['single', 'twin']),
  bed('bed-double', 'Bed, double (140×200)', 1.45, 2.1, ['double', 'full']),
  bed('bed-queen', 'Bed, queen (160×200)', 1.65, 2.12, ['queen']),
  bed('bed-king', 'Bed, king (180×200)', 1.86, 2.14, ['king']),
  {
    id: 'bunk-bed', name: 'Bunk bed', category: 'bedroom', tags: ['bed', 'bunk', 'kids', 'children'],
    size: { w: 2.08, d: 1.0, h: 1.65 }, defaultColor: C.lightOak,
    build: (o) => buildBunk(o.w, o.d, o.h, o.color),
    plan: (w, d) => [
      P.rect(0, 0, w, d), P.rect(0, 0, w - 0.12, d - 0.12),
      P.rect(-w / 2 + 0.36, 0, 0.4, Math.min(0.4, d * 0.5), 0.05),
      P.line(w / 2 - 0.25 - 0.06 - 0.18, d / 2, w / 2 - 0.25 - 0.06 - 0.18, d / 2 - 0.06),
      P.line(w / 2 - 0.25 - 0.06 + 0.18, d / 2, w / 2 - 0.25 - 0.06 + 0.18, d / 2 - 0.06),
    ],
  },
  {
    id: 'crib', name: 'Crib / baby cot', category: 'bedroom', tags: ['crib', 'cot', 'baby', 'nursery'],
    size: { w: 1.28, d: 0.68, h: 0.95 }, defaultColor: C.white,
    build: (o) => buildCrib(o.w, o.d, o.h, o.color),
    plan: (w, d) => {
      const out = [P.rect(0, 0, w, d), P.rect(0, 0, w - 0.09, d - 0.09)];
      const n = Math.max(6, Math.round((w - 0.09) / 0.085));
      for (let i = 1; i < n; i++) {
        const x = -w / 2 + 0.045 + ((w - 0.09) * i) / n;
        out.push(P.line(x, d / 2, x, d / 2 - 0.045), P.line(x, -d / 2, x, -d / 2 + 0.045));
      }
      return out;
    },
  },
  {
    id: 'nightstand', name: 'Nightstand', category: 'bedroom', tags: ['nightstand', 'bedside table', 'night table', 'drawers'],
    size: { w: 0.45, d: 0.4, h: 0.55 }, defaultColor: C.oak,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.wood(o.color ?? C.oak), front: M.wood(o.color ?? C.oak), drawers: 2, legs: Math.min(0.15, o.h * 0.25), handle: M.brass() }),
    plan: (w, d) => planCabinet(w, d),
  },
  {
    id: 'wardrobe-2', name: 'Wardrobe, 2-door', category: 'bedroom', tags: ['wardrobe', 'closet', 'armoire', 'cupboard', 'storage'],
    size: { w: 1.0, d: 0.6, h: 2.1 }, defaultColor: C.white,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), doors: 2, plinth: 0.08 }),
    plan: (w, d) => planWardrobe(w, d, 2),
  },
  {
    id: 'wardrobe-3', name: 'Wardrobe, 3-door', category: 'bedroom', tags: ['wardrobe', 'closet', 'armoire', 'cupboard', 'storage'],
    size: { w: 1.5, d: 0.6, h: 2.1 }, defaultColor: C.white,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), doors: 3, plinth: 0.08 }),
    plan: (w, d) => planWardrobe(w, d, 3),
  },
  {
    id: 'dresser', name: 'Dresser', category: 'bedroom', tags: ['dresser', 'chest of drawers', 'drawers', 'commode'],
    size: { w: 1.2, d: 0.5, h: 0.85 }, defaultColor: C.oak,
    build: (o) => {
      const g = new THREE.Group();
      const wood = M.wood(o.color ?? C.oak);
      const legH = Math.min(0.14, o.h * 0.16);
      const half = o.w / 2;
      for (const sx of [-1, 1]) {
        const c = buildCabinet(half, o.d, o.h - legH, { body: wood, front: wood, drawers: 3, handle: M.brass() });
        c.position.set(sx * half / 2, legH, 0);
        g.add(c);
      }
      g.add(legs4(o.w, o.d - 0.03, legH, M.wood(C.walnut), { inset: 0.05, r: 0.016, taper: 0.7 }));
      return g;
    },
    plan: (w, d) => [...planCabinet(w, d), P.line(0, d / 2 - 0.03, 0, d / 2)],
  },
  {
    id: 'chest-of-drawers', name: 'Chest of drawers, tall', category: 'bedroom', tags: ['chest', 'drawers', 'tallboy', 'dresser'],
    size: { w: 0.8, d: 0.45, h: 1.2 }, defaultColor: C.white,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), drawers: 5, plinth: 0.06, handle: M.brass() }),
    plan: (w, d) => planCabinet(w, d),
  },
  {
    id: 'dressing-table', name: 'Dressing table', category: 'bedroom', tags: ['vanity', 'dressing table', 'makeup', 'desk'],
    size: { w: 1.0, d: 0.45, h: 1.45 }, defaultColor: C.white,
    build: (o) => {
      const g = new THREE.Group();
      const body = M.lacquer(o.color ?? C.white);
      const th = Math.min(0.76, o.h * 0.52);
      const t = buildCabinet(o.w, o.d, th, { body, drawers: 1, drawerZone: 1, legs: th - 0.18, handle: M.brass() });
      g.add(t);
      const mh = o.h - th - 0.02;
      const mw = Math.min(o.w * 0.6, mh * 0.8);
      g.add(rbox(mw, mh, 0.03, M.brass(), 0.02, 0, th + 0.02, -o.d / 2 + 0.03));
      g.add(rbox(mw - 0.03, mh - 0.03, 0.005, M.mirror(), 0.015, 0, th + 0.035, -o.d / 2 + 0.047));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d), P.rect(0, -d / 2 + 0.03, Math.min(w * 0.6, 0.5), 0.03, 0, true)],
  },
];
