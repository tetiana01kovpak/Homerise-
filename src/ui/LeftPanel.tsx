import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Upload, Square, DoorOpen, AppWindow, PenLine, Triangle, Sparkles, Bed, Bath, CookingPot, Sofa, Car, Warehouse, Armchair, Lamp, TreePine, Layers3 } from 'lucide-react';
import { useStore, activeLevel } from '../state/store';
import { CATEGORIES, searchCatalog, getCatalogItem } from '../catalog';
import { thumbnail, unsubscribe } from './thumbs';
import { OPENING_DEFAULTS, ROOM_DEFAULTS } from '../model/ops';
import type { RoomType, OpeningKind } from '../model/types';
import { importModelFile, MODEL_EXTS, ext } from '../io/import';
import { NumberField, Section } from './common';
import { furnishAll } from '../state/actions';

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | undefined>(() => thumbnail(id, () => {}));
  useEffect(() => {
    const cb = (u: string) => setUrl(u);
    const u = thumbnail(id, cb);
    if (u) setUrl(u);
    return () => unsubscribe(id, cb);
  }, [id]);
  return url ? <img src={url} alt="" draggable={false} /> : <div style={{ width: 22, height: 22, borderRadius: 6, background: '#E6E8EC' }} />;
}

export function LibraryPanel() {
  const [q, setQ] = useState('');
  const cat = useStore((s) => s.libraryCategory);
  const placing = useStore((s) => s.placing);
  const custom = useStore((s) => s.project.customModels);
  useStore((s) => s.modelsVersion);
  const units = useStore((s) => s.project.settings.units);
  const items = useMemo(() => (cat === 'custom' ? [] : searchCatalog(q, cat === 'all' ? 'all' : (cat as never))), [q, cat]);
  const customs = custom.filter((m) => (cat === 'all' || cat === 'custom') && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const fmt = (m: number) => (units === 'imperial' ? `${Math.round(m * 39.37)}″` : `${Math.round(m * 100)}`);

  const pick = (id: string) => {
    const st = useStore.getState();
    if (st.placing?.catalogId === id) st.set({ placing: null, tool: 'select' });
    else st.set({ tool: 'item', placing: { catalogId: id }, selection: null });
  };

  const upload = async (files: FileList | File[]) => {
    const st = useStore.getState();
    setBusy(true);
    for (const f of Array.from(files)) {
      if (!MODEL_EXTS.includes(ext(f.name))) { st.toast(`.${ext(f.name)} is not a supported 3D format`, 'error'); continue; }
      try {
        const meta = await importModelFile(f, st.project);
        st.update((p) => { p.customModels.push(meta); });
        useStore.setState((s) => ({ modelsVersion: s.modelsVersion + 1, libraryCategory: 'custom' }));
        st.toast(`Imported “${meta.name}” — click it to place`, 'success');
      } catch (e) { st.toast(`Could not import ${f.name}: ${(e as Error).message}`, 'error'); }
    }
    setBusy(false);
  };

  return (
    <aside className="side" data-testid="library">
      <div className="side-head"><h3>Library</h3><span className="prop-sub">{items.length + customs.length} objects</span></div>
      <div style={{ padding: '0 16px' }}>
        <div className="search"><Search size={15} /><input className="input" placeholder="Search sofas, beds, trees…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="lib-search" /></div>
        <div className="cats">
          <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => useStore.getState().set({ libraryCategory: 'all' })}>All</button>
          {CATEGORIES.map((c) => <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => useStore.getState().set({ libraryCategory: c.id })}>{c.label}</button>)}
        </div>
      </div>
      <div className="side-body">
        {(cat === 'custom' || cat === 'all') && (
          <div className={`upload-zone ${drag ? 'drag' : ''}`} style={{ marginBottom: 12 }} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
            <Upload size={16} style={{ verticalAlign: -3, marginRight: 6 }} />{busy ? 'Importing…' : 'Upload your own 3D model'}
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>GLB, GLTF, OBJ, FBX, STL, PLY, DAE, 3MF, 3DS</div>
            <input ref={fileRef} type="file" hidden multiple accept={MODEL_EXTS.map((e) => `.${e}`).join(',')} onChange={(e) => e.target.files && upload(e.target.files)} data-testid="model-upload" />
          </div>
        )}
        <div className="lib-grid">
          {customs.map((m) => (
            <button key={m.id} className={`lib-item ${placing?.catalogId === `custom:${m.id}` ? 'on' : ''}`} onClick={() => pick(`custom:${m.id}`)} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-homerise-item', `custom:${m.id}`)} title={m.name}>
              <div className="thumb"><Thumb id={`custom:${m.id}`} /></div>
              <div className="nm">{m.name}</div><div className="sz">{fmt(m.w)} × {fmt(m.d)} · {m.format.toUpperCase()}</div>
            </button>
          ))}
          {items.map((it) => (
            <button key={it.id} className={`lib-item ${placing?.catalogId === it.id ? 'on' : ''}`} onClick={() => pick(it.id)} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-homerise-item', it.id)} title={`${it.name} — click to place, or drag into the plan / 3D view`} data-testid={`lib-${it.id}`}>
              <div className="thumb"><Thumb id={it.id} /></div>
              <div className="nm">{it.name}</div><div className="sz">{fmt(it.size.w)} × {fmt(it.size.d)}{units === 'metric' ? ' cm' : ''}</div>
            </button>
          ))}
        </div>
        {!items.length && !customs.length && <div className="prop-sub" style={{ textAlign: 'center', padding: 24 }}>No objects match “{q}”.</div>}
      </div>
    </aside>
  );
}

const ROOM_PRESETS: { type: RoomType; icon: typeof Bed }[] = [
  { type: 'living', icon: Sofa }, { type: 'bedroom', icon: Bed }, { type: 'kitchen', icon: CookingPot }, { type: 'bathroom', icon: Bath },
  { type: 'dining', icon: Armchair }, { type: 'office', icon: Lamp }, { type: 'hall', icon: Layers3 }, { type: 'garage', icon: Car },
  { type: 'storage', icon: Warehouse }, { type: 'terrace', icon: TreePine }, { type: 'other', icon: Square },
];
const DOORS: OpeningKind[] = ['door', 'frontDoor', 'doubleDoor', 'slidingDoor', 'garageDoor', 'opening'];
const WINDOWS: OpeningKind[] = ['window', 'wideWindow', 'fixedWindow'];

function OpeningIcon({ kind }: { kind: OpeningKind }) {
  const s = '#16181D';
  if (kind.includes('indow')) {
    const w = kind === 'wideWindow' ? 30 : kind === 'fixedWindow' ? 14 : 22;
    const h = kind === 'fixedWindow' ? 28 : 18;
    return <svg width="36" height="32" viewBox="0 0 36 32"><rect x={18 - w / 2} y={16 - h / 2} width={w} height={h} rx="2" fill="#E6F1F8" stroke={s} strokeWidth="1.6" /><line x1="18" y1={16 - h / 2} x2="18" y2={16 + h / 2} stroke={s} strokeWidth="1.2" /></svg>;
  }
  if (kind === 'garageDoor') return <svg width="36" height="32" viewBox="0 0 36 32"><rect x="4" y="6" width="28" height="22" rx="2" fill="#EEE" stroke={s} strokeWidth="1.6" />{[11, 16, 21].map((y) => <line key={y} x1="4" y1={y} x2="32" y2={y} stroke={s} strokeWidth="1" />)}</svg>;
  if (kind === 'slidingDoor') return <svg width="36" height="32" viewBox="0 0 36 32"><rect x="5" y="4" width="13" height="24" fill="#E6F1F8" stroke={s} strokeWidth="1.6" /><rect x="16" y="4" width="15" height="24" fill="#E6F1F8" stroke={s} strokeWidth="1.6" /></svg>;
  if (kind === 'opening') return <svg width="36" height="32" viewBox="0 0 36 32"><path d="M8 28V6h20v22" fill="none" stroke={s} strokeWidth="1.6" strokeDasharray="3 2" /></svg>;
  if (kind === 'doubleDoor') return <svg width="36" height="32" viewBox="0 0 36 32"><rect x="5" y="4" width="13" height="24" fill="#F3F1EC" stroke={s} strokeWidth="1.6" /><rect x="18" y="4" width="13" height="24" fill="#F3F1EC" stroke={s} strokeWidth="1.6" /></svg>;
  return <svg width="36" height="32" viewBox="0 0 36 32"><rect x="10" y="4" width="16" height="24" fill={kind === 'frontDoor' ? '#3C4147' : '#F3F1EC'} stroke={s} strokeWidth="1.6" /><circle cx="22" cy="17" r="1.3" fill={kind === 'frontDoor' ? '#fff' : s} /></svg>;
}

export function BuildPanel() {
  const tool = useStore((s) => s.tool);
  const placing = useStore((s) => s.placing);
  const settings = useStore((s) => s.project.settings);
  const level = useStore((s) => activeLevel(s.project));
  const st = useStore.getState;
  const setPlacing = (p: typeof placing, t = tool) => st().set({ placing: p, tool: t });
  return (
    <aside className="side" data-testid="build-panel">
      <div className="side-head"><h3>Build</h3></div>
      <div className="side-body">
        <Section title="Structure">
          <div className="tiles">
            <button className={`tile ${tool === 'wall' ? 'on' : ''}`} onClick={() => setPlacing(null, 'wall')}><PenLine size={20} />Walls</button>
            <button className={`tile ${tool === 'room' ? 'on' : ''}`} onClick={() => setPlacing({ roomType: 'other' }, 'room')}><Square size={20} />Room</button>
            <button className={`tile ${tool === 'roof' ? 'on' : ''}`} onClick={() => setPlacing(null, 'roof')}><Triangle size={20} />Roof</button>
          </div>
        </Section>
        <Section title="Rooms" right={<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>drag on the plan</span>}>
          <div className="tiles">
            {ROOM_PRESETS.map(({ type, icon: Icon }) => (
              <button key={type} className={`tile ${tool === 'room' && placing?.roomType === type ? 'on' : ''}`} onClick={() => setPlacing({ roomType: type }, 'room')} data-testid={`room-${type}`}>
                <span style={{ width: 30, height: 22, borderRadius: 6, background: ROOM_DEFAULTS[type].color, display: 'grid', placeItems: 'center', border: '1px solid rgba(0,0,0,0.06)' }}><Icon size={14} /></span>
                {ROOM_DEFAULTS[type].label}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Doors">
          <div className="tiles">
            {DOORS.map((k) => <button key={k} className={`tile ${placing?.openingKind === k ? 'on' : ''}`} onClick={() => setPlacing({ openingKind: k }, 'door')} data-testid={`opening-${k}`}><OpeningIcon kind={k} />{OPENING_DEFAULTS[k].label}</button>)}
          </div>
        </Section>
        <Section title="Windows">
          <div className="tiles">
            {WINDOWS.map((k) => <button key={k} className={`tile ${placing?.openingKind === k ? 'on' : ''}`} onClick={() => setPlacing({ openingKind: k }, 'window')} data-testid={`opening-${k}`}><OpeningIcon kind={k} />{OPENING_DEFAULTS[k].label}</button>)}
          </div>
        </Section>
        <Section title="Defaults">
          <div className="grid2">
            <NumberField label="Wall thickness" value={settings.wallThickness} step={0.01} min={0.05} max={0.6} onChange={(v) => st().update((p) => { p.settings.wallThickness = v; })} />
            <NumberField label="Level height" value={level.height} step={0.05} min={2} max={6} onChange={(v) => st().update((p) => { activeLevel(p).height = v; })} />
          </div>
        </Section>
        <Section title="Quick actions">
          <button className="btn block" onClick={() => { furnishAll(); st().toast('Furnished empty rooms', 'success'); }}><Sparkles size={15} /> Auto-furnish empty rooms</button>
        </Section>
      </div>
    </aside>
  );
}

export { getCatalogItem };
