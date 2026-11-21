import * as THREE from 'three';
import type { CatalogItem, PlanShape } from '../types';
import {
  C, M, P, mat, box, rbox, cyl, cone, sphere, mesh, rod, rodX, ringFlat, frustum,
  fitToBox, fitXZ, sideProfile, clamp, rng,
} from '../materials';
import { buildChair, planChair } from '../parts';
import { buildDiningSet, planDiningSet } from './dining';

/* ---------------------------- vegetation ---------------------------- */

function blob(r: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const me = mesh(new THREE.IcosahedronGeometry(r, 1), m);
  me.position.set(x, y, z);
  return me;
}

function buildDeciduous(w: number, d: number, h: number, color?: string): THREE.Object3D {
  const g = new THREE.Group();
  const bark = M.bark();
  g.add(cyl(0.22, 2.2, bark, 0, 0, 0, 10, 0.14));
  g.add(rod(new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0.7, 2.8, 0.2), 0.08, bark, 6));
  g.add(rod(new THREE.Vector3(0, 1.9, 0), new THREE.Vector3(-0.6, 2.9, -0.3), 0.08, bark, 6));
  const leaf = M.leaf(color ?? C.leaf);
  const leaf2 = M.leaf(C.leafDark);
  const r = rng(21);
  g.add(blob(1.4, leaf, 0, 3.6, 0));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.4;
    const rr = 0.9 + r() * 0.3;
    g.add(blob(0.8 + r() * 0.35, i % 2 ? leaf : leaf2, Math.cos(a) * rr, 3.2 + r() * 0.9, Math.sin(a) * rr));
  }
  g.add(blob(0.9, leaf2, 0.2, 4.5, -0.1));
  return fitToBox(g, w, d, h);
}

function buildConifer(w: number, d: number, h: number, color?: string): THREE.Object3D {
  const g = new THREE.Group();
  g.add(cyl(0.15, 1.0, M.bark(), 0, 0, 0, 8, 0.1));
  const leaf = M.leaf(color ?? '#3f6b47');
  const leaf2 = M.leaf('#355c3c');
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = 1.25 * (1 - t * 0.78);
    g.add(cone(r, 1.7 - t * 0.5, i % 2 ? leaf : leaf2, 0, 0.6 + i * 0.95, 0, 10));
  }
  return fitToBox(g, w, d, h);
}

function buildBush(w: number, d: number, h: number, color?: string, seed = 4): THREE.Object3D {
  const g = new THREE.Group();
  const leaf = M.leaf(color ?? C.leaf);
  const leaf2 = M.leaf(C.leafDark);
  const r = rng(seed);
  g.add(blob(0.5, leaf, 0, 0.5, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r() * 0.5;
    g.add(blob(0.3 + r() * 0.12, i % 2 ? leaf2 : leaf, Math.cos(a) * 0.38, 0.32 + r() * 0.25, Math.sin(a) * 0.38));
  }
  return fitToBox(g, w, d, h);
}

function planTree(w: number, d: number, conifer = false): PlanShape[] {
  const r = Math.min(w, d) / 2;
  const out: PlanShape[] = [];
  if (conifer) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = i % 2 ? r * 0.8 : r;
      pts.push([Math.cos(a) * rr * (w / 2 / r), Math.sin(a) * rr * (d / 2 / r)]);
    }
    out.push(P.poly(pts));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out.push(P.line(0, 0, Math.cos(a) * w * 0.4, Math.sin(a) * d * 0.4));
    }
  } else {
    // scalloped canopy
    const n = 9;
    let dd = '';
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * w * 0.47, y = Math.sin(a) * d * 0.47;
      dd += i === 0 ? `M${x.toFixed(3)} ${y.toFixed(3)}` : ` A${(w * 0.17).toFixed(3)} ${(d * 0.17).toFixed(3)} 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)}`;
    }
    out.push(P.path(dd + ' Z'));
    out.push(P.circle(0, 0, r * 0.55));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      out.push(P.line(Math.cos(a) * r * 0.1, Math.sin(a) * r * 0.1, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5));
    }
  }
  out.push(P.circle(0, 0, Math.max(0.05, r * 0.08), true));
  return out;
}

/* ---------------------------- garden structures ---------------------------- */

function buildFence(w: number, d: number, h: number, color?: string, gate = false): THREE.Group {
  const g = new THREE.Group();
  const wood = M.wood(color ?? '#b89a78');
  const post = Math.min(0.09, w * 0.1);
  g.add(box(post, h, d, wood, -w / 2 + post / 2, 0, 0));
  g.add(box(post, h, d, wood, w / 2 - post / 2, 0, 0));
  const innerW = w - 2 * post;
  const railD = Math.min(0.03, d * 0.4);
  if (gate) {
    const gw = innerW - 0.02;
    const fr = 0.05;
    const fz = d / 2 - railD / 2 - 0.0;
    g.add(box(gw, fr, railD, wood, 0, 0.08, fz - railD / 2));
    g.add(box(gw, fr, railD, wood, 0, h - 0.1 - fr, fz - railD / 2));
    const n = Math.max(4, Math.round(gw / 0.11));
    const bw = gw / n;
    for (let i = 0; i < n; i++) g.add(box(bw - 0.012, h - 0.12, railD * 0.8, wood, -gw / 2 + bw * (i + 0.5), 0.06, -d / 2 + railD * 0.4 + 0.002));
    const a = new THREE.Vector3(-gw / 2 + 0.05, 0.13, fz - railD / 2);
    const b = new THREE.Vector3(gw / 2 - 0.05, h - 0.15, fz - railD / 2);
    g.add(rod(a, b, 0.018, wood, 6));
    // latch + hinges
    g.add(box(0.04, 0.12, 0.02, M.blackMetal(), gw / 2 - 0.06, h * 0.55, d / 2 - 0.01));
    for (const y of [0.2, h - 0.3]) g.add(box(0.15, 0.03, 0.01, M.blackMetal(), -gw / 2 + 0.08, y, d / 2 - 0.005));
    return g;
  }
  g.add(box(innerW, 0.07, railD, wood, 0, h * 0.18, -d / 2 + railD / 2));
  g.add(box(innerW, 0.07, railD, wood, 0, h * 0.78, -d / 2 + railD / 2));
  const n = Math.max(3, Math.round(innerW / 0.12));
  const bw = innerW / n;
  for (let i = 0; i < n; i++) {
    const pb = box(bw - 0.025, h - 0.06, railD, wood, -innerW / 2 + bw * (i + 0.5), 0.03, -d / 2 + railD * 1.5);
    g.add(pb);
  }
  return g;
}

function buildShed(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const wall = M.wood(color ?? '#8fa39a');
  const trim = M.lacquer(C.white);
  const roof = M.matte('#4a4d52');
  const ov = Math.min(0.12, w * 0.05);
  const wallH = h * 0.68;
  const iw = w - 2 * ov, id = d - 2 * ov;
  g.add(box(iw + 0.04, 0.1, id + 0.04, M.concrete(), 0, 0, 0));
  g.add(box(iw, wallH - 0.1, id, wall, 0, 0.1, 0));
  // gable roof as an extruded triangle across the depth (ridge along Z)
  const s = new THREE.Shape();
  const rt = 0.06;
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h - wallH);
  s.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  roofGeo.translate(0, wallH, -d / 2);
  g.add(mesh(roofGeo, roof));
  const s2 = new THREE.Shape();
  s2.moveTo(-iw / 2, 0);
  s2.lineTo(iw / 2, 0);
  s2.lineTo(0, (h - wallH) * (iw / w) - rt);
  s2.closePath();
  const gable = new THREE.ExtrudeGeometry(s2, { depth: id, bevelEnabled: false });
  gable.translate(0, wallH - 0.001, -id / 2);
  g.add(mesh(gable, wall));
  // door (front, +Z)
  const dw = Math.min(0.9, iw * 0.4), dh = Math.min(1.9, wallH - 0.25);
  const fz = id / 2;
  g.add(box(dw + 0.1, dh + 0.06, 0.03, trim, -iw * 0.15, 0.1, fz + 0.015));
  g.add(box(dw, dh, 0.035, M.wood(C.walnut), -iw * 0.15, 0.1, fz + 0.02));
  g.add(sphere(0.025, M.blackMetal(), -iw * 0.15 + dw / 2 - 0.08, 0.1 + dh * 0.5, fz + 0.05, 8));
  // window
  const ww = Math.min(0.6, iw * 0.25), wh = Math.min(0.5, wallH * 0.25);
  g.add(box(ww + 0.08, wh + 0.08, 0.03, trim, iw * 0.25, wallH * 0.5, fz + 0.015));
  g.add(box(ww, wh, 0.035, M.glass(), iw * 0.25, wallH * 0.5 + 0.04, fz + 0.02));
  // corner trims
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.06, wallH - 0.1, 0.06, trim, sx * (iw / 2 - 0.02), 0.1, sz * (id / 2 - 0.02)));
  return g;
}

/* ---------------------------- pool & leisure ---------------------------- */

function buildPool(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const c = clamp(Math.min(w, d) * 0.06, 0.2, 0.4);
  const coping = M.stone('#e4dfd5');
  g.add(box(w, h, c, coping, 0, 0, -d / 2 + c / 2));
  g.add(box(w, h, c, coping, 0, 0, d / 2 - c / 2));
  g.add(box(c, h, d - 2 * c, coping, -w / 2 + c / 2, 0, 0));
  g.add(box(c, h, d - 2 * c, coping, w / 2 - c / 2, 0, 0));
  const iw = w - 2 * c, id = d - 2 * c;
  g.add(box(iw, 0.005, id, M.matte('#1f6f9a'), 0, 0, 0));
  // inner "walls" band, darker at the edges for a sunk look
  const band = mat('#2b86b4', { roughness: 0.6 });
  g.add(box(iw, h * 0.5, 0.04, band, 0, 0, -id / 2 + 0.02));
  g.add(box(iw, h * 0.5, 0.04, band, 0, 0, id / 2 - 0.02));
  g.add(box(0.04, h * 0.5, id, band, -iw / 2 + 0.02, 0, 0));
  g.add(box(0.04, h * 0.5, id, band, iw / 2 - 0.02, 0, 0));
  // steps in the near-right corner
  const sw = Math.min(1.2, iw * 0.25);
  for (let i = 0; i < 3; i++) g.add(box(sw, 0.004, 0.3, M.matte('#8fd0ea'), iw / 2 - sw / 2, 0.006 + i * 0.002, id / 2 - 0.15 - i * 0.3));
  g.add(box(iw, 0.01, id, M.water(), 0, h * 0.62, 0).translateY(0));
  if (color) g.add(box(iw, 0.002, id, mat(color, { opacity: 0.25, roughness: 0.1 }), 0, h * 0.62 + 0.01, 0));
  return g;
}

/* ---------------------------- items ---------------------------- */

export const outdoorItems: CatalogItem[] = [
  {
    id: 'tree-deciduous', name: 'Tree, deciduous', category: 'outdoor', tags: ['tree', 'oak', 'maple', 'garden', 'deciduous'], outdoor: true,
    size: { w: 4, d: 4, h: 6 }, defaultColor: C.leaf,
    build: (o) => buildDeciduous(o.w, o.d, o.h, o.color), plan: (w, d) => planTree(w, d),
  },
  {
    id: 'tree-conifer', name: 'Tree, conifer', category: 'outdoor', tags: ['tree', 'pine', 'fir', 'spruce', 'conifer', 'evergreen'], outdoor: true,
    size: { w: 2.6, d: 2.6, h: 6 }, defaultColor: '#3f6b47',
    build: (o) => buildConifer(o.w, o.d, o.h, o.color), plan: (w, d) => planTree(w, d, true),
  },
  {
    id: 'bush', name: 'Bush / shrub', category: 'outdoor', tags: ['bush', 'shrub', 'plant', 'garden'], outdoor: true,
    size: { w: 1.0, d: 1.0, h: 0.9 }, defaultColor: C.leaf,
    build: (o) => buildBush(o.w, o.d, o.h, o.color), plan: (w, d) => planTree(w, d),
  },
  {
    id: 'hedge', name: 'Hedge', category: 'outdoor', tags: ['hedge', 'bush', 'boxwood', 'garden', 'border'], outdoor: true,
    size: { w: 2.0, d: 0.6, h: 1.2 }, defaultColor: '#4f7d45',
    build: (o) => {
      const g = new THREE.Group();
      g.add(rbox(o.w, o.h, o.d, M.leaf(o.color ?? '#4f7d45'), Math.min(0.12, o.d / 3), 0, 0, 0, 2));
      return g;
    },
    plan: (w, d) => {
      const out: PlanShape[] = [P.rect(0, 0, w, d, Math.min(0.12, d / 3))];
      const n = Math.max(2, Math.round(w / 0.5));
      for (let i = 0; i < n; i++) out.push(P.circle(-w / 2 + (w / n) * (i + 0.5), 0, Math.min(d, w / n) * 0.35));
      return out;
    },
  },
  {
    id: 'flower-bed', name: 'Raised flower bed', category: 'outdoor', tags: ['flower', 'bed', 'planter', 'garden', 'raised bed'], outdoor: true,
    size: { w: 1.5, d: 0.6, h: 0.5 },
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const wood = M.wood('#9c7a5b');
      const t = 0.04;
      const bh = h * 0.55;
      g.add(box(w, bh, t, wood, 0, 0, -d / 2 + t / 2));
      g.add(box(w, bh, t, wood, 0, 0, d / 2 - t / 2));
      g.add(box(t, bh, d - 2 * t, wood, -w / 2 + t / 2, 0, 0));
      g.add(box(t, bh, d - 2 * t, wood, w / 2 - t / 2, 0, 0));
      g.add(box(w - 2 * t, bh - 0.04, d - 2 * t, M.soil(), 0, 0, 0));
      const r = rng(13);
      const cols = [o.color ?? '#e76f8a', '#f2c14e', '#ffffff', '#b07cc6', '#f08a4b'];
      const n = Math.max(6, Math.round(w * d * 40));
      const fh = h - bh;
      for (let i = 0; i < n; i++) {
        const x = (r() - 0.5) * (w - 2 * t - 0.08);
        const z = (r() - 0.5) * (d - 2 * t - 0.08);
        const sh = fh * (0.5 + r() * 0.4);
        g.add(cyl(0.006, sh, M.leaf(), x, bh - 0.04, z, 5));
        g.add(sphere(Math.min(0.045, fh * 0.2), M.matte(cols[i % cols.length]), x, Math.min(h - 0.045, bh - 0.04 + sh), z, 8));
      }
      for (let i = 0; i < n / 2; i++) {
        g.add(sphere(0.05, M.leaf(), (r() - 0.5) * (w - 0.2), bh - 0.02, (r() - 0.5) * (d - 0.2), 6));
      }
      return g;
    },
    plan: (w, d) => {
      const out: PlanShape[] = [P.rect(0, 0, w, d), P.rect(0, 0, w - 0.08, d - 0.08)];
      const r = rng(13);
      for (let i = 0; i < Math.max(4, Math.round(w * d * 12)); i++) out.push(P.circle((r() - 0.5) * (w - 0.2), (r() - 0.5) * (d - 0.2), 0.04));
      return out;
    },
  },
  {
    id: 'fence', name: 'Fence segment', category: 'outdoor', tags: ['fence', 'picket', 'boundary', 'garden'], outdoor: true,
    size: { w: 2.0, d: 0.09, h: 1.2 }, defaultColor: '#b89a78',
    build: (o) => buildFence(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.rect(0, 0, w, d), P.rect(-w / 2 + Math.min(0.09, d) / 2, 0, Math.min(0.09, d), d, 0, true), P.rect(w / 2 - Math.min(0.09, d) / 2, 0, Math.min(0.09, d), d, 0, true)],
  },
  {
    id: 'gate', name: 'Garden gate', category: 'outdoor', tags: ['gate', 'fence', 'garden', 'entry'], outdoor: true,
    size: { w: 1.1, d: 0.09, h: 1.2 }, defaultColor: '#b89a78',
    build: (o) => buildFence(o.w, o.d, o.h, o.color, true),
    plan: (w, d) => {
      const p = Math.min(0.09, d);
      const gw = w - 2 * p;
      return [P.rect(-w / 2 + p / 2, 0, p, d, 0, true), P.rect(w / 2 - p / 2, 0, p, d, 0, true), P.line(-gw / 2, 0, gw / 2, 0), P.poly([[-gw / 2, 0], [-gw / 2, gw]], false), P.arc(-gw / 2, 0, gw, 0, Math.PI / 2)];
    },
  },
  {
    id: 'lawn-chair', name: 'Garden chair', category: 'outdoor', tags: ['chair', 'garden chair', 'lawn chair', 'patio'], outdoor: true,
    size: { w: 0.6, d: 0.62, h: 0.88 }, defaultColor: '#e8e4da',
    build: (o) => buildChair(o.w, o.d, o.h, { wood: o.color ?? '#e8e4da', arms: true }),
    plan: (w, d) => planChair(0, 0, w, d),
  },
  {
    id: 'outdoor-dining-set', name: 'Outdoor dining set', category: 'outdoor', tags: ['table', 'chairs', 'patio', 'garden', 'dining', 'set'], outdoor: true,
    size: { w: 1.8, d: 1.8, h: 0.86 },
    build: (o) => buildDiningSet(o.w, o.d, o.h, 'round4', o.color, true),
    plan: (w, d) => planDiningSet(w, d, 'round4'),
  },
  {
    id: 'sun-lounger', name: 'Sun lounger', category: 'outdoor', tags: ['lounger', 'deck chair', 'sunbed', 'chaise', 'pool'], outdoor: true,
    size: { w: 0.7, d: 2.0, h: 0.85 }, defaultColor: C.white,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const frame = M.wood('#a8825e');
      const s = Math.min(0.3, h * 0.36);
      g.add(legs4(w, d, s - 0.04, frame));
      g.add(box(w, 0.04, d, frame, 0, s - 0.04, 0));
      const ct = 0.07;
      const zb = -d / 2 + d * 0.32;
      g.add(sideProfile([[d / 2, s], [d / 2, s + ct], [zb, s + ct], [-d / 2 + 0.13, h], [-d / 2, h - 0.06], [zb - 0.18, s]], w - 0.04, M.fabric(o.color ?? C.white)));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0.04), P.rect(0, -d / 2 + d * 0.16, w - 0.06, d * 0.3, 0.04), P.line(-w / 2, -d / 2 + d * 0.32, w / 2, -d / 2 + d * 0.32)],
  },
  {
    id: 'parasol', name: 'Parasol / umbrella', category: 'outdoor', tags: ['parasol', 'umbrella', 'shade', 'patio'], outdoor: true,
    size: { w: 2.7, d: 2.7, h: 2.5 }, defaultColor: C.linen,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const R = 0.5;
      g.add(cyl(0.22, 0.08, M.concrete(), 0, 0, 0, 20));
      g.add(cyl(0.022, h - 0.06, M.wood('#a8825e'), 0, 0.06, 0, 10));
      const ch = Math.min(0.6, h * 0.22);
      const canopy = mesh(new THREE.ConeGeometry(R, ch, 8, 1, true), mat(o.color ?? C.linen, { roughness: 0.9, doubleSide: true }));
      canopy.position.y = h - 0.06 - ch / 2;
      canopy.scale.set(w / (2 * R), 1, d / (2 * R));
      g.add(canopy);
      g.add(sphere(0.035, M.wood('#a8825e'), 0, h - 0.035, 0, 8));
      return g;
    },
    plan: (w, d) => {
      const pts: [number, number][] = [];
      const out: PlanShape[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push([Math.cos(a) * w / 2, Math.sin(a) * d / 2]);
        out.push(P.line(0, 0, Math.cos(a) * w / 2, Math.sin(a) * d / 2));
      }
      out.unshift(P.poly(pts));
      return out;
    },
  },
  {
    id: 'bbq', name: 'Gas barbecue grill', category: 'outdoor', tags: ['bbq', 'barbecue', 'grill', 'patio'], outdoor: true,
    size: { w: 1.25, d: 0.58, h: 1.15 }, defaultColor: C.charcoal,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const body = M.lacquer(o.color ?? C.charcoal);
      const steel = M.steel();
      const cw = w * 0.55;
      const top = h * 0.78;
      const cartH = top - 0.18;
      const hp = 0.03;
      g.add(box(cw, cartH - 0.08, d - hp, body, 0, 0.08, -hp / 2));
      for (const sx of [-1, 1]) {
        const wh = cyl(0.08, 0.03, M.black(), 0, 0, 0, 16);
        wh.rotation.z = Math.PI / 2;
        wh.position.set(sx * (cw / 2 - 0.05), 0.08, -d * 0.25);
        g.add(wh);
      }
      g.add(box(0.03, 0.08, 0.03, body, -cw / 2 + 0.05, 0, d * 0.25));
      g.add(box(0.03, 0.08, 0.03, body, cw / 2 - 0.05, 0, d * 0.25));
      // firebox
      g.add(box(cw, 0.18, d - hp, steel, 0, cartH, -hp / 2));
      // hood (half cylinder along X)
      const hr = Math.min((d - hp) / 2, h - top);
      const hood = mesh(new THREE.CylinderGeometry(hr, hr, cw, 18, 1, false, 0, Math.PI), steel);
      hood.rotation.z = Math.PI / 2;
      hood.position.set(0, top, -hp / 2);
      g.add(hood);
      g.add(rodX(cw * 0.7, 0.012, M.chrome(), 0, top + hr * 0.55, d / 2 - 0.012));
      // side shelves
      const sw = (w - cw) / 2;
      for (const sx of [-1, 1]) g.add(box(sw, 0.025, d * 0.75, steel, sx * (cw / 2 + sw / 2), top - 0.03, 0));
      // knobs
      for (let i = 0; i < 4; i++) {
        const k = cyl(0.02, 0.02, M.black(), 0, 0, 0, 12);
        k.rotation.x = Math.PI / 2;
        k.position.set(-cw / 2 + (cw / 4) * (i + 0.5), cartH + 0.09, d / 2 - hp + 0.01);
        g.add(k);
      }
      return g;
    },
    plan: (w, d) => {
      const cw = w * 0.55;
      return [P.rect(0, 0, cw, d - 0.04), P.rect(-(cw / 2 + (w - cw) / 4), 0, (w - cw) / 2, d * 0.75), P.rect(cw / 2 + (w - cw) / 4, 0, (w - cw) / 2, d * 0.75),
        P.line(-cw / 2 + 0.05, -d * 0.2, cw / 2 - 0.05, -d * 0.2), P.line(-cw / 2 + 0.05, 0, cw / 2 - 0.05, 0), P.line(-cw / 2 + 0.05, d * 0.2, cw / 2 - 0.05, d * 0.2)];
    },
  },
  {
    id: 'swimming-pool', name: 'Swimming pool', category: 'outdoor', tags: ['pool', 'swimming pool', 'water', 'garden'], outdoor: true,
    size: { w: 8, d: 4, h: 0.08 },
    build: (o) => buildPool(o.w, o.d, o.h, o.color),
    plan: (w, d) => {
      const c = clamp(Math.min(w, d) * 0.06, 0.2, 0.4);
      const iw = w - 2 * c, id = d - 2 * c;
      const sw = Math.min(1.2, iw * 0.25);
      const out: PlanShape[] = [P.rect(0, 0, w, d), P.rect(0, 0, iw, id, 0, false)];
      for (let i = 1; i <= 3; i++) out.push(P.line(iw / 2 - sw, id / 2 - 0.3 * i, iw / 2, id / 2 - 0.3 * i));
      out.push(P.line(iw / 2 - sw, id / 2, iw / 2 - sw, id / 2 - 0.9));
      out.push(P.line(-iw / 2 + 0.5, 0, iw / 2 - 0.5, 0));
      return out;
    },
  },
  {
    id: 'hot-tub', name: 'Hot tub / spa', category: 'outdoor', tags: ['hot tub', 'spa', 'jacuzzi', 'whirlpool'], outdoor: true,
    size: { w: 2.1, d: 2.1, h: 0.9 }, defaultColor: '#6b5a4c',
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const shell = M.wood(o.color ?? '#6b5a4c');
      const rim = M.lacquer('#d9d6d0');
      const t = Math.min(0.15, Math.min(w, d) * 0.08);
      g.add(rbox(w, h - 0.04, t, shell, 0.03, 0, 0, -d / 2 + t / 2));
      g.add(rbox(w, h - 0.04, t, shell, 0.03, 0, 0, d / 2 - t / 2));
      g.add(rbox(t, h - 0.04, d - 2 * t + 0.04, shell, 0.03, -w / 2 + t / 2, 0, 0));
      g.add(rbox(t, h - 0.04, d - 2 * t + 0.04, shell, 0.03, w / 2 - t / 2, 0, 0));
      // rim
      g.add(rbox(w, 0.04, t + 0.01, rim, 0.015, 0, h - 0.04, -d / 2 + t / 2));
      g.add(rbox(w, 0.04, t + 0.01, rim, 0.015, 0, h - 0.04, d / 2 - t / 2));
      g.add(rbox(t + 0.01, 0.04, d, rim, 0.015, -w / 2 + t / 2, h - 0.04, 0));
      g.add(rbox(t + 0.01, 0.04, d, rim, 0.015, w / 2 - t / 2, h - 0.04, 0));
      const iw = w - 2 * t, id = d - 2 * t;
      g.add(box(iw, h * 0.45, id, rim, 0, 0, 0));
      // bench seats around
      const bw = Math.min(0.45, iw * 0.25);
      g.add(box(iw, h * 0.15, bw, rim, 0, h * 0.45, -id / 2 + bw / 2));
      g.add(box(bw, h * 0.15, id - bw, rim, -iw / 2 + bw / 2, h * 0.45, bw / 2));
      g.add(box(iw - 0.002, 0.02, id - 0.002, M.water(), 0, h - 0.16, 0));
      return g;
    },
    plan: (w, d) => {
      const t = Math.min(0.15, Math.min(w, d) * 0.08);
      const iw = w - 2 * t, id = d - 2 * t;
      const bw = Math.min(0.45, iw * 0.25);
      return [P.rect(0, 0, w, d, 0.06), P.rect(0, 0, iw, id, 0.03), P.line(-iw / 2, -id / 2 + bw, iw / 2, -id / 2 + bw), P.line(-iw / 2 + bw, -id / 2 + bw, -iw / 2 + bw, id / 2)];
    },
  },
  {
    id: 'trampoline', name: 'Trampoline', category: 'outdoor', tags: ['trampoline', 'kids', 'play', 'garden'], outdoor: true,
    size: { w: 3.05, d: 3.05, h: 2.6 },
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const R = 1;
      const y = Math.min(0.85, h * 0.33);
      const metal = M.steel();
      const net = mat('#222222', { opacity: 0.22, doubleSide: true, roughness: 0.9 });
      const tube = 0.03;
      const Ri = R - tube;
      g.add(ringFlat(Ri, tube, metal, 0, y, 0, 48));
      g.add(ringFlat(Ri - 0.05, 0.05, M.plastic('#3d7cc9'), 0, y + 0.02, 0, 48));
      const matD = cyl(Ri - 0.12, 0.01, M.black(), 0, y, 0, 40);
      g.add(matD);
      const posts = 6;
      for (let i = 0; i < posts; i++) {
        const a = (i / posts) * Math.PI * 2;
        const x = Math.cos(a) * Ri, z = Math.sin(a) * Ri;
        g.add(cyl(0.025, y, metal, x, 0, z, 10));
        g.add(cyl(0.02, h - y - 0.02, M.black(), x * 0.98, y, z * 0.98, 10));
      }
      const netM = mesh(new THREE.CylinderGeometry(Ri * 0.98, Ri * 0.98, h - y - 0.05, 36, 1, true), net);
      netM.position.y = y + (h - y - 0.05) / 2;
      g.add(netM);
      g.add(ringFlat(Ri * 0.98, 0.02, M.black(), 0, h - 0.02, 0, 48));
      g.scale.set(w / 2, 1, d / 2);
      return g;
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) / 2 - 0.15)],
  },
  {
    id: 'garden-shed', name: 'Garden shed', category: 'outdoor', tags: ['shed', 'garden', 'storage', 'outbuilding', 'cabin'], outdoor: true,
    size: { w: 2.4, d: 1.8, h: 2.3 }, defaultColor: '#8fa39a',
    build: (o) => buildShed(o.w, o.d, o.h, o.color),
    plan: (w, d) => {
      const ov = Math.min(0.12, w * 0.05);
      const iw = w - 2 * ov, id = d - 2 * ov;
      const dw = Math.min(0.9, iw * 0.4);
      return [P.rect(0, 0, iw, id, 0, false), P.line(0, -d / 2, 0, d / 2), P.rect(0, 0, w, d), P.poly([[-iw * 0.15 - dw / 2, id / 2], [-iw * 0.15 - dw / 2, id / 2 + dw]], false), P.arc(-iw * 0.15 - dw / 2, id / 2, dw, 0, Math.PI / 2)];
    },
  },
  {
    id: 'mailbox', name: 'Mailbox', category: 'outdoor', tags: ['mailbox', 'letterbox', 'post'], outdoor: true,
    size: { w: 0.25, d: 0.5, h: 1.2 }, defaultColor: C.charcoal,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const m = M.lacquer(o.color ?? C.charcoal);
      const bh = Math.min(0.3, h * 0.25);
      const r = w / 2;
      g.add(box(0.08, h - bh, 0.08, M.wood('#9c7a5b'), 0, 0, -d * 0.1));
      g.add(box(w, bh - r, d, m, 0, h - bh, 0));
      const top = mesh(new THREE.CylinderGeometry(r, r, d, 16, 1, false, -Math.PI / 2, Math.PI), m);
      top.rotation.x = -Math.PI / 2;
      top.position.set(0, h - r, 0);
      g.add(top);
      g.add(box(0.02, 0.15, 0.05, M.plastic('#c0392b'), w / 2 - 0.0, h - bh, -d * 0.2).translateX(-0.01));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0.04), P.rect(0, -d * 0.1, 0.08, 0.08)],
  },
  {
    id: 'lamp-post', name: 'Lamp post', category: 'outdoor', tags: ['lamp', 'light', 'post', 'street light', 'garden light'], outdoor: true, light: true,
    size: { w: 0.35, d: 0.35, h: 3.0 }, defaultColor: C.black,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const m = M.lacquer(o.color ?? '#26282b');
      const r = Math.min(w, d) / 2;
      g.add(cyl(r * 0.6, 0.3, m, 0, 0, 0, 16, r * 0.45));
      g.add(cyl(0.04, h - 0.6, m, 0, 0.3, 0, 12));
      const lh = 0.45;
      g.add(frustum(r * 1.1, r * 1.1, r * 1.4, r * 1.4, lh * 0.1, m, 0, h - lh - 0.05));
      g.add(box(r * 1.2, lh * 0.75, r * 1.2, M.glass(), 0, h - lh + lh * 0.0, 0));
      g.add(sphere(r * 0.3, M.bulb(), 0, h - lh * 0.6, 0, 12));
      g.add(frustum(r * 2, r * 2, r * 0.3, r * 0.3, lh * 0.25, m, 0, h - lh * 0.25));
      return fitXZ(g, w, d);
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, 0.04, true)],
  },
  {
    id: 'bench', name: 'Garden bench', category: 'outdoor', tags: ['bench', 'seat', 'garden', 'park'], outdoor: true,
    size: { w: 1.5, d: 0.6, h: 0.8 }, defaultColor: '#a8825e',
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const wood = M.wood(o.color ?? '#a8825e');
      const metal = M.blackMetal();
      const s = h * 0.55;
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.08);
        g.add(sideProfile([[d / 2 - 0.02, 0], [d / 2 - 0.06, 0], [d / 2 - 0.06, s - 0.03], [-d / 2 + 0.06, s - 0.03], [-d / 2 + 0.03, 0], [-d / 2, 0], [-d / 2 + 0.03, s], [-d / 2, h], [-d / 2 + 0.04, h], [-d / 2 + 0.07, s], [d / 2 - 0.02, s]], 0.04, metal, x));
      }
      const n = 4;
      const sd = (d - 0.06) / n;
      for (let i = 0; i < n; i++) g.add(box(w, 0.03, sd - 0.015, wood, 0, s - 0.03, -d / 2 + 0.06 + sd * (i + 0.5)));
      for (let i = 0; i < 3; i++) g.add(box(w, (h - s) / 3 - 0.02, 0.025, wood, 0, s + 0.04 + ((h - s - 0.04) / 3) * i, -d / 2 + 0.03 + 0.012));
      return g;
    },
    plan: (w, d) => {
      const out: PlanShape[] = [P.rect(0, 0, w, d)];
      for (let i = 1; i < 4; i++) out.push(P.line(-w / 2, -d / 2 + 0.06 + ((d - 0.06) / 4) * i, w / 2, -d / 2 + 0.06 + ((d - 0.06) / 4) * i));
      out.push(P.rect(0, -d / 2 + 0.03, w, 0.06, 0, true));
      return out;
    },
  },
];

function legs4(w: number, d: number, h: number, m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, h, 0.04, m, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.06)));
  return g;
}

