// Floor-plan image → PlanVector (meters). Shared by the import dialog and the
// tests so the exact same conversion runs in both. Pure: no DOM, no store.
import { vectorizePlan, type VectorResult } from './vectorize';
import { downsample, type RGBA } from './png';
import { aiImageToPlan, type AIPlanResult } from '../ai/claude';
import type { AISettings } from '../state/store';
import type { PlanVector } from '../model/fromPlan';

/** Long side sent to Claude. Larger images are downscaled by the API, which would
 *  silently change the pixel frame Claude reports coordinates in — so we downscale
 *  ourselves and map the coordinates back. */
export const AI_MAX_SIDE = 1568;

export interface PlanImportResult {
  vec: PlanVector;
  /** Meters per pixel of the working image (for placing the trace overlay). */
  metersPerPixel: number;
  /** Offline CV result on the working image (always computed). */
  detected: VectorResult;
  ai?: AIPlanResult;
  /** How the plan was produced. */
  source: 'cv' | 'ai' | 'ai+cv-walls';
}

export function cvToVector(det: VectorResult): PlanVector {
  return {
    walls: det.walls,
    openings: det.openings.map((o) => {
      const w = det.walls[o.wallIndex];
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
      return { at: { x: w.a.x + ((w.b.x - w.a.x) * o.t) / L, y: w.a.y + ((w.b.y - w.a.y) * o.t) / L }, width: o.width, kind: o.kind };
    }),
  };
}

/** Claude's pixel-space answer (in AI-image pixels) → meters in the working-image frame. */
export function aiToVector(r: AIPlanResult, opts: { aiScale: number; fallbackMpp: number; widthM?: number }): { vec: PlanVector; metersPerPixel: number } {
  const k = opts.aiScale; // ai px = work px * k
  // Claude's scale is per AI-image pixel; convert to per working-image pixel.
  let mpp = r.metersPerPixel > 0.0005 && r.metersPerPixel < 1 ? r.metersPerPixel * k : opts.fallbackMpp;
  if (opts.widthM && r.walls.length) {
    const xs = r.walls.flatMap((w) => [w.x1, w.x2]);
    const spanWork = (Math.max(...xs) - Math.min(...xs)) / k;
    if (spanWork > 10) mpp = opts.widthM / spanWork;
  }
  const m = mpp / k; // meters per AI-image pixel
  return {
    metersPerPixel: mpp,
    vec: {
      walls: r.walls.map((w) => ({ a: { x: w.x1 * m, y: w.y1 * m }, b: { x: w.x2 * m, y: w.y2 * m }, thickness: Math.max(0.1, w.thickness_px * m) })),
      openings: r.openings.map((o) => ({ at: { x: o.x * m, y: o.y * m }, width: Math.max(0.5, o.width_px * m), kind: o.kind as never })),
      rooms: r.rooms.map((rm) => ({ name: rm.name, type: rm.type as never, at: { x: rm.label_x * m, y: rm.label_y * m } })),
    },
  };
}

/**
 * Convert a plan image. `img` is the working image (≤1800 px long side).
 * `encodePng` turns an RGBA image into base64 PNG (canvas in the browser, zlib in tests).
 */
export async function convertPlanImage(
  img: RGBA,
  opts: { mode: 'ai' | 'auto'; widthM?: number; ai?: AISettings; hint?: string; encodePng?: (im: RGBA) => Promise<string> | string; onStage?: (s: string) => void },
): Promise<PlanImportResult> {
  const widthM = opts.widthM && isFinite(opts.widthM) && opts.widthM > 0 ? opts.widthM : undefined;
  const detected = vectorizePlan(img, widthM ? { expectedWidthMeters: widthM } : {});
  if (opts.mode === 'auto') return { vec: cvToVector(detected), metersPerPixel: detected.metersPerPixel, detected, source: 'cv' };

  if (!opts.ai || !opts.encodePng) throw new Error('Claude conversion needs an API key.');
  opts.onStage?.('Claude is reading your floor plan…');
  const { image: aiImg, scale: k } = downsample(img, AI_MAX_SIDE);
  const b64 = await opts.encodePng(aiImg);
  const mpp0 = detected.metersPerPixel;
  // hand Claude the CV walls in AI-image pixels as a hint
  const hintWalls = detected.walls.map((w) => ({ a: { x: (w.a.x / mpp0) * k, y: (w.a.y / mpp0) * k }, b: { x: (w.b.x / mpp0) * k, y: (w.b.y / mpp0) * k } }));
  const ai = await aiImageToPlan(opts.ai, { base64: b64, mediaType: 'image/png', width: aiImg.width, height: aiImg.height }, { walls: hintWalls, metersPerPixel: mpp0 / k }, opts.hint);
  const { vec, metersPerPixel } = aiToVector(ai, { aiScale: k, fallbackMpp: mpp0, widthM });
  if (vec.walls.length >= 3) return { vec, metersPerPixel, detected, ai, source: 'ai' };
  // Claude found (almost) nothing: keep CV geometry but use Claude's room names.
  const cv = cvToVector(detected);
  const m0 = mpp0 / k;
  const rooms = ai.rooms.map((rm) => ({ name: rm.name, type: rm.type as never, at: { x: rm.label_x * m0, y: rm.label_y * m0 } }));
  return { vec: { ...cv, rooms }, metersPerPixel: mpp0, detected, ai, source: 'ai+cv-walls' };
}
