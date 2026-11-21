import { describe, expect, it } from 'vitest';
import { FIXTURES, type Fixture } from './fixtures';
import { planExtents, renderPlan, type PlanSpec, type Pt, type RenderOptions, type RenderResult } from './synth';
import { extractRoomsPx, vectorizePlan, type VectorResult } from './vectorize';

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };

interface Line { a: Pt; b: Pt }

/** Fraction of `g` covered by `d` (centerline within tol over the overlap). */
function coverage(g: Line, d: Line, tol = 0.15): number {
  const dg = unit(sub(g.b, g.a)), ng = { x: -dg.y, y: dg.x };
  const Lg = len(sub(g.b, g.a));
  const dd = unit(sub(d.b, d.a));
  if (Math.abs(cross(dg, dd)) > Math.sin((8 * Math.PI) / 180)) return 0;
  const s0 = dot(sub(d.a, g.a), dg), s1 = dot(sub(d.b, g.a), dg);
  const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(Lg, Math.max(s0, s1));
  if (hi <= lo) return 0;
  // lateral offset of d at the overlap ends
  const latAt = (s: number) => {
    const t = (s - s0) / (s1 - s0 || 1);
    const p = { x: d.a.x + (d.b.x - d.a.x) * t, y: d.a.y + (d.b.y - d.a.y) * t };
    return Math.abs(dot(sub(p, g.a), ng));
  };
  if (latAt(lo) > tol || latAt(hi) > tol) return 0;
  return (hi - lo) / Lg;
}

interface Score {
  name: string; size: string; gtWalls: number; detWalls: number; wP: number; wR: number; wF1: number;
  opR: number; opP: number; kindAcc: number; roomsExp: number; roomsGot: number; scaleErr: number;
  autoScaleErr: number; autoSrc: string; ms: number; conf: number; missed: string[];
}

function scoreFixture(fx: Fixture, override: Partial<RenderOptions> = {}): Score {
  const rr: RenderResult = renderPlan(fx.spec, { ...fx.render, ...override });
  const ext = planExtents(fx.spec);
  const widthM = ext.maxX - ext.minX;
  const t0 = performance.now();
  const res: VectorResult = vectorizePlan(rr.image, { expectedWidthMeters: widthM });
  const ms = performance.now() - t0;
  const auto = vectorizePlan(rr.image);
  const trueMpp = 1 / rr.pxPerMeter;
  // detected meters -> pixels -> GT world
  const toGT = (p: Pt): Pt => {
    const x = p.x / res.metersPerPixel, y = p.y / res.metersPerPixel;
    return { x: (x - rr.originPx.x) / rr.pxPerMeter, y: (y - rr.originPx.y) / rr.pxPerMeter };
  };
  const det: Line[] = res.walls.map((w) => ({ a: toGT(w.a), b: toGT(w.b) }));
  const gt: Line[] = fx.spec.walls.map((w) => ({ a: w.a, b: w.b }));
  const missed: string[] = [];
  let rec = 0;
  gt.forEach((g, i) => {
    if (det.some((d) => coverage(g, d) >= 0.8)) rec++;
    else missed.push(`W${i}`);
  });
  let prec = 0;
  det.forEach((d) => { if (gt.some((g) => coverage(d, g) >= 0.8)) prec++; else missed.push(`fp(${d.a.x.toFixed(1)},${d.a.y.toFixed(1)}-${d.b.x.toFixed(1)},${d.b.y.toFixed(1)})`); });
  const wR = gt.length ? rec / gt.length : 1, wP = det.length ? prec / det.length : 0;
  const wF1 = wP + wR > 0 ? (2 * wP * wR) / (wP + wR) : 0;

  // openings
  const gtOps = fx.spec.openings.map((o) => {
    const w = fx.spec.walls[o.wallIndex];
    const d = unit(sub(w.b, w.a));
    return { p: { x: w.a.x + d.x * o.t, y: w.a.y + d.y * o.t }, kind: o.kind };
  });
  const detOps = res.openings.map((o) => {
    const w = res.walls[o.wallIndex];
    const d = unit(sub(w.b, w.a));
    return { p: toGT({ x: w.a.x + d.x * o.t, y: w.a.y + d.y * o.t }), kind: o.kind, used: false };
  });
  let opHit = 0, kindHit = 0;
  for (const g of gtOps) {
    let best = -1, bd = 0.35;
    detOps.forEach((d, i) => { if (!d.used) { const dd = len(sub(d.p, g.p)); if (dd < bd) { bd = dd; best = i; } } });
    if (best >= 0) {
      detOps[best].used = true; opHit++;
      if (detOps[best].kind === g.kind) kindHit++;
    } else missed.push(`${g.kind}@(${g.p.x.toFixed(2)},${g.p.y.toFixed(2)})`);
  }
  detOps.forEach((d) => { if (!d.used) missed.push(`fpOpen:${d.kind}@(${d.p.x.toFixed(2)},${d.p.y.toFixed(2)})`); });
  const roomsGot = res.rooms.length;
  return {
    name: fx.spec.name, size: `${rr.image.width}x${rr.image.height}`, gtWalls: gt.length, detWalls: det.length,
    wP, wR, wF1, opR: gtOps.length ? opHit / gtOps.length : 1, opP: detOps.length ? opHit / detOps.length : 1,
    kindAcc: opHit ? kindHit / opHit : 1, roomsExp: fx.spec.expectedRooms, roomsGot,
    scaleErr: Math.abs(res.metersPerPixel - trueMpp) / trueMpp,
    autoScaleErr: Math.abs(auto.metersPerPixel - trueMpp) / trueMpp, autoSrc: auto.debug?.scaleSource ?? '',
    ms, conf: res.confidence, missed,
  };
}

function gtRoomCount(spec: PlanSpec): number {
  const ppm = 40;
  const ext = planExtents(spec);
  const W = Math.ceil((ext.maxX - ext.minX) * ppm + 80), H = Math.ceil((ext.maxY - ext.minY) * ppm + 80);
  const P = (p: Pt): Pt => ({ x: 40 + (p.x - ext.minX) * ppm, y: 40 + (p.y - ext.minY) * ppm });
  return extractRoomsPx(spec.walls.map((w) => ({ a: P(w.a), b: P(w.b), thickness: w.thickness * ppm })), W, H, 1 / ppm).length;
}

const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function table(scores: Score[]): string {
  const head = ['fixture', 'size', 'GT/det walls', 'wallP', 'wallR', 'wallF1', 'openR', 'openP', 'kind', 'rooms exp/got', 'scaleErr(hint)', 'autoScaleErr', 'ms', 'conf'];
  const rows = scores.map((s) => [
    s.name, s.size, `${s.gtWalls}/${s.detWalls}`, f2(s.wP), f2(s.wR), f2(s.wF1), f2(s.opR), f2(s.opP), f2(s.kindAcc),
    `${s.roomsExp}/${s.roomsGot}`, pct(s.scaleErr), `${pct(s.autoScaleErr)} ${s.autoSrc}`, s.ms.toFixed(0), f2(s.conf),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join(' | ');
  const out = [line(head), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.map(line)];
  for (const s of scores) if (s.missed.length) out.push(`  ${s.name}: ${s.missed.join(' ')}`);
  return out.join('\n');
}

// Robustness variants of every fixture: [label, render override, minimum mean wall F1].
// Outlined (hollow) walls are only partially supported, hence the lower floor.
const STRESS: [string, (fx: Fixture) => Partial<RenderOptions>, number][] = [
  ['low-res x0.7', (fx) => ({ pxPerMeter: fx.render.pxPerMeter * 0.7 }), 0.85],
  ['hi-res x2 + 3px lines', (fx) => ({ pxPerMeter: fx.render.pxPerMeter * 2, lineWidthPx: 3 }), 0.95],
  ['dirty (gray walls, blur 2, noise 8%)', () => ({ blur: 2, noise: 0.08, wallInk: 0.6 }), 0.95],
  ['skewed scan (rotated 1.5 deg, blur 1)', () => ({ rotateDeg: 1.5, blur: 1 }), 0.95],
  ['hatched walls', () => ({ wallStyle: 'hatch' }), 0.85],
  ['outlined (hollow) walls', () => ({ wallStyle: 'outline' }), 0.7],
];

describe('vision/vectorizePlan', () => {
  it('fixtures have consistent ground-truth room counts', () => {
    for (const fx of FIXTURES) expect(gtRoomCount(fx.spec), fx.spec.name).toBe(fx.spec.expectedRooms);
  });

  it('vectorizes all fixtures', () => {
    const scores = FIXTURES.map((fx) => scoreFixture(fx));
    console.log('\n' + table(scores));

    const good = scores.filter((s) => s.wF1 >= 0.9 && s.roomsGot === s.roomsExp).length;
    expect(good).toBeGreaterThanOrEqual(8);
    for (const s of scores) {
      expect(s.scaleErr, s.name).toBeLessThan(0.05);
      expect(s.wF1, s.name).toBeGreaterThanOrEqual(0.8);
    }
  }, 60_000);

  for (const [label, ov, floor] of STRESS) {
    it(`stress: ${label}`, () => {
      const scores = FIXTURES.map((fx) => scoreFixture(fx, ov(fx)));
      console.log(`\n[stress: ${label}]\n` + table(scores));
      const meanF1 = scores.reduce((a, s) => a + s.wF1, 0) / scores.length;
      console.log(`mean wall F1: ${meanF1.toFixed(3)}, rooms exact: ${scores.filter((s) => s.roomsGot === s.roomsExp).length}/${scores.length}`);
      expect(meanF1).toBeGreaterThan(floor);
    }, 120_000);
  }

  it('runs fast enough on a ~2000x1500 image', () => {
    const fx = FIXTURES[3];
    const rr = renderPlan(fx.spec, { ...fx.render, pxPerMeter: 130 });
    const t0 = performance.now();
    const res = vectorizePlan(rr.image, { metersPerPixel: 1 / 130 });
    const ms = performance.now() - t0;
    console.log(`perf: ${rr.image.width}x${rr.image.height} in ${ms.toFixed(0)} ms (${res.walls.length} walls, ${res.rooms.length} rooms)`, res.debug?.timings);
    expect(res.rooms.length).toBe(fx.spec.expectedRooms);
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  it('handles blank images', () => {
    const data = new Uint8ClampedArray(200 * 100 * 4).fill(255);
    const res = vectorizePlan({ width: 200, height: 100, data });
    expect(res.walls.length).toBe(0);
    expect(res.confidence).toBe(0);
  });
});
