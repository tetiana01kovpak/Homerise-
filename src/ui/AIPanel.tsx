import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, X, Wrench, KeyRound, Loader2, Square } from 'lucide-react';
import type Anthropic from '@anthropic-ai/sdk';
import { useStore } from '../state/store';
import { friendly } from '../ai/claude';
import { runDesigner } from '../ai/designer';
import { generateFromText, parseBrief } from '../ai/generator';
import { buildFromSpec } from '../state/build';
import { furnishProject } from '../model/furnish';
import { rebuildRoofs } from '../ai/tools';

type Msg = { role: 'user' | 'assistant' | 'tool' | 'error'; text: string };

const CHIPS = ['Furnish every room', 'Make it a modern house with a flat roof', 'Add a home office next to the living room', 'Paint the bedrooms a soft sage green', 'Add a pool and terrace in the garden', 'Design a 3-bed cottage with a gable roof'];

/** Offline fallback: understands a handful of common commands without an API key. */
function offlineCommand(text: string): string | null {
  const st = useStore.getState();
  const t = text.toLowerCase();
  if (/furnish/.test(t)) { st.update((p) => { furnishProject(p, { onlyEmpty: !/all|every|re/.test(t) ? true : false, replace: /refurnish|replace/.test(t) }); }); return 'Furnished the rooms.'; }
  const roof = t.match(/\b(flat|gable|hip|hipped|shed)\b.*roof|roof.*\b(flat|gable|hip|hipped|shed)\b/);
  if (roof) { const k = (roof[1] ?? roof[2]).replace('hipped', 'hip') as 'flat'; st.update((p) => rebuildRoofs(p, k)); st.set({ view3d: { ...st.view3d, showRoof: true, levels: 'all' } }); return `Switched to a ${k} roof.`; }
  if (/(design|create|generate|build|make).*(house|home|bungalow|villa|cabin|apartment|flat|cottage)|\d\s*bed/.test(t)) {
    const p = buildFromSpec(generateFromText(text)); p.id = st.project.id; st.setProject(p, { keepHistory: true });
    const b = parseBrief(text); return `Designed a ${b.bedrooms}-bedroom ${b.stories > 1 ? `${b.stories}-storey ` : ''}home with a ${b.roof} roof.`;
  }
  return null;
}

export function AIPanel() {
  const ai = useStore((s) => s.ai);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const stop = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  const push = (m: Msg) => setMsgs((x) => [...x, m]);

  const send = async (raw: string) => {
    const q = raw.trim(); if (!q || busy) return;
    setText(''); push({ role: 'user', text: q });
    const st = useStore.getState();
    if (!ai.apiKey) {
      const r = offlineCommand(q);
      push(r ? { role: 'assistant', text: `${r}\n\nConnect Claude in Settings for full conversational design.` } : { role: 'assistant', text: 'Without a Claude API key I can only do a few things: generate a house from a description, furnish rooms, and change the roof style. Add your key in Settings to unlock the full AI Designer.' });
      return;
    }
    setBusy(true); stop.current = false;
    try {
      st.checkpoint();
      await runDesigner(st.ai, history.current, q, {
        shouldStop: () => stop.current,
        onEvent: (e) => push(e.kind === 'text' ? { role: 'assistant', text: e.text } : { role: 'tool', text: e.summary }),
      });
    } catch (e) {
      // runDesigner already rolled the conversation back to a valid state
      push({ role: 'error', text: friendly(e).message });
    } finally { setBusy(false); }
  };

  return (
    <aside className="ai-panel" data-testid="ai-panel">
      <div className="ai-head">
        <span className="ai-orb"><Sparkles size={16} /></span>
        <div style={{ flex: 1 }}><div className="prop-title">AI Designer</div><div className="prop-sub">{ai.apiKey ? `Claude · ${ai.model.replace('claude-', '').replace(/-/g, ' ')}` : 'Limited offline mode'}</div></div>
        <button className="icon-btn" onClick={() => useStore.getState().set({ aiOpen: false })} aria-label="Close AI panel"><X size={17} /></button>
      </div>
      <div className="ai-msgs">
        {!msgs.length && <div className="ai-empty">
          <span className="ai-orb" style={{ width: 44, height: 44, borderRadius: 14, margin: '0 auto' }}><Sparkles size={20} /></span>
          <h4>What should we change?</h4>
          <p style={{ margin: '0 0 14px' }}>Ask for rooms, layouts, furniture, colors, roofs — or a whole new house.</p>
          {!ai.apiKey && <button className="btn" style={{ marginBottom: 14 }} onClick={() => useStore.getState().set({ settingsOpen: true })}><KeyRound size={14} /> Connect Claude</button>}
          <div className="chip-row" style={{ justifyContent: 'center' }}>{CHIPS.map((c) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div>
        </div>}
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.role === 'tool' && <Wrench size={12} />}{m.text}</div>)}
        {busy && <div className="msg assistant"><span className="typing"><i /><i /><i /></span></div>}
        <div ref={end} />
      </div>
      <div className="ai-input">
        <div className="box">
          <textarea placeholder="Describe a change…" value={text} rows={2} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} data-testid="ai-input" />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {busy ? <button className="btn" onClick={() => { stop.current = true; }}><Square size={12} /> Stop</button>
              : <button className="btn ai" style={{ height: 30 }} onClick={() => send(text)} disabled={!text.trim()} aria-label="Send">{busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}</button>}
          </div>
        </div>
      </div>
    </aside>
  );
}
