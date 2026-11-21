import { useEffect, useMemo, useState } from 'react';
import { Box, FileImage, FileCode2, Printer, FileJson, Loader2, Sparkles, ScanLine, Layers, KeyRound, CheckCircle2, CircleAlert, Wand2 } from 'lucide-react';
import { useStore, activeLevel, saveAI } from '../state/store';
import { Modal, Switch } from './common';
import { exportModel, download, planSVG, svgToPng, printPlans, exportDXF, exportProjectJSON, safeName, snapshot3D, type ModelFormat } from '../io/export';
import { imageData, readAsDataURL, ext, IMAGE_EXTS } from '../io/import';
import { testKey, aiImageToPlan } from '../ai/claude';
import { vectorizePlan } from '../vision/vectorize';
import { vectorToProject, type PlanVector } from '../model/fromPlan';
import { furnishProject } from '../model/furnish';
import { openProject } from '../state/actions';
import { uid } from '../model/types';

// ---------------------------------------------------------------- Export
const FORMATS: { id: ModelFormat; label: string; desc: string }[] = [
  { id: 'stl', label: 'STL', desc: '3D printing' },
  { id: 'glb', label: 'GLB', desc: 'Web, Blender, AR' },
  { id: 'obj', label: 'OBJ', desc: 'Universal mesh' },
  { id: 'usdz', label: 'USDZ', desc: 'Apple AR Quick Look' },
  { id: 'ply', label: 'PLY', desc: 'Point/mesh tools' },
];
const SCALES = [{ v: 1, l: 'Meters (1:1)' }, { v: 1000, l: 'Millimeters (1:1)' }, { v: 10, l: 'Model 1:100 (mm)' }, { v: 20, l: 'Model 1:50 (mm)' }, { v: 39.3701, l: 'Inches (1:1)' }];

export function ExportDialog() {
  const p = useStore((s) => s.project);
  const close = () => useStore.getState().set({ exportOpen: false });
  const [fmt, setFmt] = useState<ModelFormat>('stl');
  const [scale, setScale] = useState(10);
  const [levels, setLevels] = useState<'all' | 'active'>('all');
  const [furniture, setFurniture] = useState(true);
  const [roof, setRoof] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useStore.getState().toast;
  const level = activeLevel(p);
  const base = safeName(p);
  useEffect(() => { setScale(fmt === 'stl' || fmt === 'ply' ? 10 : 1); }, [fmt]);

  const run = async (key: string, fn: () => Promise<void> | void) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast(`Export failed: ${(e as Error).message}`, 'error'); } finally { setBusy(null); }
  };
  const model = () => run('model', async () => {
    const r = await exportModel(p, { format: fmt, scale, levels, furniture, roof, zUp: fmt === 'stl' || fmt === 'ply' });
    download(r.blob, r.filename);
    toast(`Exported ${r.filename} · ${Math.round(r.triangles).toLocaleString()} triangles`, 'success');
  });
  return (
    <Modal title="Export" subtitle="Download your design as a 3D model, a drawing, or a project file." onClose={close} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 22 }}>
        <div>
          <div className="section-title">3D model</div>
          <div className="grid3" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {FORMATS.map((f) => <button key={f.id} className={`tile ${fmt === f.id ? 'on' : ''}`} onClick={() => setFmt(f.id)} data-testid={`fmt-${f.id}`}><b style={{ fontSize: 13, color: 'var(--text)' }}>{f.label}</b>{f.desc}</button>)}
          </div>
          <div className="grid2" style={{ marginTop: 14 }}>
            <label className="field"><span>Units & scale</span><select className="input" value={scale} onChange={(e) => setScale(+e.target.value)}>{SCALES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select></label>
            <label className="field"><span>Levels</span><select className="input" value={levels} onChange={(e) => setLevels(e.target.value as 'all' | 'active')}><option value="all">Whole house</option><option value="active">Only “{level.name}”</option></select></label>
          </div>
          <div style={{ marginTop: 8 }}>
            <Switch label="Include furniture" on={furniture} onChange={setFurniture} />
            <Switch label="Include roof" on={roof} onChange={setRoof} />
          </div>
          <button className="btn accent block lg" style={{ marginTop: 10 }} onClick={model} disabled={!!busy} data-testid="export-model">{busy === 'model' ? <Loader2 size={16} className="spin" /> : <Box size={16} />} Download {fmt.toUpperCase()}</button>
          {(fmt === 'stl' || fmt === 'ply') && <p className="prop-sub" style={{ marginTop: 8 }}>Z-up for slicers. 1:100 turns a 12 m house into a 120 mm print.</p>}
        </div>
        <div>
          <div className="section-title">Drawings & data</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="choice" onClick={() => run('png', async () => download(await svgToPng(planSVG(p, level), 2), `${base}-${safeName({ name: level.name } as never)}.png`))} data-testid="export-png"><span className="ci"><FileImage size={18} /></span><div><b>Floor plan image (PNG)</b><span>High-resolution 2D plan of {level.name}</span></div></button>
            <button className="choice" onClick={() => run('svg', () => download(planSVG(p, level), `${base}.svg`, 'image/svg+xml'))}><span className="ci"><FileCode2 size={18} /></span><div><b>Vector plan (SVG)</b><span>Scalable, editable in Illustrator / Figma</span></div></button>
            <button className="choice" onClick={() => run('pdf', () => { if (!printPlans(p)) toast('Allow pop-ups to print / save as PDF', 'error'); })}><span className="ci"><Printer size={18} /></span><div><b>Print / PDF</b><span>All floors, one page each</span></div></button>
            <button className="choice" onClick={() => run('dxf', () => download(exportDXF(p, level), `${base}.dxf`, 'application/dxf'))} data-testid="export-dxf"><span className="ci"><Layers size={18} /></span><div><b>CAD drawing (DXF)</b><span>Walls, openings, rooms on layers</span></div></button>
            <button className="choice" onClick={() => run('shot', async () => { const b = await snapshot3D(); if (b) download(b, `${base}-3d.png`); else toast('Open the 3D view first', 'error'); })}><span className="ci"><Sparkles size={18} /></span><div><b>3D photo (PNG)</b><span>Current 3D view</span></div></button>
            <button className="choice" onClick={() => run('json', () => download(exportProjectJSON(p), `${base}.homerise.json`, 'application/json'))} data-testid="export-json"><span className="ci"><FileJson size={18} /></span><div><b>Project file</b><span>Re-open later or share</span></div></button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Settings
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — best quality (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — faster' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, lowest cost' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 — most capable' },
];
export function SettingsDialog() {
  const ai = useStore((s) => s.ai);
  const units = useStore((s) => s.project.settings.units);
  const showGround = useStore((s) => s.project.settings.showGround);
  const [key, setKey] = useState(ai.apiKey);
  const [model, setModel] = useState(ai.model);
  const [effort, setEffort] = useState(ai.effort);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => useStore.getState().set({ settingsOpen: false });
  const save = () => { const a = { apiKey: key.trim(), model, effort }; saveAI(a); useStore.getState().set({ ai: a }); close(); useStore.getState().toast(a.apiKey ? 'Claude connected' : 'Settings saved', 'success'); };
  const check = async () => { setBusy(true); setTest(null); try { await testKey({ apiKey: key.trim(), model, effort }); setTest({ ok: true, msg: 'Key works — Claude is ready.' }); } catch (e) { setTest({ ok: false, msg: (e as Error).message }); } finally { setBusy(false); } };
  return (
    <Modal title="Settings" onClose={close} footer={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={save} data-testid="settings-save">Save</button></>}>
      <div className="section-title"><span><KeyRound size={12} style={{ verticalAlign: -1 }} /> Claude API</span></div>
      <label className="field"><span>API key</span><input className="input" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" data-testid="api-key" /></label>
      <p className="prop-sub" style={{ margin: '6px 0 12px' }}>Stored only in this browser and sent only to the Claude API. Get a key at console.anthropic.com.</p>
      <div className="grid2">
        <label className="field"><span>Model</span><select className="input" value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="field"><span>Thinking effort</span><select className="input" value={effort} onChange={(e) => setEffort(e.target.value as typeof effort)}><option value="low">Low — fastest</option><option value="medium">Medium</option><option value="high">High — best results</option></select></label>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={check} disabled={!key.trim() || busy}>{busy ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} Test connection</button>
        {test && <span style={{ fontSize: 12.5, color: test.ok ? 'var(--success)' : 'var(--danger)', display: 'flex', gap: 5, alignItems: 'center' }}>{test.ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}{test.msg}</span>}
      </div>
      <div className="section" style={{ marginTop: 18 }}>
        <div className="section-title">Project</div>
        <div className="toggle-row"><span>Units</span><div className="seg small"><button className={units === 'metric' ? 'on' : ''} onClick={() => useStore.getState().update((p) => { p.settings.units = 'metric'; })}>Metric</button><button className={units === 'imperial' ? 'on' : ''} onClick={() => useStore.getState().update((p) => { p.settings.units = 'imperial'; })}>Imperial</button></div></div>
        <Switch label="Show terrain in 3D" on={showGround} onChange={(v) => useStore.getState().update((p) => { p.settings.showGround = v; })} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Import plan image
export function ImportPlanDialog({ file }: { file: File }) {
  const hasKey = useStore((s) => !!s.ai.apiKey);
  const [url, setUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<'ai' | 'auto' | 'trace'>(hasKey ? 'ai' : 'auto');
  const [width, setWidth] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = () => useStore.getState().set({ importFile: null });
  const isPdf = ext(file.name) === 'pdf';
  useEffect(() => { if (!isPdf) readAsDataURL(file).then(setUrl); }, [file, isPdf]);
  const name = useMemo(() => file.name.replace(/\.[^.]+$/, ''), [file]);

  const run = async () => {
    if (!url) return;
    setErr(null);
    const st = useStore.getState();
    const widthM = parseFloat(width.replace(',', '.'));
    try {
      if (mode === 'trace') {
        const { width: W, height: H } = await imageData(url, 10);
        const mpp = isFinite(widthM) && widthM > 0 ? widthM / W : 12 / W;
        st.update((p) => { p.trace = { ...(p.trace ?? {}), [activeLevel(p).id]: { dataUrl: url, x: 0, y: 0, metersPerPixel: mpp, opacity: 0.45, width: W, height: H } }; });
        st.set({ importFile: null, startOpen: false, tool: 'wall', view: '2d', panel: 'build' });
        useStore.setState((s) => ({ fitNonce: s.fitNonce + 1 }));
        st.toast('Trace over the plan with the wall tool (W). Adjust opacity in the right panel.', 'info');
        return;
      }
      setBusy('Reading the plan…');
      const img = await imageData(url, 1800);
      const det = vectorizePlan({ width: img.data.width, height: img.data.height, data: img.data.data }, isFinite(widthM) && widthM > 0 ? { expectedWidthMeters: widthM } : {});
      let vec: PlanVector;
      if (mode === 'ai') {
        setBusy('Claude is reading your floor plan…');
        const c = document.createElement('canvas'); c.width = img.data.width; c.height = img.data.height; c.getContext('2d')!.putImageData(img.data, 0, 0);
        const b64 = c.toDataURL('image/png').split(',')[1];
        const mpp0 = det.metersPerPixel;
        const r = await aiImageToPlan(st.ai, { base64: b64, mediaType: 'image/png', width: c.width, height: c.height }, { walls: det.walls.map((w) => ({ a: { x: w.a.x / mpp0, y: w.a.y / mpp0 }, b: { x: w.b.x / mpp0, y: w.b.y / mpp0 } })), metersPerPixel: mpp0 });
        let mpp = r.metersPerPixel > 0.001 && r.metersPerPixel < 1 ? r.metersPerPixel : mpp0;
        if (isFinite(widthM) && widthM > 0 && r.walls.length) { const xs = r.walls.flatMap((w) => [w.x1, w.x2]); mpp = widthM / (Math.max(...xs) - Math.min(...xs)); }
        vec = {
          walls: r.walls.map((w) => ({ a: { x: w.x1 * mpp, y: w.y1 * mpp }, b: { x: w.x2 * mpp, y: w.y2 * mpp }, thickness: Math.max(0.1, w.thickness_px * mpp) })),
          openings: r.openings.map((o) => ({ at: { x: o.x * mpp, y: o.y * mpp }, width: o.width_px * mpp, kind: o.kind as never })),
          rooms: r.rooms.map((m) => ({ name: m.name, type: m.type as never, at: { x: m.label_x * mpp, y: m.label_y * mpp } })),
        };
      } else {
        vec = {
          walls: det.walls,
          openings: det.openings.map((o) => { const w = det.walls[o.wallIndex]; const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1; return { at: { x: w.a.x + ((w.b.x - w.a.x) * o.t) / L, y: w.a.y + ((w.b.y - w.a.y) * o.t) / L }, width: o.width, kind: o.kind }; }),
        };
      }
      setBusy('Building your 3D home…');
      const p = vectorToProject(vec, name, { furnish: (pr) => { furnishProject(pr); } });
      if (!p.levels[0].walls.length) throw new Error('No walls were found in this image. Try a clearer plan, or use “Trace manually”.');
      // keep the source image as a tracing reference
      const bb = { minX: Math.min(...vec.walls.flatMap((w) => [w.a.x, w.b.x])), minY: Math.min(...vec.walls.flatMap((w) => [w.a.y, w.b.y])) };
      const mppImg = mode === 'auto' ? det.metersPerPixel : (vec.walls[0] ? det.metersPerPixel : 0.02);
      p.trace = { [p.levels[0].id]: { dataUrl: url, x: -bb.minX, y: -bb.minY, metersPerPixel: mppImg, opacity: 0.0, width: img.data.width, height: img.data.height } };
      p.id = uid('prj');
      await openProject(p);
      st.set({ importFile: null, view: 'split' });
      const rooms = p.levels[0].rooms.length;
      st.toast(`Created ${rooms} room${rooms === 1 ? '' : 's'} from your plan${mode === 'ai' ? ' with Claude' : ''}. Review and tweak anything that looks off.`, 'success');
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <Modal title="Import floor plan" subtitle={file.name} onClose={close} wide footer={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn ai" onClick={run} disabled={!url || !!busy} data-testid="import-run">{busy ? <><Loader2 size={15} className="spin" /> {busy}</> : mode === 'trace' ? 'Start tracing' : <><Wand2 size={15} /> Convert to 3D</>}</button></>}>
      {isPdf ? <p>PDF plans aren’t supported directly yet — export the page as a PNG or JPG and upload that.</p> :
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
          <div style={{ background: '#F4F5F7', borderRadius: 12, display: 'grid', placeItems: 'center', minHeight: 300, overflow: 'hidden', border: '1px solid var(--line)' }}>{url ? <img src={url} alt="Floor plan" style={{ maxWidth: '100%', maxHeight: 420 }} /> : <Loader2 className="spin" />}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className={`choice ${mode === 'ai' ? 'on' : ''}`} onClick={() => setMode('ai')} disabled={!hasKey} style={{ opacity: hasKey ? 1 : 0.55 }}><span className="ci"><Sparkles size={18} /></span><div><b>Convert with Claude</b><span>{hasKey ? 'Reads walls, doors, windows and room names' : 'Add a Claude API key in Settings to enable'}</span></div></button>
            <button className={`choice ${mode === 'auto' ? 'on' : ''}`} onClick={() => setMode('auto')} data-testid="import-auto"><span className="ci"><ScanLine size={18} /></span><div><b>Automatic (offline)</b><span>Detects walls and openings on this device</span></div></button>
            <button className={`choice ${mode === 'trace' ? 'on' : ''}`} onClick={() => setMode('trace')} data-testid="import-trace"><span className="ci"><FileImage size={18} /></span><div><b>Trace manually</b><span>Use the image as a background and draw over it</span></div></button>
            <label className="field" style={{ marginTop: 8 }}><span>Overall width of the plan (optional, meters)</span><input className="input" placeholder="e.g. 12.5 — improves scale accuracy" value={width} onChange={(e) => setWidth(e.target.value)} data-testid="import-width" /></label>
            {busy && <div className="progress" style={{ marginTop: 6 }}><i /></div>}
            {err && <div className="msg error" style={{ maxWidth: '100%' }}>{err}</div>}
          </div>
        </div>}
    </Modal>
  );
}

export { IMAGE_EXTS };
