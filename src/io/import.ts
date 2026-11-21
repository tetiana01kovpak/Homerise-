import * as THREE from 'three';
import type { Project, CustomModelMeta } from '../model/types';
import { uid } from '../model/types';
import { customModelObjects } from '../view3d/registry';

export const MODEL_EXTS = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae', '3mf', '3ds'];
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
export const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

// ---------- tiny IndexedDB blob store for custom models ----------
const DB = 'homerise', STORE = 'models';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function putModelBlob(id: string, data: { name: string; buf: ArrayBuffer }) {
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(data, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function getModelBlob(id: string): Promise<{ name: string; buf: ArrayBuffer } | undefined> {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(STORE, 'readonly'); const rq = tx.objectStore(STORE).get(id); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
}

/** Parse a 3D model file into a normalized Object3D (Y-up, meters, bottom-center at origin). */
export async function parseModel(name: string, buf: ArrayBuffer): Promise<THREE.Object3D> {
  const e = ext(name);
  let obj: THREE.Object3D;
  let zUp = false;
  const text = () => new TextDecoder().decode(buf);
  const neutral = (geo: THREE.BufferGeometry) => {
    geo.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: '#C9CCD1', roughness: 0.6, vertexColors: !!geo.attributes.color });
    return new THREE.Mesh(geo, m);
  };
  switch (e) {
    case 'glb': case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const g = await new GLTFLoader().parseAsync(e === 'gltf' ? text() : buf, '');
      obj = g.scene; break;
    }
    case 'obj': { const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js'); obj = new OBJLoader().parse(text()); obj.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && (!m.material || (m.material as THREE.MeshPhongMaterial).type === 'MeshPhongMaterial')) m.material = new THREE.MeshStandardMaterial({ color: '#D5D2CC', roughness: 0.7 }); }); break; }
    case 'fbx': { const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js'); obj = new FBXLoader().parse(buf, ''); break; }
    case 'stl': { const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js'); obj = neutral(new STLLoader().parse(buf)); zUp = true; break; }
    case 'ply': { const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js'); obj = neutral(new PLYLoader().parse(buf)); zUp = true; break; }
    case 'dae': { const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js'); const r = new ColladaLoader().parse(text(), ''); obj = r!.scene; break; }
    case '3mf': { const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js'); obj = new ThreeMFLoader().parse(buf); zUp = false; break; }
    case '3ds': { const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js'); obj = new TDSLoader().parse(buf, ''); zUp = true; break; }
    default: throw new Error(`Unsupported format .${e}`);
  }
  const root = new THREE.Group();
  root.add(obj);
  if (zUp) obj.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('The model contains no geometry');
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  // unit heuristic: furniture/houses are 0.05–60 m
  // unit heuristic: furniture/houses are 0.05–60 m. STL/3MF/PLY are conventionally millimeters.
  const mmFormat = e === 'stl' || e === '3mf' || e === 'ply';
  const unit = mmFormat ? (maxDim > 10 ? 0.001 : 1) : maxDim > 3000 ? 0.001 : maxDim > 60 ? 0.01 : maxDim < 0.02 ? 100 : 1;
  obj.scale.multiplyScalar(unit);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y;
  root.traverse((ch) => { const m = ch as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return root;
}

export async function importModelFile(file: File, project: Project): Promise<CustomModelMeta> {
  const buf = await file.arrayBuffer();
  const obj = await parseModel(file.name, buf);
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  const id = uid('mdl');
  await putModelBlob(id, { name: file.name, buf });
  customModelObjects.set(id, obj);
  const meta: CustomModelMeta = { id, name: file.name.replace(/\.[^.]+$/, ''), format: ext(file.name), w: +size.x.toFixed(3), d: +size.z.toFixed(3), h: +size.y.toFixed(3), category: 'custom' };
  void project;
  return meta;
}

/** Load all custom models referenced by a project into the object cache. */
export async function hydrateCustomModels(p: Project) {
  let n = 0;
  for (const m of p.customModels) {
    if (customModelObjects.has(m.id)) continue;
    try { const b = await getModelBlob(m.id); if (b) { customModelObjects.set(m.id, await parseModel(b.name, b.buf)); n++; } } catch (e) { console.warn('model load failed', m.name, e); }
  }
  return n;
}

export function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  return img;
}

/** Image → RGBA pixel data (downscaled to max 1800 px). */
export async function imageData(src: string, max = 1800) {
  const img = await loadImage(src);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return { data: g.getImageData(0, 0, c.width, c.height), scale: k, width: img.width, height: img.height };
}

export function isProjectJSON(o: unknown): o is Project {
  return !!o && typeof o === 'object' && Array.isArray((o as Project).levels) && (o as Project).version === 1;
}
