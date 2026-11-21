import * as THREE from 'three';
import type { CatalogItem } from '../types';
import { C, M, P, mat, box, rbox, cyl, ellipsoid, sphere, mesh, fitToBox, texMat, rng } from '../materials';

function pot(r: number, h: number, color: string | undefined): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(r * 0.78, h, M.matte(color ?? C.terracotta), 0, 0, 0, 20, r));
  g.add(cyl(r * 0.92, 0.01, M.soil(), 0, h - 0.012, 0, 20));
  return g;
}

/** Leafy plant made of leaf blades fanning out from the pot. Modelled in unit space and fitted. */
function buildSmallPlant(w: number, d: number, h: number, color?: string): THREE.Object3D {
  const g = new THREE.Group();
  const potH = 0.4;
  g.add(pot(0.2, potH, color));
  const rand = rng(7);
  const leafM = M.leaf();
  const leafM2 = M.leaf(C.leafDark);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rand() * 0.3;
    const tilt = 0.35 + rand() * 0.5;
    const len = 0.45 + rand() * 0.35;
    const leaf = ellipsoid(0.07, len / 2, 0.02, i % 2 ? leafM : leafM2, 0, 0, 0, 8);
    leaf.position.y = len / 2;
    const pivot = new THREE.Group();
    pivot.add(leaf);
    pivot.position.y = potH - 0.02;
    pivot.rotation.set(0, a, tilt, 'YXZ');
    g.add(pivot);
  }
  return fitToBox(g, w, d, h);
}

function buildLargePlant(w: number, d: number, h: number, color?: string): THREE.Object3D {
  const g = new THREE.Group();
  g.add(pot(0.3, 0.55, color ?? C.offWhite));
  g.add(cyl(0.025, 1.4, M.bark(), 0, 0.5, 0, 8, 0.018));
  const rand = rng(11);
  for (let i = 0; i < 22; i++) {
    const y = 0.9 + rand() * 1.0;
    const a = rand() * Math.PI * 2;
    const rr = 0.1 + rand() * 0.25 * (1.2 - (y - 0.9));
    g.add(ellipsoid(0.13, 0.09, 0.05, rand() > 0.5 ? M.leaf() : M.leaf(C.leafDark), Math.cos(a) * rr, y, Math.sin(a) * rr, 8));
  }
  return fitToBox(g, w, d, h);
}

function buildVase(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const pts = [
    [0, 0], [0.42, 0], [0.48, 0.05], [0.5, 0.3], [0.42, 0.62], [0.24, 0.82], [0.22, 0.92], [0.28, 1],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const v = mesh(new THREE.LatheGeometry(pts, 24), mat(color ?? '#cdd6cf', { roughness: 0.5, doubleSide: true }));
  v.scale.set(w / 1, h, d / 1);
  g.add(v);
  return g;
}

const ART_PALETTES = ['#e9c46a', '#e76f51', '#2a9d8f', '#264653', '#f4a261', '#d8b6a6', '#9aab93'];

function artMaterial(): THREE.Material {
  return texMat('wall-art-1', '#d9cbb8', (ctx, s) => {
    ctx.fillStyle = '#f3ede3';
    ctx.fillRect(0, 0, s, s);
    const r = rng(3);
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = ART_PALETTES[i % ART_PALETTES.length];
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      if (i % 2) ctx.arc(r() * s, r() * s, s * (0.1 + r() * 0.2), 0, Math.PI * 2);
      else ctx.rect(r() * s * 0.7, r() * s * 0.7, s * (0.15 + r() * 0.3), s * (0.1 + r() * 0.25));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, { roughness: 0.8 });
}

export const decorItems: CatalogItem[] = [
  {
    id: 'plant-small', name: 'Plant, small', category: 'decor', tags: ['plant', 'pot', 'houseplant', 'green'],
    size: { w: 0.4, d: 0.4, h: 0.6 }, defaultColor: C.terracotta,
    build: (o) => buildSmallPlant(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) * 0.25), P.line(-w / 2, 0, w / 2, 0), P.line(0, -d / 2, 0, d / 2), P.line(-w * 0.35, -d * 0.35, w * 0.35, d * 0.35), P.line(-w * 0.35, d * 0.35, w * 0.35, -d * 0.35)],
  },
  {
    id: 'plant-large', name: 'Plant, large (fiddle leaf)', category: 'decor', tags: ['plant', 'tree', 'houseplant', 'ficus', 'green'],
    size: { w: 0.7, d: 0.7, h: 1.7 }, defaultColor: C.offWhite,
    build: (o) => buildLargePlant(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) * 0.22), P.line(-w * 0.45, 0, w * 0.45, 0), P.line(0, -d * 0.45, 0, d * 0.45), P.line(-w * 0.32, -d * 0.32, w * 0.32, d * 0.32), P.line(-w * 0.32, d * 0.32, w * 0.32, -d * 0.32)],
  },
  {
    id: 'vase', name: 'Vase', category: 'decor', tags: ['vase', 'decoration', 'ceramic'],
    size: { w: 0.2, d: 0.2, h: 0.35 }, defaultColor: '#cdd6cf',
    build: (o) => buildVase(o.w, o.d, o.h, o.color),
    plan: (w, d) => [P.circle(0, 0, Math.min(w, d) / 2), P.circle(0, 0, Math.min(w, d) * 0.28)],
  },
  {
    id: 'wall-art', name: 'Wall art / picture', category: 'decor', tags: ['art', 'picture', 'painting', 'frame', 'poster', 'canvas'],
    size: { w: 0.9, d: 0.03, h: 0.6 }, elevation: 1.3, defaultColor: C.oak,
    build: (o) => {
      const g = new THREE.Group();
      const f = 0.03;
      const fm = M.wood(o.color ?? C.oak);
      g.add(box(o.w, f, o.d, fm, 0, 0, 0));
      g.add(box(o.w, f, o.d, fm, 0, o.h - f, 0));
      g.add(box(f, o.h - 2 * f, o.d, fm, -o.w / 2 + f / 2, f, 0));
      g.add(box(f, o.h - 2 * f, o.d, fm, o.w / 2 - f / 2, f, 0));
      g.add(box(o.w - 2 * f, o.h - 2 * f, o.d * 0.5, M.matte(C.white), 0, f, -o.d * 0.2));
      const canvas = mesh(new THREE.PlaneGeometry(o.w - 2 * f - 0.08, o.h - 2 * f - 0.08), artMaterial());
      canvas.position.set(0, o.h / 2, o.d * 0.06 + 0.001);
      g.add(canvas);
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0, true)],
  },
  {
    id: 'wall-clock', name: 'Wall clock', category: 'decor', tags: ['clock', 'wall clock', 'time'],
    size: { w: 0.35, d: 0.05, h: 0.35 }, elevation: 1.9, defaultColor: C.white,
    build: (o) => {
      const g = new THREE.Group();
      const r = Math.min(o.w, o.h) / 2;
      const fz = o.d / 2 - 0.016;
      const rimD = fz - 0.004 + o.d / 2;
      const rim = cyl(r, rimD, M.blackMetal(), 0, 0, 0, 32);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, r, -o.d / 2 + rimD / 2);
      const face = cyl(r * 0.92, 0.004, M.matte(o.color ?? C.white), 0, 0, 0, 32);
      face.rotation.x = Math.PI / 2;
      face.position.set(0, r, fz - 0.004);
      g.add(rim, face);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const t = box(0.008, i % 3 ? 0.02 : 0.04, 0.004, M.black(), 0, 0, 0);
        t.geometry.translate(0, r * 0.75, 0);
        t.position.set(0, r, fz);
        t.rotation.z = a;
        g.add(t);
      }
      const hh = box(0.012, r * 0.5, 0.004, M.black(), 0, 0, 0);
      hh.geometry.translate(0, r * 0.25 - 0.006, 0);
      hh.position.set(0, r, fz + 0.004);
      hh.rotation.z = -1.0;
      const mh = box(0.008, r * 0.75, 0.004, M.black(), 0, 0, 0);
      mh.geometry.translate(0, r * 0.37 - 0.004, 0);
      mh.position.set(0, r, fz + 0.008);
      mh.rotation.z = 2.3;
      g.add(hh, mh, sphere(0.005, M.brass(), 0, r, fz + 0.008, 8));
      g.scale.set(o.w / (2 * r), o.h / (2 * r), 1);
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0, true)],
  },
  {
    id: 'cushion', name: 'Floor cushion', category: 'decor', tags: ['cushion', 'pillow', 'floor cushion', 'pouf'],
    size: { w: 0.6, d: 0.6, h: 0.18 }, defaultColor: C.blush,
    build: (o) => {
      const g = new THREE.Group();
      g.add(rbox(o.w, o.h, o.d, M.fabric(o.color ?? C.blush), Math.min(0.08, o.h / 2), 0, 0, 0, 4));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, Math.min(w, d) * 0.2)],
  },
];
