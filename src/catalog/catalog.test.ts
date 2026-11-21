import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CATALOG, CATEGORIES, getCatalogItem, searchCatalog } from './index';
import type { PlanShape } from './types';

const TOL = 0.05;

function check(id: string, w: number, d: number, h: number, color?: string): string[] {
  const item = getCatalogItem(id)!;
  const errs: string[] = [];
  const obj = item.build({ w, d, h, color });
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const s = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const fit = (name: string, got: number, want: number) => {
    if (got > want * (1 + TOL) + 0.005) errs.push(`${name} too big: ${got.toFixed(3)} > ${want}`);
    if (got < want * (1 - TOL) - 0.005) errs.push(`${name} too small: ${got.toFixed(3)} < ${want}`);
  };
  fit('w', s.x, w);
  fit('d', s.z, d);
  fit('h', s.y, h);
  if (Math.abs(b.min.y) > 0.005 + h * 0.02) errs.push(`bottom y=${b.min.y.toFixed(3)}`);
  if (Math.abs(c.x) > w * TOL + 0.005) errs.push(`center x=${c.x.toFixed(3)}`);
  if (Math.abs(c.z) > d * TOL + 0.005) errs.push(`center z=${c.z.toFixed(3)}`);
  let nan = false;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) { nan = true; break; }
    }
  });
  if (nan) errs.push('NaN vertex');
  return errs.map((e) => `${id} @${w.toFixed(2)}x${d.toFixed(2)}x${h.toFixed(2)}: ${e}`);
}

function planErrs(id: string, shapes: PlanShape[], w: number, d: number): string[] {
  const errs: string[] = [];
  const tx = w / 2 * (1 + TOL) + 0.01, ty = d / 2 * (1 + TOL) + 0.01;
  const inX = (v: number) => Number.isFinite(v) && Math.abs(v) <= tx;
  const inY = (v: number) => Number.isFinite(v) && Math.abs(v) <= ty;
  for (const sh of shapes) {
    let ok = true;
    if (sh.t === 'rect') ok = inX(sh.x) && inX(sh.x + sh.w) && inY(sh.y) && inY(sh.y + sh.h) && sh.w >= 0 && sh.h >= 0;
    else if (sh.t === 'circle') ok = inX(sh.cx - sh.r) && inX(sh.cx + sh.r) && inY(sh.cy - sh.r) && inY(sh.cy + sh.r);
    else if (sh.t === 'line') ok = inX(sh.x1) && inX(sh.x2) && inY(sh.y1) && inY(sh.y2);
    else ok = !/NaN|Infinity/.test(sh.d);
    if (!ok) errs.push(`${id} plan shape out of bounds: ${JSON.stringify(sh)}`);
  }
  return errs;
}

describe('catalog', () => {
  it('has enough items with unique ids and valid categories', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(70);
    const ids = new Set(CATALOG.map((i) => i.id));
    expect(ids.size).toBe(CATALOG.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const i of CATALOG) expect(cats.has(i.category)).toBe(true);
  });

  it('every item builds and fits its box (default and 1.5x)', () => {
    const errs: string[] = [];
    for (const item of CATALOG) {
      const { w, d, h } = item.size;
      try {
        errs.push(...check(item.id, w, d, h));
        errs.push(...check(item.id, w * 1.5, d * 1.5, h * 1.5, '#aa5533'));
        errs.push(...check(item.id, w * 0.8, d * 1.2, h, undefined));
      } catch (e) {
        errs.push(`${item.id}: threw ${(e as Error).stack}`);
      }
    }
    expect(errs).toEqual([]);
  });

  it('plan symbols stay inside the footprint', () => {
    const errs: string[] = [];
    for (const item of CATALOG) {
      if (!item.plan) continue;
      const { w, d } = item.size;
      errs.push(...planErrs(item.id, item.plan(w, d), w, d));
      errs.push(...planErrs(item.id, item.plan(w * 1.5, d * 1.5), w * 1.5, d * 1.5));
    }
    expect(errs).toEqual([]);
  });

  it('search works', () => {
    expect(searchCatalog('sofa').length).toBeGreaterThanOrEqual(3);
    expect(searchCatalog('bed', 'bedroom').every((i) => i.category === 'bedroom')).toBe(true);
    expect(searchCatalog('').length).toBe(CATALOG.length);
    expect(searchCatalog('stairs')[0].category).toBe('structure');
  });
});
