import * as THREE from 'three';
import type { BuildOptions, PlanShape } from './types';
import {
  C, M, P, box, rbox, cyl, legs4, handleH, handleV, clamp, group, xform,
} from './materials';

/* ================================================================== */
/* Sofas                                                               */
/* ================================================================== */

export interface SofaDims { legH: number; armW: number; backD: number; seatTop: number; cushT: number }

export function sofaDims(w: number, d: number, h: number, arms = true): SofaDims {
  const legH = clamp(h * 0.1, 0.04, 0.12);
  const armW = arms ? clamp(w * 0.08, 0.08, 0.2) : 0;
  const backD = clamp(d * 0.2, 0.12, 0.25);
  const seatTop = h * 0.52;
  const cushT = clamp(seatTop * 0.3, 0.07, 0.16);
  return { legH, armW, backD, seatTop, cushT };
}

export function buildSofa(o: BuildOptions, seats: number, arms = true): THREE.Group {
  const { w, d, h } = o;
  const fab = M.fabric(o.color);
  const legM = M.wood(C.walnut);
  const s = sofaDims(w, d, h, arms);
  const g = new THREE.Group();
  g.add(legs4(w, d, s.legH, legM, { inset: 0.06, r: 0.018, taper: 0.7 }));
  const baseTop = s.seatTop - s.cushT;
  g.add(rbox(w, baseTop - s.legH, d, fab, 0.02, 0, s.legH, 0));
  g.add(rbox(w, h - s.legH, s.backD, fab, 0.04, 0, s.legH, -d / 2 + s.backD / 2));
  const armH = s.seatTop + (h - s.seatTop) * 0.4;
  if (arms) {
    for (const sx of [-1, 1]) g.add(rbox(s.armW, armH - s.legH, d, fab, 0.05, sx * (w / 2 - s.armW / 2), s.legH, 0));
  }
  const innerW = w - 2 * s.armW;
  const cw = innerW / seats;
  const seatD = d - s.backD;
  const bcT = clamp(d * 0.17, 0.08, 0.2);
  for (let i = 0; i < seats; i++) {
    const x = -innerW / 2 + cw * (i + 0.5);
    g.add(rbox(cw - 0.012, s.cushT, seatD - 0.01, fab, 0.045, x, baseTop, s.backD / 2 - 0.005));
    g.add(rbox(cw - 0.02, (h - 0.03) - s.seatTop, bcT, fab, 0.06, x, s.seatTop, -d / 2 + s.backD + bcT / 2));
  }
  return g;
}

export function planSofa(w: number, d: number, seats: number, arms = true): PlanShape[] {
  const s = sofaDims(w, d, 0.85, arms);
  const out: PlanShape[] = [P.rect(0, 0, w, d, 0.04)];
  out.push(P.rect(0, -d / 2 + s.backD / 2, w - 2 * s.armW, s.backD, 0.02));
  if (arms) for (const sx of [-1, 1]) out.push(P.rect(sx * (w / 2 - s.armW / 2), 0, s.armW, d, 0.03));
  const innerW = w - 2 * s.armW;
  const cw = innerW / seats;
  for (let i = 1; i < seats; i++) {
    const x = -innerW / 2 + cw * i;
    out.push(P.line(x, -d / 2 + s.backD, x, d / 2 - 0.02));
  }
  return out;
}

/** L-shaped sectional with chaise on the right (+x) side extending to the front. */
function lDims(w: number, d: number) {
  const mainD = clamp(d * 0.6, 0.6, Math.min(1.05, d - 0.3));
  const chaiseW = clamp(w * 0.32, 0.7, Math.min(1.1, w * 0.5));
  return { mainD, chaiseW };
}

export function buildLSofa(o: BuildOptions): THREE.Group {
  const { w, d, h } = o;
  const fab = M.fabric(o.color);
  const s = sofaDims(w, d * 0.6, h, true);
  const { mainD, chaiseW } = lDims(w, d);
  const g = new THREE.Group();
  const legM = M.wood(C.walnut);
  const baseTop = s.seatTop - s.cushT;
  // legs
  const lp: [number, number][] = [
    [-w / 2 + 0.06, -d / 2 + 0.06], [w / 2 - 0.06, -d / 2 + 0.06], [-w / 2 + 0.06, -d / 2 + mainD - 0.06],
    [w / 2 - 0.06, d / 2 - 0.06], [w / 2 - chaiseW + 0.06, d / 2 - 0.06],
  ];
  for (const [x, z] of lp) g.add(cyl(0.018, s.legH, legM, x, 0, z, 12, 0.013));
  // bases
  g.add(rbox(w, baseTop - s.legH, mainD, fab, 0.02, 0, s.legH, -d / 2 + mainD / 2));
  g.add(rbox(chaiseW, baseTop - s.legH, d - mainD + 0.02, fab, 0.02, w / 2 - chaiseW / 2, s.legH, (mainD + 0.02) / 2 - 0.01));
  // back
  g.add(rbox(w, h - s.legH, s.backD, fab, 0.04, 0, s.legH, -d / 2 + s.backD / 2));
  // arms: left (main depth), right (full depth)
  const armH = s.seatTop + (h - s.seatTop) * 0.4;
  g.add(rbox(s.armW, armH - s.legH, mainD, fab, 0.05, -w / 2 + s.armW / 2, s.legH, -d / 2 + mainD / 2));
  g.add(rbox(s.armW, armH - s.legH, d, fab, 0.05, w / 2 - s.armW / 2, s.legH, 0));
  // seat cushions
  const mainInner = w - s.armW - chaiseW;
  const seats = Math.max(1, Math.round(mainInner / 0.7));
  const cw = mainInner / seats;
  const seatD = mainD - s.backD;
  const bcT = clamp(mainD * 0.17, 0.08, 0.2);
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + s.armW + cw * (i + 0.5);
    g.add(rbox(cw - 0.012, s.cushT, seatD - 0.01, fab, 0.045, x, baseTop, -d / 2 + s.backD + seatD / 2));
    g.add(rbox(cw - 0.02, h - 0.03 - s.seatTop, bcT, fab, 0.06, x, s.seatTop, -d / 2 + s.backD + bcT / 2));
  }
  const chInner = chaiseW - s.armW;
  const chX = w / 2 - s.armW - chInner / 2;
  const chD = d - s.backD;
  g.add(rbox(chInner - 0.012, s.cushT, chD - 0.01, fab, 0.045, chX, baseTop, -d / 2 + s.backD + chD / 2));
  g.add(rbox(chInner - 0.02, h - 0.03 - s.seatTop, bcT, fab, 0.06, chX, s.seatTop, -d / 2 + s.backD + bcT / 2));
  return g;
}

export function planLSofa(w: number, d: number): PlanShape[] {
  const s = sofaDims(w, d * 0.6, 0.85, true);
  const { mainD, chaiseW } = lDims(w, d);
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  const out: PlanShape[] = [
    P.poly([[x0, y0], [x1, y0], [x1, y1], [x1 - chaiseW, y1], [x1 - chaiseW, y0 + mainD], [x0, y0 + mainD]]),
    P.rect(0, y0 + s.backD / 2, w - 2 * s.armW, s.backD),
    P.rect(x0 + s.armW / 2, y0 + mainD / 2, s.armW, mainD, 0.03),
    P.rect(x1 - s.armW / 2, 0, s.armW, d, 0.03),
    P.line(x1 - chaiseW, y0 + s.backD, x1 - chaiseW, y0 + mainD),
  ];
  const mainInner = w - s.armW - chaiseW;
  const seats = Math.max(1, Math.round(mainInner / 0.7));
  for (let i = 1; i < seats; i++) {
    const x = x0 + s.armW + (mainInner / seats) * i;
    out.push(P.line(x, y0 + s.backD, x, y0 + mainD));
  }
  return out;
}

/* ================================================================== */
/* Chairs & tables                                                     */
/* ================================================================== */

export interface ChairOpts { color?: string; upholstered?: boolean; wood?: string; arms?: boolean; metal?: boolean }

/** Dining-style chair filling w×d×h, front +Z. */
export function buildChair(w: number, d: number, h: number, opts: ChairOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const frame = opts.metal ? M.blackMetal() : M.wood(opts.wood ?? C.oak);
  const seatM = opts.upholstered ? M.fabric(opts.color ?? C.greige) : (opts.color ? M.wood(opts.color) : frame);
  const seatH = Math.min(h * 0.53, 0.5 * (h / 0.85));
  const seatT = clamp(h * 0.05, 0.03, 0.07);
  const legR = clamp(w * 0.035, 0.012, 0.025);
  g.add(legs4(w, d, seatH - seatT, frame, { inset: legR + 0.015, r: legR, taper: 0.75 }));
  g.add(rbox(w, seatT, d, seatM, 0.015, 0, seatH - seatT, 0));
  // back posts + backrest
  const postY = seatH;
  const postH = h - seatH;
  for (const sx of [-1, 1]) g.add(box(legR * 2, postH, legR * 2, frame, sx * (w / 2 - legR - 0.015), postY, -d / 2 + legR + 0.015));
  const brH = postH * 0.45;
  g.add(rbox(w - 0.02, brH, clamp(d * 0.06, 0.02, 0.05), opts.upholstered ? seatM : frame, 0.012, 0, h - brH, -d / 2 + legR + 0.015));
  if (opts.arms) {
    const armY = seatH + postH * 0.4;
    for (const sx of [-1, 1]) g.add(box(0.04, 0.03, d - 0.02, frame, sx * (w / 2 - 0.02), armY, 0.0));
  }
  return g;
}

export function chairPlanPts(cw: number, cd: number): { seat: [number, number][]; back: [number, number][] } {
  const bt = Math.min(0.06, cd * 0.15);
  return {
    seat: [[-cw / 2, -cd / 2], [cw / 2, -cd / 2], [cw / 2, cd / 2], [-cw / 2, cd / 2]],
    back: [[-cw / 2, -cd / 2], [cw / 2, -cd / 2], [cw / 2, -cd / 2 + bt], [-cw / 2, -cd / 2 + bt]],
  };
}

/** Chair plan symbol at (cx, cy) facing direction (fx, fy). */
export function planChair(cx: number, cy: number, cw: number, cd: number, fx = 0, fy = 1): PlanShape[] {
  const a = Math.atan2(-fx, fy);
  const p = chairPlanPts(cw, cd);
  return [P.poly(xform(p.seat, a, cx, cy)), P.poly(xform(p.back, a, cx, cy), true, true)];
}

export interface TableOpts { color?: string; round?: boolean; metalLegs?: boolean; topM?: THREE.Material; pedestal?: boolean; glass?: boolean; shelf?: boolean }

export function buildTable(w: number, d: number, h: number, opts: TableOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const top = opts.topM ?? (opts.glass ? M.glass() : M.wood(opts.color ?? C.oak));
  const legM = opts.metalLegs ? M.blackMetal() : M.wood(opts.color ?? C.oak);
  const t = clamp(h * 0.045, 0.02, 0.045);
  if (opts.round) {
    const r = 0.5;
    const tm = cyl(r, t, top, 0, h - t, 0, 40);
    tm.scale.set(w, 1, d);
    g.add(tm);
    if (opts.pedestal) {
      const pr = Math.min(w, d) * 0.06;
      g.add(cyl(pr, h - t, legM, 0, 0, 0, 20));
      const base = cyl(Math.min(w, d) * 0.28, 0.03, legM, 0, 0, 0, 32);
      g.add(base);
    } else {
      const k = 0.34;
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(cyl(0.02, h - t, legM, sx * w * k * 0.75, 0, sz * d * k * 0.75, 12, 0.016));
    }
    return g;
  }
  g.add(rbox(w, t, d, top, Math.min(0.01, t / 2), 0, h - t, 0));
  const legR = clamp(Math.min(w, d) * 0.03, 0.015, 0.03);
  g.add(legs4(w, d, h - t, legM, { inset: legR + Math.min(0.06, Math.min(w, d) * 0.08), r: legR, square: !opts.metalLegs }));
  if (!opts.glass) {
    const ap = Math.min(0.08, h * 0.12);
    const inset = legR + Math.min(0.06, Math.min(w, d) * 0.08);
    g.add(box(w - 2 * inset, ap, 0.02, legM, 0, h - t - ap, d / 2 - inset));
    g.add(box(w - 2 * inset, ap, 0.02, legM, 0, h - t - ap, -d / 2 + inset));
  }
  if (opts.shelf) g.add(box(w - 0.12, 0.02, d - 0.12, top, 0, h * 0.25, 0));
  return g;
}

/* ================================================================== */
/* Cabinets                                                            */
/* ================================================================== */

export interface CabOpts {
  body?: THREE.Material;
  front?: THREE.Material;
  handle?: THREE.Material | null;
  doors?: number;          // number of door columns in the door zone
  drawers?: number;        // number of drawers
  drawerZone?: number;     // fraction of front height for drawers (top). 1 = all drawers
  plinth?: number;         // plinth height
  legs?: number;           // leg height (instead of plinth)
  top?: THREE.Material;    // countertop material
  topT?: number;           // countertop thickness
  handleStyle?: 'bar' | 'none';
  doorHandleV?: boolean;   // vertical door handles (default true)
  glassDoors?: boolean;
}

export function buildCabinet(w: number, d: number, h: number, o: CabOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const body = o.body ?? M.lacquer(C.white);
  const front = o.front ?? body;
  const handle = o.handle === undefined ? M.steel() : o.handle;
  const frontT = 0.018;
  const gap = 0.004;
  const topT = o.top ? (o.topT ?? 0.03) : 0;
  let y0 = 0;
  if (o.legs) {
    g.add(legs4(w, d - frontT, o.legs, M.wood(C.walnut), { inset: 0.05, r: 0.015 }));
    y0 = o.legs;
  } else if (o.plinth) {
    g.add(box(w - 0.02, o.plinth, d - 0.07, M.matte(C.charcoal), 0, 0, -0.035));
    y0 = o.plinth;
  }
  const y1 = h - topT;
  // handles protrude ~28mm; keep them inside the d box
  const hp = handle && o.handleStyle !== 'none' ? 0.028 : 0;
  const ff = d / 2 - hp; // front face z
  g.add(box(w, y1 - y0, d - hp - frontT, body, 0, y0, -d / 2 + (d - hp - frontT) / 2));
  if (o.top) g.add(box(w, topT, d, o.top, 0, y1, 0));
  const fz = ff - frontT / 2;
  const fh = y1 - y0;
  const drawers = o.drawers ?? 0;
  const doors = o.doors ?? (drawers ? 0 : Math.max(1, Math.round(w / 0.6)));
  const dz = drawers ? (doors ? (o.drawerZone ?? 0.25) : 1) : 0;
  const drawerH = drawers ? (fh * dz) / drawers : 0;
  for (let i = 0; i < drawers; i++) {
    const yt = y1 - i * drawerH;
    const ph = drawerH - gap;
    g.add(box(w - gap * 2, ph, frontT, front, 0, yt - drawerH + gap / 2, fz));
    if (handle && o.handleStyle !== 'none') g.add(handleH(Math.min(0.3, w * 0.4), handle, 0, yt - drawerH / 2, ff));
  }
  if (doors) {
    const doorTop = y1 - fh * dz;
    const dh = doorTop - y0 - gap;
    const dw = w / doors;
    for (let i = 0; i < doors; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      const fm = o.glassDoors ? M.glass() : front;
      if (o.glassDoors) {
        // frame
        const fr = 0.04;
        g.add(box(dw - gap, fr, frontT, front, x, y0 + gap / 2, fz));
        g.add(box(dw - gap, fr, frontT, front, x, doorTop - fr - gap / 2, fz));
        g.add(box(fr, dh - 2 * fr, frontT, front, x - dw / 2 + fr / 2 + gap / 2, y0 + fr + gap / 2, fz));
        g.add(box(fr, dh - 2 * fr, frontT, front, x + dw / 2 - fr / 2 - gap / 2, y0 + fr + gap / 2, fz));
        g.add(box(dw - 2 * fr, dh - 2 * fr, 0.006, fm, x, y0 + fr + gap / 2, fz));
      } else {
        g.add(box(dw - gap, dh, frontT, fm, x, y0 + gap / 2, fz));
      }
      if (handle && o.handleStyle !== 'none') {
        // handle on the inner edge: pairs meet in the middle; single door gets it on the right
        const side = doors === 1 ? 1 : (i % 2 === 0 ? 1 : -1);
        const hx = x + side * (dw / 2 - 0.05);
        if (o.doorHandleV === false) g.add(handleH(Math.min(0.2, dw * 0.5), handle, x, doorTop - 0.06, ff));
        else {
          const hl = clamp(dh * 0.25, 0.1, 0.4);
          const hy = dh > 1.2 ? y0 + dh * 0.5 : doorTop - hl / 2 - 0.06;
          g.add(handleV(hl, handle, hx, hy, ff));
        }
      }
    }
  }
  return g;
}

/** Plan of a cabinet: outline + front line + optional door swing diagonals. */
export function planCabinet(w: number, d: number, doors = 0, swing = false): PlanShape[] {
  const out: PlanShape[] = [P.rect(0, 0, w, d), P.line(-w / 2, d / 2 - 0.03, w / 2, d / 2 - 0.03)];
  if (doors > 0) {
    const dw = w / doors;
    for (let i = 0; i < doors; i++) {
      const x0 = -w / 2 + dw * i;
      if (swing) out.push(P.line(x0, d / 2, x0 + dw, -d / 2));
      if (i > 0) out.push(P.line(x0, d / 2 - 0.03, x0, d / 2));
    }
  }
  return out;
}

/** Wardrobe plan: outline + hanging rail + diagonal door line(s). */
export function planWardrobe(w: number, d: number, doors: number): PlanShape[] {
  const out = planCabinet(w, d, doors, true);
  out.push(P.line(-w / 2 + 0.05, 0, w / 2 - 0.05, 0));
  return out;
}

/* ================================================================== */
/* Beds                                                                */
/* ================================================================== */

export interface BedOpts { pillows?: number; duvet?: string; noHeadboard?: boolean }

function bedDims(d: number, h: number) {
  const hbT = clamp(d * 0.04, 0.05, 0.1);
  const legH = clamp(h * 0.08, 0.04, 0.12);
  const frameTop = clamp(h * 0.3, 0.2, 0.4);
  const mattT = clamp(h * 0.22, 0.12, 0.28);
  return { hbT, legH, frameTop, mattT };
}

export function buildBed(o: BuildOptions, opts: BedOpts = {}): THREE.Group {
  const { w, d, h } = o;
  const g = new THREE.Group();
  const fab = M.fabric(o.color);
  const b = bedDims(d, h);
  const mattTop = Math.min(b.frameTop + b.mattT, h * 0.72);
  // legs + frame
  g.add(legs4(w, d, b.legH, M.wood(C.walnut), { inset: 0.06, r: 0.022, square: true }));
  g.add(rbox(w, b.frameTop - b.legH, d - b.hbT, fab, 0.02, 0, b.legH, b.hbT / 2));
  if (!opts.noHeadboard) g.add(rbox(w, h - b.legH, b.hbT, fab, 0.03, 0, b.legH, -d / 2 + b.hbT / 2));
  // mattress
  const mw = w - 0.04;
  const md = d - b.hbT - 0.03;
  const mz = b.hbT / 2;
  g.add(rbox(mw, mattTop - b.frameTop + 0.02, md, M.matte(C.white), 0.05, 0, b.frameTop - 0.02, mz));
  // duvet over the front ~70%
  const duvetM = M.fabric(opts.duvet ?? C.linen);
  const dd = md * 0.72;
  const dzc = d / 2 - dd / 2 - 0.01;
  g.add(rbox(w - 0.01, 0.06, dd, duvetM, 0.03, 0, mattTop - 0.03, dzc));
  // turned-down fold
  g.add(rbox(w - 0.008, 0.07, 0.18, M.fabric(C.white), 0.03, 0, mattTop - 0.03, d / 2 - dd + 0.08));
  // pillows
  const np = opts.pillows ?? (w > 1.2 ? 2 : 1);
  const pw = Math.min(0.7, (mw - 0.1) / np - 0.04);
  const pd = Math.min(0.45, md * 0.2);
  for (let i = 0; i < np; i++) {
    const x = -mw / 2 + (mw / np) * (i + 0.5);
    g.add(rbox(pw, Math.min(0.14, h - mattTop), pd, M.fabric(C.white), 0.06, x, mattTop, -d / 2 + b.hbT + 0.04 + pd / 2));
  }
  return g;
}

export function planBed(w: number, d: number, pillows?: number): PlanShape[] {
  const hbT = clamp(d * 0.04, 0.05, 0.1);
  const md = d - hbT - 0.03;
  const out: PlanShape[] = [P.rect(0, 0, w, d), P.rect(0, -d / 2 + hbT / 2, w, hbT, 0, true)];
  const np = pillows ?? (w > 1.2 ? 2 : 1);
  const mw = w - 0.04;
  const pw = Math.min(0.7, (mw - 0.1) / np - 0.04);
  const pd = Math.min(0.45, md * 0.2);
  for (let i = 0; i < np; i++) {
    const x = -mw / 2 + (mw / np) * (i + 0.5);
    out.push(P.rect(x, -d / 2 + hbT + 0.04 + pd / 2, pw, pd, 0.06));
  }
  const fy = d / 2 - md * 0.72;
  out.push(P.line(-w / 2, fy, w / 2, fy));
  // turned-down corner
  const k = Math.min(0.35, w * 0.3);
  out.push(P.poly([[-w / 2, fy], [-w / 2 + k, fy], [-w / 2, fy + k]]));
  out.push(P.line(-w / 2, fy + 0.18, w / 2, fy + 0.18));
  return out;
}

/* ================================================================== */
/* Misc shared bits                                                    */
/* ================================================================== */

/** A tap/faucet (spout toward +z), base at y, total height hh. */
export function faucet(hh: number, x: number, y: number, z: number, reach = 0.12): THREE.Group {
  const m = M.chrome();
  const r = clamp(hh * 0.07, 0.008, 0.016);
  return group(
    cyl(r * 1.6, 0.02, m, x, y, z, 16),
    cyl(r, hh - r, m, x, y, z, 12),
    box(r * 2, r * 1.6, reach, m, x, y + hh - r * 1.6, z + reach / 2),
    box(r * 1.2, 0.02, r * 2, m, x, y + hh - r * 1.6 - 0.015, z + reach - r),
  );
}

export { group };
