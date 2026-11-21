import * as THREE from 'three';
import type { CatalogItem, PlanShape } from '../types';
import { M, P, mat, box, rbox, rodX, frustum, rod, ringUpright, cyl, n } from '../materials';

function buildCar(w: number, d: number, h: number, color: string | undefined, suv: boolean): THREE.Group {
  const g = new THREE.Group();
  const paint = mat(color ?? (suv ? '#5d6b72' : '#b8c2c9'), { roughness: 0.25, metalness: 0.6 });
  const glass = mat('#27313b', { roughness: 0.08, metalness: 0.6 });
  const tire = M.black();
  const rim = M.chrome();
  const wheelR = Math.min(h * (suv ? 0.22 : 0.23), d * 0.075);
  const wheelW = Math.min(w * 0.13, 0.26);
  const bodyY = wheelR * (suv ? 0.6 : 0.45);
  const bodyTop = h * (suv ? 0.58 : 0.5);
  const bw = w * 0.96;
  g.add(rbox(bw, bodyTop - bodyY, d, paint, Math.min(0.14, (bodyTop - bodyY) / 2.2), 0, bodyY, 0));
  // cabin
  const cabD0 = d * (suv ? 0.66 : 0.52), cabD1 = d * (suv ? 0.56 : 0.32);
  const cz = suv ? -d * 0.07 : -d * 0.06;
  const cabH = h - bodyTop - 0.04;
  g.add(frustum(bw * 0.94, cabD0, bw * 0.82, cabD1, cabH, glass, 0, bodyTop, cz, 0, suv ? -d * 0.03 : -d * 0.02));
  // pillars & roof
  g.add(frustum(bw * 0.95, 0.06, bw * 0.83, 0.06, cabH, paint, 0, bodyTop, cz - 0.02, 0, suv ? -d * 0.03 + 0.0 : -d * 0.04));
  g.add(box(bw * 0.83, 0.04, cabD1, paint, 0, h - 0.04, cz + (suv ? -d * 0.03 : -d * 0.02)));
  // wheels
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - wheelW / 2);
    const z = sz * d * (suv ? 0.31 : 0.32);
    g.add(rodX(wheelW, wheelR, tire, x, wheelR, z, 20));
    g.add(rodX(wheelW + 0.004, wheelR * 0.58, rim, x - sx * 0.002, wheelR, z, 16));
  }
  // lights
  const ly = bodyTop - Math.min(0.12, (bodyTop - bodyY) * 0.35);
  const head = mat('#fff8e6', { emissive: '#fff3d0', emissiveIntensity: 1.2 });
  const tail = mat('#c0262d', { emissive: '#a0141a', emissiveIntensity: 0.8 });
  for (const sx of [-1, 1]) {
    g.add(box(bw * 0.2, 0.06, 0.02, head, sx * bw * 0.33, ly, d / 2 - 0.035));
    g.add(box(bw * 0.2, 0.06, 0.02, tail, sx * bw * 0.33, ly, -d / 2 + 0.035));
  }
  // bumpers / grille
  g.add(box(bw * 0.5, 0.1, 0.02, M.black(), 0, bodyY + 0.12, d / 2 - 0.03));
  g.add(box(bw * 0.9, 0.08, 0.03, M.matte('#2b2b2e'), 0, bodyY + 0.02, -d / 2 + 0.04));
  // mirrors
  for (const sx of [-1, 1]) g.add(box((w - bw) / 2 + 0.06, 0.07, 0.12, paint, sx * (w / 2 - ((w - bw) / 2 + 0.06) / 2), bodyTop + 0.02, cz + cabD0 / 2 - 0.12));
  return g;
}

function planCar(w: number, d: number, suv: boolean): PlanShape[] {
  const bw = w * 0.96;
  const cabD0 = d * (suv ? 0.66 : 0.52);
  const cz = suv ? -d * 0.07 : -d * 0.06;
  const r = Math.min(0.35, w * 0.2);
  const out: PlanShape[] = [P.rect(0, 0, bw, d, r)];
  out.push(P.rect(0, cz, bw * 0.86, cabD0, 0.12));
  // windscreen and rear window lines
  out.push(P.line(-bw * 0.43, cz + cabD0 * 0.3, bw * 0.43, cz + cabD0 * 0.3));
  out.push(P.line(-bw * 0.43, cz - cabD0 * 0.32, bw * 0.43, cz - cabD0 * 0.32));
  // wheels
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(P.rect(sx * (w / 2 - Math.min(w * 0.13, 0.26) / 2), sz * d * (suv ? 0.31 : 0.32), Math.min(w * 0.13, 0.26), Math.min(0.7, d * 0.15), 0.03, true));
  // mirrors
  for (const sx of [-1, 1]) out.push(P.rect(sx * (w / 2 - 0.05), cz + cabD0 / 2 - 0.12, 0.1, 0.12));
  // hood line (front +y)
  out.push(P.path(`M${n(-bw * 0.3)} ${n(d / 2 - 0.15)} Q0 ${n(d / 2 - 0.05)} ${n(bw * 0.3)} ${n(d / 2 - 0.15)}`));
  return out;
}

function buildBicycle(w: number, d: number, h: number, color?: string): THREE.Group {
  const g = new THREE.Group();
  const frameM = mat(color ?? '#2f6f8f', { roughness: 0.3, metalness: 0.5 });
  const tire = M.black();
  const tube = 0.025;
  const R = Math.min(d * 0.2, h * 0.34) - tube;
  const cy = R + tube;
  const zr = -d / 2 + R + tube, zf = d / 2 - R - tube;
  for (const z of [zr, zf]) {
    const wh = ringUpright(R, tube, tire, 0, cy, z, 28);
    wh.rotation.y = Math.PI / 2;
    g.add(wh);
    const hub = cyl(0.03, 0.08, M.chrome(), 0, 0, 0, 10);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(0, cy, z);
    g.add(hub);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(rod(new THREE.Vector3(0, cy, z), new THREE.Vector3(0, cy + Math.sin(a) * (R - 0.01), z + Math.cos(a) * (R - 0.01)), 0.003, M.chrome(), 4));
    }
  }
  const V = (y: number, z: number) => new THREE.Vector3(0, y, z);
  const bb = V(cy - 0.02, (zr + zf) / 2 - d * 0.05);
  const seatTop = V(h * 0.82, zr + d * 0.2);
  const headTop = V(h * 0.8, zf - d * 0.12);
  const headBot = V(h * 0.62, zf - d * 0.08);
  const ft = 0.018;
  g.add(rod(V(cy, zr), bb, ft, frameM));
  g.add(rod(V(cy, zr), seatTop, ft, frameM));
  g.add(rod(bb, seatTop, ft * 1.1, frameM));
  g.add(rod(bb, headBot, ft * 1.2, frameM));
  g.add(rod(seatTop, headTop, ft * 1.1, frameM));
  g.add(rod(headBot, headTop, ft * 1.2, frameM));
  g.add(rod(headBot, V(cy, zf), ft, frameM));
  // seat
  g.add(box(0.12, 0.04, 0.24, M.black(), 0, h * 0.86, seatTop.z - 0.02));
  g.add(rod(seatTop, V(h * 0.86, seatTop.z - 0.01), 0.012, M.chrome()));
  // handlebar
  const hb = V(h - 0.02, headTop.z - 0.02);
  g.add(rod(headTop, hb, 0.014, M.chrome()));
  g.add(rodX(w, 0.012, M.chrome(), 0, h - 0.015, hb.z));
  for (const sx of [-1, 1]) g.add(rodX(0.1, 0.016, M.black(), sx * (w / 2 - 0.05), h - 0.016, hb.z));
  // crank + pedals
  const crank = cyl(0.08, 0.02, M.steel(), 0, 0, 0, 16);
  crank.rotation.z = Math.PI / 2;
  crank.position.set(0.04, bb.y, bb.z);
  g.add(crank);
  g.add(box(0.1, 0.02, 0.06, M.black(), 0.12, bb.y - 0.16, bb.z));
  g.add(box(0.1, 0.02, 0.06, M.black(), -0.12, bb.y + 0.14, bb.z));
  return g;
}

export const vehicleItems: CatalogItem[] = [
  {
    id: 'car-sedan', name: 'Car (sedan)', category: 'vehicles', tags: ['car', 'sedan', 'vehicle', 'automobile', 'garage'], outdoor: true,
    size: { w: 1.82, d: 4.7, h: 1.45 }, defaultColor: '#b8c2c9',
    build: (o) => buildCar(o.w, o.d, o.h, o.color, false), plan: (w, d) => planCar(w, d, false),
  },
  {
    id: 'car-suv', name: 'SUV', category: 'vehicles', tags: ['car', 'suv', 'vehicle', 'jeep', '4x4', 'garage'], outdoor: true,
    size: { w: 1.92, d: 4.75, h: 1.75 }, defaultColor: '#5d6b72',
    build: (o) => buildCar(o.w, o.d, o.h, o.color, true), plan: (w, d) => planCar(w, d, true),
  },
  {
    id: 'bicycle', name: 'Bicycle', category: 'vehicles', tags: ['bicycle', 'bike', 'cycle'], outdoor: true,
    size: { w: 0.6, d: 1.75, h: 1.05 }, defaultColor: '#2f6f8f',
    build: (o) => buildBicycle(o.w, o.d, o.h, o.color),
    plan: (w, d) => {
      const R = Math.min(d * 0.2, 1.05 * 0.34);
      return [P.rect(0, -d / 2 + R, 0.05, 2 * R, 0.02, true), P.rect(0, d / 2 - R, 0.05, 2 * R, 0.02, true), P.line(0, -d / 2 + R, 0, d / 2 - R), P.line(-w / 2, d / 2 - R - d * 0.12, w / 2, d / 2 - R - d * 0.12), P.rect(0, -d / 2 + R + d * 0.18, 0.12, 0.24, 0.04)];
    },
  },
];
