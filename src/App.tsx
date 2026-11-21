import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, Square, PenLine, Sparkles } from 'lucide-react';
import { useStore, activeLevel, type Tool } from './state/store';
import { TopBar, Rail, LevelBar, View3DControls } from './ui/Chrome';
import { BuildPanel, LibraryPanel } from './ui/LeftPanel';
import { Properties } from './ui/Properties';
import { StartScreen } from './ui/StartScreen';
import { ExportDialog, SettingsDialog, ImportPlanDialog } from './ui/Dialogs';
import { AIPanel } from './ui/AIPanel';
import Plan2D from './editor2d/Plan2D';
import { deleteSelection, duplicateSelection, rotateSelection, nudgeSelection, openProject } from './state/actions';
import { IMAGE_EXTS, MODEL_EXTS, ext, isProjectJSON, importModelFile } from './io/import';

const View3D = lazy(() => import('./view3d/View3D'));

const KEYS: Record<string, Tool> = { v: 'select', h: 'pan', w: 'wall', r: 'room', d: 'door', n: 'window', f: 'item', m: 'measure', t: 'label', o: 'roof' };

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.kind === 'success' ? <CheckCircle2 size={15} /> : t.kind === 'error' ? <CircleAlert size={15} /> : <Info size={15} />}{t.text}</div>)}</div>;
}

function EmptyHint() {
  const empty = useStore((s) => { const l = activeLevel(s.project); return !l.walls.length && !l.rooms.length && !s.project.trace?.[l.id]; });
  const tool = useStore((s) => s.tool);
  if (!empty || tool !== 'select') return null;
  const st = useStore.getState;
  return <div className="empty-hint"><div>
    <Square size={22} color="var(--text-3)" />
    <h4>This floor is empty</h4>
    Drag out a room, draw walls, or let AI design it for you.
    <div className="row">
      <button className="btn" onClick={() => st().set({ tool: 'room', panel: 'build', placing: { roomType: 'living' } })}><Square size={14} /> Room</button>
      <button className="btn" onClick={() => st().set({ tool: 'wall', panel: 'build' })}><PenLine size={14} /> Walls</button>
      <button className="btn ai" onClick={() => st().set({ aiOpen: true })}><Sparkles size={14} /> AI</button>
    </div>
  </div></div>;
}

export default function App() {
  const view = useStore((s) => s.view);
  const panel = useStore((s) => s.panel);
  const tool = useStore((s) => s.tool);
  const aiOpen = useStore((s) => s.aiOpen);
  const startOpen = useStore((s) => s.startOpen);
  const exportOpen = useStore((s) => s.exportOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const importFile = useStore((s) => s.importFile);
  const [split, setSplit] = useState(0.5);
  const wsRef = useRef<HTMLDivElement>(null);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable]')) return;
      const st = useStore.getState();
      if (st.startOpen || st.exportOpen || st.settingsOpen || st.importFile) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); st.redo(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (mod) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { if (st.selection) { e.preventDefault(); deleteSelection(); } return; }
      if (e.key === 'Escape') { if (st.tool !== 'select' || st.placing) st.set({ tool: 'select', placing: null }); else st.select(null); return; }
      if (k === 'e' && st.selection?.kind === 'item') { rotateSelection(e.shiftKey ? -90 : 90); return; }
      if (k === 'q' && st.selection?.kind === 'item') { rotateSelection(-15); return; }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && st.selection) { e.preventDefault(); const s = e.shiftKey ? 0.25 : 0.05; nudgeSelection(arrows[e.key][0] * s, arrows[e.key][1] * s); return; }
      if (k === '1') { st.set({ view: '2d' }); return; }
      if (k === '2') { st.set({ view: 'split' }); return; }
      if (k === '3') { st.set({ view: '3d' }); return; }
      if (KEYS[k] && !(st.tool === 'wall' && /^[0-9.]$/.test(k))) {
        const tl = KEYS[k];
        if (tl === 'item') st.set({ tool: 'item', panel: 'library', selection: null });
        else st.set({ tool: tl, placing: tl === 'door' ? { openingKind: 'door' } : tl === 'window' ? { openingKind: 'window' } : tl === 'room' ? { roomType: 'other' } : null, panel: ['wall', 'room', 'door', 'window', 'roof'].includes(tl) ? 'build' : st.panel });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // drop files anywhere: images → import, json → open, models → library
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const drop = async (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      const st = useStore.getState();
      const x = ext(f.name);
      if (IMAGE_EXTS.includes(x) || x === 'pdf') st.set({ importFile: f, startOpen: false });
      else if (MODEL_EXTS.includes(x)) {
        try { const meta = await importModelFile(f, st.project); st.update((p) => { p.customModels.push(meta); }); useStore.setState((s) => ({ modelsVersion: s.modelsVersion + 1, panel: 'library', libraryCategory: 'custom' })); st.toast(`Imported “${meta.name}”`, 'success'); } catch (err) { st.toast((err as Error).message, 'error'); }
      } else if (x === 'json') { try { const j = JSON.parse(await f.text()); if (isProjectJSON(j)) await openProject(j); else st.toast('Not a Homerise project', 'error'); } catch { st.toast('Could not read that file', 'error'); } }
    };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);

  const dragDivider = (e: React.PointerEvent) => {
    const el = wsRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.max(0.2, Math.min(0.8, (ev.clientX - r.left) / r.width)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    e.preventDefault();
  };

  const leftPanel = tool === 'item' || panel === 'library' ? <LibraryPanel /> : panel === 'build' ? <BuildPanel /> : null;

  return (
    <div className="app">
      <TopBar />
      <div className="main" style={{ gridTemplateColumns: `60px ${leftPanel ? 'auto' : '0px'} 1fr auto` }}>
        <Rail />
        <div style={{ display: 'flex', minHeight: 0 }}>{leftPanel}</div>
        <div className="workspace" ref={wsRef}>
          {view !== '3d' && <div className="pane" style={{ flex: view === 'split' ? split : 1 }} data-testid="pane-2d">
            <Plan2D />
            <EmptyHint />
          </div>}
          {view === 'split' && <div className="divider" onPointerDown={dragDivider} />}
          {view !== '2d' && <div className="pane" style={{ flex: view === 'split' ? 1 - split : 1 }} data-testid="pane-3d">
            <Suspense fallback={<div className="view3d-loading">Loading 3D…</div>}><View3D /></Suspense>
            <View3DControls />
          </div>}
          <LevelBar />
        </div>
        <div style={{ display: 'flex', minHeight: 0 }}>
          {aiOpen ? <AIPanel /> : <Properties />}
        </div>
      </div>
      {startOpen && <StartScreen />}
      {exportOpen && <ExportDialog />}
      {settingsOpen && <SettingsDialog />}
      {importFile && <ImportPlanDialog file={importFile} />}
      <Toasts />
    </div>
  );
}
