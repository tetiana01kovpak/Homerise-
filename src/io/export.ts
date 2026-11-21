import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { Project, Level } from '../model/types';
import { buildHouse } from '../view3d/build';
import { customModelObjects, view3dRegistry } from '../view3d/registry';
import { wallPolygon, wallExtensions, wallLength, labelPoint, absArea, formatArea, levelBounds, formatLength } from '../model/geometry';
import { ROOM_DEFAULTS, levelArea } from '../model/ops';
import { getCatalogItem } from '../catalog';
import { itemCorners } from '../model/place';

export type ModelFormat = 'stl' | 'obj' | 'glb' | 'ply' | 'usdz';
export interface ModelExportOptions {
  format: ModelFormat;
  /** Scale factor applied to meters. 1 = meters; 1000 = millimeters (1:1); 10 = 1:100 model in mm. */
  scale: number;
  levels: 'all' | 'active';
  furniture: boolean;
  roof: boolean;
  /** Convert to Z-up (most 3D-print slicers / CAD). */
  zUp: boolean;
}

export function download(data: Blob | string, filename: string, type = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const safeName = (p: Project) => (p.name || 'home').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'home';

export function exportScene(p: Project, o: ModelExportOptions) {
  const house = buildHouse(p, { levels: o.levels === 'all' ? 'all' : 'only', activeLevelId: p.activeLevelId, showRoof: o.roof, showFurniture: o.furniture, wallMode: 'full', forExport: true, customModels: customModelObjects });
  // remove invisible parts (glass) so printers get solids only
  const dead: THREE.Object3D[] = [];
  house.traverse((c) => { if (!c.visible) dead.push(c); });
  dead.forEach((d) => d.parent?.remove(d));
  const root = new THREE.Group();
  root.add(house);
  root.scale.setScalar(o.scale);
  if (o.zUp) root.rotation.x = Math.PI / 2;
  root.updateMatrixWorld(true);
  return root;
}

export async function exportModel(p: Project, o: ModelExportOptions): Promise<{ blob: Blob; filename: string; triangles: number }> {
  const root = exportScene(p, o);
  let triangles = 0;
  root.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { const g = m.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  const base = safeName(p);
  if (o.format === 'stl') {
    const data = new STLExporter().parse(root, { binary: true }) as DataView;
    return { blob: new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' }), filename: `${base}.stl`, triangles };
  }
  if (o.format === 'obj') return { blob: new Blob([new OBJExporter().parse(root)], { type: 'text/plain' }), filename: `${base}.obj`, triangles };
  if (o.format === 'ply') {
    const data = await new Promise<ArrayBuffer>((res) => new PLYExporter().parse(root, (r) => res(r as ArrayBuffer), { binary: true }));
    return { blob: new Blob([data], { type: 'application/octet-stream' }), filename: `${base}.ply`, triangles };
  }
  if (o.format === 'usdz') {
    const data = await new USDZExporter().parseAsync(root);
    return { blob: new Blob([data as BlobPart], { type: 'model/vnd.usdz+zip' }), filename: `${base}.usdz`, triangles };
  }
  const data = await new GLTFExporter().parseAsync(root, { binary: true });
  return { blob: new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }), filename: `${base}.glb`, triangles };
}

/** Clean, printable SVG floor plan for one level. */
export function planSVG(p: Project, level: Level, opts: { furniture?: boolean; title?: boolean; dims?: boolean } = {}) {
  const units = p.settings.units;
  const b = levelBounds({ ...level, items: [] }) ?? levelBounds(level) ?? { minX: 0, minY: 0, maxX: 10, maxY: 8, w: 10, h: 8 };
  const pad = 1.6, S = 60; // px per meter
  const W = (b.w + pad * 2) * S, H = (b.h + pad * 2) * S + (opts.title !== false ? 70 : 0);
  const ox = (-b.minX + pad) * S, oy = (-b.minY + pad) * S + (opts.title !== false ? 70 : 0);
  const X = (x: number) => (x * S + ox).toFixed(1), Y = (y: number) => (y * S + oy).toFixed(1);
  const pts = (a: { x: number; y: number }[]) => a.map((q) => `${X(q.x)},${Y(q.y)}`).join(' ');
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="Inter, Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  if (opts.title !== false) out.push(`<text x="${pad * S}" y="44" font-size="26" font-weight="700" fill="#15181d">${esc(p.name)} — ${esc(level.name)}</text><text x="${W - pad * S}" y="44" text-anchor="end" font-size="16" fill="#6b7078">${formatArea(levelArea(level), units)}</text>`);
  for (const r of level.rooms) out.push(`<polygon points="${pts(r.points)}" fill="${ROOM_DEFAULTS[r.type]?.color ?? '#eee'}"/>`);
  if (opts.furniture !== false) for (const it of level.items) {
    const def = getCatalogItem(it.catalogId);
    const c = itemCorners(it);
    out.push(`<polygon points="${pts(c)}" fill="${/rug/.test(it.catalogId) ? '#ece6dc' : '#fff'}" stroke="#4a5059" stroke-width="1"/>`);
    if (def && it.w * S > 50) { const deg = (it.rotation * 180) / Math.PI; out.push(`<text x="${X(it.x)}" y="${Y(it.y)}" font-size="9" fill="#8a9099" text-anchor="middle" dominant-baseline="middle" transform="rotate(${deg.toFixed(1)} ${X(it.x)} ${Y(it.y)})">${esc(def.name)}</text>`); }
  }
  for (const w of level.walls) {
    if (w.kind === 'invisible') continue;
    const { ea, eb } = wallExtensions(w, level.walls);
    out.push(`<polygon points="${pts(wallPolygon(w, w.kind === 'railing' ? 0 : ea, w.kind === 'railing' ? 0 : eb))}" fill="${w.kind === 'railing' ? '#fff' : '#22262c'}" stroke="#22262c" stroke-width="${w.kind === 'railing' ? 1 : 0.5}"/>`);
  }
  for (const o of level.openings) {
    const w = level.walls.find((x) => x.id === o.wallId); if (!w) continue;
    const L = wallLength(w); const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L }; const n = { x: -d.y, y: d.x };
    const c = { x: w.a.x + d.x * o.t, y: w.a.y + d.y * o.t };
    const hw = o.width / 2, ht = w.thickness / 2 + 0.01;
    const P = (u: number, v: number) => ({ x: c.x + d.x * u + n.x * v, y: c.y + d.y * u + n.y * v });
    out.push(`<polygon points="${pts([P(-hw, ht), P(hw, ht), P(hw, -ht), P(-hw, -ht)])}" fill="#fff"/>`);
    if (o.kind.includes('indow')) {
      for (const v of [ht * 0.4, 0, -ht * 0.4]) out.push(`<line x1="${X(P(-hw, v).x)}" y1="${Y(P(-hw, v).y)}" x2="${X(P(hw, v).x)}" y2="${Y(P(hw, v).y)}" stroke="#22262c" stroke-width="1"/>`);
    } else if (o.kind !== 'opening' && o.kind !== 'garageDoor' && o.kind !== 'slidingDoor') {
      const s = o.flip ? -1 : 1;
      const hinge = P(-hw, 0), tip = P(hw, 0), open = P(-hw, s * o.width);
      out.push(`<line x1="${X(hinge.x)}" y1="${Y(hinge.y)}" x2="${X(open.x)}" y2="${Y(open.y)}" stroke="#22262c" stroke-width="1.5"/>`);
      out.push(`<path d="M ${X(tip.x)} ${Y(tip.y)} A ${o.width * S} ${o.width * S} 0 0 ${s > 0 ? 1 : 0} ${X(open.x)} ${Y(open.y)}" fill="none" stroke="#22262c" stroke-width="0.8" stroke-dasharray="4 3"/>`);
    } else if (o.kind === 'garageDoor' || o.kind === 'slidingDoor') {
      out.push(`<line x1="${X(P(-hw, 0).x)}" y1="${Y(P(-hw, 0).y)}" x2="${X(P(hw, 0).x)}" y2="${Y(P(hw, 0).y)}" stroke="#22262c" stroke-width="1.2" stroke-dasharray="6 4"/>`);
    }
  }
  for (const r of level.rooms) {
    const lp = labelPoint(r.points);
    out.push(`<text x="${X(lp.x)}" y="${Y(lp.y)}" text-anchor="middle" font-size="14" font-weight="600" fill="#15181d">${esc(r.name)}</text>`);
    out.push(`<text x="${X(lp.x)}" y="${(+Y(lp.y) + 17).toFixed(1)}" text-anchor="middle" font-size="12" fill="#6b7078">${formatArea(absArea(r.points), units)}</text>`);
  }
  for (const l of level.labels) out.push(`<text x="${X(l.x)}" y="${Y(l.y)}" text-anchor="middle" font-size="14" fill="#15181d">${esc(l.text)}</text>`);
  if (opts.dims !== false && level.walls.length) {
    const yTop = b.minY - 0.8, xLeft = b.minX - 0.8;
    out.push(`<line x1="${X(b.minX)}" y1="${Y(yTop)}" x2="${X(b.maxX)}" y2="${Y(yTop)}" stroke="#555" stroke-width="1"/><text x="${X(b.minX + b.w / 2)}" y="${(+Y(yTop) - 6).toFixed(1)}" text-anchor="middle" font-size="12" fill="#555">${formatLength(b.w, units)}</text>`);
    out.push(`<line x1="${X(xLeft)}" y1="${Y(b.minY)}" x2="${X(xLeft)}" y2="${Y(b.maxY)}" stroke="#555" stroke-width="1"/><text x="${(+X(xLeft) - 6).toFixed(1)}" y="${Y(b.minY + b.h / 2)}" text-anchor="middle" font-size="12" fill="#555" transform="rotate(-90 ${(+X(xLeft) - 6).toFixed(1)} ${Y(b.minY + b.h / 2)})">${formatLength(b.h, units)}</text>`);
  }
  // north arrow + scale bar
  out.push(`<g transform="translate(${W - 60},${H - 70})"><circle r="18" fill="none" stroke="#999"/><path d="M0 -15 L6 6 L0 2 L-6 6 Z" fill="#22262c"/><text y="34" text-anchor="middle" font-size="11" fill="#555">N</text></g>`);
  out.push(`<g transform="translate(${pad * S},${H - 40})"><rect width="${S}" height="6" fill="#22262c"/><rect x="${S}" width="${S}" height="6" fill="#fff" stroke="#22262c"/><text y="22" font-size="11" fill="#555">0</text><text x="${S}" y="22" font-size="11" fill="#555" text-anchor="middle">1 m</text><text x="${2 * S}" y="22" font-size="11" fill="#555" text-anchor="middle">2 m</text></g>`);
  out.push('</svg>');
  return out.join('\n');
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = img.width * scale; c.height = img.height * scale;
  const g = c.getContext('2d')!; g.scale(scale, scale); g.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
}

/** Print-ready document (user can "Save as PDF") with every level. */
export function printPlans(p: Project) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const pages = [...p.levels].sort((a, b) => a.elevation - b.elevation).map((l) => `<section>${planSVG(p, l)}</section>`).join('');
  w.document.write(`<!doctype html><html><head><title>${esc(p.name)} — floor plans</title><style>body{margin:0;font-family:Inter,system-ui,sans-serif}section{page-break-after:always;display:flex;justify-content:center;padding:24px}svg{max-width:100%;height:auto}@page{size:landscape;margin:10mm}</style></head><body>${pages}<script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
  return true;
}

/** Minimal DXF (R12) with walls, openings, rooms and labels on separate layers. */
export function exportDXF(p: Project, level: Level) {
  const L: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const poly = (pts: { x: number; y: number }[], layer: string, closed = true) => {
    L.push('0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '1' : '0');
    for (const q of pts) L.push('0', 'VERTEX', '8', layer, '10', q.x.toFixed(4), '20', (-q.y).toFixed(4), '30', '0');
    L.push('0', 'SEQEND');
  };
  const text = (x: number, y: number, h: number, s: string, layer: string) => L.push('0', 'TEXT', '8', layer, '10', x.toFixed(3), '20', (-y).toFixed(3), '30', '0', '40', h.toFixed(3), '1', s, '72', '1', '11', x.toFixed(3), '21', (-y).toFixed(3), '31', '0');
  for (const w of level.walls) { const { ea, eb } = wallExtensions(w, level.walls); poly(wallPolygon(w, ea, eb), w.exterior ? 'WALLS_EXT' : 'WALLS'); }
  for (const o of level.openings) {
    const w = level.walls.find((x) => x.id === o.wallId); if (!w) continue;
    const Lw = wallLength(w); const d = { x: (w.b.x - w.a.x) / Lw, y: (w.b.y - w.a.y) / Lw };
    const a = { x: w.a.x + d.x * (o.t - o.width / 2), y: w.a.y + d.y * (o.t - o.width / 2) }, b2 = { x: w.a.x + d.x * (o.t + o.width / 2), y: w.a.y + d.y * (o.t + o.width / 2) };
    poly([a, b2], o.kind.includes('indow') ? 'WINDOWS' : 'DOORS', false);
  }
  for (const r of level.rooms) { poly(r.points, 'ROOMS'); const lp = labelPoint(r.points); text(lp.x, lp.y, 0.25, `${r.name} ${absArea(r.points).toFixed(1)}m2`, 'TEXT'); }
  for (const it of level.items) poly(itemCorners(it), 'FURNITURE');
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\n');
}

export function exportProjectJSON(p: Project) { return JSON.stringify(p, null, 1); }

export function snapshot3D(scale = 2): Promise<Blob | null> {
  const gl = view3dRegistry.gl;
  if (!gl) return Promise.resolve(null);
  const src = gl.domElement;
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  void scale;
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

export { safeName };
