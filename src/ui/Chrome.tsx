import { useEffect, useState } from 'react';
import { MousePointer2, Hand, PenLine, Square, DoorOpen, AppWindow, Sofa, Ruler, Type, Triangle, Undo2, Redo2, Sparkles, Download, Settings, Box, Columns2, LayoutPanelLeft, Orbit, Footprints, Camera, Plus, Layers, Home, Eye, EyeOff, Check } from 'lucide-react';
import { useStore, type Tool, activeLevel } from '../state/store';
import { addLevel } from '../model/ops';
import { snapshot3D, download, safeName } from '../io/export';

export function TopBar() {
  const name = useStore((s) => s.project.name);
  const view = useStore((s) => s.view);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const aiOpen = useStore((s) => s.aiOpen);
  const updatedAt = useStore((s) => s.project.updatedAt);
  const st = useStore.getState;
  const [saved, setSaved] = useState(true);
  useEffect(() => { setSaved(false); const t = setTimeout(() => setSaved(true), 900); return () => clearTimeout(t); }, [updatedAt]);
  return (
    <header className="topbar">
      <button className="brand" onClick={() => st().set({ startOpen: true })} title="Home">
        <span className="brand-mark"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M5 15.5 16 7l11 8.5V26a1 1 0 0 1-1 1h-6.5v-7h-7v7H6a1 1 0 0 1-1-1z" fill="#fff" /></svg></span>
        Homerise
      </button>
      <input className="project-name" value={name} aria-label="Project name" onChange={(e) => st().update((p) => { p.name = e.target.value; }, { commit: false })} />
      <span className="save-state">{saved ? <><Check size={13} /> Saved</> : 'Saving…'}</span>
      <div className="row" style={{ marginLeft: 6 }}>
        <button className="icon-btn" disabled={!canUndo} onClick={() => st().undo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={18} /></button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={18} /></button>
      </div>
      <div className="spacer" />
      <div className="seg" role="tablist" aria-label="View">
        <button className={view === '2d' ? 'on' : ''} onClick={() => st().set({ view: '2d' })} title="2D plan (1)"><LayoutPanelLeft size={15} /> 2D</button>
        <button className={view === 'split' ? 'on' : ''} onClick={() => st().set({ view: 'split' })} title="Split view (2)"><Columns2 size={15} /> Split</button>
        <button className={view === '3d' ? 'on' : ''} onClick={() => st().set({ view: '3d' })} title="3D view (3)"><Box size={15} /> 3D</button>
      </div>
      <div className="spacer" />
      <button className="icon-btn" onClick={() => st().set({ settingsOpen: true })} title="Settings" aria-label="Settings"><Settings size={18} /></button>
      <button className="btn" onClick={() => st().set({ exportOpen: true })}><Download size={15} /> Export</button>
      <button className={`btn ai`} onClick={() => st().set({ aiOpen: !aiOpen })} data-testid="ai-toggle"><Sparkles size={15} /> AI Designer</button>
    </header>
  );
}

const TOOLS: { id: Tool; icon: typeof Hand; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select & move', key: 'V' },
  { id: 'pan', icon: Hand, label: 'Pan', key: 'H' },
  { id: 'wall', icon: PenLine, label: 'Draw walls', key: 'W' },
  { id: 'room', icon: Square, label: 'Draw room', key: 'R' },
  { id: 'door', icon: DoorOpen, label: 'Doors', key: 'D' },
  { id: 'window', icon: AppWindow, label: 'Windows', key: 'N' },
  { id: 'item', icon: Sofa, label: 'Furniture & objects', key: 'F' },
  { id: 'roof', icon: Triangle, label: 'Roofs', key: 'O' },
  { id: 'measure', icon: Ruler, label: 'Measure', key: 'M' },
  { id: 'label', icon: Type, label: 'Text label', key: 'T' },
];

export function Rail() {
  const tool = useStore((s) => s.tool);
  const panel = useStore((s) => s.panel);
  const pick = (t: Tool) => {
    const st = useStore.getState();
    if (t === 'item') { st.set({ tool: 'item', panel: 'library', placing: st.placing?.catalogId ? st.placing : null, selection: null }); return; }
    const panelFor = t === 'door' || t === 'window' || t === 'room' || t === 'wall' || t === 'roof' ? 'build' : panel;
    st.set({ tool: t, panel: panelFor, placing: t === 'door' ? { openingKind: 'door' } : t === 'window' ? { openingKind: 'window' } : t === 'room' ? { roomType: 'other' } : null });
  };
  return (
    <nav className="rail" aria-label="Tools">
      {TOOLS.map((t, i) => (
        <div key={t.id} style={{ display: 'contents' }}>
          {(i === 2 || i === 6 || i === 8) && <div className="sep" />}
          <button className={`tool ${tool === t.id ? 'on' : ''}`} onClick={() => pick(t.id)} aria-label={t.label} data-testid={`tool-${t.id}`}>
            <t.icon size={20} strokeWidth={1.8} />
            <span className="tip">{t.label} <span className="kbd">{t.key}</span></span>
          </button>
        </div>
      ))}
    </nav>
  );
}

export function LevelBar() {
  const levels = useStore((s) => s.project.levels);
  const active = useStore((s) => s.project.activeLevelId);
  const sorted = [...levels].sort((a, b) => b.elevation - a.elevation);
  const st = useStore.getState;
  const [menu, setMenu] = useState(false);
  return (
    <div className="levelbar" data-testid="levelbar">
      <span style={{ display: 'grid', placeItems: 'center', padding: '0 6px 0 8px', color: 'var(--text-3)' }}><Layers size={15} /></span>
      {[...sorted].reverse().map((l) => (
        <button key={l.id} className={`lv ${l.id === active ? 'on' : ''}`} onClick={() => st().update((p) => { p.activeLevelId = l.id; }, { commit: false })} onDoubleClick={() => { const n = prompt('Level name', l.name); if (n) st().update((p) => { const x = p.levels.find((y) => y.id === l.id); if (x) x.name = n; }); }}>{l.name}</button>
      ))}
      <div style={{ position: 'relative' }}>
        <button className="lv" onClick={() => setMenu(!menu)} title="Add level" aria-label="Add level"><Plus size={15} style={{ verticalAlign: -3 }} /></button>
        {menu && <div className="float" style={{ position: 'absolute', top: 40, left: 0, flexDirection: 'column', alignItems: 'stretch', padding: 6, minWidth: 170 }} onMouseLeave={() => setMenu(false)}>
          <button className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { st().update((p) => { addLevel(p, 'above'); }); setMenu(false); st().toast('Added a floor above (exterior walls copied)', 'success'); }}>Add floor above</button>
          <button className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { st().update((p) => { addLevel(p, 'below'); }); setMenu(false); st().toast('Added a basement', 'success'); }}>Add basement</button>
          {levels.length > 1 && <button className="btn ghost danger" style={{ justifyContent: 'flex-start' }} onClick={() => { const id = st().project.activeLevelId; st().update((p) => { p.levels = p.levels.filter((x) => x.id !== id); p.activeLevelId = p.levels[0].id; }); setMenu(false); }}>Delete current level</button>}
        </div>}
      </div>
    </div>
  );
}

export function View3DControls() {
  const v3 = useStore((s) => s.view3d);
  const set3 = (patch: Partial<typeof v3>) => useStore.getState().set({ view3d: { ...useStore.getState().view3d, ...patch } });
  const name = useStore((s) => s.project.name);
  const hasRoof = useStore((s) => s.project.levels.some((l) => l.roofs.length > 0));
  const snap = async () => {
    const b = await snapshot3D();
    if (b) { download(b, `${safeName({ name } as never)}-3d.png`); useStore.getState().toast('3D photo saved', 'success'); }
  };
  return (
    <div className="v3-ctl">
      <div className="float">
        <button className={`icon-btn ${v3.mode === 'orbit' ? 'on' : ''}`} onClick={() => set3({ mode: 'orbit' })} title="Orbit view" aria-label="Orbit view"><Orbit size={17} /></button>
        <button className={`icon-btn ${v3.mode === 'walk' ? 'on' : ''}`} onClick={() => set3({ mode: 'walk' })} title="Walk through (first person)" aria-label="Walk through"><Footprints size={17} /></button>
        <span className="sepv" />
        <button className="icon-btn" onClick={() => useStore.setState((s) => ({ fitNonce: s.fitNonce + 1, view3d: { ...s.view3d, mode: 'orbit' } }))} title="Reset camera" aria-label="Reset camera"><Home size={17} /></button>
        <button className="icon-btn" onClick={snap} title="Save 3D photo (PNG)" aria-label="Save 3D photo"><Camera size={17} /></button>
      </div>
      {v3.mode === 'orbit' && <div className="float" style={{ padding: 4 }}>
        <div className="seg small" style={{ background: 'transparent' }}>
          <button className={v3.wallMode === 'full' ? 'on' : ''} onClick={() => set3({ wallMode: 'full' })}>Full walls</button>
          <button className={v3.wallMode === 'cut' ? 'on' : ''} onClick={() => set3({ wallMode: 'cut' })}>Cutaway</button>
        </div>
        <span className="sepv" />
        <button className={`btn ghost`} style={{ height: 28, padding: '0 8px', fontSize: 12 }} onClick={() => set3({ showRoof: !v3.showRoof, levels: !v3.showRoof ? 'all' : 'upto' })} disabled={!hasRoof} title="Show roof and all floors">{v3.showRoof ? <Eye size={14} /> : <EyeOff size={14} />} Roof</button>
      </div>}
    </div>
  );
}

export function useLevelName() { return useStore((s) => activeLevel(s.project).name); }
