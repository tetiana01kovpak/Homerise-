import * as THREE from 'three';
import type { CatalogItem } from '../types';
import { C, M, P, mat, box, cyl, sphere, mesh, rodZ, clamp, fitXZ } from '../materials';

/** Lampshade: open tapered cylinder (double sided, slightly glowing) with a bulb inside. Bottom at y. */
function shade(rBot: number, rTop: number, h: number, color: string | undefined, y: number, x = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  const s = mesh(new THREE.CylinderGeometry(rTop, rBot, h, 28, 1, true), M.shade(color ?? C.linen));
  s.position.set(x, y + h / 2, z);
  g.add(s);
  g.add(sphere(Math.min(rTop, rBot) * 0.45, M.bulb(), x, y + h * 0.45, z, 12));
  return g;
}

function dome(r: number, h: number, m: THREE.Material, y: number): THREE.Mesh {
  // half-sphere opening downward, scaled to height h, top at y + h
  const geo = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const me = mesh(geo, m);
  me.scale.set(r, h, r);
  me.position.y = y;
  return me;
}

export const lightingItems: CatalogItem[] = [
  {
    id: 'ceiling-lamp', name: 'Ceiling lamp (flush)', category: 'lighting', tags: ['lamp', 'light', 'ceiling', 'flush mount'], light: true,
    size: { w: 0.4, d: 0.4, h: 0.12 }, elevation: 2.58,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const r = Math.min(w, d) / 2;
      g.add(cyl(r * 0.55, h * 0.15, M.lacquer(o.color ?? C.white), 0, h * 0.85, 0, 24));
      const diffuser = mesh(new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.bulb('#fffaf0'));
      diffuser.scale.set(r, h * 0.85, r);
      diffuser.position.y = h * 0.85;
      g.add(diffuser);
      g.scale.set(w / (2 * r), 1, d / (2 * r));
      return g;
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.line(-w / 2, 0, w / 2, 0), P.line(0, -d / 2, 0, d / 2)],
  },
  {
    id: 'pendant-lamp', name: 'Pendant lamp', category: 'lighting', tags: ['lamp', 'light', 'pendant', 'hanging'], light: true,
    size: { w: 0.4, d: 0.4, h: 1.0 }, elevation: 1.7, defaultColor: C.charcoal,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const r = Math.min(w, d) / 2;
      const sh = Math.min(h * 0.35, r * 1.1);
      const sm = mat2(o.color ?? C.charcoal);
      g.add(dome(r, sh, sm, 0));
      g.add(sphere(r * 0.22, M.bulb(), 0, r * 0.15, 0, 12));
      g.add(cyl(0.02, 0.05, M.brass(), 0, sh - 0.01, 0, 12));
      g.add(cyl(0.004, h - sh - 0.03, M.black(), 0, sh + 0.04, 0, 6));
      g.add(cyl(0.05, 0.025, sm, 0, h - 0.025, 0, 16));
      g.scale.set(w / (2 * r), 1, d / (2 * r));
      return g;
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) * 0.1)],
  },
  {
    id: 'table-lamp', name: 'Table lamp', category: 'lighting', tags: ['lamp', 'light', 'table lamp', 'bedside'], light: true,
    size: { w: 0.3, d: 0.3, h: 0.5 }, elevation: 0.55, defaultColor: C.linen,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const r = Math.min(w, d) / 2;
      const baseH = h * 0.5;
      g.add(cyl(r * 0.45, baseH * 0.85, M.ceramic(), 0, 0, 0, 20, r * 0.3));
      g.add(cyl(r * 0.08, baseH * 0.2, M.brass(), 0, baseH * 0.85, 0, 10));
      g.add(shade(r, r * 0.78, h - baseH * 0.95, o.color, baseH * 0.95));
      g.scale.set(w / (2 * r), 1, d / (2 * r));
      return g;
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) * 0.15)],
  },
  {
    id: 'floor-lamp', name: 'Floor lamp', category: 'lighting', tags: ['lamp', 'light', 'floor lamp', 'standing lamp'], light: true,
    size: { w: 0.45, d: 0.45, h: 1.6 }, defaultColor: C.linen,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const r = Math.min(w, d) / 2;
      g.add(cyl(r * 0.6, 0.025, M.blackMetal(), 0, 0, 0, 24));
      const sh = clamp(h * 0.2, 0.15, 0.45);
      g.add(cyl(0.012, h - sh * 0.6, M.blackMetal(), 0, 0.025, 0, 10));
      g.add(shade(r, r * 0.8, sh, o.color, h - sh));
      g.scale.set(w / (2 * r), 1, d / (2 * r));
      return g;
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) * 0.3), P.line(-w * 0.3, 0, w * 0.3, 0), P.line(0, -d * 0.3, 0, d * 0.3)],
  },
  {
    id: 'wall-sconce', name: 'Wall sconce', category: 'lighting', tags: ['lamp', 'light', 'wall light', 'sconce'], light: true,
    size: { w: 0.18, d: 0.2, h: 0.28 }, elevation: 1.75, defaultColor: C.linen,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      g.add(box(0.08, 0.12, 0.02, M.brass(), 0, h * 0.25, -d / 2 + 0.01));
      g.add(rodZ(d * 0.4, 0.008, M.brass(), 0, h * 0.3, -d / 2 + d * 0.2));
      const r = Math.min(w / 2, d * 0.3);
      g.add(shade(r, r * 0.75, h, o.color, 0, 0, d / 2 - r));
      return fitXZ(g, w, d);
    },
    plan: (w, d) => [P.rect(0, -d / 2 + 0.01, 0.08, 0.02, 0, true), P.circle(0, d / 2 - Math.min(w / 2, d * 0.3), Math.min(w / 2, d * 0.3))],
  },
  {
    id: 'downlight', name: 'Recessed downlight', category: 'lighting', tags: ['spot', 'downlight', 'recessed', 'ceiling'], light: true,
    size: { w: 0.1, d: 0.1, h: 0.02 }, elevation: 2.68,
    build: (o) => {
      const g = new THREE.Group();
      const ring = cyl(0.5, o.h * 0.6, M.lacquer(C.white), 0, o.h * 0.4, 0, 20);
      ring.scale.set(o.w, 1, o.d);
      const lens = cyl(0.36, o.h * 0.4, M.bulb('#fffaf0'), 0, 0, 0, 20);
      lens.scale.set(o.w, 1, o.d);
      g.add(ring, lens);
      return g;
    },
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.line(-w / 2, -d / 2, w / 2, d / 2), P.line(-w / 2, d / 2, w / 2, -d / 2)],
  },
];

function mat2(c: string): THREE.Material {
  return mat(c, { roughness: 0.45, doubleSide: true });
}
