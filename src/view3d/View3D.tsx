import { Canvas, useThree, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PointerLockControls } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useStore, activeLevel } from '../state/store';
import { buildHouse } from './build';
import { grassTexture } from './materials';
import { view3dRegistry, customModelObjects } from './registry';
import { projectToSegment, wallLength } from '../model/geometry';
import { getCatalogItem } from '../catalog';
import { snapToWall } from '../model/place';
import { uid } from '../model/types';
import type { Project } from '../model/types';

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && !m.userData.cached) m.geometry?.dispose();
  });
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    return () => { env.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
}

function houseBox(p: Project) {
  const b = new THREE.Box3();
  for (const l of p.levels) {
    for (const w of l.walls) { b.expandByPoint(new THREE.Vector3(w.a.x, l.elevation, w.a.y)); b.expandByPoint(new THREE.Vector3(w.b.x, l.elevation + l.height, w.b.y)); }
    for (const r of l.rooms) for (const q of r.points) b.expandByPoint(new THREE.Vector3(q.x, l.elevation, q.y));
  }
  if (b.isEmpty()) b.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
  return b;
}

function Sun({ box }: { box: THREE.Box3 }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(8, box.getSize(new THREE.Vector3()).length() * 0.75);
  useEffect(() => {
    const l = ref.current; if (!l) return;
    l.target.position.copy(c); l.target.updateMatrixWorld();
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.5; cam.far = r * 4; cam.updateProjectionMatrix();
  });
  return <directionalLight ref={ref} position={[c.x + r * 0.8, r * 1.4, c.z + r * 0.6]} intensity={2.4} color="#fff6e8" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03} />;
}

function CameraRig({ box }: { box: THREE.Box3 }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const fitNonce = useStore((s) => s.fitNonce);
  const camMode = useStore((s) => s.view3d.camera);
  const walk = useStore((s) => s.view3d.mode === 'walk');
  useEffect(() => {
    if (walk) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // distance so the whole footprint fits the viewport (accounting for aspect ratio)
    const R = Math.max(Math.hypot(size.x, size.z), 8) * 0.55;
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = (R / Math.sin(Math.min(vfov, hfov) / 2)) * 0.95;
    if (camMode === 'top') camera.position.set(c.x, dist, c.z + 0.01);
    else { const dir = new THREE.Vector3(0.5, 1.2, 0.85).normalize(); camera.position.copy(c).addScaledVector(dir, dist); }
    if (controls) { controls.target.set(c.x, Math.min(1, c.y), c.z); controls.update(); } else camera.lookAt(c);
  }, [fitNonce, controls, camMode, walk]); // eslint-disable-line
  return null;
}

function Registry() {
  const { gl, scene, camera, raycaster } = useThree();
  const project = useStore((s) => s.project);
  useEffect(() => {
    view3dRegistry.gl = gl; view3dRegistry.scene = scene; view3dRegistry.camera = camera;
    view3dRegistry.pickFloor = (cx, cy) => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const lv = activeLevel(useStore.getState().project);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -lv.elevation);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : null;
    };
  }, [gl, scene, camera, raycaster, project]);
  return null;
}

/** First-person walk with simple wall collision. */
function Walker() {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const project = useStore((s) => s.project);
  useEffect(() => {
    const lv = activeLevel(project);
    const front = lv.openings.find((o) => o.kind === 'frontDoor');
    let start = { x: 0, y: 0 };
    const r = lv.rooms.find((x) => x.type === 'living') ?? lv.rooms[0];
    if (r) { const xs = r.points.map((p) => p.x), ys = r.points.map((p) => p.y); start = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; }
    void front;
    camera.position.set(start.x, lv.elevation + 1.62, start.y);
    // face into the house (toward the footprint centre)
    const pts = lv.rooms.flatMap((x) => x.points);
    const hc = pts.length ? { x: pts.reduce((t, q) => t + q.x, 0) / pts.length, y: pts.reduce((t, q) => t + q.y, 0) / pts.length } : { x: start.x, y: start.y - 1 };
    const dx = hc.x - start.x, dy = hc.y - start.y;
    camera.lookAt(start.x + (Math.abs(dx) + Math.abs(dy) < 0.5 ? 0 : dx), lv.elevation + 1.5, start.y + (Math.abs(dx) + Math.abs(dy) < 0.5 ? 1 : dy));
    const kd = (e: KeyboardEvent) => { keys.current[e.code] = e.type === 'keydown'; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', kd);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', kd); };
  }, []); // eslint-disable-line
  useFrame((_, dt) => {
    const k = keys.current;
    const speed = (k.ShiftLeft ? 3.2 : 1.6) * Math.min(dt, 0.05);
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const mv = new THREE.Vector3();
    if (k.KeyW || k.ArrowUp) mv.add(fwd); if (k.KeyS || k.ArrowDown) mv.sub(fwd);
    if (k.KeyD || k.ArrowRight) mv.add(right); if (k.KeyA || k.ArrowLeft) mv.sub(right);
    if (mv.lengthSq() === 0) return;
    mv.normalize().multiplyScalar(speed);
    const lv = activeLevel(useStore.getState().project);
    const next = { x: camera.position.x + mv.x, y: camera.position.z + mv.z };
    const blocked = lv.walls.some((w) => {
      if (w.kind === 'invisible') return false;
      const pr = projectToSegment(next, w.a, w.b);
      if (pr.distance > w.thickness / 2 + 0.22) return false;
      const L = wallLength(w);
      return !lv.openings.some((o) => o.wallId === w.id && o.sill < 0.05 && !o.kind.includes('indow') && pr.t > o.t - o.width / 2 + 0.15 && pr.t < o.t + o.width / 2 - 0.15) || L < 0;
    });
    if (!blocked) { camera.position.x = next.x; camera.position.z = next.y; }
  });
  return <><PointerLockControls /><CameraLight /></>;
}

function CameraLight() {
  const { camera } = useThree();
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => { ref.current?.position.copy(camera.position); });
  return <><pointLight ref={ref} intensity={6} distance={9} decay={1.6} color="#fff4e6" /><ambientLight intensity={0.35} /></>;
}

function House({ project }: { project: Project }) {
  const v3 = useStore((s) => s.view3d);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const modelsVersion = useStore((s) => s.modelsVersion);
  const house = useMemo(() => buildHouse(project, {
    activeLevelId: project.activeLevelId, levels: v3.levels, wallMode: v3.mode === 'walk' ? 'full' : v3.wallMode,
    showRoof: v3.showRoof && v3.mode !== 'walk', showFurniture: v3.showFurniture, customModels: customModelObjects,
  }), [project, v3.levels, v3.wallMode, v3.showRoof, v3.showFurniture, v3.mode, modelsVersion]);
  useEffect(() => () => disposeTree(house), [house]);

  const selBox = useMemo(() => {
    if (!selection) return null;
    const b = new THREE.Box3();
    house.updateMatrixWorld(true);
    house.traverse((c) => { if ((c as THREE.Mesh).isMesh && c.userData.id === selection.id && c.visible) b.expandByObject(c); });
    return b.isEmpty() ? null : b;
  }, [selection, house]);

  const dragging = useRef<{ id: string; off: THREE.Vector2 } | null>(null);
  const { controls } = useThree() as unknown as { controls: { enabled: boolean } | null };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (v3.mode === 'walk' || tool !== 'select') return;
    e.stopPropagation();
    const ud = e.object.userData as { kind?: string; id?: string; levelId?: string };
    if (!ud.kind || !ud.id) return;
    const st = useStore.getState();
    if (ud.levelId && ud.levelId !== st.project.activeLevelId) { st.select({ kind: ud.kind as never, id: ud.id }); return; }
    st.select({ kind: ud.kind as never, id: ud.id });
    if (ud.kind === 'item') {
      const it = activeLevel(st.project).items.find((x) => x.id === ud.id);
      if (!it) return;
      st.checkpoint();
      dragging.current = { id: ud.id, off: new THREE.Vector2(it.x - e.point.x, it.y - e.point.z) };
      if (controls) controls.enabled = false;
      (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    }
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = dragging.current; if (!d) return;
    const lv = activeLevel(useStore.getState().project);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -lv.elevation);
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(plane, hit)) return;
    useStore.getState().update((p) => {
      const L = activeLevel(p); const it = L.items.find((x) => x.id === d.id); if (!it) return;
      it.x = Math.round((hit.x + d.off.x) / 0.05) * 0.05; it.y = Math.round((hit.z + d.off.y) / 0.05) * 0.05;
      const def = getCatalogItem(it.catalogId);
      if (def && def.category !== 'outdoor' && !/rug|stair-/.test(it.catalogId)) { const s = snapToWall(L, it, 0.25, true); if (s) { it.x = s.x; it.y = s.y; } }
    }, { commit: false });
  };
  const onUp = () => { if (dragging.current) { dragging.current = null; if (controls) controls.enabled = true; } };

  return <group>
    <primitive object={house} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerMissed={() => { if (!dragging.current && useStore.getState().tool === 'select') useStore.getState().select(null); }} />
    {selBox && <box3Helper args={[selBox, new THREE.Color('#2F6BFF')]} />}
  </group>;
}

function Ground({ box }: { box: THREE.Box3 }) {
  const project = useStore((s) => s.project);
  const lv = activeLevel(project);
  const show = project.settings.showGround && lv.elevation > -0.5;
  const tex = useMemo(() => grassTexture(), []);
  const c = box.getCenter(new THREE.Vector3());
  if (!show) return <gridHelper args={[80, 80, '#c9ced6', '#e3e6ea']} position={[c.x, lv.elevation - 0.01, c.z]} />;
  return <mesh rotation-x={-Math.PI / 2} position={[c.x, -0.3, c.z]} receiveShadow>
    <circleGeometry args={[90, 64]} />
    <meshStandardMaterial color={tex ? '#ffffff' : project.settings.groundColor} {...(tex ? { map: tex } : {})} roughness={1} />
  </mesh>;
}

export default function View3D() {
  const project = useStore((s) => s.project);
  const v3 = useStore((s) => s.view3d);
  const box = useMemo(() => houseBox(project), [project]);
  const [ready, setReady] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-homerise-item');
    if (!id) return;
    e.preventDefault();
    const hit = view3dRegistry.pickFloor?.(e.clientX, e.clientY);
    if (!hit) return;
    const def = getCatalogItem(id);
    const st = useStore.getState();
    const custom = id.startsWith('custom:') ? st.project.customModels.find((m) => `custom:${m.id}` === id) : undefined;
    const size = def ? def.size : custom ? { w: custom.w, d: custom.d, h: custom.h } : null;
    if (!size) return;
    const it = { id: uid('it'), catalogId: id, x: hit.x, y: hit.y, rotation: 0, elevation: def?.elevation ?? 0, w: size.w, d: size.d, h: size.h, name: def?.name ?? custom?.name };
    const lv = activeLevel(st.project);
    if (def && def.category !== 'outdoor') { const s = snapToWall(lv, it, 0.6); if (s) Object.assign(it, { x: s.x, y: s.y, rotation: s.rotation }); }
    st.update((p) => { activeLevel(p).items.push(it); });
    st.select({ kind: 'item', id: it.id });
  };

  return (
    <div className="view3d" ref={wrap} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} data-testid="view3d">
      <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: false, toneMapping: THREE.NoToneMapping }} camera={{ fov: 40, near: 0.1, far: 800, position: [18, 16, 22] }} onCreated={() => setReady(true)}>
        <color attach="background" args={['#EEF1F5']} />
        <fog attach="fog" args={['#EEF1F5', 60, 220]} />
        <Environment />
        <hemisphereLight args={['#ffffff', '#c9cfc2', 1.15]} />
        <Sun box={box} />
        <Ground box={box} />
        <House project={project} />
        {v3.mode === 'walk' ? <Walker /> : <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={2} maxDistance={180} />}
        <CameraRig box={box} />
        <Registry />
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <N8AO aoRadius={0.9} intensity={1.6} distanceFalloff={0.6} halfRes quality="medium" />
          <SMAA />
          <ToneMapping />
        </EffectComposer>
      </Canvas>
      {!ready && <div className="view3d-loading">Preparing 3D…</div>}
      {v3.mode === 'walk' && <div className="walk-hint">Click to look around · <b>W A S D</b> to move · <b>Shift</b> to run · <b>Esc</b> to release</div>}
    </div>
  );
}
