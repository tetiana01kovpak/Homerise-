// Renders small 3D thumbnails of catalog items with a single shared offscreen renderer.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getCatalogItem } from '../catalog';
import { customModelObjects } from '../view3d/registry';

const cache = new Map<string, string>();
const listeners = new Map<string, Set<(url: string) => void>>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene, camera: THREE.PerspectiveCamera;
const queue: string[] = [];
let running = false;

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(200, 150);
  renderer.setPixelRatio(1.5);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight('#ffffff', '#bfc6cf', 1.1));
  const d = new THREE.DirectionalLight('#ffffff', 1.6); d.position.set(3, 5, 4); scene.add(d);
  camera = new THREE.PerspectiveCamera(28, 200 / 150, 0.01, 200);
}

function renderOne(id: string): string | null {
  if (!renderer) init();
  let obj: THREE.Object3D | null = null;
  if (id.startsWith('custom:')) { const src = customModelObjects.get(id.slice(7)); if (src) obj = src.clone(true); }
  else { const def = getCatalogItem(id); if (def) { try { obj = def.build({ ...def.size, color: def.defaultColor }); } catch { obj = null; } } }
  if (!obj) return null;
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const R = Math.max(size.x, size.y * 1.15, size.z) || 1;
  const dist = R / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.25;
  const dir = new THREE.Vector3(0.75, 0.62, 1).normalize();
  camera.position.copy(c).addScaledVector(dir, dist + R * 0.3);
  camera.lookAt(c);
  renderer!.render(scene, camera);
  const url = renderer!.domElement.toDataURL('image/png');
  scene.remove(obj);
  obj.traverse((m) => { const mesh = m as THREE.Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
  return url;
}

function pump() {
  if (running) return;
  running = true;
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 12) {
      const id = queue.shift()!;
      if (cache.has(id)) continue;
      const url = renderOne(id);
      if (url) { cache.set(id, url); listeners.get(id)?.forEach((f) => f(url)); listeners.delete(id); }
    }
    if (queue.length) requestAnimationFrame(step); else running = false;
  };
  requestAnimationFrame(step);
}

export function thumbnail(id: string, cb: (url: string) => void): string | undefined {
  const hit = cache.get(id);
  if (hit) return hit;
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(cb);
  if (!queue.includes(id)) queue.push(id);
  pump();
  return undefined;
}
export function unsubscribe(id: string, cb: (url: string) => void) { listeners.get(id)?.delete(cb); }
export function invalidateThumb(id: string) { cache.delete(id); }
