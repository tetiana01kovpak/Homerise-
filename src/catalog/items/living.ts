import * as THREE from 'three';
import type { CatalogItem } from '../types';
import { C, M, P, box, rbox, cyl, legs4, clamp, rng } from '../materials';
import { buildSofa, planSofa, buildLSofa, planLSofa, buildTable, buildCabinet, planCabinet } from '../parts';

const BOOK_COLORS = ['#c9b79c', '#8c9a8b', '#d6a77a', '#6f7d8c', '#e2d8c6', '#b5674d', '#3f4f5f', '#d9c27a', '#a7b8a8'];

export function buildBookshelf(w: number, d: number, h: number, color?: string, books = true): THREE.Group {
  const g = new THREE.Group();
  const wood = M.wood(color ?? C.oak);
  const t = clamp(w * 0.02, 0.016, 0.025);
  g.add(box(t, h, d, wood, -w / 2 + t / 2, 0, 0));
  g.add(box(t, h, d, wood, w / 2 - t / 2, 0, 0));
  g.add(box(w - 2 * t, t, d, wood, 0, h - t, 0));
  g.add(box(w - 2 * t, h - 0.06, 0.006, M.matte(C.offWhite), 0, 0.05, -d / 2 + 0.003));
  const plinth = 0.06;
  g.add(box(w - 2 * t, plinth, d - 0.02, wood, 0, 0, 0));
  const n = Math.max(2, Math.round((h - plinth) / 0.36));
  const sp = (h - plinth - t) / n;
  const rand = rng(Math.round(w * 1000 + h * 7));
  for (let i = 0; i < n; i++) {
    const y = plinth + i * sp;
    if (i > 0) g.add(box(w - 2 * t, t, d - 0.01, wood, 0, y, -0.005));
    if (!books) continue;
    // books
    let x = -w / 2 + t + 0.01;
    const maxX = w / 2 - t - 0.01 - (rand() * 0.3) * (w - 2 * t);
    const by = y + (i > 0 ? t : 0);
    const room = sp - t - 0.02;
    while (x < maxX) {
      const bw = 0.02 + rand() * 0.03;
      if (x + bw > w / 2 - t - 0.005) break;
      const bh = Math.min(room, room * (0.6 + rand() * 0.35));
      const bd = Math.min(d - 0.04, d * (0.6 + rand() * 0.25));
      g.add(box(bw, bh, bd, M.matte(BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)]), x + bw / 2, by, -d / 2 + 0.01 + bd / 2));
      x += bw + 0.002;
    }
  }
  return g;
}

export const livingItems: CatalogItem[] = [
  {
    id: 'sofa-2', name: 'Sofa, 2-seat', category: 'living', tags: ['sofa', 'couch', 'loveseat', 'settee'],
    size: { w: 1.6, d: 0.9, h: 0.85 }, defaultColor: C.fabric,
    build: (o) => buildSofa(o, 2), plan: (w, d) => planSofa(w, d, 2),
  },
  {
    id: 'sofa-3', name: 'Sofa, 3-seat', category: 'living', tags: ['sofa', 'couch', 'settee'],
    size: { w: 2.2, d: 0.92, h: 0.85 }, defaultColor: C.fabric,
    build: (o) => buildSofa(o, 3), plan: (w, d) => planSofa(w, d, 3),
  },
  {
    id: 'sofa-l', name: 'Sectional sofa (L-shaped)', category: 'living', tags: ['sofa', 'couch', 'sectional', 'corner', 'chaise', 'l-shaped'],
    size: { w: 2.8, d: 1.65, h: 0.85 }, defaultColor: C.fabric,
    build: (o) => buildLSofa(o), plan: (w, d) => planLSofa(w, d),
  },
  {
    id: 'armchair', name: 'Armchair', category: 'living', tags: ['chair', 'armchair', 'lounge chair', 'seat'],
    size: { w: 0.85, d: 0.85, h: 0.85 }, defaultColor: C.sage,
    build: (o) => buildSofa(o, 1), plan: (w, d) => planSofa(w, d, 1),
  },
  {
    id: 'ottoman', name: 'Ottoman / pouf', category: 'living', tags: ['ottoman', 'pouf', 'footstool', 'stool'],
    size: { w: 0.8, d: 0.6, h: 0.42 }, defaultColor: C.greige,
    build: (o) => {
      const g = new THREE.Group();
      const legH = Math.min(0.08, o.h * 0.2);
      g.add(legs4(o.w, o.d, legH, M.wood(C.walnut), { inset: 0.06, r: 0.016, taper: 0.7 }));
      g.add(rbox(o.w, o.h - legH, o.d, M.fabric(o.color ?? C.greige), 0.06, 0, legH, 0));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0.06)],
  },
  {
    id: 'coffee-table', name: 'Coffee table', category: 'living', tags: ['table', 'coffee table', 'low table'],
    size: { w: 1.2, d: 0.6, h: 0.42 }, defaultColor: C.oak,
    build: (o) => buildTable(o.w, o.d, o.h, { color: o.color, shelf: true }),
    plan: (w, d) => [P.rect(0, 0, w, d, 0.03), P.rect(0, 0, w - 0.12, d - 0.12, 0.02)],
  },
  {
    id: 'coffee-table-round', name: 'Coffee table, round', category: 'living', tags: ['table', 'coffee table', 'round'],
    size: { w: 0.9, d: 0.9, h: 0.4 }, defaultColor: C.oak,
    build: (o) => buildTable(o.w, o.d, o.h, { color: o.color, round: true }),
    plan: (w, d) => [{ t: 'circle', cx: 0, cy: 0, r: Math.min(w, d) / 2 }],
  },
  {
    id: 'side-table', name: 'Side table', category: 'living', tags: ['table', 'side table', 'end table', 'round'],
    size: { w: 0.45, d: 0.45, h: 0.55 }, defaultColor: C.oak,
    build: (o) => buildTable(o.w, o.d, o.h, { color: o.color, round: true, pedestal: true }),
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) * 0.08)],
  },
  {
    id: 'tv', name: 'TV (65")', category: 'living', tags: ['tv', 'television', 'screen', 'media'],
    size: { w: 1.45, d: 0.25, h: 0.88 }, elevation: 0.5, defaultColor: C.black,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const body = M.matte(o.color ?? '#222326');
      const footH = h * 0.08;
      g.add(rbox(w * 0.32, 0.015, d, M.blackMetal(), 0.005, 0, 0, 0));
      g.add(box(w * 0.04, footH, 0.03, M.blackMetal(), 0, 0.015, -d * 0.05));
      const sd = Math.min(0.05, d * 0.3);
      g.add(rbox(w, h - footH, sd, body, 0.006, 0, footH, -d * 0.05));
      g.add(box(w - 0.02, h - footH - 0.02, 0.004, M.screen(), 0, footH + 0.01, -d * 0.05 + sd / 2));
      return g;
    },
    plan: (w, d) => [P.rect(0, -d * 0.05, w, Math.min(0.05, d * 0.3), 0, true), P.rect(0, 0, w * 0.32, d, 0.01)],
  },
  {
    id: 'tv-stand', name: 'TV stand / media console', category: 'living', tags: ['tv stand', 'media console', 'tv bench', 'sideboard', 'cabinet'],
    size: { w: 1.6, d: 0.42, h: 0.5 }, defaultColor: C.oak,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.wood(o.color ?? C.oak), front: M.lacquer(C.offWhite), legs: Math.min(0.15, o.h * 0.25), doors: Math.max(2, Math.round(o.w / 0.5)), doorHandleV: false }),
    plan: (w, d) => planCabinet(w, d, Math.max(2, Math.round(w / 0.5))),
  },
  {
    id: 'bookshelf', name: 'Bookshelf', category: 'living', tags: ['bookshelf', 'bookcase', 'shelves', 'library', 'storage'],
    size: { w: 0.9, d: 0.32, h: 1.9 }, defaultColor: C.oak,
    build: (o) => buildBookshelf(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(-w / 2 + 0.02, -d / 2 + 0.02, w / 2 - 0.02, -d / 2 + 0.02), P.line(-w / 2, d / 2, w / 2, -d / 2)],
  },
  {
    id: 'rug-rect', name: 'Rug, rectangular', category: 'living', tags: ['rug', 'carpet', 'mat'],
    size: { w: 2.0, d: 1.4, h: 0.012 }, defaultColor: '#d8cdbd',
    build: (o) => {
      const g = new THREE.Group();
      const base = M.fabric(o.color ?? '#d8cdbd');
      g.add(box(o.w, o.h * 0.6, o.d, base, 0, 0, 0));
      const b = Math.min(0.12, Math.min(o.w, o.d) * 0.08);
      g.add(box(o.w - 2 * b, o.h * 0.4, o.d - 2 * b, M.fabric(C.linen), 0, o.h * 0.6, 0));
      g.add(box(o.w - 4 * b, o.h * 0.42, o.d - 4 * b, base, 0, o.h * 0.58, 0));
      return g;
    },
    plan: (w, d) => {
      const b = Math.min(0.12, Math.min(w, d) * 0.08);
      return [P.rect(0, 0, w, d), P.rect(0, 0, w - 2 * b, d - 2 * b)];
    },
  },
  {
    id: 'rug-round', name: 'Rug, round', category: 'living', tags: ['rug', 'carpet', 'round', 'mat'],
    size: { w: 1.6, d: 1.6, h: 0.012 }, defaultColor: '#c9bba6',
    build: (o) => {
      const g = new THREE.Group();
      const a = cyl(0.5, o.h * 0.6, M.fabric(o.color ?? '#c9bba6'), 0, 0, 0, 48);
      a.scale.set(o.w, 1, o.d);
      const b = cyl(0.42, o.h * 0.4, M.fabric(C.linen), 0, o.h * 0.6, 0, 48);
      b.scale.set(o.w, 1, o.d);
      g.add(a, b);
      return g;
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) * 0.42)],
  },
];
