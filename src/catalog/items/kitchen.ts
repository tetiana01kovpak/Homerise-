import * as THREE from 'three';
import type { CatalogItem, PlanShape } from '../types';
import { C, M, P, mat, box, rbox, cyl, ringFlat, frustum, handleH, handleV, clamp, fitXZ } from '../materials';
import { buildCabinet, planCabinet, faucet } from '../parts';

export const counterMat = () => mat('#e7e3db', { roughness: 0.35 });

/** Base cabinet with countertop that has a rectangular sink cut-out + faucet. */
export function buildSinkCabinet(w: number, d: number, h: number, color: string | undefined, double = false, kitchen = true): THREE.Group {
  const faucetH = clamp(h * 0.22, 0.12, 0.35);
  const ch = h - faucetH; // countertop height
  const topT = 0.03;
  const g = buildCabinet(w, d, ch - topT, { body: M.lacquer(color ?? C.white), doors: Math.max(1, Math.round(w / 0.45)), plinth: kitchen ? 0.1 : 0, legs: kitchen ? undefined : Math.min(0.2, ch * 0.2) });
  const top = counterMat();
  const basins = double ? 2 : 1;
  const bw = Math.min(w * (double ? 0.38 : 0.62), 0.75);
  const bd = d * 0.55;
  const bz = 0.02;
  const spacing = w / (basins + 1) * (double ? 1.1 : 1);
  const centers = basins === 1 ? [0] : [-spacing / 2 - 0.02, spacing / 2 + 0.02];
  // countertop as strips around basin holes
  const ty = ch - topT;
  const zf = bz + bd / 2, zb = bz - bd / 2;
  g.add(box(w, topT, d / 2 - zf, top, 0, ty, (zf + d / 2) / 2));
  g.add(box(w, topT, zb + d / 2, top, 0, ty, (zb - d / 2) / 2));
  const xs = [-w / 2, ...centers.flatMap((c) => [c - bw / 2, c + bw / 2]), w / 2];
  for (let i = 0; i < xs.length; i += 2) {
    const a = xs[i], b = xs[i + 1];
    if (b - a > 0.002) g.add(box(b - a, topT, bd, top, (a + b) / 2, ty, bz));
  }
  const bowl = kitchen ? M.steel() : M.ceramic();
  const depth = Math.min(0.18, ch * 0.22);
  for (const cx of centers) {
    const t = 0.01;
    g.add(box(bw, t, bd, bowl, cx, ch - depth, bz));
    g.add(box(bw, depth, t, bowl, cx, ch - depth, bz - bd / 2 + t / 2));
    g.add(box(bw, depth, t, bowl, cx, ch - depth, bz + bd / 2 - t / 2));
    g.add(box(t, depth, bd, bowl, cx - bw / 2 + t / 2, ch - depth, bz));
    g.add(box(t, depth, bd, bowl, cx + bw / 2 - t / 2, ch - depth, bz));
    g.add(cyl(0.025, 0.004, M.chrome(), cx, ch - depth + t, bz, 16));
    g.add(faucet(faucetH, cx, ch, zb - Math.min(0.05, (zb + d / 2) / 2), Math.min(0.18, bd * 0.4)));
  }
  return g;
}

export function planSink(w: number, d: number, double = false, faucetBack = true): PlanShape[] {
  const bw = Math.min(w * (double ? 0.38 : 0.62), 0.75);
  const bd = d * 0.55;
  const bz = 0.02;
  const spacing = w / 3 * 1.1;
  const centers = double ? [-spacing / 2 - 0.02, spacing / 2 + 0.02] : [0];
  const out: PlanShape[] = [P.rect(0, 0, w, d)];
  for (const cx of centers) {
    out.push(P.rect(cx, bz, bw, bd, 0.04), P.circle(cx, bz, 0.025));
    if (faucetBack) out.push(P.circle(cx, bz - bd / 2 - 0.035, 0.02));
  }
  return out;
}

function buildRange(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const body = color ? M.lacquer(color) : M.steel();
  const guard = Math.min(0.08, h * 0.08);
  const ct = h - guard; // cooktop height
  const hp = 0.03;
  g.add(box(w, ct - 0.01, d - hp, body, 0, 0, -hp / 2));
  g.add(box(w, 0.01, d - hp, M.screen(), 0, ct - 0.01, -hp / 2));
  g.add(box(w, guard, 0.03, body, 0, ct, -d / 2 + 0.015));
  // burners
  const bx = w * 0.23, bzf = (d - hp) * 0.2;
  for (const [x, z, r] of [[-bx, bzf, 0.08], [bx, bzf, 0.065], [-bx, -bzf - hp / 2, 0.065], [bx, -bzf - hp / 2, 0.08]] as const) {
    const s = Math.min(1, w / 0.6);
    g.add(ringFlat(r * s, 0.008, M.blackMetal(), x, ct + 0.004, z - hp / 2, 24));
    g.add(cyl(r * s * 0.45, 0.012, M.blackMetal(), x, ct - 0.004, z - hp / 2, 16));
  }
  // control panel + knobs
  const fz = d / 2 - hp;
  const panelH = Math.min(0.1, ct * 0.12);
  g.add(box(w - 0.02, panelH, 0.005, M.black(), 0, ct - panelH - 0.01, fz));
  const kn = Math.max(4, Math.round(w / 0.12));
  for (let i = 0; i < kn; i++) {
    const kx = -w / 2 + (w / kn) * (i + 0.5);
    const k = cyl(0.018, 0.022, M.chrome(), 0, 0, 0, 16);
    k.rotation.x = Math.PI / 2;
    k.position.set(kx, ct - panelH / 2 - 0.01, fz + 0.011);
    g.add(k);
  }
  // oven door
  const dh = (ct - panelH - 0.01) * 0.75;
  const dy = (ct - panelH - 0.01) - dh - 0.01;
  g.add(box(w - 0.02, dh, 0.01, M.black(), 0, dy, fz));
  g.add(box(w * 0.7, dh * 0.5, 0.004, M.glass(), 0, dy + dh * 0.25, fz + 0.007));
  g.add(handleH(w * 0.75, M.chrome(), 0, dy + dh - 0.05, fz));
  // drawer
  g.add(box(w - 0.02, dy - 0.02, 0.01, body, 0, 0.01, fz));
  return g;
}

function buildFridge(w: number, d: number, h: number, color?: string, sideBySide = false): THREE.Group {
  const g = new THREE.Group();
  const body = color ? M.lacquer(color) : M.steel();
  const hp = 0.04;
  g.add(rbox(w, h - 0.01, d - hp - 0.03, body, 0.02, 0, 0.01, -(hp + 0.03) / 2));
  const fz = d / 2 - hp - 0.015;
  const doorM = color ? M.lacquer(color) : M.steel();
  if (sideBySide) {
    for (const sx of [-1, 1]) {
      g.add(rbox(w / 2 - 0.006, h - 0.02, 0.03, doorM, 0.01, sx * w / 4, 0.015, fz));
      g.add(handleV(h * 0.5, M.chrome(), sx * 0.04, h * 0.55, fz + 0.015));
    }
    g.add(box(0.22, 0.32, 0.005, M.screen(), -w / 4, h * 0.55, fz + 0.016));
    return g;
  }
  const fh = h * 0.32;
  g.add(rbox(w - 0.006, fh - 0.006, 0.03, doorM, 0.01, 0, 0.01, fz));
  g.add(rbox(w - 0.006, h - fh - 0.016, 0.03, doorM, 0.01, 0, fh + 0.006, fz));
  g.add(handleV(Math.min(0.25, fh * 0.5), M.chrome(), w / 2 - 0.06, fh - 0.18, fz + 0.015));
  g.add(handleV(Math.min(0.5, (h - fh) * 0.4), M.chrome(), w / 2 - 0.06, fh + 0.35, fz + 0.015));
  return g;
}

export const kitchenItems: CatalogItem[] = [
  {
    id: 'kitchen-base-cabinet', name: 'Base cabinet', category: 'kitchen', tags: ['cabinet', 'base cabinet', 'cupboard', 'counter', 'drawer'],
    size: { w: 0.6, d: 0.62, h: 0.9 }, defaultColor: C.white,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), top: counterMat(), plinth: 0.1, drawers: 1, drawerZone: 0.2, doors: Math.max(1, Math.round(o.w / 0.6)) }),
    plan: (w, d) => planCabinet(w, d, Math.max(1, Math.round(w / 0.6))),
  },
  {
    id: 'kitchen-drawer-cabinet', name: 'Drawer cabinet', category: 'kitchen', tags: ['cabinet', 'drawers', 'base cabinet'],
    size: { w: 0.6, d: 0.62, h: 0.9 }, defaultColor: C.white,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), top: counterMat(), plinth: 0.1, drawers: 3 }),
    plan: (w, d) => planCabinet(w, d),
  },
  {
    id: 'kitchen-wall-cabinet', name: 'Wall cabinet', category: 'kitchen', tags: ['cabinet', 'wall cabinet', 'upper cabinet', 'cupboard'],
    size: { w: 0.6, d: 0.35, h: 0.72 }, elevation: 1.45, defaultColor: C.white,
    build: (o) => buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), doors: Math.max(1, Math.round(o.w / 0.5)), doorHandleV: true }),
    plan: (w, d) => [...planCabinet(w, d), P.line(-w / 2, -d / 2, w / 2, d / 2), P.line(-w / 2, d / 2, w / 2, -d / 2)],
  },
  {
    id: 'kitchen-sink-cabinet', name: 'Sink cabinet', category: 'kitchen', tags: ['sink', 'cabinet', 'basin', 'faucet', 'tap'],
    size: { w: 0.8, d: 0.62, h: 1.15 }, defaultColor: C.white,
    build: (o) => buildSinkCabinet(o.w, o.d, o.h, o.color),
    plan: (w, d) => planSink(w, d),
  },
  {
    id: 'stove', name: 'Stove / range', category: 'kitchen', tags: ['stove', 'range', 'cooker', 'oven', 'hob', 'cooktop'],
    size: { w: 0.6, d: 0.65, h: 0.95 },
    build: (o) => buildRange(o.w, o.d, o.h, o.color),
    plan: (w, d) => {
      const bx = w * 0.23, bz = d * 0.2;
      const s = Math.min(1, w / 0.6);
      return [P.rect(0, 0, w, d), P.rect(0, -d / 2 + 0.015, w, 0.03),
        P.circle(-bx, bz - 0.015, 0.08 * s), P.circle(bx, bz - 0.015, 0.065 * s),
        P.circle(-bx, -bz - 0.03, 0.065 * s), P.circle(bx, -bz - 0.03, 0.08 * s)];
    },
  },
  {
    id: 'cooktop', name: 'Cooktop (induction)', category: 'kitchen', tags: ['cooktop', 'hob', 'induction', 'stove'],
    size: { w: 0.6, d: 0.52, h: 0.01 }, elevation: 0.9,
    build: (o) => {
      const g = new THREE.Group();
      g.add(rbox(o.w, o.h, o.d, M.screen(), 0.004, 0, 0, 0));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0.01), P.circle(-w * 0.23, d * 0.2, 0.09), P.circle(w * 0.23, d * 0.2, 0.07), P.circle(-w * 0.23, -d * 0.2, 0.07), P.circle(w * 0.23, -d * 0.2, 0.09)],
  },
  {
    id: 'oven-tower', name: 'Oven tower (oven + microwave)', category: 'kitchen', tags: ['oven', 'microwave', 'tall cabinet', 'built-in'],
    size: { w: 0.6, d: 0.62, h: 2.1 }, defaultColor: C.white,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const body = M.lacquer(o.color ?? C.white);
      g.add(box(w - 0.02, 0.1, d - 0.08, M.matte(C.charcoal), 0, 0, -0.04));
      g.add(box(w, h - 0.1, d - 0.03, body, 0, 0.1, -0.015));
      const fz = d / 2 - 0.03;
      const ovenY = h * 0.38, ovenH = Math.min(0.6, h * 0.29);
      const mwY = ovenY + ovenH + 0.02, mwH = Math.min(0.38, h * 0.18);
      g.add(box(w - 0.02, ovenH, 0.012, M.black(), 0, ovenY, fz + 0.006));
      g.add(box(w * 0.7, ovenH * 0.5, 0.004, M.glass(), 0, ovenY + ovenH * 0.15, fz + 0.014));
      g.add(handleH(w * 0.7, M.chrome(), 0, ovenY + ovenH - 0.07, fz));
      g.add(box(w - 0.02, mwH, 0.012, M.black(), 0, mwY, fz + 0.006));
      g.add(box(w * 0.6, mwH * 0.6, 0.004, M.glass(), -w * 0.08, mwY + mwH * 0.2, fz + 0.014));
      // doors above / below
      g.add(box(w - 0.006, ovenY - 0.12, 0.018, body, 0, 0.105, fz));
      g.add(box(w - 0.006, h - (mwY + mwH) - 0.02, 0.018, body, 0, mwY + mwH + 0.015, fz));
      g.add(handleH(Math.min(0.3, w * 0.4), M.steel(), 0, ovenY - 0.08, fz));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(-w / 2, -d / 2, w / 2, d / 2), P.line(-w / 2, d / 2, w / 2, -d / 2)],
  },
  {
    id: 'microwave', name: 'Microwave', category: 'kitchen', tags: ['microwave', 'appliance'],
    size: { w: 0.5, d: 0.38, h: 0.3 }, elevation: 0.9,
    build: (o) => {
      const g = new THREE.Group();
      g.add(rbox(o.w, o.h, o.d - 0.01, M.lacquer(o.color ?? C.charcoal), 0.015, 0, 0, -0.005));
      g.add(box(o.w * 0.62, o.h * 0.7, 0.01, M.screen(), -o.w * 0.12, o.h * 0.15, o.d / 2 - 0.01));
      g.add(box(o.w * 0.18, o.h * 0.7, 0.01, M.steel(), o.w * 0.33, o.h * 0.15, o.d / 2 - 0.01));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0.01)],
  },
  {
    id: 'fridge', name: 'Fridge-freezer', category: 'kitchen', tags: ['fridge', 'refrigerator', 'freezer', 'appliance'],
    size: { w: 0.7, d: 0.72, h: 1.85 },
    build: (o) => buildFridge(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.rect(0, 0, w, d, 0.02), P.line(-w / 2, d / 2 - 0.06, w / 2, d / 2 - 0.06), P.line(-w / 2, -d / 2, w / 2, d / 2 - 0.06)],
  },
  {
    id: 'fridge-side-by-side', name: 'Fridge, side-by-side', category: 'kitchen', tags: ['fridge', 'refrigerator', 'american', 'side by side', 'appliance'],
    size: { w: 0.91, d: 0.75, h: 1.78 },
    build: (o) => buildFridge(o.w, o.d, o.h, o.color, true),
    plan: (w, d) => [P.rect(0, 0, w, d, 0.02), P.line(-w / 2, d / 2 - 0.06, w / 2, d / 2 - 0.06), P.line(0, -d / 2, 0, d / 2 - 0.06)],
  },
  {
    id: 'dishwasher', name: 'Dishwasher', category: 'kitchen', tags: ['dishwasher', 'appliance'],
    size: { w: 0.6, d: 0.62, h: 0.9 },
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      g.add(box(w, h - 0.03, d - 0.05, M.steel(), 0, 0, -0.025));
      g.add(box(w, 0.03, d, counterMat(), 0, h - 0.03, 0));
      const fz = d / 2 - 0.03 - 0.01;
      g.add(box(w - 0.006, h - 0.13, 0.02, o.color ? M.lacquer(o.color) : M.steel(), 0, 0.1, fz));
      g.add(box(w - 0.006, 0.07, 0.02, M.black(), 0, h - 0.11, fz));
      g.add(handleH(w * 0.6, M.chrome(), 0, h - 0.17, fz + 0.01));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(-w / 2, -d / 2, w / 2, d / 2), P.line(-w / 2, d / 2, w / 2, -d / 2)],
  },
  {
    id: 'kitchen-island', name: 'Kitchen island', category: 'kitchen', tags: ['island', 'counter', 'breakfast bar', 'cabinet'],
    size: { w: 2.0, d: 1.0, h: 0.92 }, defaultColor: C.sage,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const ov = Math.min(0.3, d * 0.3);
      const body = buildCabinet(w - 0.04, d - ov - 0.02, h - 0.04, { body: M.lacquer(o.color ?? C.sage), plinth: 0.1, drawers: 1, drawerZone: 0.22, doors: Math.max(2, Math.round(w / 0.6)) });
      // cabinet fronts face -Z (kitchen side), overhang/seating at +Z
      body.rotation.y = Math.PI;
      body.position.z = -d / 2 + (d - ov - 0.02) / 2 + 0.0;
      g.add(body);
      g.add(box(w, 0.04, d, counterMat(), 0, h - 0.04, 0));
      return g;
    },
    plan: (w, d) => {
      const ov = Math.min(0.3, d * 0.3);
      return [P.rect(0, 0, w, d), P.line(-w / 2 + 0.02, d / 2 - ov, w / 2 - 0.02, d / 2 - ov), P.rect(0, -d / 2 + (d - ov) / 2, w - 0.04, d - ov - 0.02)];
    },
  },
  {
    id: 'bar-stool', name: 'Bar stool', category: 'kitchen', tags: ['stool', 'bar stool', 'counter stool', 'seat'],
    size: { w: 0.42, d: 0.42, h: 0.75 }, defaultColor: C.walnut,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const r = Math.min(w, d) / 2;
      const seat = cyl(r, 0.05, M.wood(o.color ?? C.walnut), 0, h - 0.05, 0, 24);
      g.add(seat);
      const legM = M.blackMetal();
      const lp = r * 0.72;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        const x = Math.cos(a) * lp, z = Math.sin(a) * lp;
        g.add(cyl(0.012, h - 0.05, legM, x, 0, z, 10));
      }
      g.add(ringFlat(lp, 0.008, legM, 0, h * 0.3, 0, 24));
      return fitXZ(g, w, d);
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2)],
  },
  {
    id: 'range-hood', name: 'Range hood', category: 'kitchen', tags: ['hood', 'extractor', 'range hood', 'vent'],
    size: { w: 0.9, d: 0.5, h: 0.9 }, elevation: 1.55,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const m = o.color ? M.lacquer(o.color) : M.steel();
      const ch = Math.min(0.25, h * 0.3);
      g.add(box(w, 0.05, d, m, 0, 0, 0));
      const dw = Math.min(0.28, w * 0.32), dd = Math.min(0.25, d * 0.5);
      g.add(frustum(w, d, dw, dd, ch - 0.05, m, 0, 0.05, 0, 0, -d / 2 + dd / 2));
      g.add(box(dw, h - ch, dd, m, 0, ch, -d / 2 + dd / 2));
      g.add(box(w * 0.6, 0.003, d * 0.6, M.blackMetal(), 0, -0.0, 0));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(-w / 2, -d / 2, w / 2, d / 2), P.line(-w / 2, d / 2, w / 2, -d / 2)],
  },
];

