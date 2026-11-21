import * as THREE from 'three';

export interface FloorMaterialDef { id: string; name: string; color: string; kind: 'wood' | 'tile' | 'stone' | 'carpet' | 'concrete' | 'deck' | 'herringbone' | 'marble' | 'grass'; tile?: number; tone?: string }

export const FLOOR_MATERIALS: FloorMaterialDef[] = [
  { id: 'oak', name: 'Light oak', color: '#C9A77C', kind: 'wood', tone: '#B48F63' },
  { id: 'walnut', name: 'Walnut', color: '#8A6446', kind: 'wood', tone: '#6F4E35' },
  { id: 'ash', name: 'White ash', color: '#E2D3BC', kind: 'wood', tone: '#CDBB9F' },
  { id: 'herringbone', name: 'Herringbone', color: '#BF9A6E', kind: 'herringbone', tone: '#A9845A' },
  { id: 'tile-light', name: 'Light tile', color: '#EDEBE6', kind: 'tile', tile: 0.6, tone: '#D9D6CF' },
  { id: 'tile-grey', name: 'Grey tile', color: '#B9BCBF', kind: 'tile', tile: 0.3, tone: '#A3A6A9' },
  { id: 'tile-dark', name: 'Slate tile', color: '#5E6367', kind: 'tile', tile: 0.6, tone: '#4D5155' },
  { id: 'marble', name: 'Marble', color: '#F1EFEC', kind: 'marble', tile: 0.8, tone: '#C9C6C2' },
  { id: 'terrazzo', name: 'Terrazzo', color: '#E6E1D9', kind: 'stone', tone: '#A9A097' },
  { id: 'concrete', name: 'Polished concrete', color: '#B7B5B1', kind: 'concrete', tone: '#A29F9A' },
  { id: 'carpet', name: 'Carpet', color: '#CFC8BE', kind: 'carpet', tone: '#BDB5AA' },
  { id: 'carpet-blue', name: 'Blue carpet', color: '#7D8FA6', kind: 'carpet', tone: '#6C7D93' },
  { id: 'deck', name: 'Timber deck', color: '#9C7A57', kind: 'deck', tone: '#7F6244' },
  { id: 'stone', name: 'Stone pavers', color: '#C2BCB2', kind: 'tile', tile: 0.9, tone: '#ABA59B' },
];

export const WALL_COLORS = ['#FAFAF7', '#F4F1EA', '#EDE6DA', '#E4E7E2', '#D9E2E6', '#DCD5E3', '#F1DCD3', '#E8DDBF', '#C9D3C0', '#9FB1BC', '#5B6770', '#2F3A40'];

const texCache = new Map<string, THREE.Texture>();
const hasDOM = typeof document !== 'undefined';

function rand(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function drawFloor(def: FloorMaterialDef): HTMLCanvasElement {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rand(def.id.length * 977 + 13);
  g.fillStyle = def.color; g.fillRect(0, 0, S, S);
  const tone = def.tone ?? def.color;
  const noise = (alpha: number, n = 2000, size = 2) => { for (let i = 0; i < n; i++) { g.globalAlpha = alpha * r(); g.fillStyle = r() > 0.5 ? '#000' : '#fff'; g.fillRect(r() * S, r() * S, size, size); } g.globalAlpha = 1; };
  if (def.kind === 'wood' || def.kind === 'deck') {
    // planks: 4 planks per tile (tile = 1m), staggered
    const rows = def.kind === 'deck' ? 7 : 5;
    const h = S / rows;
    for (let i = 0; i < rows; i++) {
      const off = r() * S;
      for (let k = -1; k < 2; k++) {
        const x = off + k * S * (def.kind === 'deck' ? 1 : 0.9);
        g.fillStyle = tone; g.globalAlpha = 0.15 + r() * 0.3;
        g.fillRect(x, i * h, S * 0.9, h);
        g.globalAlpha = 1;
        // grain
        g.strokeStyle = tone; g.globalAlpha = 0.25;
        for (let j = 0; j < 7; j++) { g.beginPath(); const y = i * h + r() * h; g.moveTo(x, y); g.bezierCurveTo(x + S * 0.3, y + (r() - 0.5) * 6, x + S * 0.6, y + (r() - 0.5) * 6, x + S * 0.9, y); g.stroke(); }
        g.globalAlpha = 0.55; g.fillStyle = '#3b2a1b'; g.fillRect(x, i * h, 1.5, h); g.globalAlpha = 1;
      }
      g.fillStyle = 'rgba(40,25,10,0.35)'; g.fillRect(0, i * h, S, def.kind === 'deck' ? 4 : 1.5);
    }
    noise(0.05);
  } else if (def.kind === 'herringbone') {
    const w = S / 8, l = w * 4;
    g.save();
    for (let y = -l; y < S + l; y += w) for (let x = -l; x < S + l; x += w * 2) {
      const flip = ((x / (w * 2)) | 0) % 2 === 0;
      g.fillStyle = tone; g.globalAlpha = 0.1 + r() * 0.35;
      g.save(); g.translate(x + (y % (w * 2)), y); g.rotate(flip ? Math.PI / 4 : -Math.PI / 4); g.fillRect(0, 0, l, w); g.globalAlpha = 0.5; g.strokeStyle = '#4a3420'; g.lineWidth = 1; g.strokeRect(0, 0, l, w); g.restore();
    }
    g.restore(); g.globalAlpha = 1;
    noise(0.05);
  } else if (def.kind === 'tile' || def.kind === 'marble') {
    const n = Math.max(1, Math.round(1 / (def.tile ?? 0.6)));
    const t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = tone; g.globalAlpha = r() * 0.18; g.fillRect(i * t, j * t, t, t); }
    g.globalAlpha = 1;
    if (def.kind === 'marble') {
      g.strokeStyle = tone; g.lineWidth = 1.2;
      for (let k = 0; k < 18; k++) { g.globalAlpha = 0.25 + r() * 0.35; g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y); for (let s = 0; s < 8; s++) { x += (r() - 0.3) * 80; y += (r() - 0.5) * 80; g.lineTo(x, y); } g.stroke(); }
      g.globalAlpha = 1;
    }
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t + 2, 0); g.lineTo(i * t + 2, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t + 2); g.lineTo(S, i * t + 2); g.stroke(); }
    noise(0.03);
  } else if (def.kind === 'carpet') {
    noise(0.12, 40000, 1.5);
  } else if (def.kind === 'concrete') {
    for (let i = 0; i < 60; i++) { g.globalAlpha = 0.04; g.fillStyle = r() > 0.5 ? '#fff' : '#000'; g.beginPath(); g.arc(r() * S, r() * S, 20 + r() * 80, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1; noise(0.08, 9000, 1.5);
  } else if (def.kind === 'stone') {
    for (let i = 0; i < 1400; i++) { g.fillStyle = r() > 0.5 ? tone : ['#7d756c', '#d8d1c6', '#9fa29a'][(r() * 3) | 0]; g.globalAlpha = 0.8; g.beginPath(); g.arc(r() * S, r() * S, 1 + r() * 4, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  } else if (def.kind === 'grass') {
    noise(0.2, 40000, 2);
  }
  return c;
}

/** Repeating floor texture; UVs are expected in meters (1 repeat per meter). */
export function floorTexture(id: string): THREE.Texture | null {
  if (!hasDOM) return null;
  const def = FLOOR_MATERIALS.find((m) => m.id === id) ?? FLOOR_MATERIALS[0];
  const key = `floor:${def.id}`;
  if (texCache.has(key)) return texCache.get(key)!;
  const tex = new THREE.CanvasTexture(drawFloor(def));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const scale = def.kind === 'wood' ? 1 / 2.4 : def.kind === 'deck' ? 1 / 2 : def.kind === 'herringbone' ? 1 / 1.6 : def.kind === 'carpet' || def.kind === 'concrete' ? 1 / 3 : 1;
  tex.repeat.set(scale, scale);
  texCache.set(key, tex);
  return tex;
}

const matCache = new Map<string, THREE.Material>();
export function floorMaterial(id: string) {
  const key = `fm:${id}`;
  if (matCache.has(key)) return matCache.get(key)!;
  const def = FLOOR_MATERIALS.find((m) => m.id === id) ?? FLOOR_MATERIALS[0];
  const tex = floorTexture(id);
  const m = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : def.color, map: tex ?? undefined, roughness: def.kind === 'marble' || def.kind === 'tile' ? 0.35 : def.kind === 'carpet' ? 0.95 : 0.6, metalness: 0 });
  matCache.set(key, m);
  return m;
}

export function colorMaterial(color: string, opts: { roughness?: number; metalness?: number; transparent?: boolean; opacity?: number; side?: THREE.Side; emissive?: string } = {}) {
  const key = `c:${color}:${JSON.stringify(opts)}`;
  if (matCache.has(key)) return matCache.get(key)!;
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0, transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1, side: opts.side ?? THREE.FrontSide, emissive: opts.emissive ?? '#000000' });
  matCache.set(key, m);
  return m;
}

export const glassMaterial = () => {
  const key = 'glass';
  if (matCache.has(key)) return matCache.get(key)!;
  const m = new THREE.MeshPhysicalMaterial({ color: '#cfe6f2', roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  matCache.set(key, m);
  return m;
};

export function roofTexture(color: string): THREE.Texture | null {
  if (!hasDOM) return null;
  const key = `roof:${color}`;
  if (texCache.has(key)) return texCache.get(key)!;
  const S = 256; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d')!;
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  const r = rand(7);
  const rows = 8, h = S / rows;
  for (let i = 0; i < rows; i++) {
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, i * h + h - 3, S, 3);
    const off = (i % 2) * (S / 12);
    for (let x = off; x < S + 40; x += S / 6) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.08})`; g.fillRect(x, i * h, S / 6 - 2, h - 3); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, i * h, 1.5, h); }
  }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.repeat.set(0.5, 0.5); tex.anisotropy = 8;
  texCache.set(key, tex);
  return tex;
}

export function grassTexture(): THREE.Texture | null {
  if (!hasDOM) return null;
  if (texCache.has('grass')) return texCache.get('grass')!;
  const S = 512; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d')!;
  g.fillStyle = '#9DB88A'; g.fillRect(0, 0, S, S);
  const r = rand(3);
  for (let i = 0; i < 30000; i++) { g.fillStyle = ['#8FAE7B', '#A9C495', '#86A472', '#B3CB9F'][(r() * 4) | 0]; g.globalAlpha = 0.6; g.fillRect(r() * S, r() * S, 1.5, 3); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.repeat.set(1 / 4, 1 / 4); tex.anisotropy = 8;
  texCache.set('grass', tex);
  return tex;
}
