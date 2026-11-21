import { useStore, activeLevel } from './store';
import type { Project, Item } from '../model/types';
import { uid } from '../model/types';
import { generateFromText } from '../ai/generator';
import { aiTextToSpec } from '../ai/claude';
import { furnishProject } from '../model/furnish';
import { buildFromSpec } from './build';
import { deleteWall, cloneItem } from '../model/ops';
import { hydrateCustomModels } from '../io/import';

export { buildFromSpec };

export async function openProject(p: Project) {
  const st = useStore.getState();
  st.setProject(p);
  st.set({ startOpen: false, aiOpen: st.aiOpen, selection: null });
  if (p.customModels.length) { await hydrateCustomModels(p); useStore.setState((s) => ({ modelsVersion: s.modelsVersion + 1 })); }
}

/** Generate a home from a description — Claude when a key is set, otherwise the built-in generator. */
export async function generateHome(prompt: string, opts: { forceOffline?: boolean } = {}): Promise<{ project: Project; usedAI: boolean }> {
  const st = useStore.getState();
  if (st.ai.apiKey && !opts.forceOffline) {
    const spec = await aiTextToSpec(st.ai, prompt);
    return { project: buildFromSpec(spec), usedAI: true };
  }
  const spec = generateFromText(prompt);
  return { project: buildFromSpec(spec), usedAI: false };
}

export function deleteSelection() {
  const st = useStore.getState();
  const sel = st.selection; if (!sel) return;
  st.update((p) => {
    const lv = activeLevel(p);
    if (sel.kind === 'wall') deleteWall(lv, sel.id);
    if (sel.kind === 'opening') lv.openings = lv.openings.filter((o) => o.id !== sel.id);
    if (sel.kind === 'item') lv.items = lv.items.filter((o) => o.id !== sel.id);
    if (sel.kind === 'room') lv.rooms = lv.rooms.filter((o) => o.id !== sel.id);
    if (sel.kind === 'roof') lv.roofs = lv.roofs.filter((o) => o.id !== sel.id);
    if (sel.kind === 'label') lv.labels = lv.labels.filter((o) => o.id !== sel.id);
    if (sel.kind === 'dim') lv.dims = lv.dims.filter((o) => o.id !== sel.id);
  });
  st.select(null);
}

export function duplicateSelection() {
  const st = useStore.getState();
  const sel = st.selection; if (!sel || sel.kind !== 'item') return;
  let nid = '';
  st.update((p) => { const lv = activeLevel(p); const it = lv.items.find((i) => i.id === sel.id); if (it) { const c: Item = cloneItem(it); nid = c.id; lv.items.push(c); } });
  if (nid) st.select({ kind: 'item', id: nid });
}

export function rotateSelection(deg: number) {
  const st = useStore.getState();
  const sel = st.selection; if (!sel || sel.kind !== 'item') return;
  st.update((p) => { const it = activeLevel(p).items.find((i) => i.id === sel.id); if (it) it.rotation += (deg * Math.PI) / 180; });
}

export function nudgeSelection(dx: number, dy: number) {
  const st = useStore.getState();
  const sel = st.selection; if (!sel) return;
  st.update((p) => {
    const lv = activeLevel(p);
    if (sel.kind === 'item') { const it = lv.items.find((i) => i.id === sel.id); if (it) { it.x += dx; it.y += dy; } }
    if (sel.kind === 'label') { const l = lv.labels.find((i) => i.id === sel.id); if (l) { l.x += dx; l.y += dy; } }
  });
}

export function furnishAll() {
  const st = useStore.getState();
  st.update((p) => { furnishProject(p, { onlyEmpty: true }); });
}

export const newId = uid;
