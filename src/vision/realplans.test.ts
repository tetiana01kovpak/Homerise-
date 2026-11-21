// Real-style plans exported by the app (tests/fixtures/plans). Each PNG is
// downsampled like the app does (max 1800 px long side) and vectorized with
// expectedWidthMeters = outerWidth. Set VISION_DUMP=<dir> to write overlay PNGs.
import { describe, expect, it } from 'vitest';
import { decodePng, downsample, type RGBA } from './png';
import { vectorizePlan, type VectorResult } from './vectorize';

type Pt = { x: number; y: number };
interface GT {
  id: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  outerWidth: number;
  walls: { a: Pt; b: Pt; thickness: number }[];
  openings: { kind: string; width: number; at: Pt }[];
  rooms: { name: string; type: string }[];
}

// node built-ins without needing @types/node in the app tsconfig
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeProc = (globalThis as any).process;
const fs = nodeProc?.getBuiltinModule?.('node:fs');
const zlib = nodeProc?.getBuiltinModule?.('node:zlib');
const DIR = 'tests/fixtures/plans/';
const PPM = 120, PAD = 1.6, TITLE = 140;
const DUMP: string | undefined = nodeProc?.env?.VISION_DUMP;

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };

/** Fraction of segment `g` covered by the union of collinear segments `ds` (within tol m). */
function unionCoverage(g: { a: Pt; b: Pt }, ds: { a: Pt; b: Pt }[], tol = 0.15): number {
  const dg = unit(sub(g.b, g.a)), ng = { x: -dg.y, y: dg.x }, Lg = len(sub(g.b, g.a));
  if (Lg < 1e-6) return 1;
  const iv: [number, number][] = [];
  for (const d of ds) {
    const dd = unit(sub(d.b, d.a));
    if (Math.abs(cross(dg, dd)) > 0.14) continue;
    if (Math.abs(dot(sub(d.a, g.a), ng)) > tol || Math.abs(dot(sub(d.b, g.a), ng)) > tol) continue;
    const s0 = dot(sub(d.a, g.a), dg), s1 = dot(sub(d.b, g.a), dg);
    const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(Lg, Math.max(s0, s1));
    if (hi > lo) iv.push([lo, hi]);
  }
  iv.sort((p, q) => p[0] - q[0]);
  let cov = 0, cur = -1;
  for (const [lo, hi] of iv) { const s = Math.max(lo, cur); if (hi > s) { cov += hi - s; cur = hi; } }
  return cov / Lg;
}

interface Row {
  id: string; size: string; gtW: number; detW: number; wP: number; wR: number; wF1: number;
  opR: number; roomsExp: number; roomsGot: number; scaleErr: number; ms: number; missed: string[];
}

function scorePlan(id: string, clean: boolean): Row {
  const gt: GT = JSON.parse(fs.readFileSync(`${DIR}${id}.json`, 'utf8'));
  const full = decodePng(new Uint8Array(fs.readFileSync(`${DIR}${id}${clean ? '-clean' : ''}.png`)), (b) => new Uint8Array(zlib.inflateSync(b)));
  const { image, scale } = downsample(full, 1800);
  const t0 = performance.now();
  const res = vectorizePlan(image, { expectedWidthMeters: gt.outerWidth });
  if (nodeProc?.env?.VISION_VERBOSE) console.log(id, JSON.stringify({ ...res.debug, timings: undefined, doorWidthsPx: undefined }));
  const ms = performance.now() - t0;
  // detected meters -> downsampled px -> full px -> GT meters
  const toGT = (p: Pt): Pt => {
    const fx = p.x / res.metersPerPixel / scale, fy = p.y / res.metersPerPixel / scale;
    return { x: fx / PPM + gt.bounds.minX - PAD, y: (fy - TITLE) / PPM + gt.bounds.minY - PAD };
  };
  const det = res.walls.map((w) => ({ a: toGT(w.a), b: toGT(w.b) }));
  const missed: string[] = [];
  let rec = 0;
  gt.walls.forEach((g) => {
    if (unionCoverage(g, det) >= 0.8) rec++;
    else missed.push(`W(${g.a.x.toFixed(1)},${g.a.y.toFixed(1)}-${g.b.x.toFixed(1)},${g.b.y.toFixed(1)})`);
  });
  let prec = 0;
  det.forEach((d) => {
    if (unionCoverage(d, gt.walls) >= 0.8) prec++;
    else missed.push(`fp(${d.a.x.toFixed(1)},${d.a.y.toFixed(1)}-${d.b.x.toFixed(1)},${d.b.y.toFixed(1)})`);
  });
  const wR = gt.walls.length ? rec / gt.walls.length : 1, wP = det.length ? prec / det.length : 0;
  const wF1 = wP + wR > 0 ? (2 * wP * wR) / (wP + wR) : 0;
  const detOps = res.openings.map((o) => {
    const w = res.walls[o.wallIndex];
    const d = unit(sub(w.b, w.a));
    return { p: toGT({ x: w.a.x + d.x * o.t, y: w.a.y + d.y * o.t }), used: false };
  });
  let opHit = 0;
  for (const g of gt.openings) {
    let best = -1, bd = Math.max(0.35, g.width / 4);
    detOps.forEach((d, i) => { if (!d.used) { const dd = len(sub(d.p, g.at)); if (dd < bd) { bd = dd; best = i; } } });
    if (best >= 0) { detOps[best].used = true; opHit++; } else missed.push(`${g.kind}@(${g.at.x.toFixed(1)},${g.at.y.toFixed(1)})`);
  }
  const trueMpp = 1 / (PPM * scale);
  if (DUMP) dumpOverlay(`${DUMP}/${id}${clean ? '-clean' : ''}.png`, image, res);
  return {
    id: id + (clean ? ' (clean)' : ''), size: `${image.width}x${image.height}`, gtW: gt.walls.length, detW: det.length,
    wP, wR, wF1, opR: gt.openings.length ? opHit / gt.openings.length : 1, roomsExp: gt.rooms.length,
    roomsGot: res.rooms.length, scaleErr: Math.abs(res.metersPerPixel - trueMpp) / trueMpp, ms, missed,
  };
}

function dumpOverlay(path: string, img: RGBA, res: VectorResult): void {
  const { width: W, height: H } = img;
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < W * H * 4; i += 4) for (let c = 0; c < 3; c++) d[i + c] = 128 + d[i + c] / 2;
  const put = (x: number, y: number, col: number[]) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const j = (y * W + x) * 4; d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2];
  };
  const line = (a: Pt, b: Pt, col: number[]) => {
    const n = Math.ceil(len(sub(b, a))) + 1;
    for (let k = 0; k <= n; k++) put(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, col);
  };
  const m = 1 / res.metersPerPixel, P = (p: Pt) => ({ x: p.x * m, y: p.y * m });
  for (const r of res.rooms) r.points.forEach((p, k) => line(P(p), P(r.points[(k + 1) % r.points.length]), [0, 170, 0]));
  for (const w of res.walls) line(P(w.a), P(w.b), [255, 0, 0]);
  for (const o of res.openings) {
    const w = res.walls[o.wallIndex], dd = unit(sub(w.b, w.a));
    const p0 = P({ x: w.a.x + dd.x * (o.t - o.width / 2), y: w.a.y + dd.y * (o.t - o.width / 2) });
    const p1 = P({ x: w.a.x + dd.x * (o.t + o.width / 2), y: w.a.y + dd.y * (o.t + o.width / 2) });
    for (const off of [-2, 2]) line({ x: p0.x - dd.y * off, y: p0.y + dd.x * off }, { x: p1.x - dd.y * off, y: p1.y + dd.x * off }, o.kind === 'door' ? [255, 0, 255] : [0, 160, 255]);
  }
  const raw = new Uint8Array((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) raw.set(d.subarray(y * W * 4, (y + 1) * W * 4), y * (W * 4 + 1) + 1);
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const chunk = (type: string, data: Uint8Array) => {
    const b = new Uint8Array(12 + data.length), v = new DataView(b.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    let c = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8);
    v.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
    return b;
  };
  const ih = new Uint8Array(13), iv = new DataView(ih.buffer);
  iv.setUint32(0, W); iv.setUint32(4, H); ih[8] = 8; ih[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  fs.writeFileSync(path, all);
}

function table(rows: Row[]): string {
  const head = ['plan', 'size', 'GT/det walls', 'wallP', 'wallR', 'wallF1', 'openR', 'rooms exp/got', 'scaleErr', 'ms'];
  const body = rows.map((r) => [r.id, r.size, `${r.gtW}/${r.detW}`, r.wP.toFixed(2), r.wR.toFixed(2), r.wF1.toFixed(2),
    r.opR.toFixed(2), `${r.roomsExp}/${r.roomsGot}`, `${(r.scaleErr * 100).toFixed(1)}%`, r.ms.toFixed(0)]);
  const wd = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const ln = (r: string[]) => r.map((c, i) => c.padEnd(wd[i])).join(' | ');
  const out = [ln(head), wd.map((w) => '-'.repeat(w)).join('-|-'), ...body.map(ln)];
  if (nodeProc?.env?.VISION_VERBOSE) for (const r of rows) if (r.missed.length) out.push(`  ${r.id}: ${r.missed.join(' ')}`);
  return out.join('\n');
}

const IDS: string[] = fs ? fs.readdirSync(DIR).filter((f: string) => f.endsWith('.json')).map((f: string) => f.slice(0, -5)).sort() : [];

describe.skipIf(!fs || IDS.length === 0)('vision/realplans', () => {
  it('furnished plans', () => {
    const rows = IDS.map((id) => scorePlan(id, false));
    console.log('\n[real plans, furnished]\n' + table(rows));
    const good = rows.filter((r) => r.wF1 >= 0.9 && Math.abs(r.roomsGot - r.roomsExp) <= 1).length;
    for (const r of rows) expect(r.scaleErr, r.id).toBeLessThan(0.05);
    expect(good).toBeGreaterThanOrEqual(8);
  }, 120_000);

  it('clean plans (no furniture)', () => {
    const rows = IDS.map((id) => scorePlan(id, true));
    console.log('\n[real plans, clean]\n' + table(rows));
    const good = rows.filter((r) => r.wF1 >= 0.9 && Math.abs(r.roomsGot - r.roomsExp) <= 1).length;
    expect(good).toBeGreaterThanOrEqual(8);
  }, 120_000);
});
