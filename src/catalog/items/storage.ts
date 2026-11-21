import * as THREE from 'three';
import type { CatalogItem } from '../types';
import { C, M, P, box, rbox, cyl, clamp, rng, fitXZ } from '../materials';
import { buildCabinet, planCabinet } from '../parts';
import { buildBookshelf } from './living';

function buildShelvingUnit(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const frame = M.blackMetal();
  const shelfM = M.wood(color ?? C.oak);
  const p = 0.025;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(p, h, p, frame, sx * (w / 2 - p / 2), 0, sz * (d / 2 - p / 2)));
  const n = Math.max(3, Math.round(h / 0.4));
  const rand = rng(5);
  for (let i = 0; i < n; i++) {
    const y = 0.08 + ((h - 0.08 - 0.025) * i) / (n - 1);
    g.add(box(w, 0.025, d, shelfM, 0, y, 0));
    if (i < n - 1 && rand() > 0.3) {
      // a few storage boxes / baskets
      const bw = Math.min(0.3, w * 0.35);
      const bh = Math.min(0.22, ((h - 0.1) / (n - 1)) * 0.6);
      g.add(rbox(bw, bh, d * 0.8, M.fabric(rand() > 0.5 ? C.linen : C.sage), 0.02, -w / 2 + 0.05 + bw / 2 + rand() * (w - bw - 0.1), y + 0.025, 0));
    }
  }
  return g;
}

function buildCubeStorage(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const m = M.lacquer(color ?? C.white);
  const cols = Math.max(1, Math.round(w / 0.4));
  const rows = Math.max(1, Math.round(h / 0.4));
  const t = 0.018;
  g.add(box(w, t, d, m, 0, 0, 0));
  for (let r = 1; r <= rows; r++) g.add(box(w, t, d, m, 0, ((h - t) * r) / rows, 0));
  for (let c = 0; c <= cols; c++) g.add(box(t, h - t * 2, d, m, -w / 2 + t / 2 + ((w - t) * c) / cols, t, 0));
  g.add(box(w, h, 0.005, m, 0, 0, -d / 2 + 0.0025));
  const cw = (w - t) / cols, rh = (h - t) / rows;
  const rand = rng(9);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (rand() < 0.45) continue;
    g.add(rbox(cw - t - 0.02, rh - t - 0.03, d - 0.04, M.fabric(rand() > 0.5 ? C.greige : C.sage), 0.02, -w / 2 + t / 2 + cw * (c + 0.5), t + rh * r + 0.005, 0.005));
  }
  return g;
}

export const storageItems: CatalogItem[] = [
  {
    id: 'shelving-unit', name: 'Shelving unit', category: 'storage', tags: ['shelf', 'shelves', 'rack', 'shelving', 'storage'],
    size: { w: 0.8, d: 0.4, h: 1.8 }, defaultColor: C.oak,
    build: (o) => buildShelvingUnit(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(-w / 2, -d / 2, w / 2, d / 2)],
  },
  {
    id: 'shoe-cabinet', name: 'Shoe cabinet', category: 'storage', tags: ['shoe', 'cabinet', 'hallway', 'entry', 'storage'],
    size: { w: 0.8, d: 0.3, h: 1.0 }, defaultColor: C.white,
    build: (o) => {
      const g = buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), drawers: Math.max(2, Math.round(o.h / 0.4)), legs: 0.1, handle: M.wood(C.oak) });
      return g;
    },
    plan: (w, d) => planCabinet(w, d),
  },
  {
    id: 'cube-storage', name: 'Cube storage', category: 'storage', tags: ['cube', 'kallax', 'shelf', 'storage', 'boxes'],
    size: { w: 0.78, d: 0.39, h: 0.78 }, defaultColor: C.white,
    build: (o) => buildCubeStorage(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(0, -d / 2, 0, d / 2)],
  },
  {
    id: 'tall-cabinet', name: 'Tall storage cabinet', category: 'storage', tags: ['cabinet', 'cupboard', 'pantry', 'tall', 'storage', 'broom'],
    size: { w: 0.6, d: 0.6, h: 2.1 }, defaultColor: C.white,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), doors: Math.max(1, Math.round(o.w / 0.5)), plinth: 0.1 }),
    plan: (w, d) => planCabinet(w, d, Math.max(1, Math.round(w / 0.5)), true),
  },
  {
    id: 'bookcase-low', name: 'Low bookcase', category: 'storage', tags: ['bookcase', 'shelf', 'books', 'low'],
    size: { w: 1.2, d: 0.3, h: 0.8 }, defaultColor: C.walnut,
    build: (o) => buildBookshelf(o.w, o.d, o.h, o.color ?? C.walnut),
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(-w / 2, d / 2, w / 2, -d / 2)],
  },
  {
    id: 'coat-rack', name: 'Coat rack', category: 'storage', tags: ['coat', 'rack', 'hanger', 'hallway', 'stand'],
    size: { w: 0.5, d: 0.5, h: 1.75 }, defaultColor: C.walnut,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const m = M.wood(o.color ?? C.walnut);
      const r = Math.min(w, d) / 2;
      g.add(cyl(r * 0.6, 0.03, m, 0, 0, 0, 24));
      g.add(cyl(0.02, h - 0.03, m, 0, 0.03, 0, 12));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const hook = box(r * 0.5, 0.02, 0.02, m, 0, 0, 0);
        hook.geometry.translate(r * 0.25, 0, 0);
        hook.position.set(0, h - clamp(h * 0.08, 0.08, 0.2), 0);
        hook.rotation.y = a;
        g.add(hook);
      }
      return fitXZ(g, w, d);
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) * 0.3), P.line(-w * 0.25, -d * 0.25, w * 0.25, d * 0.25), P.line(-w * 0.25, d * 0.25, w * 0.25, -d * 0.25)],
  },
];
