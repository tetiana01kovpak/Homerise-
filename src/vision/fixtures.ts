// Ground-truth floor plans (meters) of increasing difficulty used to test the
// raster vectorizer. Walls are maximal (not split at T-junctions); corners are
// end-to-end joints. `expectedRooms` counts enclosed regions >= ~1 m².

import type {
  PlanSpec, RenderOptions, SpecColumn, SpecFurniture, SpecLabel, SpecOpening, SpecWall, FurnitureKind,
} from './synth';

export interface Fixture { spec: PlanSpec; render: RenderOptions }

class B {
  walls: SpecWall[] = [];
  openings: SpecOpening[] = [];
  furniture: SpecFurniture[] = [];
  labels: SpecLabel[] = [];
  columns: SpecColumn[] = [];

  w(x1: number, y1: number, x2: number, y2: number, t: number): number {
    this.walls.push({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: t });
    return this.walls.length - 1;
  }
  private tOf(wi: number, at: number): number {
    const w = this.walls[wi];
    return Math.abs(w.b.x - w.a.x) >= Math.abs(w.b.y - w.a.y) ? Math.abs(at - w.a.x) : Math.abs(at - w.a.y);
  }
  /** Door centered at world coordinate `at` along the wall axis. */
  door(wi: number, at: number, width = 0.85, swing: 1 | -1 = 1, hingeAtEnd = false, double = false): this {
    this.openings.push({ wallIndex: wi, kind: 'door', t: this.tOf(wi, at), width, swing, hingeAtEnd, double });
    return this;
  }
  win(wi: number, at: number, width = 1.2): this {
    this.openings.push({ wallIndex: wi, kind: 'window', t: this.tOf(wi, at), width });
    return this;
  }
  /** Opening by distance from wall.a (for diagonal walls). */
  doorT(wi: number, t: number, width = 0.85, swing: 1 | -1 = 1): this {
    this.openings.push({ wallIndex: wi, kind: 'door', t, width, swing });
    return this;
  }
  winT(wi: number, t: number, width = 1.2): this {
    this.openings.push({ wallIndex: wi, kind: 'window', t, width });
    return this;
  }
  f(kind: FurnitureKind, x: number, y: number, w: number, h: number, rot = 0): this {
    this.furniture.push({ kind, x, y, w, h, rot });
    return this;
  }
  label(x: number, y: number, chars: number, size = 0.24, bold = false): this {
    this.labels.push({ x, y, chars, size, bold });
    return this;
  }
  col(x: number, y: number, size = 0.3): this {
    this.columns.push({ x, y, size });
    return this;
  }
  /** Rectangle exterior with given thickness: returns [top, bottom, left, right]. */
  box(x0: number, y0: number, x1: number, y1: number, t: number): [number, number, number, number] {
    return [this.w(x0, y0, x1, y0, t), this.w(x0, y1, x1, y1, t), this.w(x0, y0, x0, y1, t), this.w(x1, y0, x1, y1, t)];
  }
  build(name: string, expectedRooms: number, dimensions = false): PlanSpec {
    return {
      name, walls: this.walls, openings: this.openings, expectedRooms,
      furniture: this.furniture, labels: this.labels, columns: this.columns, dimensions,
    };
  }
}

// 1. Studio ------------------------------------------------------------------
function studio(): Fixture {
  const b = new B();
  const [top, bot, , right] = b.box(0, 0, 6, 5, 0.25);
  const bh = b.w(0, 3, 2.2, 3, 0.12);
  const bv = b.w(2.2, 3, 2.2, 5, 0.12);
  b.door(bot, 4.2, 0.9, -1).door(bv, 4.0, 0.8, 1, true);
  b.win(top, 2, 1.4).win(top, 4.5, 1.2).win(right, 2.5, 1.2);
  void bh;
  b.f('bed', 1.3, 1.3, 1.6, 2.0).f('sofa', 4.2, 2.2, 2.0, 0.9).f('table', 4.5, 1.0, 0.8, 0.8)
    .f('counter', 4.6, 4.5, 2.2, 0.6).f('bath', 0.9, 4.2, 1.4, 0.7).f('wc', 1.8, 3.4, 0.4, 0.6);
  b.label(3.2, 2.9, 6).label(1.0, 3.6, 4, 0.2);
  return { spec: b.build('studio', 2), render: { pxPerMeter: 60, seed: 1 } };
}

// 2. One-bedroom apartment -------------------------------------------------------
function oneBed(): Fixture {
  const b = new B();
  const [top, bot, left, right] = b.box(0, 0, 9, 7, 0.25);
  const v55 = b.w(5.5, 0, 5.5, 7, 0.12);
  b.w(5.5, 4, 9, 4, 0.12);
  const h5 = b.w(0, 5, 2.5, 5, 0.12);
  b.w(2.5, 5, 2.5, 7, 0.12);
  b.door(bot, 1.25, 0.9, -1).door(h5, 1.25, 0.8, -1).door(v55, 2.5, 0.8, -1).door(v55, 5.5, 0.8, -1, true);
  b.win(top, 2.5, 1.6).win(top, 7.2, 1.4).win(left, 2.5, 1.2).win(right, 5.5, 0.8);
  b.f('sofa', 2.5, 3.6, 2.2, 0.9).f('table', 2.5, 1.6, 1.2, 0.8).f('bed', 7.4, 1.8, 1.6, 2.0)
    .f('bath', 8.2, 5.5, 0.7, 1.6, 0).f('wc', 6.2, 6.4, 0.4, 0.6, Math.PI).f('counter', 4.2, 0.5, 1.8, 0.6);
  b.label(3.2, 2.8, 6).label(7.2, 3.2, 7).label(7.2, 5.6, 4).label(1.2, 6.0, 4);
  return { spec: b.build('1-bed apartment', 4), render: { pxPerMeter: 50, seed: 2 } };
}

// 3. Two-bedroom -------------------------------------------------------------------
function twoBed(): Fixture {
  const b = new B();
  const [top, bot, left, right] = b.box(0, 0, 11, 8, 0.3);
  const v4 = b.w(4, 0, 4, 8, 0.12);
  const h35 = b.w(4, 3.5, 11, 3.5, 0.12);
  const h47 = b.w(4, 4.7, 11, 4.7, 0.12);
  b.w(7.5, 0, 7.5, 3.5, 0.12);
  b.w(7, 4.7, 7, 8, 0.12);
  const h5 = b.w(0, 5, 4, 5, 0.12);
  b.door(v4, 4.1, 0.8, 1).door(h35, 5.75, 0.8, -1).door(h35, 9.25, 0.8, -1, true).door(h47, 5.5, 0.8, 1)
    .door(h47, 9, 0.8, 1, true).door(h5, 2, 0.9, 1).door(right, 4.1, 0.9, 1);
  b.win(top, 2, 1.6).win(top, 5.75, 1.2).win(top, 9.25, 1.2).win(left, 2.5, 1.4).win(left, 6.5, 1.0)
    .win(bot, 2, 1.2).win(bot, 5.5, 0.6).win(bot, 9, 1.0);
  b.f('sofa', 2, 3.8, 2.2, 0.9).f('table', 2, 1.8, 1.0, 1.0).f('counter', 2, 7.5, 2.6, 0.6)
    .f('bed', 5.75, 1.6, 1.6, 2.0).f('bed', 9.25, 1.4, 1.0, 2.0).f('bath', 5.5, 7.4, 1.6, 0.7)
    .f('rect', 9.5, 6.5, 1.2, 0.6);
  b.label(2, 2.9, 6).label(2, 6.3, 7).label(5.75, 2.8, 5).label(9.25, 2.8, 5).label(7.5, 4.1, 8, 0.2)
    .label(5.5, 6.0, 4).label(9, 6.0, 7);
  return { spec: b.build('2-bed apartment', 7), render: { pxPerMeter: 45, seed: 3 } };
}

// 4. Three-bedroom house --------------------------------------------------------------
function threeBed(): Fixture {
  const b = new B();
  const [top, bot, left, right] = b.box(0, 0, 14, 10, 0.3);
  const h4 = b.w(0, 4, 14, 4, 0.15);
  const h54 = b.w(0, 5.4, 14, 5.4, 0.15);
  b.w(4, 0, 4, 4, 0.15);
  b.w(8, 0, 8, 4, 0.15);
  b.w(10.5, 0, 10.5, 4, 0.15);
  const v7 = b.w(7, 5.4, 7, 10, 0.15);
  b.w(11, 5.4, 11, 10, 0.15);
  const h75 = b.w(11, 7.5, 14, 7.5, 0.15);
  b.door(h4, 2, 0.85, -1).door(h4, 6, 0.85, -1, true).door(h4, 9.25, 0.75, -1).door(h4, 12.25, 0.85, -1)
    .door(h54, 3.5, 1.0, 1).door(h54, 9, 0.85, 1).door(h54, 12.5, 0.8, 1, true).door(h75, 12.5, 0.8, 1)
    .door(v7, 7.7, 0.9, 1).door(left, 4.7, 0.9, 1);
  b.win(top, 2, 1.4).win(top, 6, 1.4).win(top, 9.25, 0.7).win(top, 12.25, 1.4)
    .win(bot, 2, 2.0).win(bot, 5, 1.2).win(bot, 9, 1.4).win(bot, 12.5, 1.0)
    .win(left, 2, 1.2).win(left, 7.7, 1.6).win(right, 2, 1.2).win(right, 6.5, 1.0);
  b.f('bed', 2, 1.6, 1.6, 2.0).f('bed', 6, 1.6, 1.4, 2.0).f('bed', 12.25, 1.6, 1.6, 2.0)
    .f('bath', 9.25, 0.6, 1.6, 0.7).f('sofa', 3.5, 8.6, 2.4, 0.9).f('table', 3.5, 7, 1.2, 0.8)
    .f('counter', 9, 9.5, 3, 0.6).f('island', 9, 7.4, 1.6, 0.8);
  b.label(2, 3, 6).label(6, 3, 6).label(12.25, 3, 6).label(7, 4.7, 8, 0.2).label(4, 6.2, 6)
    .label(9, 6.2, 7).label(12.5, 6.4, 7).label(12.5, 8.8, 7);
  return { spec: b.build('3-bed house', 9), render: { pxPerMeter: 40, seed: 4 } };
}

// 5. L-shaped house ----------------------------------------------------------------------
function lShape(): Fixture {
  const b = new B();
  const t = 0.25, ti = 0.12;
  const w0 = b.w(0, 0, 10, 0, t);
  const w1 = b.w(10, 0, 10, 5, t);
  const w2 = b.w(5, 5, 10, 5, t);
  const w3 = b.w(5, 5, 5, 9, t);
  const w4 = b.w(0, 9, 5, 9, t);
  const w5 = b.w(0, 0, 0, 9, t);
  const w6 = b.w(5, 0, 5, 5, ti);
  const w7 = b.w(0, 4.5, 5, 4.5, ti);
  const w8 = b.w(7.5, 0, 7.5, 5, ti);
  b.w(0, 7, 2, 7, ti);
  const w10 = b.w(2, 7, 2, 9, ti);
  b.door(w6, 2, 0.9, 1).door(w8, 2.5, 0.8, 1).door(w7, 3.5, 0.8, 1).door(w10, 8, 0.7, -1).door(w5, 2, 0.9, 1);
  b.win(w0, 2.5, 1.5).win(w0, 6.25, 1.2).win(w0, 8.75, 0.8).win(w1, 2.5, 1.2).win(w2, 6.25, 1.0)
    .win(w2, 8.75, 1.0).win(w3, 7, 1.4).win(w4, 3.5, 1.2);
  b.f('sofa', 2.5, 3.6, 2.2, 0.9).f('table', 2.5, 1.8, 1.0, 1.0).f('counter', 6.25, 0.5, 2.0, 0.6)
    .f('bath', 8.75, 4.4, 1.6, 0.7).f('bed', 3.5, 6.6, 1.6, 2.0).f('rect', 1, 8.1, 1.4, 1.0);
  b.label(2.5, 2.6, 6).label(6.25, 2.6, 7).label(8.75, 2.6, 4).label(3.5, 5.0, 7).label(1, 8.0, 3, 0.18);
  return { spec: b.build('L-shaped house', 5), render: { pxPerMeter: 55, seed: 5 } };
}

// 6. U-shaped house ------------------------------------------------------------------------
function uShape(): Fixture {
  const b = new B();
  const t = 0.25, ti = 0.12;
  const w0 = b.w(0, 0, 12, 0, t);
  const w1 = b.w(12, 0, 12, 9, t);
  const w2 = b.w(8.5, 9, 12, 9, t);
  const w3 = b.w(8.5, 4, 8.5, 9, t);
  const w4 = b.w(3.5, 4, 8.5, 4, t);
  const w5 = b.w(3.5, 4, 3.5, 9, t);
  const w6 = b.w(0, 9, 3.5, 9, t);
  const w7 = b.w(0, 0, 0, 9, t);
  const l4 = b.w(0, 4, 3.5, 4, ti);
  const l65 = b.w(0, 6.5, 3.5, 6.5, ti);
  const r4 = b.w(8.5, 4, 12, 4, ti);
  const r65 = b.w(8.5, 6.5, 12, 6.5, ti);
  const v6 = b.w(6, 0, 6, 4, ti);
  b.door(v6, 2, 0.9, 1).door(l4, 1.75, 0.8, 1).door(l65, 1.75, 0.8, 1).door(r4, 10.25, 0.8, 1)
    .door(r65, 10.25, 0.8, 1).door(w4, 4.75, 1.0, -1);
  b.win(w0, 3, 1.6).win(w0, 9, 1.6).win(w7, 5.25, 1.0).win(w7, 7.75, 1.0).win(w1, 2, 1.2)
    .win(w1, 5.25, 1.0).win(w1, 7.75, 1.0).win(w6, 1.75, 1.2).win(w2, 10.25, 1.2)
    .win(w5, 5.25, 1.0).win(w5, 7.75, 1.0).win(w3, 5.25, 1.0).win(w3, 7.75, 1.0).win(w4, 7.25, 1.4);
  b.f('sofa', 3, 2.8, 2.4, 0.9).f('table', 9, 2, 1.6, 0.9).f('bed', 1.75, 7.8, 1.4, 1.9)
    .f('bed', 10.25, 7.8, 1.4, 1.9).f('bath', 1.75, 4.6, 1.5, 0.7).f('counter', 10.3, 5.0, 2.4, 0.6);
  b.label(3, 1.5, 6).label(9, 3.2, 7).label(1.75, 5.6, 4).label(10.25, 5.8, 7).label(1.75, 7.0, 5)
    .label(10.25, 7.0, 5).label(6, 6.5, 9, 0.3);
  return { spec: b.build('U-shaped house', 6), render: { pxPerMeter: 50, seed: 6 } };
}

// 7. Open-plan loft with island and columns ------------------------------------------------
function loft(): Fixture {
  const b = new B();
  const [top, bot, left, right] = b.box(0, 0, 13, 8, 0.3);
  const v10 = b.w(10, 0, 10, 3, 0.12);
  b.w(10, 3, 13, 3, 0.12);
  b.w(7, 4.5, 7, 8, 0.15); // free-standing partition (open top end)
  b.door(left, 6, 1.0, 1).door(v10, 1.8, 0.8, -1);
  b.win(top, 2, 1.8).win(top, 5, 1.8).win(top, 8, 1.8).win(top, 11.5, 0.8)
    .win(bot, 2, 1.6).win(bot, 4.5, 1.6).win(bot, 9.5, 1.6).win(bot, 11.5, 1.6).win(right, 5.5, 1.6);
  b.col(4, 4).col(8.5, 3.8);
  b.f('island', 4.5, 2.0, 2.4, 1.0).f('counter', 4.5, 0.5, 4.0, 0.6).f('sofa', 2.5, 5.6, 2.6, 1.0)
    .f('table', 2.5, 3.9, 1.0, 0.6).f('bed', 10, 6.4, 1.8, 2.1).f('rect', 8.2, 7.4, 1.4, 0.5)
    .f('bath', 11.5, 0.6, 1.6, 0.7).f('wc', 12.6, 2.2, 0.4, 0.6, -Math.PI / 2).f('circle', 9, 5.2, 0.6, 0.6);
  b.label(3, 3.1, 8).label(10, 4.0, 7).label(11.5, 1.8, 4);
  void bot;
  return { spec: b.build('open-plan loft', 2), render: { pxPerMeter: 60, seed: 7, blur: 1 } };
}

// 8. House with many small rooms ---------------------------------------------------------
function manyRooms(): Fixture {
  const b = new B();
  const t = 0.25, ti = 0.1;
  const [top, bot, left, right] = b.box(0, 0, 12, 10, t);
  const v5 = b.w(5, 0, 5, 10, ti);
  const v64 = b.w(6.4, 0, 6.4, 10, ti);
  b.w(0, 2.5, 5, 2.5, ti);
  b.w(0, 4, 5, 4, ti);
  b.w(0, 6, 5, 6, ti);
  b.w(0, 8.2, 5, 8.2, ti);
  const v25 = b.w(2.5, 2.5, 2.5, 4, ti);
  b.w(6.4, 3, 12, 3, ti);
  b.w(6.4, 4.5, 12, 4.5, ti);
  b.w(6.4, 7, 12, 7, ti);
  const v95 = b.w(9.5, 0, 9.5, 3, ti);
  const v9 = b.w(9, 7, 9, 10, ti);
  b.door(bot, 5.7, 0.9, -1);
  for (const y of [1.25, 3.25, 5, 7.1, 9.1]) b.door(v5, y, 0.8, -1);
  b.door(v25, 3.25, 0.7, -1);
  for (const y of [1.5, 3.75, 5.75, 8.5]) b.door(v64, y, 0.8, 1);
  b.door(v95, 1.5, 0.7, 1).door(v9, 8.5, 0.7, 1);
  for (const y of [1.25, 5, 7.1, 9.1]) b.win(left, y, 1.0);
  b.win(top, 2.5, 1.2).win(top, 8, 1.2).win(top, 10.75, 1.0);
  b.win(right, 3.75, 0.8).win(right, 5.75, 1.2).win(right, 8.5, 1.2);
  b.win(bot, 2.5, 1.0).win(bot, 10.5, 1.0);
  b.f('bed', 2.5, 1.2, 1.4, 1.9, Math.PI / 2).f('bath', 1.2, 3.25, 1.4, 0.7).f('wc', 3.5, 3.0, 0.4, 0.6)
    .f('bed', 2.5, 5, 1.4, 1.9, Math.PI / 2).f('rect', 2.5, 7.1, 2, 0.6).f('sofa', 2.5, 9.1, 2.0, 0.8)
    .f('bed', 8, 1.5, 1.4, 1.9).f('rect', 10.75, 1.5, 1.2, 0.6).f('counter', 9.2, 4.0, 3.0, 0.6)
    .f('table', 9.2, 5.75, 1.2, 0.8).f('bed', 7.7, 8.5, 1.2, 1.9).f('rect', 10.5, 8.5, 1.4, 1.4)
    .f('stairs', 5.7, 6.0, 1.0, 2.6);
  b.label(1.2, 1.0, 5, 0.2).label(4.0, 5.4, 4, 0.2).label(8, 2.6, 5, 0.2).label(11, 4.0, 4, 0.18);
  return { spec: b.build('many small rooms', 13), render: { pxPerMeter: 45, seed: 8 } };
}

// 9. Diagonal walls and non-uniform interior thickness ------------------------------------
function diagonal(): Fixture {
  const b = new B();
  const t = 0.25;
  const top = b.w(0, 0, 9, 0, t);
  const diag = b.w(9, 0, 12, 3, t);
  const right = b.w(12, 3, 12, 9, t);
  const bot = b.w(0, 9, 12, 9, t);
  const left = b.w(0, 0, 0, 9, t);
  const v6 = b.w(6, 0, 6, 9, 0.2);
  const h5 = b.w(0, 5, 6, 5, 0.1);
  const h45 = b.w(6, 4.5, 12, 4.5, 0.15);
  b.w(0, 7, 2, 9, 0.1);
  b.door(v6, 2.5, 0.9, 1).door(v6, 7, 0.9, -1).door(h45, 9, 0.8, 1).door(h5, 4, 0.8, 1).door(bot, 9, 1.0, -1);
  b.winT(diag, Math.hypot(3, 3) / 2, 1.2);
  b.win(top, 3, 1.5).win(left, 2.5, 1.2).win(right, 6.5, 1.4).win(bot, 4, 1.2);
  b.f('sofa', 3, 3.8, 2.2, 0.9).f('table', 3, 2, 1.0, 1.0).f('bed', 9, 2.2, 1.6, 2.0)
    .f('bed', 4, 7.4, 1.4, 1.9, Math.PI / 2).f('counter', 9, 8.5, 3.0, 0.6);
  b.label(3, 1.0, 6).label(8, 3.6, 7).label(3.6, 5.6, 7).label(9, 6.2, 7);
  return { spec: b.build('diagonal + mixed thickness', 5), render: { pxPerMeter: 50, seed: 9 } };
}

// 10. Noisy plan: gray walls, dense furniture, bold labels, dimensions, blur + noise --------
function noisy(): Fixture {
  const b = new B();
  const [top, bot, left, right] = b.box(0, 0, 12, 9, 0.3);
  const ti = 0.12;
  const v45 = b.w(4.5, 0, 4.5, 9, ti);
  const h5 = b.w(0, 5, 4.5, 5, ti);
  const h35 = b.w(4.5, 3.5, 12, 3.5, ti);
  b.w(8, 0, 8, 3.5, ti);
  const v85 = b.w(8.5, 3.5, 8.5, 9, ti);
  b.w(8.5, 6.5, 12, 6.5, ti);
  b.door(v45, 2.5, 0.9, 1).door(v45, 7, 0.9, -1).door(h5, 2.25, 0.8, 1).door(h35, 6.25, 0.9, -1)
    .door(h35, 10, 0.8, -1, true).door(v85, 5, 0.8, 1).door(v85, 7.75, 0.8, 1).door(bot, 6.5, 1.0, -1);
  b.win(top, 2.25, 1.6).win(top, 6.25, 1.4).win(top, 10, 1.4).win(left, 2.5, 1.4).win(left, 7, 1.2)
    .win(right, 1.75, 1.2).win(right, 5, 1.0).win(right, 7.75, 1.0).win(bot, 2.25, 1.6).win(bot, 10.25, 1.2);
  b.f('sofa', 2.25, 3.9, 2.6, 0.9).f('table', 2.25, 2.2, 1.2, 0.8).f('rect', 0.6, 2.4, 0.5, 1.6)
    .f('circle', 3.8, 0.8, 0.5, 0.5).f('bed', 2.25, 7.2, 1.6, 2.0).f('rect', 0.6, 8.2, 0.6, 0.6)
    .f('rect', 3.9, 8.2, 0.6, 0.6).f('bed', 6.25, 1.6, 1.4, 2.0).f('rect', 7.4, 0.6, 0.6, 0.6)
    .f('bath', 10, 0.6, 1.6, 0.7).f('wc', 11.5, 2.4, 0.4, 0.6, -Math.PI / 2).f('island', 6.5, 6.2, 1.8, 0.9)
    .f('counter', 6.5, 8.5, 3.2, 0.6).f('rect', 5, 4.4, 0.6, 1.2).f('stairs', 10.25, 5, 2.6, 1.0, Math.PI / 2)
    .f('rect', 10.25, 8.2, 2.4, 0.6).f('circle', 9.2, 7.4, 0.5, 0.5).f('rect', 11.5, 7.4, 0.6, 0.6)
    .f('table', 6.3, 4.6, 0.8, 0.6);
  b.label(2.25, 1.0, 6, 0.3, true).label(2.25, 6.0, 7, 0.3, true).label(6.25, 3.0, 6, 0.26, true)
    .label(10, 2.0, 4, 0.26, true).label(6.5, 7.4, 7, 0.3, true).label(10.25, 4.2, 6, 0.22)
    .label(10.25, 7.3, 5, 0.22).label(2.25, 2.9, 5, 0.16).label(2.25, 6.6, 5, 0.16);
  return {
    spec: b.build('noisy furnished plan', 7, true),
    render: { pxPerMeter: 70, seed: 10, blur: 1, noise: 0.05, wallInk: 0.72, lineWidthPx: 1.5 },
  };
}

export const FIXTURES: Fixture[] = [
  studio(), oneBed(), twoBed(), threeBed(), lShape(), uShape(), loft(), manyRooms(), diagonal(), noisy(),
];
