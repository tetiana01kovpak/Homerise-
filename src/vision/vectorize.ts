// Deterministic "plan image -> vector floor plan" engine (fallback for the
// Claude-vision path). Pure TypeScript, no DOM: runs in node, a worker or the
// main thread.
//
// Pipeline (all geometry in pixels until the very end):
//  1. Luminance + Otsu threshold -> dark mask (auto-inverts dark-background
//     images). A second, more lenient "ink" mask (kept >= 3 sigma from paper
//     noise) preserves faint thin lines for door-arc / window evidence.
//  2. Wall thickness: per dark pixel the local stroke width is
//     min(horizontal run, vertical run). From the histogram of elongated
//     strokes: tDom = dominant width (weighted by width), tMin = first
//     significant peak after the thin-line (1-2 px) peak, walked down its
//     rising flank (handles mixed interior thicknesses), tMax = thickest peak.
//  3. Morphological opening with a k×k square (k ≈ 0.6·tMin, capped at
//     0.4·tDom, min 3 px) removes text, dimension lines, furniture, door arcs
//     and window glazing lines, leaving wall bodies (and solid columns).
//  3b. Deskew: projection-profile sharpness of the wall mask over ±8° (0.05°
//     steps); if |skew| >= 0.25° the gray image is rotated and step 1-3 rerun.
//  3c. Hatched / outlined walls: if few dark pixels are thick strokes, enclosed
//     light regions that look like wall interiors (tiny, or thin strips in the
//     thinnest width cluster) are filled and the pipeline is rerun; the better
//     of both results is kept.
//  4. Axis walls: a row run of the opened mask is a "horizontal-wall run" if
//     it is >= 1.5·tMin long and, over most of its length, >= 1.2x longer than
//     the local vertical run (rejects cross-sections of vertical walls,
//     45° walls and square columns). Connected components of such pixels are
//     cut column-by-column into bands of constant center/thickness -> wall
//     rectangles -> centerlines. Same on the transposed mask for vertical
//     walls. Remaining elongated, solid blobs are PCA-fitted -> diagonal walls.
//  5. Collinear pieces are merged; endpoints are snapped to the intersection
//     with crossing walls' centerlines (corners and T-junctions). Clusters of
//     walls detached from the main structure (furniture, legends, text) are
//     dropped.
//  6. Openings: from every still-free endpoint a ray is cast along the wall;
//     if the next wall is 0.45–3 m away and the gap is empty, it is classified
//     as a window (thin lines cover the gap band, >= 2 parallel lines), a door
//     (a quarter arc of radius = gap, incl. double doors) or – for collinear
//     gaps <= 1.25 m without symbols – a plain door/passage. The gap is closed
//     (walls merged or extended to the crossing wall) and an opening recorded.
//  7. Rooms: final walls are re-rasterized (openings closed), the free space
//     connected to the border is "outside", remaining components >= 0.7 m²
//     with mean width >= 0.35 m are rooms; outlines are crack-traced and
//     Douglas–Peucker simplified (inner wall faces).
//
// Scale (meters per pixel), in priority order:
//  a. opts.metersPerPixel;
//  b. opts.expectedWidthMeters / overall outer width of the detected walls
//     (outer face to outer face, i.e. the usual "overall width" dimension);
//  c. door gaps: the median detected single-door width is assumed to be 0.80 m
//     (needs >= 2 doors; typically within ~10%);
//  d. the thickest wall class is assumed to be a 0.25 m exterior wall (rough).
//
// Output coordinates are meters with the origin at the image's top-left pixel
// corner (so the source image can be overlaid as a trace image at (0,0)). If
// the image was deskewed (debug.skewDeg != 0) the coordinates are in the
// deskewed frame, i.e. rotated by -skewDeg about the image center.

export interface VPoint { x: number; y: number }
export interface VectorWall { a: VPoint; b: VPoint; thickness: number }
/** 'opening' = doorless gap / passage (no door or window symbol found). */
export type VectorOpeningKind = 'door' | 'window' | 'opening';
export interface VectorOpening { wallIndex: number; kind: VectorOpeningKind; t: number; width: number }
export interface VectorRoom { points: VPoint[]; area: number }
export interface VectorResult {
  walls: VectorWall[];
  openings: VectorOpening[];
  rooms: VectorRoom[];
  metersPerPixel: number;
  confidence: number;
  debug?: VectorDebug;
}
export interface RGBAImageLike { width: number; height: number; data: Uint8ClampedArray }
export interface VectorizeOptions {
  metersPerPixel?: number;
  expectedWidthMeters?: number;
}
export interface VectorDebug {
  threshold: number;
  inverted: boolean;
  /** Detected rotation (deg); output is in the deskewed frame (rotation about the image center). */
  skewDeg: number;
  /** >0 when walls were drawn hatched/outlined and a closing of this size was applied. */
  closeKernel: number;
  tDom: number;
  tMin: number;
  tMax: number;
  kernel: number;
  scaleSource: 'given' | 'expectedWidth' | 'doors' | 'wallThickness';
  widthPx: number;
  heightPx: number;
  doorWidthsPx: number[];
  axisSegments: number;
  diagonalSegments: number;
  timings: Record<string, number>;
}

type P = VPoint;
interface Seg { a: P; b: P; t: number; joinA: boolean; joinB: boolean; dead: boolean; mergedInto?: Seg }
interface OpenRec { p0: P; p1: P; kind: VectorOpeningKind; host: Seg }

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: P, s: number): P => ({ x: a.x * s, y: a.y * s });
const dot = (a: P, b: P): number => a.x * b.x + a.y * b.y;
const cross = (a: P, b: P): number => a.x * b.y - a.y * b.x;
const len = (a: P): number => Math.hypot(a.x, a.y);
const unit = (a: P): P => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const perp = (a: P): P => ({ x: -a.y, y: a.x });
const segLen = (s: Seg): number => len(sub(s.b, s.a));
const segDir = (s: Seg): P => unit(sub(s.b, s.a));
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const DEFAULT_DOOR_M = 0.8;
const DEFAULT_EXT_WALL_M = 0.25;

// ---------------------------------------------------------------------------
// public API

export function vectorizePlan(img: RGBAImageLike, opts: VectorizeOptions = {}): VectorResult {
  const timings: Record<string, number> = {};
  let t0 = now();
  const lap = (name: string) => { const t = now(); timings[name] = Math.round((t - t0) * 10) / 10; t0 = t; };
  const W = img.width, H = img.height, N = W * H;

  // 1. gray + threshold ---------------------------------------------------------
  let gray = toGray(img);
  let inverted = false;
  {
    const th0 = otsu(gray);
    if (th0.darkFrac > 0.5) {
      for (let i = 0; i < N; i++) gray[i] = 255 - gray[i];
      inverted = true;
    }
  }
  const empty = (): VectorResult => ({ walls: [], openings: [], rooms: [], metersPerPixel: opts.metersPerPixel ?? 0.01, confidence: 0 });
  let prep = prepare(gray, W, H, 0);
  lap('threshold+opening');

  // 1b. deskew (scanned / photographed plans) ---------------------------------------
  let skewDeg = 0;
  if (prep) {
    let cnt = 0;
    for (let i = 0; i < N; i++) cnt += prep.opened[i];
    skewDeg = estimateSkew(cnt >= 2000 ? prep.opened : prep.mask, W, H);
    if (Math.abs(skewDeg) >= 0.25) {
      gray = rotateGray(gray, W, H, (skewDeg * Math.PI) / 180);
      prep = prepare(gray, W, H, 0);
    }
  }
  lap('deskew');
  const meta = { inverted, skewDeg, lap, timings };
  let res = prep ? analyze(prep, W, H, opts, meta, 0) : null;

  // 1c. fallback for hatched / outlined walls: close the wall interiors first ------------
  const weak = (r: VectorResult | null) => !r || r.rooms.length === 0 || r.confidence < 0.55 || (r.debug?.tDom ?? 0) <= 3;
  const solidFrac = prep ? prep.est.thickFrac : 0;
  const gapK = solidFrac < 0.6 || weak(res) ? estimateGapKernel(prep ? prep.mask : thresholdOnly(gray), W, H) : 0;
  if (gapK > 0) {
    const prep2 = prepare(gray, W, H, gapK);
    // share of the dark ink that survives as solid wall body: low for hatched /
    // outlined walls (everything is thin lines), high for solid-fill plans
    if (prep2 && (solidFrac < 0.6 || weak(res))) {
      const res2 = analyze(prep2, W, H, opts, meta, gapK);
      const q = (r: VectorResult | null) => {
        if (!r) return -1;
        // fragmented results (many short walls) are typical of a wrong wall model
        const short = r.walls.filter((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) < 0.8).length / Math.max(1, r.walls.length);
        return r.confidence + 0.05 * Math.min(r.rooms.length, 10) + (r.walls.length >= 4 ? 0.2 : 0) - 0.5 * short;
      };
      if (res2.walls.length >= 3 && (solidFrac < 0.3 || q(res2) > q(res))) res = res2;
    }
    lap('fallback');
  }
  return res ?? empty();
}

function analyze(
  prep: Prepared, W: number, H: number, opts: VectorizeOptions,
  meta: { inverted: boolean; skewDeg: number; lap: (n: string) => void; timings: Record<string, number> }, closeKernel: number,
): VectorResult {
  const N = W * H;
  const { lap, timings, inverted, skewDeg } = meta;
  const { th, ink, opened, kernel } = prep;
  const { tDom, tMin, tMax } = prep.est;

  // 4. axis + diagonal walls --------------------------------------------------------
  const minLen = Math.max(6, Math.round(1.5 * tMin));
  const maxT = 1.6 * tMax + 2;
  const minT = Math.max(2, 0.7 * tMin);
  const segs: Seg[] = [];
  for (const r of extractBands(opened, W, H, minLen, minT, maxT)) {
    segs.push(mkSeg({ x: r.x0, y: r.yc }, { x: r.x1, y: r.yc }, r.t));
  }
  const tr = transpose(opened, W, H);
  for (const r of extractBands(tr, H, W, minLen, minT, maxT)) {
    segs.push(mkSeg({ x: r.yc, y: r.x0 }, { x: r.yc, y: r.x1 }, r.t));
  }
  const axisCount = segs.length;
  const diag = extractResidual(opened, W, H, segs, tMin, tMax);
  segs.push(...diag);
  lap('segments');

  // 5. merge + join -------------------------------------------------------------------
  mergeCollinear(segs);
  joinEnds(segs, 0);
  mergeCollinear(segs);
  lap('join');

  // provisional scale for metric thresholds
  let ext = wallExtents(segs);
  let mppProv: number;
  let mppLoose = false;
  if (opts.metersPerPixel && opts.metersPerPixel > 0) mppProv = opts.metersPerPixel;
  else if (opts.expectedWidthMeters && opts.expectedWidthMeters > 0 && ext.w > 0) mppProv = opts.expectedWidthMeters / ext.w;
  else { mppProv = DEFAULT_EXT_WALL_M / tMax; mppLoose = true; }

  // 6. openings -------------------------------------------------------------------------
  const openings: OpenRec[] = [];
  dropDetached(segs, m2pProv(3.0, mppProv));
  detectOpenings(segs, openings, ink, opened, W, H, mppProv, mppLoose);
  joinEnds(segs, 0);
  mergeCollinear(segs);
  lap('openings');

  // cleanup: drop stray short pieces
  for (const s of segs) {
    if (s.dead) continue;
    const L = segLen(s);
    if (L < Math.max(2, 0.8 * s.t)) s.dead = true;
    else if (!s.joinA && !s.joinB && L * mppProv < 0.9 && L < 6 * s.t) s.dead = true;
  }
  dropContained(segs);
  dropDetached(segs);
  const finalSegs = segs.filter((s) => !s.dead);

  // final scale ---------------------------------------------------------------------------
  ext = wallExtents(finalSegs);
  const doorWidthsPx = openings.filter((o) => o.kind === 'door').map((o) => len(sub(o.p1, o.p0)));
  let mpp: number;
  let scaleSource: VectorDebug['scaleSource'];
  if (opts.metersPerPixel && opts.metersPerPixel > 0) { mpp = opts.metersPerPixel; scaleSource = 'given'; }
  else if (opts.expectedWidthMeters && opts.expectedWidthMeters > 0 && ext.w > 0) { mpp = opts.expectedWidthMeters / ext.w; scaleSource = 'expectedWidth'; }
  else if (doorWidthsPx.length >= 2) {
    // ignore double doors / wide passages for the scale estimate
    const sorted = [...doorWidthsPx].sort((a, b) => a - b);
    const med0 = sorted[Math.floor(sorted.length / 2)];
    const singles = sorted.filter((w) => w < 1.35 * med0);
    mpp = DEFAULT_DOOR_M / singles[Math.floor((singles.length - 1) / 2)];
    scaleSource = 'doors';
  } else { mpp = DEFAULT_EXT_WALL_M / tMax; scaleSource = 'wallThickness'; }

  // 7. rooms --------------------------------------------------------------------------------
  const roomPx = extractRoomsPx(finalSegs.map((s) => ({ a: s.a, b: s.b, thickness: s.t })), W, H, mpp);
  lap('rooms');

  // output ------------------------------------------------------------------------------------
  const walls: VectorWall[] = finalSegs.map((s) => ({ a: mul(s.a, mpp), b: mul(s.b, mpp), thickness: s.t * mpp }));
  const outOpenings: VectorOpening[] = [];
  for (const o of openings) {
    let host: Seg | undefined = o.host;
    while (host && host.dead && host.mergedInto) host = host.mergedInto;
    if (!host || host.dead) continue;
    const wi = finalSegs.indexOf(host);
    if (wi < 0) continue;
    const s = finalSegs[wi];
    const d = segDir(s);
    const mid = mul(add(o.p0, o.p1), 0.5);
    outOpenings.push({ wallIndex: wi, kind: o.kind, t: dot(sub(mid, s.a), d) * mpp, width: len(sub(o.p1, o.p0)) * mpp });
  }
  const rooms: VectorRoom[] = roomPx.map((r) => ({ points: r.points.map((p) => mul(p, mpp)), area: r.areaPx * mpp * mpp }));

  // confidence: wall pixels explained, joined endpoints, rooms found
  let covered = 0, total = 0;
  {
    const paint = new Uint8Array(N);
    for (const s of finalSegs) fillSegRect(paint, W, H, s.a, s.b, s.t / 2 + 1.5, s.t / 2 + 1.5);
    for (let i = 0; i < N; i++) if (opened[i]) { total++; if (paint[i]) covered++; }
  }
  const ends = finalSegs.length * 2 || 1;
  const joined = finalSegs.reduce((n, s) => n + (s.joinA ? 1 : 0) + (s.joinB ? 1 : 0), 0);
  const coverage = total ? covered / total : 0;
  const confidence = finalSegs.length === 0 ? 0
    : Math.max(0, Math.min(1, 0.45 * coverage + 0.35 * (joined / ends) + 0.2 * (rooms.length > 0 ? 1 : 0)
      - (scaleSource === 'wallThickness' ? 0.1 : 0)));
  lap('output');

  return {
    walls, openings: outOpenings, rooms, metersPerPixel: mpp, confidence,
    debug: {
      threshold: th.thr, inverted, skewDeg, closeKernel, tDom, tMin, tMax, kernel, scaleSource, widthPx: ext.w, heightPx: ext.h,
      doorWidthsPx, axisSegments: axisCount, diagonalSegments: diag.length, timings,
    },
  };
}

/**
 * Rooms from vector walls given in pixel units (also used by tests to verify
 * ground truth). Returns polygons in pixel units.
 */
export function extractRoomsPx(
  walls: { a: P; b: P; thickness: number }[], W: number, H: number, mpp: number,
): { points: P[]; areaPx: number }[] {
  const f = W * H > 2_500_000 ? 2 : 1;
  const gw = Math.ceil(W / f), gh = Math.ceil(H / f);
  const n = gw * gh;
  const grid = new Uint8Array(n);
  for (const w of walls) {
    const a = mul(w.a, 1 / f), b = mul(w.b, 1 / f);
    const h = Math.max(w.thickness / 2 / f, 0.75);
    fillSegRect(grid, gw, gh, a, b, h, h);
  }
  const lab = new Int32Array(n);
  const queue = new Int32Array(n);
  // outside
  let qt = 0;
  const pushOut = (i: number) => { if (!grid[i] && lab[i] === 0) { lab[i] = -1; queue[qt++] = i; } };
  for (let x = 0; x < gw; x++) { pushOut(x); pushOut((gh - 1) * gw + x); }
  for (let y = 0; y < gh; y++) { pushOut(y * gw); pushOut(y * gw + gw - 1); }
  for (let qh = 0; qh < qt; qh++) {
    const i = queue[qh], x = i % gw;
    if (x > 0) pushOut(i - 1);
    if (x < gw - 1) pushOut(i + 1);
    if (i >= gw) pushOut(i - gw);
    if (i < n - gw) pushOut(i + gw);
  }
  const cellM2 = (f * mpp) ** 2;
  const out: { points: P[]; areaPx: number }[] = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (grid[s] || lab[s] !== 0) continue;
    id++;
    qt = 0; lab[s] = id; queue[qt++] = s;
    for (let qh = 0; qh < qt; qh++) {
      const i = queue[qh], x = i % gw;
      const visit = (j: number) => { if (!grid[j] && lab[j] === 0) { lab[j] = id; queue[qt++] = j; } };
      if (x > 0) visit(i - 1);
      if (x < gw - 1) visit(i + 1);
      if (i >= gw) visit(i - gw);
      if (i < n - gw) visit(i + gw);
    }
    const count = qt;
    const areaM2 = count * cellM2;
    if (areaM2 < 0.7) continue;
    const tr = traceOuter(lab, gw, gh, id, s);
    const perimM = tr.perimeter * f * mpp;
    if ((2 * areaM2) / perimM < 0.35) continue;
    const poly = simplifyClosed(tr.points, 1.0).map((p) => mul(p, f));
    out.push({ points: poly, areaPx: count * f * f });
  }
  return out;
}

// ---------------------------------------------------------------------------
// image basics

interface Prepared {
  th: ReturnType<typeof otsu>;
  mask: Uint8Array;
  ink: Uint8Array;
  /** Pixels added by the hollow-wall fill. */
  filled: number;
  opened: Uint8Array;
  kernel: number;
  est: { tDom: number; tMin: number; tMax: number; thickFrac: number };
}

/** Robust sigma of paper noise: median |horizontal neighbour difference| on light pixels. */
function pixelNoise(g: Uint8Array, W: number, thr: number): number {
  const hist = new Float64Array(256);
  let n = 0;
  const step = Math.max(1, Math.floor(g.length / 400000));
  for (let i = 0; i + 1 < g.length; i += step) {
    if ((i + 1) % W === 0) continue;
    const a = g[i], b = g[i + 1];
    if (a <= thr || b <= thr) continue;
    hist[Math.abs(a - b)]++; n++;
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) return (1.4826 * v) / Math.SQRT2; }
  return 0;
}

/** Threshold, wall-thickness estimate and morphological opening. */
function prepare(gray: Uint8Array, W: number, H: number, closeK: number): Prepared | null {
  const N = W * H;
  const th = otsu(gray);
  if (th.meanHi - th.meanLo < 40) return null;
  const mask = new Uint8Array(N);
  const ink = new Uint8Array(N);
  // lenient threshold for faint thin lines, but kept >= 3 sigma away from the paper noise
  // (pixel noise is measured from neighbour differences, so flat pastel room
  // fills do not count as noise)
  const inkThr = Math.max(th.thr, Math.min(th.thr + 0.45 * (th.meanHi - th.thr), th.meanHi - 4 * pixelNoise(gray, W, th.thr)));
  for (let i = 0; i < N; i++) { const g = gray[i]; if (g <= th.thr) mask[i] = 1; if (g <= inkThr) ink[i] = 1; }
  // hatched / outlined walls: fill enclosed thin light regions (wall interiors)
  const wallSrc = closeK > 0 ? fillThinHoles(mask, W, H, closeK) : mask;
  const est = estimateThickness(wallSrc, W, H);
  if (!est) return null;
  const { tDom, tMin } = est;
  const kernel = tMin >= 4 ? Math.max(3, Math.min(Math.round(0.6 * tMin), Math.round(0.4 * tDom))) : 2;
  const opened = openSquare(wallSrc, W, H, kernel);
  let filled = 0;
  if (closeK > 0) for (let i = 0; i < N; i++) filled += wallSrc[i] - mask[i];
  return { th, mask, ink, opened, kernel, est, filled };
}

/**
 * Dominant wall angle (degrees, within ±8°) from projection-profile sharpness
 * of the wall mask. Rotating the image by -angle makes the walls axis aligned.
 */
function estimateSkew(m: Uint8Array, W: number, H: number): number {
  let count = 0;
  for (let i = 0; i < m.length; i++) count += m[i];
  if (count < 100) return 0;
  const stride = Math.max(1, Math.floor(count / 60000));
  const xs: number[] = [], ys: number[] = [];
  let k = 0;
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    if (k++ % stride) continue;
    const x = i % W;
    xs.push(x + 0.5 - cx); ys.push((i - x) / W + 0.5 - cy);
  }
  const R = Math.ceil(Math.hypot(W, H) / 2) + 2;
  const hx = new Float64Array(2 * R + 1), hy = new Float64Array(2 * R + 1);
  const score = (deg: number): number => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    hx.fill(0); hy.fill(0);
    for (let j = 0; j < xs.length; j++) {
      const x = xs[j], y = ys[j];
      hx[Math.round(x * c + y * s) + R]++;
      hy[Math.round(-x * s + y * c) + R]++;
    }
    let sc = 0;
    for (let j = 0; j < hx.length; j++) sc += hx[j] * hx[j] + hy[j] * hy[j];
    return sc;
  };
  let best = 0, bestS = score(0);
  for (let d = -8; d <= 8.001; d += 0.5) { const sc = score(d); if (sc > bestS * 1.0001) { bestS = sc; best = d; } }
  const c0 = best;
  for (let d = c0 - 0.5; d <= c0 + 0.501; d += 0.05) { const sc = score(d); if (sc > bestS * 1.0001) { bestS = sc; best = d; } }
  return Math.round(best * 100) / 100;
}

/** Rotate a gray image by -angle about its center (bilinear, white fill). */
function rotateGray(g: Uint8Array, W: number, H: number, angle: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const c = Math.cos(angle), s = Math.sin(angle), cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const sx = dx * c - dy * s + cx - 0.5, sy = dx * s + dy * c + cy - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { out[y * W + x] = 255; continue; }
      const fx = sx - x0, fy = sy - y0, i = y0 * W + x0;
      const v = (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + W] * (1 - fx) + g[i + W + 1] * fx) * fy;
      out[y * W + x] = v;
    }
  }
  return out;
}

function toGray(img: RGBAImageLike): Uint8Array {
  const n = img.width * img.height, d = img.data, g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = d[j + 3] / 255;
    const l = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    g[i] = Math.round(255 - a * (255 - l));
  }
  return g;
}

function otsu(g: Uint8Array): { thr: number; meanLo: number; meanHi: number; sdHi: number; darkFrac: number } {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = -1, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  let lo = 0, nlo = 0, hi = 0, nhi = 0;
  for (let t = 0; t < 256; t++) { if (t <= thr) { lo += t * hist[t]; nlo += hist[t]; } else { hi += t * hist[t]; nhi += hist[t]; } }
  const meanHi = nhi ? hi / nhi : 255;
  let v = 0;
  for (let t = thr + 1; t < 256; t++) v += hist[t] * (t - meanHi) * (t - meanHi);
  const sdHi = nhi ? Math.sqrt(v / nhi) : 0;
  return { thr, meanLo: nlo ? lo / nlo : 0, meanHi, sdHi, darkFrac: nlo / total };
}

function runLengths(m: Uint8Array, W: number, H: number): { hr: Uint16Array; vr: Uint16Array } {
  const hr = new Uint16Array(W * H), vr = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let x = 0;
    while (x < W) {
      if (!m[row + x]) { x++; continue; }
      const s = x;
      while (x < W && m[row + x]) x++;
      const L = Math.min(x - s, 65535);
      for (let k = s; k < x; k++) hr[row + k] = L;
    }
  }
  for (let i = 0; i < W * H; i++) if (m[i]) vr[i] = Math.min(65535, (i >= W ? vr[i - W] : 0) + 1);
  for (let i = W * H - W - 1; i >= 0; i--) if (m[i] && m[i + W]) vr[i] = vr[i + W];
  return { hr, vr };
}

function estimateThickness(m: Uint8Array, W: number, H: number): { tDom: number; tMin: number; tMax: number; thickFrac: number } | null {
  const { hr, vr } = runLengths(m, W, H);
  const MAXS = 400;
  const uH = new Float64Array(MAXS + 2), wH = new Float64Array(MAXS + 2);
  let nDark = 0, nThick = 0;
  for (let i = 0; i < W * H; i++) {
    if (!m[i]) continue;
    const a = hr[i], b = vr[i];
    const s = a < b ? a : b, L = a < b ? b : a;
    nDark++;
    if (s >= 4) nThick++;
    if (s <= MAXS && L >= 2.5 * s) { uH[s]++; wH[s] += s; }
  }
  const smooth = (h: Float64Array) => {
    const o = new Float64Array(h.length);
    for (let s = 1; s <= MAXS; s++) o[s] = (h[s - 1] + 2 * h[s] + h[s + 1]) / 4;
    return o;
  };
  const uS = smooth(uH), wS = smooth(wH);
  let tDom = -1, best = 0;
  for (let s = 3; s <= MAXS; s++) if (wS[s] > best) { best = wS[s]; tDom = s; }
  if (tDom < 0 || best <= 0) return null;
  // thinnest wall class: skip the thin-line peak (1-2 px strokes) up to its
  // valley, then take the first significant local maximum below tDom and
  // extend it down its rising flank (mixed thicknesses smear into a ramp)
  let valley = 2;
  const lp = uS[1] >= uS[2] ? 1 : 2;
  if (uS[lp] >= uS[lp + 1]) {
    // a thin-line peak exists at 1-2 px: skip to the following valley
    for (let s = lp + 1; s < tDom; s++) if (uS[s] <= uS[s - 1] && uS[s] <= uS[s + 1]) { valley = s; break; }
  }
  let tMin = -1;
  for (let s = Math.max(3, valley + 1, Math.ceil(0.2 * tDom)); s < tDom; s++) {
    if (uS[s] >= uS[s - 1] && uS[s] >= uS[s + 1] && uS[s] >= 0.04 * uS[tDom]) {
      let e = s;
      while (e - 1 > valley && e - 1 >= 3 && uS[e - 1] >= 0.35 * uS[s] && uS[e - 1] <= uS[e]) e--;
      tMin = e;
      break;
    }
  }
  if (tMin < 0) {
    // no separate thin class: walk down the dominant peak's flank
    tMin = tDom;
    while (tMin - 1 > valley && tMin - 1 >= 3 && uS[tMin - 1] >= 0.2 * uS[tDom] && uS[tMin - 1] <= uS[tMin]) tMin--;
  }
  let tMax = tDom;
  for (let s = Math.min(MAXS - 1, Math.floor(2.5 * tDom)); s > tDom; s--) {
    if (wS[s] >= wS[s - 1] && wS[s] >= wS[s + 1] && wS[s] >= 0.15 * wS[tDom]) { tMax = s; break; }
  }
  return { tDom, tMin, tMax, thickFrac: nDark ? nThick / nDark : 0 };
}

function integral(m: Uint8Array, W: number, H: number, I: Int32Array): void {
  const W1 = W + 1;
  for (let x = 0; x <= W; x++) I[x] = 0;
  for (let y = 0; y < H; y++) {
    let rs = 0;
    const o = (y + 1) * W1, p = y * W1, r = y * W;
    I[o] = 0;
    for (let x = 0; x < W; x++) { rs += m[r + x]; I[o + x + 1] = I[p + x + 1] + rs; }
  }
}

/** Erosion with a k×k square: pixel kept if the square anchored on it is fully set. */
function erodeSquare(m: Uint8Array, W: number, H: number, k: number): Uint8Array {
  const W1 = W + 1;
  const I = new Int32Array(W1 * (H + 1));
  integral(m, W, H, I);
  const r1 = (k - 1) >> 1, r2 = k - 1 - r1, kk = k * k;
  const e = new Uint8Array(W * H);
  for (let y = r1; y < H - r2; y++) {
    const y0 = (y - r1) * W1, y1 = (y + r2 + 1) * W1;
    for (let x = r1; x < W - r2; x++) {
      if (!m[y * W + x]) continue;
      const x0 = x - r1, x1 = x + r2 + 1;
      if (I[y1 + x1] - I[y0 + x1] - I[y1 + x0] + I[y0 + x0] === kk) e[y * W + x] = 1;
    }
  }
  return e;
}

/** Dilation with the reflected k×k square (inverse of erodeSquare's anchoring). */
function dilateSquare(m: Uint8Array, W: number, H: number, k: number): Uint8Array {
  const W1 = W + 1;
  const I = new Int32Array(W1 * (H + 1));
  integral(m, W, H, I);
  const r1 = (k - 1) >> 1, r2 = k - 1 - r1;
  const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r2) * W1, y1 = Math.min(H, y + r1 + 1) * W1;
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r2), x1 = Math.min(W, x + r1 + 1);
      if (I[y1 + x1] - I[y0 + x1] - I[y1 + x0] + I[y0 + x0] > 0) o[y * W + x] = 1;
    }
  }
  return o;
}

/** Morphological opening with a k×k square (union of all k×k squares inside the mask). */
function openSquare(m: Uint8Array, W: number, H: number, k: number): Uint8Array {
  return dilateSquare(erodeSquare(m, W, H, k), W, H, k);
}

function thresholdOnly(gray: Uint8Array): Uint8Array {
  const th = otsu(gray);
  const m = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) if (gray[i] <= th.thr) m[i] = 1;
  return m;
}

/**
 * For hatched / outlined walls: the most frequent short light gap between dark
 * pixels (rows and columns) + 2 px is the closing size that fills wall interiors.
 */
function estimateGapKernel(m: Uint8Array, W: number, H: number): number {
  const MAXG = 60;
  const hist = new Float64Array(MAXG + 1);
  const scan = (get: (i: number, j: number) => number, n1: number, n2: number) => {
    for (let i = 0; i < n1; i++) {
      let last = -1;
      for (let j = 0; j < n2; j++) {
        if (!get(i, j)) continue;
        const gap = j - last - 1;
        if (last >= 0 && gap >= 2 && gap <= MAXG) hist[gap]++;
        last = j;
      }
    }
  };
  scan((y, x) => m[y * W + x], H, W);
  scan((x, y) => m[y * W + x], W, H);
  let best = 0, bk = -1;
  for (let g = 2; g <= MAXG; g++) {
    const v = hist[g - 1] * 0.5 + hist[g] + hist[g + 1 <= MAXG ? g + 1 : g] * 0.5;
    if (v > best) { best = v; bk = g; }
  }
  return bk > 0 ? bk : 0;
}

/**
 * Fill enclosed light components that look like wall interiors: either tiny
 * (mean width <= 1.5·gap, e.g. between hatch lines) or elongated strips whose
 * width is within 1.5x of the typical elongated-strip width (length-weighted
 * 80th percentile). Rooms are wide and not strip-like, so they stay empty.
 */
function fillThinHoles(m: Uint8Array, W: number, H: number, gap: number): Uint8Array {
  const N = W * H;
  const out = m.slice();
  const lab = new Int32Array(N);
  const q = new Int32Array(N);
  const comps: { start: number; n: number; w: number; L: number }[] = [];
  let id = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (m[s0] || lab[s0]) continue;
    id++;
    let qt = 0, border = false, perim = 0;
    lab[s0] = id; q[qt++] = s0;
    for (let qh = 0; qh < qt; qh++) {
      const i = q[qh], x = i % W, y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (x > 0) { const j = i - 1; if (m[j]) perim++; else if (!lab[j]) { lab[j] = id; q[qt++] = j; } }
      if (x < W - 1) { const j = i + 1; if (m[j]) perim++; else if (!lab[j]) { lab[j] = id; q[qt++] = j; } }
      if (y > 0) { const j = i - W; if (m[j]) perim++; else if (!lab[j]) { lab[j] = id; q[qt++] = j; } }
      if (y < H - 1) { const j = i + W; if (m[j]) perim++; else if (!lab[j]) { lab[j] = id; q[qt++] = j; } }
    }
    if (border || perim === 0) continue;
    comps.push({ start: s0, n: qt, w: (2 * qt) / perim, L: perim / 2 });
  }
  const strips = comps.filter((c) => c.L / c.w >= 6 && c.w > 1.2).sort((a, b) => a.w - b.w);
  // wall-interior strips are the thin cluster: cut at the first big width jump
  // (>= 1.6x) once at least 20% of the strip length has been accumulated
  let cap = 1.5 * gap;
  const totalL = strips.reduce((a, c) => a + c.L, 0);
  let acc = 0, p50 = 0, found = false;
  for (let i = 0; i + 1 < strips.length; i++) {
    acc += strips[i].L;
    if (!p50 && acc >= 0.5 * totalL) p50 = strips[i].w;
    if (acc >= 0.2 * totalL && strips[i + 1].w >= 1.6 * strips[i].w) { cap = Math.max(cap, 1.25 * strips[i].w); found = true; break; }
  }
  if (!found && p50) cap = Math.max(cap, 1.25 * p50);
  const fillIds = new Set<number>();
  for (const c of comps) {
    if (c.w <= 1.5 * gap || (c.w <= cap && c.L / c.w >= 3)) fillIds.add(lab[c.start]);
  }
  for (let i = 0; i < N; i++) if (lab[i] && fillIds.has(lab[i])) out[i] = 1;
  return out;
}

function transpose(m: Uint8Array, W: number, H: number): Uint8Array {
  const t = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < W; x++) t[x * H + y] = m[r + x]; }
  return t;
}

// ---------------------------------------------------------------------------
// wall extraction

interface Band { x0: number; x1: number; yc: number; t: number }

/** Horizontal wall bands: long row runs -> components -> constant-thickness column groups. */
function extractBands(m: Uint8Array, W: number, H: number, minLen: number, minT: number, maxT: number): Band[] {
  const N = W * H;
  // vertical run length through every pixel
  const vr = new Uint16Array(N);
  for (let i = 0; i < N; i++) if (m[i]) vr[i] = Math.min(65535, (i >= W ? vr[i - W] : 0) + 1);
  for (let i = N - W - 1; i >= 0; i--) if (m[i] && m[i + W]) vr[i] = vr[i + W];
  // a row run belongs to a horizontal wall if it is long and, for most of its
  // length, clearly longer than the local vertical extent (excludes
  // cross-sections of vertical walls, diagonal walls and square blobs)
  const cand = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let x = 0;
    while (x < W) {
      if (!m[row + x]) { x++; continue; }
      const s = x;
      while (x < W && m[row + x]) x++;
      const L = x - s;
      if (L < minLen) continue;
      let thin = 0;
      for (let k = s; k < x; k++) if (vr[row + k] * 1.2 <= L) thin++;
      if (thin >= 0.3 * L) for (let k = s; k < x; k++) cand[row + k] = 1;
    }
  }
  const out: Band[] = [];
  const q = new Int32Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (cand[s0] !== 1) continue;
    let qt = 0;
    cand[s0] = 2; q[qt++] = s0;
    let minX = W, maxX = -1;
    for (let qh = 0; qh < qt; qh++) {
      const i = q[qh], x = i % W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (x > 0 && cand[i - 1] === 1) { cand[i - 1] = 2; q[qt++] = i - 1; }
      if (x < W - 1 && cand[i + 1] === 1) { cand[i + 1] = 2; q[qt++] = i + 1; }
      if (i >= W && cand[i - W] === 1) { cand[i - W] = 2; q[qt++] = i - W; }
      if (i < N - W && cand[i + W] === 1) { cand[i + W] = 2; q[qt++] = i + W; }
    }
    const cw = maxX - minX + 1;
    const top = new Int32Array(cw).fill(1 << 30), bot = new Int32Array(cw).fill(-1);
    for (let k = 0; k < qt; k++) {
      const i = q[k], x = i % W, y = (i - x) / W, c = x - minX;
      if (y < top[c]) top[c] = y;
      if (y > bot[c]) bot[c] = y;
    }
    let gx0 = 0, gLast = 0, sc = 0, st = 0, gn = 0;
    const flush = () => {
      if (gn > 0) {
        const x0 = minX + gx0, x1 = minX + gLast + 1, mt = st / gn;
        if (x1 - x0 >= minLen && mt <= maxT && mt >= minT) out.push({ x0, x1, yc: sc / gn, t: mt });
      }
      gn = 0; sc = 0; st = 0;
    };
    for (let c = 0; c < cw; c++) {
      if (bot[c] < 0) { flush(); continue; }
      const cc = (top[c] + bot[c] + 1) / 2, tt = bot[c] - top[c] + 1;
      if (gn > 0) {
        const mc = sc / gn, mt = st / gn;
        if (Math.abs(cc - mc) > Math.max(1.5, 0.3 * mt) || Math.abs(tt - mt) > Math.max(2, 0.35 * mt)) flush();
      }
      if (gn === 0) gx0 = c;
      sc += cc; st += tt; gn++; gLast = c;
    }
    flush();
  }
  return out;
}

function mkSeg(a: P, b: P, t: number): Seg {
  return { a, b, t, joinA: false, joinB: false, dead: false };
}

/** Fill a (possibly rotated) rectangle around segment a-b: half width `h`, ends extended by `ext`. */
function fillSegRect(m: Uint8Array, W: number, H: number, a: P, b: P, h: number, ext: number): void {
  const d = unit(sub(b, a)), n = perp(d);
  const L = len(sub(b, a));
  const A = sub(a, mul(d, ext));
  const corners = [add(A, mul(n, h)), add(A, mul(n, -h)), add(add(A, mul(d, L + 2 * ext)), mul(n, h)), add(add(A, mul(d, L + 2 * ext)), mul(n, -h))];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of corners) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H - 1, Math.ceil(y1));
  const LL = L + 2 * ext;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const rx = x + 0.5 - A.x, ry = y + 0.5 - A.y;
      const u = rx * d.x + ry * d.y;
      if (u < 0 || u > LL) continue;
      const v = rx * n.x + ry * n.y;
      if (v < -h || v > h) continue;
      m[y * W + x] = 1;
    }
  }
}

/** Elongated blobs not explained by axis walls -> (diagonal) walls via PCA. */
function extractResidual(opened: Uint8Array, W: number, H: number, axis: Seg[], tMin: number, tMax: number): Seg[] {
  const N = W * H;
  const claimed = new Uint8Array(N);
  for (const s of axis) fillSegRect(claimed, W, H, s.a, s.b, s.t / 2 + 2, 2);
  const res = new Uint8Array(N);
  let any = false;
  for (let i = 0; i < N; i++) if (opened[i] && !claimed[i]) { res[i] = 1; any = true; }
  const out: Seg[] = [];
  if (!any) return out;
  const q = new Int32Array(N);
  const minPix = Math.max(20, 3 * tMin * tMin);
  for (let s0 = 0; s0 < N; s0++) {
    if (res[s0] !== 1) continue;
    let qt = 0;
    res[s0] = 2; q[qt++] = s0;
    for (let qh = 0; qh < qt; qh++) {
      const i = q[qh], x = i % W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, j = i + dy * W + dx;
        if (nx < 0 || nx >= W || j < 0 || j >= N) continue;
        if (res[j] === 1) { res[j] = 2; q[qt++] = j; }
      }
    }
    if (qt < minPix) continue;
    let mx = 0, my = 0;
    for (let k = 0; k < qt; k++) { const i = q[k], x = i % W; mx += x + 0.5; my += (i - x) / W + 0.5; }
    mx /= qt; my /= qt;
    let sxx = 0, syy = 0, sxy = 0;
    for (let k = 0; k < qt; k++) {
      const i = q[k], x = i % W, dx = x + 0.5 - mx, dy = (i - x) / W + 0.5 - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let d = { x: Math.cos(ang), y: Math.sin(ang) };
    const deg = ((ang * 180) / Math.PI + 180) % 90;
    const nearAxis = deg < 10 || deg > 80;
    if (nearAxis) d = Math.abs(d.x) > Math.abs(d.y) ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const n = perp(d);
    let smin = Infinity, smax = -Infinity, lat = 0;
    for (let k = 0; k < qt; k++) {
      const i = q[k], x = i % W, dx = x + 0.5 - mx, dy = (i - x) / W + 0.5 - my;
      const s = dx * d.x + dy * d.y;
      if (s < smin) smin = s;
      if (s > smax) smax = s;
      lat += dx * n.x + dy * n.y;
    }
    lat /= qt;
    const L = smax - smin + 1;
    const thick = qt / L;
    if (L / thick < 3 || thick < 0.7 * tMin || thick > 1.6 * tMax + 2) continue;
    // solidity: pixels must hug the centerline (rejects outlines / rings)
    let inside = 0;
    for (let k = 0; k < qt; k++) {
      const i = q[k], x = i % W, dx = x + 0.5 - mx, dy = (i - x) / W + 0.5 - my;
      if (Math.abs(dx * n.x + dy * n.y - lat) <= 0.5 * thick + 1.5) inside++;
    }
    if (inside < 0.9 * qt) continue;
    if (nearAxis && L < 2 * tMin) continue;
    const c = add({ x: mx, y: my }, mul(n, lat));
    let a = add(c, mul(d, smin - 0.5)), b = add(c, mul(d, smax + 0.5));
    if (a.x > b.x + 1e-9 || (Math.abs(a.x - b.x) < 1e-9 && a.y > b.y)) { const t = a; a = b; b = t; }
    out.push(mkSeg(a, b, thick));
  }
  return out;
}

// ---------------------------------------------------------------------------
// topology


/** Merge W into S (assumed parallel & roughly collinear). */
function mergeInto(S: Seg, Wg: Seg): void {
  const dS = segDir(S), nS = perp(dS);
  const LS = segLen(S);
  const w0 = dot(sub(Wg.a, S.a), dS), w1 = dot(sub(Wg.b, S.a), dS);
  const wmin = Math.min(w0, w1), wmax = Math.max(w0, w1);
  const LW = wmax - wmin;
  const lat = (dot(sub(Wg.a, S.a), nS) + dot(sub(Wg.b, S.a), nS)) / 2;
  const wl = LW / (LS + LW || 1);
  const origin = add(S.a, mul(nS, lat * wl));
  const wJoinMin = w0 < w1 ? Wg.joinA : Wg.joinB, wJoinMax = w0 < w1 ? Wg.joinB : Wg.joinA;
  const lo = Math.min(0, wmin), hi = Math.max(LS, wmax);
  const joinA = wmin < 0 ? wJoinMin : S.joinA;
  const joinB = wmax > LS ? wJoinMax : S.joinB;
  S.t = (S.t * LS + Wg.t * LW) / (LS + LW || 1);
  S.a = add(origin, mul(dS, lo));
  S.b = add(origin, mul(dS, hi));
  S.joinA = joinA; S.joinB = joinB;
  Wg.dead = true;
  Wg.mergedInto = S;
}

function mergeCollinear(segs: Seg[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      const S = segs[i];
      if (S.dead) continue;
      for (let j = i + 1; j < segs.length; j++) {
        const Wg = segs[j];
        if (Wg.dead) continue;
        const dS = segDir(S), dW = segDir(Wg);
        if (Math.abs(cross(dS, dW)) > 0.08) continue;
        const nS = perp(dS);
        const tolLat = Math.max(2, 0.45 * Math.min(S.t, Wg.t));
        const la = dot(sub(Wg.a, S.a), nS), lb = dot(sub(Wg.b, S.a), nS);
        if (Math.abs(la) > tolLat || Math.abs(lb) > tolLat) continue;
        if (Math.abs(S.t - Wg.t) > Math.max(2, 0.35 * Math.max(S.t, Wg.t))) continue;
        const LS = segLen(S);
        const w0 = dot(sub(Wg.a, S.a), dS), w1 = dot(sub(Wg.b, S.a), dS);
        const gap = Math.max(0, Math.min(w0, w1)) - Math.min(LS, Math.max(w0, w1));
        if (gap > Math.max(2, 0.6 * Math.min(S.t, Wg.t))) continue;
        mergeInto(S, Wg);
        changed = true;
      }
    }
  }
}

/** Snap free endpoints to the centerline intersection with crossing walls. */
function joinEnds(segs: Seg[], extraTol: number): void {
  for (const S of segs) {
    if (S.dead) continue;
    for (const end of [0, 1]) {
      if (end === 0 ? S.joinA : S.joinB) continue;
      const E = end ? S.b : S.a, O = end ? S.a : S.b;
      const d = unit(sub(E, O));
      const LS = segLen(S);
      let best: { X: P; score: number } | null = null;
      for (const Wg of segs) {
        if (Wg === S || Wg.dead) continue;
        const dW = segDir(Wg);
        const cr = cross(d, dW), as = Math.abs(cr);
        if (as < 0.3) continue;
        const r = sub(Wg.a, E);
        const delta = cross(r, dW) / cr;
        const u = cross(r, d) / cr;
        const hW = Wg.t / 2, hS = S.t / 2, cs = Math.abs(dot(d, dW));
        const lo = -(hW / as + (hS * cs) / as + 1.5);
        const hi = hW / as + Math.max(3, 0.8 * S.t) + extraTol;
        if (delta < lo || delta > hi || delta < -0.5 * LS) continue;
        const LW = segLen(Wg);
        const uTol = hS / as + Math.max(3, 0.8 * Wg.t) + extraTol;
        if (u < -uTol || u > LW + uTol) continue;
        const score = Math.abs(delta) + (u < 0 || u > LW ? 0.5 * Math.min(Math.abs(u), Math.abs(u - LW)) : 0);
        if (!best || score < best.score) best = { X: add(E, mul(d, delta)), score };
      }
      if (best) {
        if (end) { S.b = best.X; S.joinB = true; } else { S.a = best.X; S.joinA = true; }
      }
    }
  }
}

/** Remove thinner walls whose body lies inside / alongside a parallel thicker wall. */
function dropContained(segs: Seg[]): void {
  for (const S of segs) {
    if (S.dead) continue;
    const dS = segDir(S), LS = segLen(S);
    for (const Wg of segs) {
      if (Wg === S || Wg.dead || Wg.t < S.t) continue;
      const dW = segDir(Wg), nW = perp(dW);
      if (Math.abs(cross(dS, dW)) > 0.08) continue;
      const la = dot(sub(S.a, Wg.a), nW), lb = dot(sub(S.b, Wg.a), nW);
      const tol = (Wg.t + S.t) / 2 + 1;
      if (Math.abs(la) > tol || Math.abs(lb) > tol) continue;
      const LW = segLen(Wg);
      const s0 = dot(sub(S.a, Wg.a), dW), s1 = dot(sub(S.b, Wg.a), dW);
      const ov = Math.min(LW, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1));
      if (ov >= 0.7 * LS) { S.dead = true; break; }
    }
  }
}

/** Remove small wall clusters that do not touch the main structure (furniture, legends). */
function m2pProv(m: number, mpp: number): number { return m / mpp; }

function dropDetached(segs: Seg[], collinearGap = 0): void {
  const live = segs.filter((s) => !s.dead);
  const n = live.length;
  const parent = live.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = live[i], Bs = live[j];
    if (segDist(A.a, A.b, Bs.a, Bs.b) <= A.t / 2 + Bs.t / 2 + 3) { parent[find(i)] = find(j); continue; }
    if (collinearGap > 0) {
      // collinear pieces separated by an opening-sized gap belong together
      const dA = segDir(A), nA = perp(dA);
      if (Math.abs(cross(dA, segDir(Bs))) > 0.08) continue;
      const tol = Math.max(2, 0.45 * Math.min(A.t, Bs.t));
      if (Math.abs(dot(sub(Bs.a, A.a), nA)) > tol || Math.abs(dot(sub(Bs.b, A.a), nA)) > tol) continue;
      if (segDist(A.a, A.b, Bs.a, Bs.b) <= collinearGap) parent[find(i)] = find(j);
    }
  }
  const total = new Map<number, number>();
  live.forEach((s, i) => { const r = find(i); total.set(r, (total.get(r) ?? 0) + segLen(s)); });
  const maxTotal = Math.max(0, ...total.values());
  live.forEach((s, i) => { if ((total.get(find(i)) ?? 0) < 0.2 * maxTotal) s.dead = true; });
}

function pointSegDist(p: P, a: P, b: P): number {
  const d = sub(b, a), L2 = dot(d, d);
  const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)) : 0;
  return len(sub(p, add(a, mul(d, t))));
}

function segDist(a: P, b: P, c: P, d: P): number {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) > 1e-9) {
    const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

function wallExtents(segs: Seg[]): { x0: number; y0: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) {
    if (s.dead) continue;
    const n = perp(segDir(s)), h = s.t / 2;
    for (const p of [s.a, s.b]) for (const sg of [-1, 1]) {
      const q = add(p, mul(n, h * sg));
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, w: 0, h: 0 };
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------------------
// openings

function rayHit(O: P, d: P, Wg: Seg): number {
  const dW = segDir(Wg), nW = perp(dW), LW = segLen(Wg), h = Wg.t / 2;
  const r = sub(O, Wg.a);
  let t0 = -Infinity, t1 = Infinity;
  const slab = (o: number, dd: number, lo: number, hi: number): boolean => {
    if (Math.abs(dd) < 1e-9) return o >= lo && o <= hi;
    let ta = (lo - o) / dd, tb = (hi - o) / dd;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    return true;
  };
  if (!slab(dot(r, dW), dot(d, dW), 0, LW)) return Infinity;
  if (!slab(dot(r, nW), dot(d, nW), -h, h)) return Infinity;
  if (t0 > t1 || t1 < 0) return Infinity;
  return Math.max(t0, 0);
}

function px(m: Uint8Array, W: number, H: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return 0;
  return m[yi * W + xi];
}

function near(m: Uint8Array, W: number, H: number, x: number, y: number, r: number): boolean {
  const xi = Math.floor(x), yi = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const X = xi + dx, Y = yi + dy;
    if (X >= 0 && Y >= 0 && X < W && Y < H && m[Y * W + X]) return true;
  }
  return false;
}

function windowEvidence(ink: Uint8Array, W: number, H: number, E: P, d: P, n: P, g: number, h: number): { cov: number; runs: number } {
  let tot = 0, covered = 0;
  const runs: number[] = [];
  for (let s = 0.12 * g; s <= 0.88 * g; s += 1) {
    tot++;
    let any = false, prev = false, r = 0;
    for (let o = -h - 2; o <= h + 2; o += 0.5) {
      const p = add(add(E, mul(d, s)), mul(n, o));
      const v = px(ink, W, H, p.x, p.y) === 1;
      if (v && !prev) r++;
      prev = v;
      if (v) any = true;
    }
    if (any) covered++;
    runs.push(r);
  }
  runs.sort((a, b) => a - b);
  return { cov: tot ? covered / tot : 0, runs: runs.length ? runs[Math.floor(runs.length / 2)] : 0 };
}

function arcScore(ink: Uint8Array, wall: Uint8Array, W: number, H: number, c: P, u: P, v: P, r: number): number {
  let valid = 0, hit = 0;
  for (let k = 0; k < 24; k++) {
    const th = ((8 + (74 * k) / 23) * Math.PI) / 180;
    const p = add(c, add(mul(u, r * Math.cos(th)), mul(v, r * Math.sin(th))));
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
    if (near(wall, W, H, p.x, p.y, 1)) continue;
    valid++;
    if (near(ink, W, H, p.x, p.y, 1)) hit++;
  }
  return valid >= 8 ? hit / valid : 0;
}

/** Fraction of points along a straight door leaf (hinge -> hinge + v·r) that hit ink. */
function leafScore(ink: Uint8Array, wall: Uint8Array, W: number, H: number, c: P, v: P, r: number): number {
  let valid = 0, hit = 0;
  for (let k = 0; k < 16; k++) {
    const p = add(c, mul(v, r * (0.15 + (0.75 * k) / 15)));
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
    if (near(wall, W, H, p.x, p.y, 1)) continue;
    valid++;
    if (near(ink, W, H, p.x, p.y, 1)) hit++;
  }
  return valid >= 8 ? hit / valid : 0;
}

/** Length of a continuous ink line from c along v (gaps <= 2 px tolerated). */
function leafLength(ink: Uint8Array, W: number, H: number, c: P, v: P, maxLen: number): number {
  let last = 0, miss = 0;
  for (let s = 2; s <= maxLen; s += 1) {
    const p = add(c, mul(v, s));
    if (near(ink, W, H, p.x, p.y, 1)) { last = s; miss = 0; } else if (++miss > 2) break;
  }
  return last;
}

/**
 * Door symbol score: a quarter arc of radius = gap around either jamb, on either
 * side. Dashed arcs only hit ~half the samples, so a weaker arc counts when the
 * straight leaf at the hinge is also present.
 */
function doorEvidence(ink: Uint8Array, wall: Uint8Array, W: number, H: number, E: P, F: P, d: P, n: P, g: number, h: number): number {
  let best = 0;
  const nd = mul(d, -1);
  const single = (hinge: P, u: P, v: P, r: number) => {
    let arc = arcScore(ink, wall, W, H, hinge, u, v, r);
    if (arc >= 0.55) return arc;
    const leaf = leafScore(ink, wall, W, H, hinge, v, r);
    // the leaf may be shorter than the gap (door next to a corner / stub):
    // measure it and test the arc at that radius
    if (leaf >= 0.5) {
      const L = leafLength(ink, W, H, hinge, v, 1.1 * r);
      if (L >= 0.6 * r && L < 0.97 * r) {
        const a2 = arcScore(ink, wall, W, H, hinge, u, v, L);
        if (a2 >= 0.55) return a2;
        if (a2 >= 0.25) return 0.6;
      }
    }
    if (arc < 0.25) return arc;
    return leaf >= 0.7 ? 0.6 : arc;
  };
  for (const side of [1, -1]) {
    const v = mul(n, side);
    for (const off of [h, 0]) {
      for (const rf of [1, 0.96, 1.04]) {
        const r = g * rf;
        best = Math.max(best,
          single(add(E, mul(v, off)), d, v, r),
          single(add(F, mul(v, off)), nd, v, r));
        const dbl = (arcScore(ink, wall, W, H, add(E, mul(v, off)), d, v, r / 2)
          + arcScore(ink, wall, W, H, add(F, mul(v, off)), nd, v, r / 2)) / 2;
        best = Math.max(best, dbl);
      }
    }
  }
  return best;
}

function detectOpenings(
  segs: Seg[], openings: OpenRec[], ink: Uint8Array, wallMask: Uint8Array, W: number, H: number, mpp: number, loose: boolean,
): void {
  const m2p = (m: number) => m / mpp;
  const gMin = m2p(loose ? 0.35 : 0.45);
  const gMaxDoor = m2p(loose ? 2.6 : 2.0);
  const gMaxWin = m2p(loose ? 6.0 : 5.5);
  const gMaxPlain = m2p(loose ? 5.0 : 4.5);
  const failed = new Set<string>();
  let guard = 0;
  let progress = true;
  while (progress && guard++ < 2000) {
    progress = false;
    for (const S of segs) {
      if (S.dead) continue;
      for (const end of [0, 1]) {
        if (end === 0 ? S.joinA : S.joinB) continue;
        const E = end ? S.b : S.a, O = end ? S.a : S.b;
        const key = `${Math.round(E.x)},${Math.round(E.y)},${Math.round(O.x)},${Math.round(O.y)}`;
        if (failed.has(key)) continue;
        const d = unit(sub(E, O)), n = perp(d), hS = S.t / 2;
        const origin = sub(E, d);
        let bestT = Infinity, bestW: Seg | null = null;
        for (const Wg of segs) {
          if (Wg === S || Wg.dead) continue;
          const t = rayHit(origin, d, Wg);
          if (t < bestT) { bestT = t; bestW = Wg; }
        }
        const g = bestT - 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((globalThis as any).process?.env?.VDBG) console.log('ray', E.x.toFixed(0), E.y.toFixed(0), 'g', g.toFixed(0));
        if (!bestW || g < gMin || g > gMaxWin) { failed.add(key); continue; }
        const dW = segDir(bestW);
        const parallel = Math.abs(cross(d, dW)) < 0.1;
        const latOff = Math.abs(dot(sub(mul(add(bestW.a, bestW.b), 0.5), E), n));
        const collinear = parallel && latOff <= Math.max(hS, bestW.t / 2) + 1;
        if (parallel && !collinear) { failed.add(key); continue; }
        const F = add(E, mul(d, g));
        // a perpendicular closure needs an anchored or long wall piece
        const anchored = (end ? S.joinA : S.joinB) || segLen(S) * mpp >= 1.0;
        if (!collinear && !anchored) { failed.add(key); continue; }
        // the gap must actually be empty of wall body
        let solid = 0, ns = 0;
        for (let sx = 0.1 * g; sx <= 0.9 * g; sx += 1) {
          const p = add(E, mul(d, sx));
          ns++;
          if (px(wallMask, W, H, p.x, p.y)) solid++;
        }
        if (ns && solid / ns > 0.3) { failed.add(key); continue; }
        const win = windowEvidence(ink, W, H, E, d, n, g, hS);
        const door = g <= gMaxDoor ? doorEvidence(ink, wallMask, W, H, E, F, d, n, g, hS) : 0;
        let kind: VectorOpeningKind | null = null;
        if (win.cov >= 0.7 && (win.runs >= 2 || (collinear && door < 0.5))) kind = 'window';
        else if (door >= 0.55) kind = 'door';
        // sliding / garage door: a dashed line along the wall centre
        else if (collinear && g <= gMaxWin && win.cov >= 0.3 && win.runs <= 1) kind = 'door';
        // doorless passage between two in-line wall pieces
        else if (collinear && g <= gMaxPlain && win.cov < 0.3) kind = 'opening';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((globalThis as any).process?.env?.VDBG) console.log('gap', E.x.toFixed(0), E.y.toFixed(0), 'g', g.toFixed(0), 'col', collinear, 'win', win.cov.toFixed(2), win.runs, 'door', door.toFixed(2), kind);
        if (!kind) { failed.add(key); continue; }
        if (collinear) {
          mergeInto(S, bestW);
        } else {
          // extend S to the crossing wall's centerline
          const cr = cross(d, dW);
          const delta = cross(sub(bestW.a, E), dW) / cr;
          const X = add(E, mul(d, delta));
          if (end) { S.b = X; S.joinB = true; } else { S.a = X; S.joinA = true; }
        }
        openings.push({ p0: E, p1: F, kind, host: S });
        progress = true;
        break;
      }
      if (progress) break;
    }
  }
}

// ---------------------------------------------------------------------------
// room outlines

function traceOuter(lab: Int32Array, gw: number, gh: number, id: number, startIdx: number): { points: P[]; perimeter: number } {
  const inR = (x: number, y: number) => x >= 0 && y >= 0 && x < gw && y < gh && lab[y * gw + x] === id;
  const sx = startIdx % gw, sy = (startIdx - sx) / gw;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  let cx = sx, cy = sy, dir = 0, steps = 0;
  const pts: P[] = [{ x: cx, y: cy }];
  const maxSteps = 4 * gw * gh + 8;
  do {
    cx += DX[dir]; cy += DY[dir]; steps++;
    const dx = DX[dir], dy = DY[dir], rx = -dy, ry = dx;
    const R = inR(Math.floor(cx + 0.5 * dx + 0.5 * rx), Math.floor(cy + 0.5 * dy + 0.5 * ry));
    const L = inR(Math.floor(cx + 0.5 * dx - 0.5 * rx), Math.floor(cy + 0.5 * dy - 0.5 * ry));
    let nd = dir;
    if (!R) nd = (dir + 1) % 4;
    else if (L) nd = (dir + 3) % 4;
    if (nd !== dir) pts.push({ x: cx, y: cy });
    dir = nd;
  } while (!(cx === sx && cy === sy && dir === 0) && steps < maxSteps);
  if (pts.length > 1 && pts[pts.length - 1].x === pts[0].x && pts[pts.length - 1].y === pts[0].y) pts.pop();
  return { points: pts, perimeter: steps };
}

function dpOpen(pts: P[], eps: number): P[] {
  if (pts.length <= 2) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const d = sub(b, a), L = len(d);
  let idx = -1, md = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = L > 1e-9 ? Math.abs(cross(d, sub(pts[i], a))) / L : len(sub(pts[i], a));
    if (dist > md) { md = dist; idx = i; }
  }
  if (md <= eps) return [a, b];
  const l = dpOpen(pts.slice(0, idx + 1), eps), r = dpOpen(pts.slice(idx), eps);
  return l.slice(0, -1).concat(r);
}

function simplifyClosed(pts: P[], eps: number): P[] {
  if (pts.length <= 4) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const dd = len(sub(pts[i], pts[0])); if (dd > fd) { fd = dd; far = i; } }
  const a = dpOpen(pts.slice(0, far + 1), eps);
  const b = dpOpen(pts.slice(far).concat([pts[0]]), eps);
  const res = a.slice(0, -1).concat(b.slice(0, -1));
  return res.length >= 3 ? res : pts;
}

export const _internal = { otsu, estimateThickness, openSquare, estimateSkew, fillThinHoles };
