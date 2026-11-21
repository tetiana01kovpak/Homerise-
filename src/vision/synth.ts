// Synthetic floor-plan rasterizer used to build ground-truth fixtures for the
// vectorizer. Pure TypeScript, no DOM. Units in the spec are meters (x right,
// y down); output is an RGBA raster.

export type Pt = { x: number; y: number };

export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray }

export interface SpecWall { a: Pt; b: Pt; thickness: number }

export interface SpecOpening {
  wallIndex: number;
  kind: 'door' | 'window';
  /** Distance from wall.a to the opening center (m). */
  t: number;
  width: number;
  /** Door swing side relative to the wall's left normal. */
  swing?: 1 | -1;
  /** Hinge on the far (b) side of the gap instead of the near side. */
  hingeAtEnd?: boolean;
  /** Double door (two leaves of width/2). */
  double?: boolean;
}

export type FurnitureKind =
  | 'rect' | 'circle' | 'bed' | 'sofa' | 'counter' | 'table' | 'island' | 'bath' | 'wc' | 'stairs';

export interface SpecFurniture { kind: FurnitureKind; x: number; y: number; w: number; h: number; rot?: number }
export interface SpecLabel { x: number; y: number; chars: number; size?: number; bold?: boolean }
export interface SpecColumn { x: number; y: number; size: number }

export interface PlanSpec {
  name: string;
  walls: SpecWall[];
  openings: SpecOpening[];
  expectedRooms: number;
  furniture?: SpecFurniture[];
  labels?: SpecLabel[];
  columns?: SpecColumn[];
  /** Draw dimension chains above and left of the plan. */
  dimensions?: boolean;
}

export interface RenderOptions {
  pxPerMeter: number;
  marginPx?: number;
  /** Thin line width in px (door arcs, windows, furniture). */
  lineWidthPx?: number;
  /** Number of 3x3 box-blur passes. */
  blur?: number;
  /** Gaussian noise sigma as a fraction of 255. */
  noise?: number;
  seed?: number;
  /** Wall darkness 0..1 (1 = black). */
  wallInk?: number;
  /** Thin-line darkness 0..1. */
  lineInk?: number;
  /** Rotate the whole drawing about the image center (simulates a skewed scan). */
  rotateDeg?: number;
  /** Wall rendering: solid fill (default), outline only, or outline + 45° hatch. */
  wallStyle?: 'solid' | 'outline' | 'hatch';
}

export interface RenderResult {
  image: RGBAImage;
  pxPerMeter: number;
  /** Pixel position of world (0,0). */
  originPx: Pt;
  extents: { minX: number; minY: number; maxX: number; maxY: number };
}

// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const len = (a: Pt): number => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;

/** Outer extents (m) of all wall bodies (axis-aligned bounding box of wall rectangles). */
export function planExtents(spec: PlanSpec): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of spec.walls) {
    const d = unit(sub(w.b, w.a));
    const n = { x: -d.y, y: d.x };
    const h = w.thickness / 2;
    for (const p of [w.a, w.b]) for (const s of [-1, 1]) {
      const q = add(p, mul(n, h * s));
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

class Canvas {
  w: number;
  h: number;
  ink: Float32Array;
  constructor(w: number, h: number) {
    this.w = w; this.h = h; this.ink = new Float32Array(w * h);
  }

  private bbox(pts: Pt[], pad: number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return {
      x0: Math.max(0, Math.floor(x0 - pad)), y0: Math.max(0, Math.floor(y0 - pad)),
      x1: Math.min(this.w - 1, Math.ceil(x1 + pad)), y1: Math.min(this.h - 1, Math.ceil(y1 + pad)),
    };
  }

  /** Fill a convex polygon with 2x2 supersampled coverage. */
  fillConvex(pts: Pt[], v: number): void {
    if (pts.length < 3) return;
    const sgn = polySign(pts);
    const bb = this.bbox(pts, 1);
    for (let y = bb.y0; y <= bb.y1; y++) {
      for (let x = bb.x0; x <= bb.x1; x++) {
        let c = 0;
        for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) {
          if (insideConvex(pts, sgn, x + ox, y + oy)) c++;
        }
        if (c) { const i = y * this.w + x; const val = (v * c) / 4; if (val > this.ink[i]) this.ink[i] = val; }
      }
    }
  }

  clearConvex(pts: Pt[]): void {
    const sgn = polySign(pts);
    const bb = this.bbox(pts, 1);
    for (let y = bb.y0; y <= bb.y1; y++) for (let x = bb.x0; x <= bb.x1; x++) {
      if (insideConvex(pts, sgn, x + 0.5, y + 0.5)) this.ink[y * this.w + x] = 0;
    }
  }

  /** Anti-aliased capsule line. */
  line(p: Pt, q: Pt, width: number, v: number): void {
    const bb = this.bbox([p, q], width + 2);
    const d = sub(q, p);
    const L2 = d.x * d.x + d.y * d.y;
    for (let y = bb.y0; y <= bb.y1; y++) for (let x = bb.x0; x <= bb.x1; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      let t = L2 > 0 ? ((cx - p.x) * d.x + (cy - p.y) * d.y) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(cx - (p.x + d.x * t), cy - (p.y + d.y * t));
      const cov = Math.max(0, Math.min(1, width / 2 + 0.5 - dist));
      if (cov > 0) { const i = y * this.w + x; const val = cov * v; if (val > this.ink[i]) this.ink[i] = val; }
    }
  }

  polyline(pts: Pt[], width: number, v: number, closed = false): void {
    for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i], pts[i + 1], width, v);
    if (closed && pts.length > 2) this.line(pts[pts.length - 1], pts[0], width, v);
  }
}

function polySign(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i], pts[(i + 1) % pts.length]);
  return s >= 0 ? 1 : -1;
}

function insideConvex(pts: Pt[], sgn: number, x: number, y: number): boolean {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c * sgn < -1e-9) return false;
  }
  return true;
}

function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function lineIntersect(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q, p), e) / den;
  return add(p, mul(d, t));
}

// ---------------------------------------------------------------------------

export function renderPlan(spec: PlanSpec, opts: RenderOptions): RenderResult {
  const ppm = opts.pxPerMeter;
  const rng = mulberry32(opts.seed ?? 1);
  const lw = opts.lineWidthPx ?? 1.3;
  const wallInk = opts.wallInk ?? 1;
  const lineInk = opts.lineInk ?? 0.9;
  const ext = planExtents(spec);
  const margin = (opts.marginPx ?? 40) + (spec.dimensions ? Math.round(1.3 * ppm) : 0);
  const W = Math.ceil((ext.maxX - ext.minX) * ppm + 2 * margin);
  const H = Math.ceil((ext.maxY - ext.minY) * ppm + 2 * margin);
  const origin = { x: margin - ext.minX * ppm, y: margin - ext.minY * ppm };
  const rot = ((opts.rotateDeg ?? 0) * Math.PI) / 180, rc = Math.cos(rot), rs = Math.sin(rot);
  const P = (p: Pt): Pt => {
    const x = origin.x + p.x * ppm - W / 2, y = origin.y + p.y * ppm - H / 2;
    return { x: x * rc - y * rs + W / 2, y: x * rs + y * rc + H / 2 };
  };
  const cv = new Canvas(W, H);

  // --- walls -------------------------------------------------------------
  for (const w of spec.walls) {
    const d = unit(sub(w.b, w.a));
    const n = { x: -d.y, y: d.x };
    const h = w.thickness / 2;
    cv.fillConvex([add(w.a, mul(n, h)), add(w.b, mul(n, h)), add(w.b, mul(n, -h)), add(w.a, mul(n, -h))].map(P), wallInk);
  }
  // joints where several wall ends coincide: fill hull of faces + face intersections
  const ends: { p: Pt; wi: number }[] = [];
  spec.walls.forEach((w, wi) => { ends.push({ p: w.a, wi }, { p: w.b, wi }); });
  const done = new Set<number>();
  for (let i = 0; i < ends.length; i++) {
    if (done.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < ends.length; j++) if (!done.has(j) && len(sub(ends[i].p, ends[j].p)) < 1e-6) group.push(j);
    group.forEach((g) => done.add(g));
    if (group.length < 2) continue;
    const P0 = ends[i].p;
    const lines: { o: Pt; d: Pt }[] = [];
    const pts: Pt[] = [];
    let hmax = 0;
    for (const g of group) {
      const w = spec.walls[ends[g].wi];
      const d = unit(sub(w.b, w.a));
      const n = { x: -d.y, y: d.x };
      const h = w.thickness / 2;
      hmax = Math.max(hmax, h);
      for (const s of [-1, 1]) {
        const o = add(P0, mul(n, h * s));
        pts.push(o);
        lines.push({ o, d });
      }
    }
    for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
      const X = lineIntersect(lines[a].o, lines[a].d, lines[b].o, lines[b].d);
      if (X && len(sub(X, P0)) < 3 * hmax) pts.push(X);
    }
    cv.fillConvex(convexHull(pts).map(P), wallInk);
  }
  for (const c of spec.columns ?? []) {
    const h = c.size / 2;
    cv.fillConvex([{ x: c.x - h, y: c.y - h }, { x: c.x + h, y: c.y - h }, { x: c.x + h, y: c.y + h }, { x: c.x - h, y: c.y + h }].map(P), wallInk);
  }

  // --- openings: cut all gaps first (so outlined walls get closed jambs) -------
  for (const o of spec.openings) {
    const w = spec.walls[o.wallIndex];
    const d = unit(sub(w.b, w.a));
    const n = { x: -d.y, y: d.x };
    const hc = w.thickness / 2 + 1.5 / ppm;
    const at = (s: number, off: number) => add(add(w.a, mul(d, s)), mul(n, off));
    const s0 = o.t - o.width / 2, s1 = o.t + o.width / 2;
    cv.clearConvex([at(s0, hc), at(s1, hc), at(s1, -hc), at(s0, -hc)].map(P));
  }
  if (opts.wallStyle && opts.wallStyle !== 'solid') hollowWalls(cv, Math.max(1, Math.round(lw)), opts.wallStyle === 'hatch', wallInk);

  for (const o of spec.openings) {
    const w = spec.walls[o.wallIndex];
    const d = unit(sub(w.b, w.a));
    const n = { x: -d.y, y: d.x };
    const h = w.thickness / 2;
    const s0 = o.t - o.width / 2, s1 = o.t + o.width / 2;
    const at = (s: number, off: number) => add(add(w.a, mul(d, s)), mul(n, off));
    if (o.kind === 'window') {
      for (const off of [-h, 0, h]) cv.line(P(at(s0, off)), P(at(s1, off)), lw, lineInk);
      cv.line(P(at(s0, -h)), P(at(s0, h)), lw, lineInk);
      cv.line(P(at(s1, -h)), P(at(s1, h)), lw, lineInk);
    } else {
      const side = o.swing ?? 1;
      const v = mul(n, side);
      const leaf = (hingeS: number, otherS: number, r: number) => {
        const hinge = at(hingeS, h * side);
        const u = unit(sub(at(otherS, h * side), hinge));
        cv.line(P(hinge), P(add(hinge, mul(v, r))), lw * 1.2, lineInk);
        const arc: Pt[] = [];
        for (let k = 0; k <= 24; k++) {
          const th = (Math.PI / 2) * (k / 24);
          arc.push(P(add(hinge, add(mul(u, r * Math.cos(th)), mul(v, r * Math.sin(th))))));
        }
        cv.polyline(arc, lw, lineInk);
      };
      if (o.double) {
        leaf(s0, s1, o.width / 2);
        leaf(s1, s0, o.width / 2);
      } else if (o.hingeAtEnd) leaf(s1, s0, o.width);
      else leaf(s0, s1, o.width);
    }
  }

  // --- furniture -------------------------------------------------------------
  for (const f of spec.furniture ?? []) drawFurniture(cv, f, P, lw * 0.9, lineInk * 0.85);

  // --- labels ------------------------------------------------------------------
  for (const l of spec.labels ?? []) drawText(cv, l, P, ppm, rng, lw);

  // --- dimension chains ---------------------------------------------------------
  if (spec.dimensions) {
    const xs = new Set<number>(), ys = new Set<number>();
    for (const w of spec.walls) {
      if (Math.abs(w.a.x - w.b.x) < 1e-6) xs.add(w.a.x);
      if (Math.abs(w.a.y - w.b.y) < 1e-6) ys.add(w.a.y);
    }
    const xa = [...xs].sort((a, b) => a - b), ya = [...ys].sort((a, b) => a - b);
    const yDim = ext.minY - 0.7, xDim = ext.minX - 0.7;
    cv.line(P({ x: xa[0], y: yDim }), P({ x: xa[xa.length - 1], y: yDim }), lw * 0.8, lineInk);
    cv.line(P({ x: xDim, y: ya[0] }), P({ x: xDim, y: ya[ya.length - 1] }), lw * 0.8, lineInk);
    for (let i = 0; i < xa.length; i++) {
      const x = xa[i];
      cv.line(P({ x: x - 0.08, y: yDim + 0.08 }), P({ x: x + 0.08, y: yDim - 0.08 }), lw * 1.2, lineInk);
      cv.line(P({ x, y: yDim - 0.15 }), P({ x, y: yDim + 0.3 }), lw * 0.7, lineInk);
      if (i + 1 < xa.length && xa[i + 1] - x > 0.8) drawText(cv, { x: (x + xa[i + 1]) / 2, y: yDim - 0.2, chars: 3, size: 0.18 }, P, ppm, rng, lw * 0.8);
    }
    for (let i = 0; i < ya.length; i++) {
      const y = ya[i];
      cv.line(P({ x: xDim - 0.08, y: y + 0.08 }), P({ x: xDim + 0.08, y: y - 0.08 }), lw * 1.2, lineInk);
      cv.line(P({ x: xDim - 0.15, y }), P({ x: xDim + 0.3, y }), lw * 0.7, lineInk);
      if (i + 1 < ya.length && ya[i + 1] - y > 0.8) drawText(cv, { x: xDim - 0.35, y: (y + ya[i + 1]) / 2, chars: 3, size: 0.18 }, P, ppm, rng, lw * 0.8);
    }
  }

  // --- post: blur + noise + compose -------------------------------------------
  let ink = cv.ink;
  for (let pass = 0; pass < (opts.blur ?? 0); pass++) ink = boxBlur3(ink, W, H);
  const data = new Uint8ClampedArray(W * H * 4);
  const bg = 250, dark = 20;
  const sigma = (opts.noise ?? 0) * 255;
  for (let i = 0; i < W * H; i++) {
    let g = bg - ink[i] * (bg - dark);
    if (sigma > 0) {
      const u1 = Math.max(1e-9, rng()), u2 = rng();
      g += sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    const j = i * 4;
    data[j] = g; data[j + 1] = g; data[j + 2] = g * 0.98; data[j + 3] = 255;
  }
  return { image: { width: W, height: H, data }, pxPerMeter: ppm, originPx: origin, extents: ext };
}

/** Keep only a border of width `r` px around the wall bodies (optionally hatch the inside). */
function hollowWalls(cv: Canvas, r: number, hatch: boolean, v: number): void {
  const { w: W, h: H, ink } = cv;
  const B = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) B[i] = ink[i] > 0.5 ? 1 : 0;
  // interior = pixels whose (2r+1)^2 neighborhood is fully wall
  const I = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0;
    for (let x = 0; x < W; x++) { rs += B[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + rs; }
  }
  const k = 2 * r + 1;
  for (let y = r; y < H - r; y++) for (let x = r; x < W - r; x++) {
    const x0 = x - r, y0 = y - r, x1 = x + r + 1, y1 = y + r + 1;
    const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    if (sum === k * k) ink[y * W + x] = hatch && (x + y) % 6 < 1.5 ? v : 0;
  }
}

function boxBlur3(src: Float32Array, W: number, H: number): Float32Array {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    tmp[i] = (src[i] + (x > 0 ? src[i - 1] : src[i]) + (x < W - 1 ? src[i + 1] : src[i])) / 3;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    out[i] = (tmp[i] + (y > 0 ? tmp[i - W] : tmp[i]) + (y < H - 1 ? tmp[i + W] : tmp[i])) / 3;
  }
  return out;
}

function drawText(cv: Canvas, l: SpecLabel, P: (p: Pt) => Pt, ppm: number, rng: () => number, lw: number): void {
  const size = l.size ?? 0.24;
  const cw = size * 0.62, gap = size * 0.18;
  const total = l.chars * cw + (l.chars - 1) * gap;
  const width = l.bold ? Math.max(2.4, lw * 2.1) : lw;
  let x0 = l.x - total / 2;
  const y0 = l.y - size / 2;
  for (let c = 0; c < l.chars; c++) {
    const grid = (gx: number, gy: number): Pt => ({ x: x0 + (gx / 2) * cw, y: y0 + (gy / 2) * size });
    const strokes = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < strokes; s++) {
      const a = grid(Math.floor(rng() * 3), Math.floor(rng() * 3));
      const b = grid(Math.floor(rng() * 3), Math.floor(rng() * 3));
      if (a.x === b.x && a.y === b.y) continue;
      cv.line(P(a), P(b), width, 1);
    }
    x0 += cw + gap;
  }
  void ppm;
}

function drawFurniture(cv: Canvas, f: SpecFurniture, P: (p: Pt) => Pt, lw: number, v: number): void {
  const rot = f.rot ?? 0;
  const c = Math.cos(rot), s = Math.sin(rot);
  // local coords: (lx, ly) relative to center, in meters
  const L = (lx: number, ly: number): Pt => P({ x: f.x + lx * c - ly * s, y: f.y + lx * s + ly * c });
  const hw = f.w / 2, hh = f.h / 2;
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    cv.polyline([L(x0, y0), L(x1, y0), L(x1, y1), L(x0, y1)], lw, v, true);
  const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
    const pts: Pt[] = [];
    for (let k = 0; k < 32; k++) { const t = (k / 32) * Math.PI * 2; pts.push(L(cx + rx * Math.cos(t), cy + ry * Math.sin(t))); }
    cv.polyline(pts, lw, v, true);
  };
  switch (f.kind) {
    case 'rect': rect(-hw, -hh, hw, hh); break;
    case 'circle': ellipse(0, 0, hw, hh); break;
    case 'bed':
      rect(-hw, -hh, hw, hh);
      rect(-hw + 0.1, -hh + 0.08, -0.05, -hh + 0.45);
      rect(0.05, -hh + 0.08, hw - 0.1, -hh + 0.45);
      cv.line(L(-hw, -hh + 0.7), L(hw, -hh + 0.7), lw, v);
      break;
    case 'sofa':
      rect(-hw, -hh, hw, hh);
      rect(-hw + 0.18, -hh + 0.22, hw - 0.18, hh);
      cv.line(L(0, -hh + 0.22), L(0, hh), lw, v);
      break;
    case 'counter':
      rect(-hw, -hh, hw, hh);
      rect(-0.35, -hh + 0.1, 0.35, hh - 0.1);
      ellipse(0.6, 0, 0.12, 0.12);
      ellipse(0.9, 0, 0.12, 0.12);
      break;
    case 'table':
      ellipse(0, 0, hw, hh);
      for (let k = 0; k < 4; k++) {
        const t = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const cx = (hw + 0.25) * Math.cos(t), cy = (hh + 0.25) * Math.sin(t);
        rect(cx - 0.2, cy - 0.2, cx + 0.2, cy + 0.2);
      }
      break;
    case 'island':
      rect(-hw, -hh, hw, hh);
      rect(-hw + 0.05, -hh + 0.05, hw - 0.05, hh - 0.05);
      for (let k = -1; k <= 1; k++) ellipse(k * 0.6, hh + 0.3, 0.18, 0.18);
      break;
    case 'bath':
      rect(-hw, -hh, hw, hh);
      ellipse(0, 0, hw - 0.1, hh - 0.1);
      break;
    case 'wc':
      rect(-hw, -hh, hw, -hh + 0.18);
      ellipse(0, 0.05, hw * 0.8, hh * 0.7);
      break;
    case 'stairs': {
      rect(-hw, -hh, hw, hh);
      const n = Math.max(3, Math.round(f.h / 0.28));
      for (let k = 1; k < n; k++) { const y = -hh + (f.h * k) / n; cv.line(L(-hw, y), L(hw, y), lw, v); }
      cv.line(L(0, hh - 0.2), L(0, -hh + 0.3), lw, v);
      break;
    }
  }
}
