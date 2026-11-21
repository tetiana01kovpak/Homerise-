import { useMemo, useRef, useState } from 'react';
import { Sparkles, ArrowRight, FileImage, PenLine, FolderOpen, Trash2, Loader2, KeyRound, Upload } from 'lucide-react';
import { useStore, listProjects, loadProject, deleteProject } from '../state/store';
import { EXAMPLE_PROMPTS } from '../examples/prompts';
import { generateFromText } from '../ai/generator';
import { buildFromSpec } from '../state/build';
import { openProject, generateHome } from '../state/actions';
import { planSVG } from '../io/export';
import { houseThumbnail } from './thumbs';
import { newProject } from '../model/ops';
import { isProjectJSON, IMAGE_EXTS, ext } from '../io/import';
import type { Project } from '../model/types';

const SUGGESTIONS = ['3 bedroom bungalow with a garage and patio', 'Modern 2-storey house, 4 beds, home office, flat roof', 'Tiny 1 bedroom cabin, 45 m², steep gable roof', 'Mediterranean villa with pool, 5 bedrooms'];

function planThumb(p: Project) {
  const lv = [...p.levels].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0];
  const svg = planSVG(p, lv, { title: false, dims: false, furniture: true });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function StartScreen() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const hasKey = useStore((s) => !!s.ai.apiKey);
  const canClose = useStore((s) => s.project.levels.some((l) => l.walls.length > 0));
  const recents = listProjects();
  const fileRef = useRef<HTMLInputElement>(null);
  const examples = useMemo(() => EXAMPLE_PROMPTS.map((e) => { const p = buildFromSpec(generateFromText(e.prompt)); p.name = e.title; let thumb: string; try { thumb = houseThumbnail(e.id, p); } catch { thumb = planThumb(p); } return { e, p, thumb }; }), []);

  const go = async (prompt: string) => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    const st = useStore.getState();
    try {
      const { project, usedAI } = await generateHome(prompt);
      await openProject(project);
      st.set({ view: 'split' });
      st.toast(usedAI ? 'Designed with Claude ✨ — ask the AI Designer for changes' : 'Home generated — add a Claude key in Settings for AI-designed layouts', 'success');
    } catch (err) {
      st.toast((err as Error).message, 'error');
      // fall back to the offline generator so the user still gets a result
      try { const { project } = await generateHome(prompt, { forceOffline: true }); await openProject(project); } catch { /* ignore */ }
    } finally { setBusy(false); }
  };

  const openFile = async (f: File) => {
    const st = useStore.getState();
    if (IMAGE_EXTS.includes(ext(f.name)) || ext(f.name) === 'pdf') { st.set({ startOpen: false, importFile: f }); return; }
    try {
      const j = JSON.parse(await f.text());
      if (!isProjectJSON(j)) throw new Error('Not a Homerise project file');
      await openProject(j);
    } catch (e) { st.toast((e as Error).message, 'error'); }
  };

  return (
    <div className="start" data-testid="start-screen">
      <div className="start-inner">
        <div className="start-top">
          <div className="brand" style={{ fontSize: 18 }}><span className="brand-mark"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M5 15.5 16 7l11 8.5V26a1 1 0 0 1-1 1h-6.5v-7h-7v7H6a1 1 0 0 1-1-1z" fill="#fff" /></svg></span>Homerise</div>
          <div className="row">
            {!hasKey && <button className="btn ghost" onClick={() => useStore.getState().set({ settingsOpen: true })}><KeyRound size={15} /> Connect Claude</button>}
            {canClose && <button className="btn" onClick={() => useStore.getState().set({ startOpen: false })}>Back to project <ArrowRight size={15} /></button>}
          </div>
        </div>
        <div className="hero">
          <h1>Design your home in minutes</h1>
          <p>Describe it, upload a floor plan, or start drawing. Homerise builds the walls, rooms, roof, and furniture in 3D.</p>
        </div>
        <div className="prompt-box">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="A bright 3-bedroom family home with an open kitchen, home office and a double garage…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(text); } }} data-testid="start-prompt" autoFocus />
          <div className="bar">
            <span className="hint"><Sparkles size={13} /> {hasKey ? 'Designed by Claude' : 'Built-in generator · connect Claude for AI design'}</span>
            <div className="spacer" />
            <button className="btn ai lg" onClick={() => go(text)} disabled={!text.trim() || busy} data-testid="start-generate">{busy ? <><Loader2 size={16} className="spin" /> Designing…</> : <>Generate home <ArrowRight size={16} /></>}</button>
          </div>
        </div>
        <div className="suggest">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => { setText(s); go(s); }}>{s}</button>)}</div>

        <div className="start-cards">
          <button className="start-card" onClick={() => fileRef.current?.click()} data-testid="start-upload">
            <span className="ci"><FileImage size={19} /></span><b>Upload a floor plan</b><span>Turn a plan image into an editable 3D model, or trace over it.</span>
          </button>
          <button className="start-card" onClick={async () => { await openProject(newProject('My home')); useStore.getState().set({ tool: 'room', panel: 'build', placing: { roomType: 'living' }, view: 'split' }); }} data-testid="start-blank">
            <span className="ci"><PenLine size={19} /></span><b>Start from scratch</b><span>Drag out rooms or draw walls. Everything appears in 3D as you go.</span>
          </button>
          <button className="start-card" onClick={() => fileRef.current?.click()}>
            <span className="ci"><FolderOpen size={19} /></span><b>Open a project</b><span>Open a saved Homerise project (.json).</span>
          </button>
          <input ref={fileRef} type="file" hidden accept=".json,.homerise,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} data-testid="start-file" />
        </div>

        {recents.length > 0 && <>
          <div className="h-sec"><h3>Your projects</h3><span>Saved in this browser</span></div>
          <div className="recent">
            {recents.slice(0, 8).map((m) => {
              const p = loadProject(m.id);
              return <div key={m.id} className="ex-card" style={{ position: 'relative' }}>
                <button style={{ border: 0, background: 'none', padding: 0, width: '100%', textAlign: 'left' }} onClick={() => p && openProject(p)}>
                  <div className="pv">{p && p.levels.some((l) => l.walls.length) ? <img src={planThumb(p)} alt="" /> : <Upload size={18} color="#bbb" />}</div>
                  <div className="meta"><div><b>{m.name}</b><span>{new Date(m.updatedAt).toLocaleDateString()}</span></div></div>
                </button>
                <button className="icon-btn" style={{ position: 'absolute', right: 6, bottom: 8 }} onClick={() => { deleteProject(m.id); force((x) => x + 1); }} aria-label={`Delete ${m.name}`}><Trash2 size={15} /></button>
              </div>;
            })}
          </div>
        </>}

        <div className="h-sec"><h3>Start from an example</h3><span>Fully furnished, ready to customize</span></div>
        <div className="examples">
          {examples.map(({ e, p, thumb }) => (
            <button key={e.id} className="ex-card" onClick={() => openProject(JSON.parse(JSON.stringify({ ...p, id: `prj_${Math.random().toString(36).slice(2, 9)}` })))} data-testid={`example-${e.id}`}>
              <div className="pv"><img src={thumb} alt="" /></div>
              <div className="meta"><b>{e.title}</b><span>{e.prompt.length > 54 ? `${e.prompt.slice(0, 52)}…` : e.prompt}</span></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
