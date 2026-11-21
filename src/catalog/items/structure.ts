import * as THREE from 'three';
import type { CatalogItem, PlanShape } from '../types';
import {
  C, M, P, mat, box, cyl, rod, mesh, extrudeFlat, sideProfile, frustum, texMat, clamp,
} from '../materials';
import { buildCabinet, planCabinet } from '../parts';
import { counterMat } from './kitchen';

const RAIL_H = 0.9;

function arrowHead(x: number, y: number, dx: number, dy: number, s = 0.12): PlanShape {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  const px = -uy, py = ux;
  return P.poly([[x, y], [x - ux * s + px * s * 0.5, y - uy * s + py * s * 0.5], [x - ux * s - px * s * 0.5, y - uy * s - py * s * 0.5]], true, true);
}

function stepCount(h: number) {
  const steps = Math.max(3, Math.round(h / 0.18));
  return { steps, riser: h / steps };
}

/* ---------------------------- straight stair ---------------------------- */

function buildStraightStair(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const { steps, riser } = stepCount(h);
  const going = d / steps;
  const s = riser / going;
  const wood = M.wood(color ?? C.oak);
  const white = M.lacquer(C.white);
  const str = clamp(w * 0.05, 0.04, 0.06);
  const tt = Math.min(0.04, riser * 0.3);
  for (let i = 1; i <= steps; i++) {
    const zFront = d / 2 - (i - 1) * going;
    const depth = going + (i > 1 ? 0.02 : 0);
    g.add(box(w - 2 * str, tt, depth, wood, 0, i * riser - tt, zFront - going + depth / 2 - (i > 1 ? 0 : 0)));
    g.add(box(w - 2 * str, riser - tt, 0.015, white, 0, (i - 1) * riser, zFront - 0.0075 - (i > 1 ? 0.02 : 0)));
  }
  // stringers (band following the pitch, clipped to h)
  const bandH = clamp(riser * 2, 0.25, 0.4);
  const top0 = riser + 0.03;
  const zc = d / 2 - (h - top0) / s;
  const yb = (z: number) => h - bandH - s * (z + d / 2);
  const zf = -d / 2 + (h - bandH) / s;
  const prof: [number, number][] = [];
  if (zf < d / 2) prof.push([zf, 0], [d / 2, 0]);
  else prof.push([d / 2, yb(d / 2)]);
  prof.push([d / 2, top0], [zc, h], [-d / 2, h], [-d / 2, h - bandH]);
  for (const sx of [-1, 1]) g.add(sideProfile(prof, str, white, sx * (w / 2 - str / 2)));
  // railing on the right (+x) side, ends where it reaches the upper floor level
  const rx = w / 2 - str / 2;
  const iEnd = Math.max(1, Math.floor((h - RAIL_H - 0.03) / riser));
  const zc1 = d / 2 - going / 2;
  const zcE = d / 2 - (iEnd - 0.5) * going;
  const metal = M.blackMetal();
  for (let i = 1; i <= iEnd; i++) {
    const z = d / 2 - (i - 0.5) * going;
    g.add(cyl(0.008, RAIL_H, metal, rx, i * riser, z, 6));
  }
  g.add(box(0.06, riser + RAIL_H + 0.05, 0.06, wood, rx, 0, zc1));
  if (iEnd > 1) g.add(rod(new THREE.Vector3(rx, riser + RAIL_H, zc1), new THREE.Vector3(rx, iEnd * riser + RAIL_H, zcE), 0.022, wood, 10));
  return g;
}

function planStraightStair(w: number, d: number): PlanShape[] {
  const { steps } = stepCount(2.8);
  const going = d / steps;
  const out: PlanShape[] = [P.rect(0, 0, w, d)];
  for (let i = 1; i < steps; i++) out.push(P.line(-w / 2, d / 2 - i * going, w / 2, d / 2 - i * going));
  const y0 = d / 2 - going / 2, y1 = -d / 2 + going / 2;
  out.push(P.circle(0, y0, Math.min(0.05, going * 0.3)));
  out.push(P.line(0, y0, 0, y1), arrowHead(0, y1 - 0.02, 0, -1, Math.min(0.15, w * 0.15)));
  // cut line
  out.push(P.line(-w / 2, -d * 0.05 + w * 0.15, w / 2, -d * 0.05 - w * 0.15));
  return out;
}

/* ---------------------------- L-shaped stair ---------------------------- */

function lStairLayout(w: number, d: number, h: number) {
  const fw = clamp(Math.min(w, d) * 0.45, 0.7, 1.2);
  const { steps, riser } = stepCount(h);
  const run1 = d - fw, run2 = w - fw;
  let n1 = Math.round(((steps - 1) * run1) / (run1 + run2));
  n1 = clamp(n1, 1, steps - 2);
  const n2 = steps - 1 - n1;
  return { fw, steps, riser, run1, run2, n1, n2, g1: run1 / n1, g2: run2 / n2 };
}

function buildLStair(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const L = lStairLayout(w, d, h);
  const wood = M.wood(color ?? C.oak);
  const body = M.lacquer(C.white);
  const cap = Math.min(0.04, L.riser * 0.3);
  const x1 = w / 2 - L.fw / 2;
  for (let i = 1; i <= L.n1; i++) {
    const zF = d / 2 - (i - 1) * L.g1;
    const top = i * L.riser;
    g.add(box(L.fw, top - cap, L.g1, body, x1, 0, zF - L.g1 / 2));
    g.add(box(L.fw, cap, L.g1, wood, x1, top - cap, zF - L.g1 / 2));
  }
  const landTop = (L.n1 + 1) * L.riser;
  const zL = -d / 2 + L.fw / 2;
  g.add(box(L.fw, landTop - cap, L.fw, body, x1, 0, zL));
  g.add(box(L.fw, cap, L.fw, wood, x1, landTop - cap, zL));
  for (let j = 1; j <= L.n2; j++) {
    const xF = w / 2 - L.fw - (j - 1) * L.g2;
    const top = landTop + j * L.riser;
    g.add(box(L.g2, top - cap, L.fw, body, xF - L.g2 / 2, 0, zL));
    g.add(box(L.g2, cap, L.fw, wood, xF - L.g2 / 2, top - cap, zL));
  }
  // inner railing
  const metal = M.blackMetal();
  const rx = w / 2 - L.fw + 0.03;
  for (let i = 1; i <= L.n1; i++) g.add(cyl(0.008, RAIL_H, metal, rx, i * L.riser, d / 2 - (i - 0.5) * L.g1, 6));
  const a = new THREE.Vector3(rx, L.riser + RAIL_H, d / 2 - 0.5 * L.g1);
  const b = new THREE.Vector3(rx, L.n1 * L.riser + RAIL_H, d / 2 - (L.n1 - 0.5) * L.g1);
  g.add(rod(a, b, 0.02, wood, 8));
  const rz = -d / 2 + L.fw - 0.03;
  const jEnd = Math.floor((h - RAIL_H - 0.03 - landTop) / L.riser);
  if (jEnd >= 1) {
    for (let j = 1; j <= jEnd; j++) g.add(cyl(0.008, RAIL_H, metal, w / 2 - L.fw - (j - 0.5) * L.g2, landTop + j * L.riser, rz, 6));
    if (jEnd > 1) g.add(rod(new THREE.Vector3(w / 2 - L.fw - 0.5 * L.g2, landTop + L.riser + RAIL_H, rz), new THREE.Vector3(w / 2 - L.fw - (jEnd - 0.5) * L.g2, landTop + jEnd * L.riser + RAIL_H, rz), 0.02, wood, 8));
  }
  // newel posts
  g.add(box(0.07, L.riser + RAIL_H + 0.05, 0.07, wood, rx, 0, d / 2 - 0.5 * L.g1));
  g.add(box(0.07, Math.min(h, landTop + RAIL_H + 0.05), 0.07, wood, rx, 0, rz));
  return g;
}

function planLStair(w: number, d: number): PlanShape[] {
  const L = lStairLayout(w, d, 2.8);
  const out: PlanShape[] = [P.poly([[w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2], [-w / 2, -d / 2 + L.fw], [w / 2 - L.fw, -d / 2 + L.fw], [w / 2 - L.fw, d / 2]])];
  for (let i = 1; i <= L.n1; i++) out.push(P.line(w / 2 - L.fw, d / 2 - i * L.g1, w / 2, d / 2 - i * L.g1));
  for (let j = 0; j < L.n2; j++) out.push(P.line(w / 2 - L.fw - j * L.g2, -d / 2, w / 2 - L.fw - j * L.g2, -d / 2 + L.fw));
  const cx = w / 2 - L.fw / 2, cy = -d / 2 + L.fw / 2;
  out.push(P.poly([[cx, d / 2 - L.g1 / 2], [cx, cy], [-w / 2 + L.g2 / 2, cy]], false));
  out.push(P.circle(cx, d / 2 - L.g1 / 2, 0.05));
  out.push(arrowHead(-w / 2 + L.g2 / 2 - 0.02, cy, -1, 0, Math.min(0.15, L.fw * 0.15)));
  return out;
}

/* ---------------------------- spiral stair ---------------------------- */

function spiralLayout(w: number, d: number, h: number) {
  const { steps, riser } = stepCount(h);
  const R = Math.min(w, d) / 2;
  const step = (Math.PI * 2 * 0.9) / steps;
  return { steps, riser, R, step };
}

function buildSpiralStair(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const S = spiralLayout(w, d, h);
  const wood = M.wood(color ?? C.oak);
  const metal = M.blackMetal();
  const core = clamp(S.R * 0.08, 0.05, 0.1);
  g.add(cyl(core, h, metal, 0, 0, 0, 16));
  const wedge = S.step * 1.08;
  const shape = new THREE.Shape();
  shape.moveTo(core * Math.cos(-wedge / 2), core * Math.sin(-wedge / 2));
  shape.absarc(0, 0, S.R - 0.005, -wedge / 2, wedge / 2, false);
  shape.lineTo(core * Math.cos(wedge / 2), core * Math.sin(wedge / 2));
  shape.closePath();
  const tt = Math.min(0.04, S.riser * 0.3);
  const railPts: THREE.Vector3[] = [];
  const br = S.R - 0.04;
  for (let i = 1; i <= S.steps; i++) {
    const th = -Math.PI / 2 + (i - 1) * S.step;
    const t = extrudeFlat(shape, tt, wood, i * S.riser - tt);
    t.rotation.y = th;
    g.add(t);
    // direction of the tread center in world coords
    const dx = Math.cos(th), dz = -Math.sin(th);
    const top = i * S.riser;
    const by = Math.min(RAIL_H, h - top - 0.03);
    if (by > 0.1) {
      g.add(cyl(0.008, by, metal, dx * br, top, dz * br, 6));
      railPts.push(new THREE.Vector3(dx * br, top + by, dz * br));
    }
  }
  if (railPts.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(railPts);
    g.add(mesh(new THREE.TubeGeometry(curve, railPts.length * 6, 0.02, 8, false), wood));
  }
  g.scale.set(w / (2 * S.R), 1, d / (2 * S.R));
  return g;
}

function planSpiralStair(w: number, d: number): PlanShape[] {
  const S = spiralLayout(w, d, 2.8);
  const rx = w / 2, ry = d / 2;
  const out: PlanShape[] = [P.circle(0, 0, Math.min(rx, ry)), P.circle(0, 0, Math.min(rx, ry) * 0.08)];
  // plan y = world z ; world dir for angle th is (cos th, -sin th)
  for (let i = 0; i <= S.steps; i++) {
    const th = -Math.PI / 2 + (i - 0.5) * S.step;
    out.push(P.line(Math.cos(th) * rx * 0.08, -Math.sin(th) * ry * 0.08, Math.cos(th) * rx, -Math.sin(th) * ry));
  }
  // arrow arc
  const pts: [number, number][] = [];
  const ar = 0.6;
  for (let i = 0; i <= 24; i++) {
    const th = -Math.PI / 2 + (i / 24) * (S.steps - 1) * S.step;
    pts.push([Math.cos(th) * rx * ar, -Math.sin(th) * ry * ar]);
  }
  out.push(P.poly(pts, false));
  const thE = -Math.PI / 2 + (S.steps - 1) * S.step;
  out.push(arrowHead(pts[pts.length - 1][0], pts[pts.length - 1][1], -Math.sin(thE), -Math.cos(thE), 0.12));
  return out;
}

/* ---------------------------- fireplace / chimney ---------------------------- */

function brickMat(): THREE.Material {
  return texMat('brick', '#a8604a', (ctx, s) => {
    ctx.fillStyle = '#d8d0c4';
    ctx.fillRect(0, 0, s, s);
    const rows = 8, bw = s / 4, bh = s / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < 5; c++) {
        const x = c * bw + (r % 2 ? bw / 2 : 0);
        const shade = 150 + ((r * 7 + c * 13) % 5) * 10;
        ctx.fillStyle = `rgb(${shade + 20}, ${Math.round(shade * 0.55)}, ${Math.round(shade * 0.42)})`;
        ctx.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
  }, { roughness: 0.95 });
}

function buildFireplace(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const surround = M.lacquer(color ?? C.white);
  const stone = M.stone('#9b958c');
  const hearthH = 0.06;
  const bodyD = d * 0.7;
  const bz = -d / 2 + bodyD / 2;
  g.add(box(w, hearthH, d, stone, 0, 0, 0));
  const ow = w * 0.55, oh = h * 0.55;
  const jw = (w - ow) / 2;
  const mantelT = 0.05;
  g.add(box(jw, h - mantelT - hearthH, bodyD, surround, -w / 2 + jw / 2, hearthH, bz));
  g.add(box(jw, h - mantelT - hearthH, bodyD, surround, w / 2 - jw / 2, hearthH, bz));
  g.add(box(ow, h - mantelT - hearthH - oh, bodyD, surround, 0, hearthH + oh, bz));
  g.add(box(w, mantelT, d * 0.85, M.wood(C.walnut), 0, h - mantelT, -d / 2 + (d * 0.85) / 2));
  // firebox
  g.add(box(ow, oh, 0.04, M.matte('#1a1a1a'), 0, hearthH, -d / 2 + 0.02));
  g.add(box(0.04, oh, bodyD - 0.04, M.matte('#2a2a2a'), -ow / 2 + 0.02, hearthH, bz + 0.02));
  g.add(box(0.04, oh, bodyD - 0.04, M.matte('#2a2a2a'), ow / 2 - 0.02, hearthH, bz + 0.02));
  // logs + flames
  const logR = Math.min(0.05, oh * 0.08);
  const lz = bz;
  for (const [x, z] of [[-ow * 0.12, lz - 0.03], [ow * 0.12, lz + 0.02]]) {
    const l = cyl(logR, ow * 0.55, M.bark(), 0, 0, 0, 10);
    l.rotation.z = Math.PI / 2;
    l.position.set(x, hearthH + logR, z);
    g.add(l);
  }
  const flame = mat('#ff9a3c', { emissive: '#ff7a1a', emissiveIntensity: 2, opacity: 0.9 });
  const flame2 = mat('#ffd36b', { emissive: '#ffc04a', emissiveIntensity: 2.2, opacity: 0.9 });
  const fh = oh * 0.45;
  g.add(frustum(ow * 0.35, 0.05, 0.01, 0.01, fh, flame, 0, hearthH + logR * 1.5, lz));
  g.add(frustum(ow * 0.15, 0.04, 0.01, 0.01, fh * 0.7, flame2, -ow * 0.1, hearthH + logR * 1.5, lz + 0.02));
  g.add(frustum(ow * 0.15, 0.04, 0.01, 0.01, fh * 0.6, flame2, ow * 0.12, hearthH + logR * 1.5, lz + 0.02));
  return g;
}

/* ---------------------------- items ---------------------------- */

export const structureItems: CatalogItem[] = [
  {
    id: 'stair-straight', name: 'Staircase, straight', category: 'structure', tags: ['stairs', 'staircase', 'steps', 'straight'],
    size: { w: 1.0, d: 3.9, h: 2.8 }, defaultColor: C.oak,
    build: (o) => buildStraightStair(o.w, o.d, o.h, o.color), plan: planStraightStair,
  },
  {
    id: 'stair-l', name: 'Staircase, L-shaped', category: 'structure', tags: ['stairs', 'staircase', 'l-shaped', 'landing', 'quarter turn'],
    size: { w: 2.4, d: 2.9, h: 2.8 }, defaultColor: C.oak,
    build: (o) => buildLStair(o.w, o.d, o.h, o.color), plan: planLStair,
  },
  {
    id: 'stair-spiral', name: 'Staircase, spiral', category: 'structure', tags: ['stairs', 'staircase', 'spiral', 'helical'],
    size: { w: 1.6, d: 1.6, h: 2.8 }, defaultColor: C.oak,
    build: (o) => buildSpiralStair(o.w, o.d, o.h, o.color), plan: planSpiralStair,
  },
  {
    id: 'column-round', name: 'Column, round', category: 'structure', tags: ['column', 'pillar', 'post', 'round'],
    size: { w: 0.3, d: 0.3, h: 2.8 }, defaultColor: C.white,
    build: (o) => {
      const g = new THREE.Group();
      const m = M.lacquer(o.color ?? C.white);
      const c = cyl(0.5, o.h, m, 0, 0, 0, 24);
      c.scale.set(o.w * 0.9, 1, o.d * 0.9);
      const b1 = cyl(0.5, 0.06, m, 0, 0, 0, 24);
      b1.scale.set(o.w, 1, o.d);
      const b2 = cyl(0.5, 0.06, m, 0, o.h - 0.06, 0, 24);
      b2.scale.set(o.w, 1, o.d);
      g.add(c, b1, b2);
      return g;
    },
    plan: (w, d) => [{ t: 'circle', cx: 0, cy: 0, r: Math.min(w, d) / 2, fill: true }],
  },
  {
    id: 'column-square', name: 'Column, square', category: 'structure', tags: ['column', 'pillar', 'post', 'square'],
    size: { w: 0.3, d: 0.3, h: 2.8 }, defaultColor: C.white,
    build: (o) => {
      const g = new THREE.Group();
      g.add(box(o.w, o.h, o.d, M.lacquer(o.color ?? C.white)));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d, 0, true)],
  },
  {
    id: 'fireplace', name: 'Fireplace', category: 'structure', tags: ['fireplace', 'hearth', 'mantel', 'fire'], light: true,
    size: { w: 1.5, d: 0.5, h: 1.15 }, defaultColor: C.white,
    build: (o) => buildFireplace(o.w, o.d, o.h, o.color),
    plan: (w, d) => {
      const ow = w * 0.55;
      const bodyD = d * 0.7;
      return [P.rect(0, 0, w, d), P.rect(0, -d / 2 + bodyD / 2, w, bodyD), P.rect(0, -d / 2 + bodyD / 2 + 0.02, ow, bodyD - 0.04, 0, true)];
    },
  },
  {
    id: 'chimney', name: 'Chimney breast', category: 'structure', tags: ['chimney', 'brick', 'flue', 'stack'],
    size: { w: 1.0, d: 0.5, h: 2.8 },
    build: (o) => {
      const g = new THREE.Group();
      const bm = o.color ? M.matte(o.color) : brickMat();
      g.add(box(o.w, o.h - 0.08, o.d, bm, 0, 0, 0));
      g.add(box(o.w, 0.08, o.d, M.stone('#8d8880'), 0, o.h - 0.08, 0));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(-w / 2, -d / 2, w / 2, d / 2), P.line(-w / 2, d / 2, w / 2, -d / 2)],
  },
  {
    id: 'kitchen-counter-run', name: 'Kitchen counter run', category: 'structure', tags: ['kitchen', 'counter', 'cabinets', 'worktop', 'run'],
    size: { w: 2.4, d: 0.62, h: 0.9 }, defaultColor: C.white,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const k = Math.max(1, Math.round(w / 0.6));
      const cw = w / k;
      const topT = 0.03;
      for (let i = 0; i < k; i++) {
        const c = buildCabinet(cw, d - 0.02, h - topT, {
          body: M.lacquer(o.color ?? C.white), plinth: 0.1,
          ...(i % 3 === 1 ? { drawers: 3 } : { drawers: 1, drawerZone: 0.2, doors: 1 }),
        });
        c.position.set(-w / 2 + cw * (i + 0.5), 0, -0.01);
        g.add(c);
      }
      g.add(box(w, topT, d, counterMat(), 0, h - topT, 0));
      return g;
    },
    plan: (w, d) => {
      const k = Math.max(1, Math.round(w / 0.6));
      const out = planCabinet(w, d);
      for (let i = 1; i < k; i++) out.push(P.line(-w / 2 + (w / k) * i, d / 2 - 0.05, -w / 2 + (w / k) * i, d / 2));
      return out;
    },
  },
  {
    id: 'railing', name: 'Railing / balustrade', category: 'structure', tags: ['railing', 'balustrade', 'banister', 'guard', 'handrail'],
    size: { w: 2.0, d: 0.06, h: 1.0 }, defaultColor: C.oak,
    build: (o) => {
      const { w, d, h } = o;
      const g = new THREE.Group();
      const wood = M.wood(o.color ?? C.oak);
      const metal = M.blackMetal();
      g.add(box(w, 0.05, d, wood, 0, h - 0.05, 0));
      g.add(box(w, 0.03, d * 0.6, metal, 0, 0.08, 0));
      const k = Math.max(2, Math.round(w / 0.11));
      for (let i = 0; i <= k; i++) g.add(box(0.015, h - 0.05, 0.015, metal, -w / 2 + 0.01 + ((w - 0.02) * i) / k, 0, 0));
      return g;
    },
    plan: (w, d) => [P.rect(0, 0, w, d), P.line(-w / 2, 0, w / 2, 0)],
  },
];

