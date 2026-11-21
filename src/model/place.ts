import type { Level, Item, Vec2, Wall } from './types';
import { projectToSegment, wallNormal, wallLength, dot, sub } from './geometry';

/** Rotation that makes an item's front (+y local) point along direction n. */
export const rotationFacing = (n: Vec2) => Math.atan2(-n.x, n.y);
/** Local → plan transform. */
export const localToPlan = (it: { x: number; y: number; rotation: number }, lx: number, ly: number): Vec2 => {
  const c = Math.cos(it.rotation), s = Math.sin(it.rotation);
  return { x: it.x + lx * c - ly * s, y: it.y + lx * s + ly * c };
};
export const planToLocal = (it: { x: number; y: number; rotation: number }, p: Vec2): Vec2 => {
  const c = Math.cos(it.rotation), s = Math.sin(it.rotation);
  const dx = p.x - it.x, dy = p.y - it.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
};
export function itemCorners(it: Pick<Item, 'x' | 'y' | 'rotation' | 'w' | 'd'>): Vec2[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => localToPlan(it, (a * it.w) / 2, (b * it.d) / 2));
}

/**
 * Snap an item against the nearest wall so its back touches the wall face and it faces into the room.
 * Returns null when no wall is close enough.
 */
export function snapToWall(level: Level, it: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rotation'>, threshold = 0.35, keepRotation = false) {
  let best: { wall: Wall; t: number; dist: number; n: Vec2 } | null = null;
  for (const w of level.walls) {
    if (w.kind === 'railing' || w.kind === 'invisible') continue;
    const pr = projectToSegment({ x: it.x, y: it.y }, w.a, w.b);
    let n = wallNormal(w);
    if (dot(sub({ x: it.x, y: it.y }, pr.point), n) < 0) n = { x: -n.x, y: -n.y };
    const depth = keepRotation ? Math.abs(Math.cos(it.rotation)) * it.d + Math.abs(Math.sin(it.rotation)) * it.w : it.d;
    const gap = pr.distance - w.thickness / 2 - depth / 2;
    if (Math.abs(gap) < threshold && pr.u > 0.02 && pr.u < 0.98 && (!best || Math.abs(gap) < best.dist)) best = { wall: w, t: pr.t, dist: Math.abs(gap), n };
  }
  if (!best) return null;
  const { wall, n } = best;
  const L = wallLength(wall);
  const dir = { x: (wall.b.x - wall.a.x) / L, y: (wall.b.y - wall.a.y) / L };
  const half = (keepRotation ? it.w : it.w) / 2;
  const t = Math.max(Math.min(half, L / 2), Math.min(L - Math.min(half, L / 2), best.t));
  const depth = it.d;
  const off = wall.thickness / 2 + depth / 2 + 0.005;
  return {
    x: wall.a.x + dir.x * t + n.x * off,
    y: wall.a.y + dir.y * t + n.y * off,
    rotation: keepRotation ? it.rotation : rotationFacing(n),
    wallId: wall.id,
  };
}
