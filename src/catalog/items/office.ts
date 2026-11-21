import * as THREE from 'three';
import type { CatalogItem, PlanShape } from '../types';
import { C, M, P, box, rbox, cyl, sphere, xform, fitXZ } from '../materials';
import { buildCabinet, planCabinet } from '../parts';

function buildDesk(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const top = M.wood(color ?? C.oak);
  const metal = M.blackMetal();
  const t = 0.03;
  g.add(rbox(w, t, d, top, 0.008, 0, h - t, 0));
  const lw = 0.04;
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.06);
    g.add(box(lw, h - t, lw, metal, x, 0, d / 2 - 0.06));
    g.add(box(lw, h - t, lw, metal, x, 0, -d / 2 + 0.06));
    g.add(box(lw, 0.03, d - 0.08, metal, x, h - t - 0.03, 0));
    g.add(box(lw, 0.02, d - 0.08, metal, x, 0, 0));
  }
  g.add(box(w - 0.16, 0.04, 0.02, metal, 0, h - t - 0.06, -d / 2 + 0.08));
  // drawer unit under the right side
  const uw = Math.min(0.42, w * 0.3);
  const unit = buildCabinet(uw, d * 0.8, (h - t) * 0.55, { body: M.lacquer(C.white), drawers: 2, handle: M.steel() });
  unit.position.set(w / 2 - 0.1 - uw / 2, (h - t) * 0.45, 0);
  g.add(unit);
  return g;
}

function buildOfficeChair(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const fab = M.fabric(color ?? C.charcoal);
  const metal = M.chrome();
  const R = Math.min(w, d) / 2;
  const caster = Math.min(0.03, R * 0.1);
  const L = R - caster - 0.02;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const spoke = box(L, 0.03, 0.04, M.black(), 0, caster * 2, 0);
    spoke.geometry.translate(L / 2, 0, 0);
    spoke.rotation.y = a;
    g.add(spoke);
    g.add(sphere(caster, M.black(), Math.cos(a) * (L - 0.01), caster, -Math.sin(a) * (L - 0.01), 10));
  }
  const seatH = h * 0.43;
  g.add(cyl(0.03, seatH - 0.08, metal, 0, caster * 2, 0, 14));
  g.add(box(0.2, 0.05, 0.2, M.black(), 0, seatH - 0.1, 0));
  const sw = w * 0.78, sd = d * 0.72;
  g.add(rbox(sw, 0.08, sd, fab, 0.035, 0, seatH - 0.06, d * 0.04));
  // backrest
  const bh = h - seatH - 0.08;
  g.add(box(0.05, bh * 0.4, 0.03, M.black(), 0, seatH, -d / 2 + 0.08));
  g.add(rbox(sw * 0.92, bh, 0.07, fab, 0.035, 0, h - bh, -d / 2 + 0.06));
  // arms
  for (const sx of [-1, 1]) {
    g.add(box(0.03, 0.2, 0.03, M.black(), sx * (sw / 2 + 0.01), seatH, 0));
    g.add(rbox(0.06, 0.03, sd * 0.6, M.black(), 0.012, sx * (sw / 2 + 0.01), seatH + 0.2, 0));
  }
  return g;
}

function planOfficeChair(w: number, d: number): PlanShape[] {
  const R = Math.min(w, d) / 2;
  const out: PlanShape[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    out.push(P.line(0, 0, Math.cos(a) * (R - 0.03), Math.sin(a) * (R - 0.03)));
  }
  const sw = w * 0.78, sd = d * 0.72;
  out.push(P.rect(0, d * 0.04, sw, sd, 0.05));
  out.push(P.poly(xform([[-sw * 0.46, 0], [sw * 0.46, 0], [sw * 0.46, 0.07], [-sw * 0.46, 0.07]], 0, 0, -d / 2 + 0.025), true, true));
  return out;
}

export const officeItems: CatalogItem[] = [
  {
    id: 'desk', name: 'Desk', category: 'office', tags: ['desk', 'table', 'workstation', 'study'],
    size: { w: 1.4, d: 0.7, h: 0.75 }, defaultColor: C.oak,
    build: (o) => buildDesk(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.rect(0, 0, w, d), P.rect(w / 2 - 0.1 - Math.min(0.42, w * 0.3) / 2, 0, Math.min(0.42, w * 0.3), d * 0.8)],
  },
  {
    id: 'desk-corner', name: 'Corner desk (L-shaped)', category: 'office', tags: ['desk', 'corner', 'l-shaped', 'workstation'],
    size: { w: 1.6, d: 1.4, h: 0.75 }, defaultColor: C.oak,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const top = M.wood(o.color ?? C.oak);
      const dd = Math.min(0.7, d * 0.5);
      const t = 0.03;
      g.add(rbox(w, t, dd, top, 0.008, 0, h - t, -d / 2 + dd / 2));
      g.add(rbox(dd, t, d - dd, top, 0.008, -w / 2 + dd / 2, h - t, dd / 2));
      const metal = M.blackMetal();
      const pts: [number, number][] = [[w / 2 - 0.05, -d / 2 + 0.05], [w / 2 - 0.05, -d / 2 + dd - 0.05], [-w / 2 + 0.05, -d / 2 + 0.05], [-w / 2 + 0.05, d / 2 - 0.05], [-w / 2 + dd - 0.05, d / 2 - 0.05]];
      for (const [x, z] of pts) g.add(box(0.04, h - t, 0.04, metal, x, 0, z));
      return g;
    },
    plan: (w, d) => {
      const dd = Math.min(0.7, d * 0.5);
      return [P.poly([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + dd], [-w / 2 + dd, -d / 2 + dd], [-w / 2 + dd, d / 2], [-w / 2, d / 2]])];
    },
  },
  {
    id: 'office-chair', name: 'Office chair', category: 'office', tags: ['chair', 'office chair', 'desk chair', 'swivel'],
    size: { w: 0.65, d: 0.65, h: 1.1 }, defaultColor: C.charcoal,
    build: (o) => fitXZ(buildOfficeChair(o.w, o.d, o.h, o.color), o.w, o.d), plan: planOfficeChair,
  },
  {
    id: 'filing-cabinet', name: 'Filing cabinet', category: 'office', tags: ['filing cabinet', 'drawers', 'cabinet', 'storage'],
    size: { w: 0.47, d: 0.62, h: 1.32 }, defaultColor: '#a9aeb3',
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.plastic(o.color ?? '#a9aeb3'), drawers: Math.max(2, Math.round(o.h / 0.33)), handle: M.chrome() }),
    plan: (w, d) => planCabinet(w, d),
  },
  {
    id: 'monitor', name: 'Computer monitor', category: 'office', tags: ['monitor', 'screen', 'computer', 'display', 'pc'],
    size: { w: 0.62, d: 0.2, h: 0.5 }, elevation: 0.75, defaultColor: C.black,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const body = M.matte(o.color ?? '#242528');
      g.add(rbox(Math.min(0.25, w * 0.4), 0.015, d, body, 0.006, 0, 0, 0));
      g.add(box(0.04, h * 0.45, 0.025, body, 0, 0.015, -d * 0.15));
      const sh = Math.min(h - 0.08, w * 0.6);
      g.add(rbox(w, sh, 0.025, body, 0.006, 0, h - sh, 0));
      g.add(box(w - 0.02, sh - 0.02, 0.003, M.screen(), 0, h - sh + 0.01, 0.0125));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, 0.03, 0, true), P.rect(0, 0, Math.min(0.25, w * 0.4), d, 0.01)],
  },
  {
    id: 'laptop', name: 'Laptop', category: 'office', tags: ['laptop', 'computer', 'notebook'],
    size: { w: 0.33, d: 0.24, h: 0.22 }, elevation: 0.75,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const m = o.color ? M.lacquer(o.color) : M.steel();
      g.add(rbox(w, 0.015, d - 0.012, m, 0.004, 0, 0, 0.006));
      g.add(box(w * 0.9, 0.002, d * 0.45, M.black(), 0, 0.015, -0.0));
      g.add(rbox(w, h - 0.0, 0.008, m, 0.003, 0, 0, -d / 2 + 0.004));
      g.add(box(w - 0.02, h - 0.035, 0.002, M.screen(), 0, 0.025, -d / 2 + 0.009));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0.01), P.line(-w / 2, -d / 2 + 0.01, w / 2, -d / 2 + 0.01)],
  },
  {
    id: 'office-bookcase', name: 'Office cabinet with glass doors', category: 'office', tags: ['cabinet', 'bookcase', 'display', 'glass', 'storage'],
    size: { w: 0.8, d: 0.4, h: 1.9 }, defaultColor: C.white,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), doors: 2, glassDoors: true, plinth: 0.06 }),
    plan: (w, d) => planCabinet(w, d, 2, true),
  },
];

