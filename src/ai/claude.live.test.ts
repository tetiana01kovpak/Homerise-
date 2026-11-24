// LIVE tests against the Claude API. Skipped unless ANTHROPIC_API_KEY is set:
//   ANTHROPIC_API_KEY=sk-ant-api03-… npx vitest run src/ai/claude.live.test.ts
// Optional: CLAUDE_MODEL (default claude-opus-5-5), CLAUDE_EFFORT (default medium),
//           LIVE_PLANS=studio,bungalow,… (default: a representative subset)
// Covers the three Claude features end to end through the app's own code paths:
//   1. text → house spec → built 3D project
//   2. 2D floor-plan image → vector plan → built 3D project (scored against ground truth)
//   3. AI Designer tool loop editing a live project
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { aiTextToSpec } from './claude';
import { runDesigner } from './designer';
import { buildFromSpec } from '../state/build';
import { evaluateProject } from '../examples/evaluate';
import { EXAMPLE_PROMPTS } from '../examples/prompts';
import { decodePng, downsample, type RGBA } from '../vision/png';
import { convertPlanImage } from '../vision/planImport';
import { vectorToProject } from '../model/fromPlan';
import { furnishProject } from '../model/furnish';
import { useStore } from '../state/store';
import type { AISettings } from '../state/store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeProc = (globalThis as any).process;
const env = nodeProc?.env ?? {};
const fs = nodeProc?.getBuiltinModule?.('node:fs');
const zlib = nodeProc?.getBuiltinModule?.('node:zlib');
const KEY: string | undefined = env.ANTHROPIC_API_KEY;
const AI: AISettings = { apiKey: KEY ?? '', model: env.CLAUDE_MODEL || 'claude-opus-5-5', effort: (env.CLAUDE_EFFORT as AISettings['effort']) || 'medium' };
const LIVE = !!KEY;
const T = 15 * 60_000;

// ---------- minimal PNG encoder (node) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
}
function encodePng(img: RGBA): string {
  const { width: W, height: H, data } = img;
  const raw = new Uint8Array((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; raw.set(data.subarray(y * W * 4, (y + 1) * W * 4), y * (W * 4 + 1) + 1); }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, W); dv.setUint32(4, H); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array())];
  const total = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- scoring (same conventions as src/vision/realplans.test.ts) ----------
type Pt = { x: number; y: number };
const DIR = 'tests/fixtures/plans/', PPM = 120, PAD = 1.6, TITLE = 140;
const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y }), dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y, cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const len = (a: Pt) => Math.hypot(a.x, a.y), unit = (a: Pt) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
function coverage(g: { a: Pt; b: Pt }, ds: { a: Pt; b: Pt }[], tol = 0.2) {
  const dg = unit(sub(g.b, g.a)), ng = { x: -dg.y, y: dg.x }, Lg = len(sub(g.b, g.a)); if (Lg < 1e-6) return 1;
  const iv: [number, number][] = [];
  for (const d of ds) {
    if (Math.abs(cross(dg, unit(sub(d.b, d.a)))) > 0.14) continue;
    if (Math.abs(dot(sub(d.a, g.a), ng)) > tol || Math.abs(dot(sub(d.b, g.a), ng)) > tol) continue;
    const s0 = dot(sub(d.a, g.a), dg), s1 = dot(sub(d.b, g.a), dg), lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(Lg, Math.max(s0, s1));
    if (hi > lo) iv.push([lo, hi]);
  }
  iv.sort((p, q) => p[0] - q[0]); let cov = 0, cur = -1;
  for (const [lo, hi] of iv) { const s = Math.max(lo, cur); if (hi > s) { cov += hi - s; cur = hi; } }
  return cov / Lg;
}

interface GT { bounds: { minX: number; minY: number }; outerWidth: number; walls: { a: Pt; b: Pt }[]; openings: { at: Pt }[]; rooms: { name: string; type: string }[] }

describe.skipIf(!LIVE)('LIVE Claude: text → 3D house', () => {
  const ids = (env.LIVE_PROMPTS ?? 'apt2,bungalow,modern2').split(',');
  for (const ex of EXAMPLE_PROMPTS.filter((e) => ids.includes(e.id))) {
    it(ex.id, async () => {
      const t0 = Date.now();
      const spec = await aiTextToSpec(AI, ex.prompt);
      const p = buildFromSpec(spec);
      const rep = evaluateProject(p, { requireFurniture: true });
      const rooms = p.levels.flatMap((l) => l.rooms);
      const beds = rooms.filter((r) => r.type === 'bedroom').length, baths = rooms.filter((r) => r.type === 'bathroom').length;
      console.log(`[text] ${ex.id.padEnd(9)} ${((Date.now() - t0) / 1000).toFixed(0)}s score=${rep.score} beds=${beds} baths=${baths} levels=${p.levels.length} area=${rep.stats.livingArea.toFixed(0)} items=${rep.stats.items} roofs=${rep.stats.roofs}\n   ${rep.issues.map((i) => `${i.severity}:${i.level}:${i.msg}`).join('\n   ')}`);
      expect(beds).toBe(ex.expect.bedrooms);
      expect(baths).toBeGreaterThanOrEqual(ex.expect.bathroomsMin);
      expect(p.levels.length).toBe(ex.expect.levels);
      expect(rep.stats.walls).toBeGreaterThan(4);
      expect(rep.stats.items).toBeGreaterThan(0);
      expect(rep.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }, T);
  }
});

describe.skipIf(!LIVE)('LIVE Claude: 2D plan image → 3D model', () => {
  const ids = (env.LIVE_PLANS ?? 'studio,apt2,bungalow,villa').split(',');
  const rows: string[] = [];
  for (const id of ids) {
    it(id, async () => {
      const gt: GT = JSON.parse(fs.readFileSync(`${DIR}${id}.json`, 'utf8'));
      const full = decodePng(new Uint8Array(fs.readFileSync(`${DIR}${id}.png`)), (b) => new Uint8Array(zlib.inflateSync(b)));
      const { image, scale } = downsample(full, 1800);
      const t0 = Date.now();
      // No width hint: Claude must work out the scale itself, as most users won't type it.
      const conv = await convertPlanImage(image, { mode: 'ai', ai: AI, encodePng });
      const secs = (Date.now() - t0) / 1000;
      const mpp = conv.metersPerPixel;
      const toGT = (p: Pt): Pt => { const fx = p.x / mpp / scale, fy = p.y / mpp / scale; return { x: fx / PPM + gt.bounds.minX - PAD, y: (fy - TITLE) / PPM + gt.bounds.minY - PAD }; };
      const det = conv.vec.walls.map((w) => ({ a: toGT(w.a), b: toGT(w.b) }));
      const rec = gt.walls.filter((g) => coverage(g, det) >= 0.7).length / gt.walls.length;
      const prec = det.length ? det.filter((d) => coverage(d, gt.walls) >= 0.7).length / det.length : 0;
      const ops = conv.vec.openings.map((o) => toGT(o.at));
      const opR = gt.openings.filter((g) => ops.some((o) => len(sub(o, g.at)) < 0.6)).length / (gt.openings.length || 1);
      const trueMpp = 1 / (PPM * scale), scaleErr = Math.abs(mpp - trueMpp) / trueMpp;
      // build the 3D project exactly like the import dialog does
      const p = vectorToProject(conv.vec, id, { furnish: (pr) => { furnishProject(pr); } });
      const lv = p.levels[0];
      const gtTypes = gt.rooms.map((r) => r.type), gotTypes: string[] = lv.rooms.map((r) => r.type);
      const typeHits = gtTypes.filter((t) => { const i = gotTypes.indexOf(t); if (i >= 0) { gotTypes.splice(i, 1); return true; } return false; }).length;
      rows.push(`${id.padEnd(9)} ${secs.toFixed(0).padStart(4)}s src=${conv.source.padEnd(11)} walls gt/got=${gt.walls.length}/${det.length} wallR=${rec.toFixed(2)} wallP=${prec.toFixed(2)} openR=${opR.toFixed(2)} rooms gt/got=${gt.rooms.length}/${lv.rooms.length} typeMatch=${typeHits}/${gt.rooms.length} scaleErr=${(scaleErr * 100).toFixed(1)}% items=${lv.items.length}`);
      console.log(`[plan] ${rows[rows.length - 1]}\n   claude notes: ${conv.ai?.notes?.slice(0, 300)}`);
      expect(lv.walls.length).toBeGreaterThan(3);
      expect(lv.rooms.length).toBeGreaterThanOrEqual(Math.ceil(gt.rooms.length * 0.6));
      expect(scaleErr).toBeLessThan(0.15);
      expect(rec).toBeGreaterThanOrEqual(0.6);
      expect(typeHits / gt.rooms.length).toBeGreaterThanOrEqual(0.5);
    }, T);
  }
  it.skipIf(!LIVE)('summary', () => { console.log(`\n[plan image → 3D, model=${AI.model} effort=${AI.effort}]\n${rows.join('\n')}`); });
});

describe.skipIf(!LIVE)('LIVE Claude: AI Designer edits the live project', () => {
  it('adds an office room and furnishes it via tools', async () => {
    const st = useStore.getState();
    const { generateFromText } = await import('./generator');
    st.setProject(buildFromSpec(generateFromText('3 bedroom bungalow with a gable roof')));
    const before = useStore.getState().project.levels[0].rooms.length;
    const h: Anthropic.Beta.BetaMessageParam[] = [];
    const log: string[] = [];
    const r = await runDesigner(AI, h, 'Add a home office of about 3 x 3 m attached to the outside of the house next to the living room, connect it with a door, and put a desk and chair in it.', { onEvent: (e) => log.push(e.kind === 'tool' ? `tool ${e.name}: ${e.summary}` : `say: ${e.text}`) });
    console.log(`[designer] turns=${r.turns} tools=${r.toolCalls}\n   ${log.join('\n   ')}`);
    const lv = useStore.getState().project.levels[0];
    const office = lv.rooms.find((x) => x.type === 'office');
    expect(lv.rooms.length).toBeGreaterThan(before);
    expect(office).toBeTruthy();
    expect(lv.items.some((i) => /desk/i.test(i.catalogId))).toBe(true);
    expect(h[h.length - 1].role).toBe('assistant');
  }, T);
});

describe.skipIf(LIVE)('LIVE Claude (skipped)', () => { it('set ANTHROPIC_API_KEY to run the live Claude tests', () => {}); });
