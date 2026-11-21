import * as THREE from 'three';
import type { CatalogItem, PlanShape } from '../types';
import { C, M, P, box, rbox, cyl, rodX, rodZ, ringUpright, extrudeFlat, clamp, mesh, planEllipse } from '../materials';
import { buildCabinet, planCabinet } from '../parts';
import { buildSinkCabinet, planSink } from './kitchen';

function buildToilet(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const cer = color ? M.plastic(color) : M.ceramic();
  const tankD = d * 0.26;
  const tankY = h * 0.5;
  g.add(rbox(w, h - tankY, tankD, cer, 0.03, 0, tankY, -d / 2 + tankD / 2));
  g.add(cyl(0.022, 0.008, M.chrome(), 0, h - 0.006, -d / 2 + tankD / 2, 16));
  const bowlLen = d - tankD * 0.5;
  const bowlH = h * 0.46;
  const bz = -d / 2 + tankD * 0.5 + bowlLen / 2;
  const bowl = cyl(0.32, bowlH, cer, 0, 0, bz, 28, 0.5);
  bowl.scale.set(w * 0.94, 1, bowlLen);
  g.add(bowl);
  // back block connecting bowl to tank
  g.add(rbox(w * 0.6, tankY, tankD * 0.8, cer, 0.03, 0, 0, -d / 2 + tankD * 0.4));
  const seat = cyl(0.5, 0.025, M.plastic(C.white), 0, bowlH, 0, 28);
  seat.scale.set(w * 0.96, 1, bowlLen * 0.97);
  seat.position.z = bz;
  g.add(seat);
  const lid = cyl(0.5, 0.02, M.plastic(C.white), 0, bowlH + 0.025, 0, 28);
  lid.scale.set(w * 0.92, 1, bowlLen * 0.9);
  lid.position.z = bz - bowlLen * 0.02;
  g.add(lid);
  return g;
}

function planToilet(w: number, d: number): PlanShape[] {
  const tankD = d * 0.26;
  const bowlLen = d - tankD * 0.5;
  const bz = -d / 2 + tankD * 0.5 + bowlLen / 2;
  return [
    P.rect(0, -d / 2 + tankD / 2, w, tankD, 0.03),
    planEllipse(0, bz + tankD * 0.12, w * 0.47, bowlLen / 2 - tankD * 0.12),
    planEllipse(0, bz + tankD * 0.2, w * 0.3, bowlLen * 0.3),
  ];
}

function buildTub(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const m = color ? M.plastic(color) : M.ceramic();
  const t = clamp(Math.min(w, d) * 0.08, 0.05, 0.1);
  g.add(rbox(w, h, t, m, 0.02, 0, 0, -d / 2 + t / 2));
  g.add(rbox(w, h, t, m, 0.02, 0, 0, d / 2 - t / 2));
  g.add(rbox(t, h, d - 2 * t + 0.02, m, 0.02, -w / 2 + t / 2, 0, 0));
  g.add(rbox(t, h, d - 2 * t + 0.02, m, 0.02, w / 2 - t / 2, 0, 0));
  g.add(rbox(w - 2 * t + 0.02, h * 0.2, d - 2 * t + 0.02, m, 0.05, 0, 0, 0));
  // spout on the left end
  g.add(box(0.12, 0.04, 0.035, M.chrome(), -w / 2 + t + 0.04, h - 0.1, 0));
  g.add(cyl(0.025, 0.004, M.chrome(), -w / 2 + t + 0.1, h * 0.2, 0, 16));
  return g;
}

function buildWasher(w: number, d: number, h: number, color: string | undefined, dryer: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = M.lacquer(color ?? C.white);
  const fz = d / 2 - 0.03;
  g.add(rbox(w, h, d - 0.03, body, 0.02, 0, 0, -0.015));
  const panelH = Math.min(0.12, h * 0.14);
  g.add(box(w - 0.04, panelH - 0.02, 0.01, M.plastic(C.offWhite), 0, h - panelH, fz - 0.002));
  g.add(box(w * 0.22, panelH * 0.5, 0.004, M.screen(), w * 0.05, h - panelH * 0.75, fz + 0.004));
  const k = cyl(0.025, 0.02, M.chrome(), 0, 0, 0, 20);
  k.rotation.x = Math.PI / 2;
  k.position.set(w * 0.32, h - panelH * 0.55, fz + 0.01);
  g.add(k);
  g.add(box(w * 0.2, panelH * 0.4, 0.008, M.plastic(C.greige), -w * 0.3, h - panelH * 0.75, fz));
  const R = Math.min(w, h - panelH) * 0.32;
  const cy = (h - panelH) * 0.52;
  const ring = ringUpright(R, Math.min(0.03, R * 0.14), dryer ? M.plastic(C.greige) : M.chrome(), 0, cy, fz + 0.0, 32);
  ring.scale.z = 0.6;
  g.add(ring);
  const glassDisc = mesh(new THREE.CircleGeometry(R * 0.92, 32), dryer ? M.screen() : M.glass());
  glassDisc.position.set(0, cy, fz + 0.002);
  g.add(glassDisc);
  if (!dryer) {
    const drum = mesh(new THREE.CircleGeometry(R * 0.85, 32), M.steel());
    drum.position.set(0, cy, fz - 0.02);
    g.add(drum);
  }
  return g;
}

function quarterShape(w: number, d: number, seg = 20): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI / 2;
    s.lineTo(Math.sin(a) * w, -Math.cos(a) * d);
  }
  s.lineTo(0, 0);
  return s;
}

export const bathroomItems: CatalogItem[] = [
  {
    id: 'toilet', name: 'Toilet', category: 'bathroom', tags: ['toilet', 'wc', 'lavatory', 'loo'],
    size: { w: 0.38, d: 0.7, h: 0.8 },
    build: (o) => buildToilet(o.w, o.d, o.h, o.color), plan: planToilet,
  },
  {
    id: 'vanity-single', name: 'Vanity, single sink', category: 'bathroom', tags: ['sink', 'vanity', 'basin', 'washbasin', 'lavatory'],
    size: { w: 0.7, d: 0.48, h: 1.05 }, defaultColor: C.oak,
    build: (o) => buildSinkCabinet(o.w, o.d, o.h, o.color ?? C.oak, false, false),
    plan: (w, d) => planSink(w, d),
  },
  {
    id: 'vanity-double', name: 'Vanity, double sink', category: 'bathroom', tags: ['sink', 'vanity', 'double', 'basin', 'washbasin'],
    size: { w: 1.3, d: 0.5, h: 1.05 }, defaultColor: C.oak,
    build: (o) => buildSinkCabinet(o.w, o.d, o.h, o.color ?? C.oak, true, false),
    plan: (w, d) => planSink(w, d, true),
  },
  {
    id: 'pedestal-sink', name: 'Pedestal sink', category: 'bathroom', tags: ['sink', 'basin', 'pedestal', 'washbasin'],
    size: { w: 0.55, d: 0.45, h: 1.05 },
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const cer = M.ceramic();
      const top = h * 0.8;
      g.add(cyl(Math.min(w, d) * 0.15, top - 0.15, cer, 0, 0, -d * 0.1, 20, Math.min(w, d) * 0.1));
      const basin = cyl(0.5, 0.15, cer, 0, top - 0.15, 0, 28, 0.5);
      basin.scale.set(w, 1, d);
      g.add(basin);
      const inner = cyl(0.4, 0.005, cer, 0, top - 0.004, d * 0.05, 28);
      inner.scale.set(w, 1, d * 0.8);
      g.add(inner);
      g.add(cyl(0.012, h - top, M.chrome(), 0, top, -d * 0.35, 12));
      g.add(box(0.025, 0.02, 0.1, M.chrome(), 0, h - 0.03, -d * 0.3));
      return g;
    },
    plan: (w, d) => [planEllipse(0, 0, w / 2, d / 2), planEllipse(0, d * 0.05, w * 0.36, d * 0.3), P.circle(0, -d * 0.35, 0.02)],
  },
  {
    id: 'bathtub', name: 'Bathtub', category: 'bathroom', tags: ['bath', 'bathtub', 'tub'],
    size: { w: 1.7, d: 0.75, h: 0.58 },
    build: (o) => buildTub(o.w, o.d, o.h, o.color),
    plan: (w, d) => {
      const t = clamp(Math.min(w, d) * 0.08, 0.05, 0.1);
      return [P.rect(0, 0, w, d, 0.03), P.rect(0.02, 0, w - 2 * t - 0.04, d - 2 * t, Math.min(0.2, d * 0.25)), P.circle(-w / 2 + t + 0.1, 0, 0.025), P.rect(-w / 2 + t / 2 + 0.03, 0, 0.06, 0.04)];
    },
  },
  {
    id: 'shower-square', name: 'Shower, square', category: 'bathroom', tags: ['shower', 'shower tray', 'enclosure', 'cubicle'],
    size: { w: 0.9, d: 0.9, h: 2.0 },
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const trayH = 0.05;
      g.add(rbox(w, trayH, d, M.ceramic(), 0.01, 0, 0, 0));
      g.add(cyl(0.04, 0.003, M.chrome(), 0, trayH, 0, 16));
      const gh = h - trayH - 0.02;
      g.add(box(w - 0.02, gh, 0.008, M.glass(), -0.01, trayH, d / 2 - 0.015));
      g.add(box(0.008, gh, d - 0.02, M.glass(), w / 2 - 0.015, trayH, -0.01));
      // frame
      g.add(rodX(w - 0.02, 0.01, M.chrome(), -0.01, h - 0.02 - 0.01, d / 2 - 0.015));
      g.add(rodZ(d - 0.02, 0.01, M.chrome(), w / 2 - 0.015, h - 0.02 - 0.01, -0.01));
      g.add(box(0.02, h - trayH, 0.02, M.chrome(), w / 2 - 0.015, trayH, d / 2 - 0.015));
      // shower riser + head on the back wall
      const sx = -w * 0.15;
      g.add(cyl(0.012, h * 0.55, M.chrome(), sx, h * 0.4, -d / 2 + 0.03, 12));
      g.add(box(0.06, 0.08, 0.04, M.chrome(), sx, h * 0.5, -d / 2 + 0.02));
      g.add(rodZ(0.25, 0.01, M.chrome(), sx, h * 0.95 - 0.01, -d / 2 + 0.03 + 0.125));
      g.add(cyl(0.1, 0.015, M.chrome(), sx, h * 0.95 - 0.04, -d / 2 + 0.25, 24));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d), P.rect(0, 0, w - 0.04, d - 0.04), P.line(-w / 2, -d / 2, w / 2, d / 2), P.line(-w / 2, d / 2, w / 2, -d / 2), P.circle(0, 0, 0.04)],
  },
  {
    id: 'shower-corner', name: 'Shower, quarter-round corner', category: 'bathroom', tags: ['shower', 'corner shower', 'quadrant', 'enclosure'],
    size: { w: 0.9, d: 0.9, h: 2.0 },
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const trayH = 0.05;
      const tray = extrudeFlat(quarterShape(w, d), trayH, M.ceramic());
      tray.position.set(-w / 2, 0, -d / 2);
      g.add(tray);
      const gh = h - trayH;
      const glass = mesh(new THREE.CylinderGeometry(1, 1, gh, 24, 1, true, 0, Math.PI / 2), M.glass());
      glass.scale.set(w - 0.01, 1, d - 0.01);
      glass.position.set(-w / 2, trayH + gh / 2, -d / 2);
      g.add(glass);
      const rim = mesh(new THREE.CylinderGeometry(1, 1, 0.02, 24, 1, true, 0, Math.PI / 2), M.chrome());
      rim.scale.set(w - 0.005, 1, d - 0.005);
      rim.position.set(-w / 2, h - 0.01, -d / 2);
      g.add(rim);
      g.add(cyl(0.04, 0.003, M.chrome(), -w * 0.1, trayH, -d * 0.1, 16));
      const sx = -w / 2 + 0.03;
      g.add(cyl(0.012, h * 0.55, M.chrome(), sx, h * 0.4, -d * 0.1, 12));
      g.add(cyl(0.09, 0.015, M.chrome(), sx + 0.12, h * 0.95 - 0.04, -d * 0.1, 24));
      g.add(rodX(0.15, 0.01, M.chrome(), sx + 0.06, h * 0.95 - 0.02, -d * 0.1));
      return g;
    },
    plan: (w, d) => {
      const pts: [number, number][] = [[-w / 2, -d / 2]];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI / 2;
        pts.push([-w / 2 + Math.sin(a) * w, -d / 2 + Math.cos(a) * d]);
      }
      return [P.poly(pts), P.line(-w / 2, -d / 2, -w / 2 + w * 0.707, -d / 2 + d * 0.707), P.circle(-w * 0.1, -d * 0.1, 0.04)];
    },
  },
  {
    id: 'towel-rail', name: 'Heated towel rail', category: 'bathroom', tags: ['towel', 'rail', 'radiator', 'heated'],
    size: { w: 0.5, d: 0.1, h: 0.8 }, elevation: 0.3,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const m = o.color ? M.lacquer(o.color) : M.chrome();
      const r = 0.015;
      const z = d / 2 - r;
      for (const sx of [-1, 1]) {
        g.add(cyl(r, h, m, sx * (w / 2 - r), 0, z, 12));
        for (const yy of [0.15, 0.85]) g.add(rodZ(d - r, 0.008, m, sx * (w / 2 - r), h * yy, (d - r) / 2 - d / 2));
      }
      const n = Math.max(4, Math.round(h / 0.07));
      for (let i = 0; i < n; i++) g.add(rodX(w - 2 * r, 0.01, m, 0, 0.04 + (h - 0.08) * (i / (n - 1)), z));
      return g;
    },
    plan: (w, d) => [P.rect(0, d / 2 - 0.015, w, 0.03), P.line(-w / 2 + 0.015, -d / 2, -w / 2 + 0.015, d / 2), P.line(w / 2 - 0.015, -d / 2, w / 2 - 0.015, d / 2)],
  },
  {
    id: 'mirror', name: 'Mirror', category: 'bathroom', tags: ['mirror', 'wall mirror'],
    size: { w: 0.6, d: 0.03, h: 0.8 }, elevation: 1.1,
    build: (o) => {
      const g = new THREE.Group();
      g.add(rbox(o.w, o.h, o.d * 0.6, M.matte(o.color ?? C.charcoal), 0.03, 0, 0, -o.d * 0.2));
      g.add(rbox(o.w - 0.03, o.h - 0.03, o.d * 0.4, M.mirror(), 0.025, 0, 0.015, o.d * 0.3));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0, true)],
  },
  {
    id: 'bathroom-wall-cabinet', name: 'Mirror cabinet', category: 'bathroom', tags: ['cabinet', 'mirror', 'medicine cabinet', 'wall cabinet'],
    size: { w: 0.6, d: 0.15, h: 0.65 }, elevation: 1.2,
    build: (o) => {
      const g = buildCabinet(o.w, o.d, o.h, { body: M.lacquer(o.color ?? C.white), doors: Math.max(1, Math.round(o.w / 0.4)), handle: null });
      const n = Math.max(1, Math.round(o.w / 0.4));
      const dw = o.w / n;
      for (let i = 0; i < n; i++) g.add(box(dw - 0.03, o.h - 0.03, 0.002, M.mirror(), -o.w / 2 + dw * (i + 0.5), 0.015, o.d / 2 + 0.0005));
      return g;
    },
    plan: (w, d) => planCabinet(w, d),
  },
  {
    id: 'washing-machine', name: 'Washing machine', category: 'bathroom', tags: ['washer', 'washing machine', 'laundry', 'appliance'],
    size: { w: 0.6, d: 0.6, h: 0.85 },
    build: (o) => buildWasher(o.w, o.d, o.h, o.color, false),
    plan: (w, d) => [P.rect(0, 0, w, d, 0.02), P.circle(0, 0, Math.min(w, d) * 0.32), P.line(-w / 2, d / 2 - 0.04, w / 2, d / 2 - 0.04)],
  },
  {
    id: 'dryer', name: 'Tumble dryer', category: 'bathroom', tags: ['dryer', 'tumble dryer', 'laundry', 'appliance'],
    size: { w: 0.6, d: 0.6, h: 0.85 },
    build: (o) => buildWasher(o.w, o.d, o.h, o.color, true),
    plan: (w, d) => [P.rect(0, 0, w, d, 0.02), P.circle(0, 0, Math.min(w, d) * 0.32), P.circle(0, 0, Math.min(w, d) * 0.2), P.line(-w / 2, d / 2 - 0.04, w / 2, d / 2 - 0.04)],
  },
];

