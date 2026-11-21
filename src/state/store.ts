import { create } from 'zustand';
import type { Project, Level } from '../model/types';
import { newProject } from '../model/ops';

export type Tool = 'select' | 'pan' | 'wall' | 'room' | 'door' | 'window' | 'item' | 'measure' | 'label' | 'roof';
export type SelKind = 'wall' | 'opening' | 'room' | 'item' | 'roof' | 'label' | 'dim';
export interface Selection { kind: SelKind; id: string }
export type ViewMode = '2d' | '3d' | 'split';

export interface AISettings { apiKey: string; model: string; effort: 'low' | 'medium' | 'high' }

export interface Toast { id: number; text: string; kind?: 'info' | 'success' | 'error' }

interface State {
  project: Project;
  past: string[];
  future: string[];
  selection: Selection | null;
  hover: Selection | null;
  tool: Tool;
  placing: { catalogId?: string; openingKind?: string; roomType?: string } | null;
  view: ViewMode;
  view3d: { mode: 'orbit' | 'walk'; wallMode: 'full' | 'cut' | 'low'; showRoof: boolean; levels: 'upto' | 'all' | 'only'; showFurniture: boolean; camera: 'persp' | 'top' };
  panel: 'library' | 'build' | null;
  libraryCategory: string;
  aiOpen: boolean;
  exportOpen: boolean;
  settingsOpen: boolean;
  startOpen: boolean;
  checkOpen: boolean;
  /** A plan image/PDF waiting to be imported. */
  importFile: File | null;
  ai: AISettings;
  toasts: Toast[];
  /** Incremented to ask views to fit the camera to the house. */
  fitNonce: number;
  /** Version bump for custom model cache. */
  modelsVersion: number;

  setProject: (p: Project, opts?: { keepHistory?: boolean }) => void;
  update: (fn: (p: Project) => void, opts?: { commit?: boolean }) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection | null) => void;
  setHover: (s: Selection | null) => void;
  setTool: (t: Tool, placing?: State['placing']) => void;
  set: (patch: Partial<State>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
}

const AI_KEY = 'homerise:ai';
const loadAI = (): AISettings => {
  try { const s = JSON.parse(localStorage.getItem(AI_KEY) || '{}'); return { apiKey: s.apiKey ?? '', model: s.model ?? 'claude-opus-5-5', effort: s.effort ?? 'medium' }; } catch { return { apiKey: '', model: 'claude-opus-5-5', effort: 'medium' }; }
};
export const saveAI = (a: AISettings) => { try { localStorage.setItem(AI_KEY, JSON.stringify(a)); } catch { /* ignore */ } };

const clone = (p: Project): Project => JSON.parse(JSON.stringify(p));
let toastId = 1;

export const useStore = create<State>((set, get) => ({
  project: newProject(),
  past: [],
  future: [],
  selection: null,
  hover: null,
  tool: 'select',
  placing: null,
  view: 'split',
  view3d: { mode: 'orbit', wallMode: 'full', showRoof: false, levels: 'upto', showFurniture: true, camera: 'persp' },
  panel: 'build',
  libraryCategory: 'all',
  aiOpen: false,
  exportOpen: false,
  settingsOpen: false,
  startOpen: true,
  checkOpen: false,
  importFile: null,
  ai: typeof localStorage !== 'undefined' ? loadAI() : { apiKey: '', model: 'claude-opus-5-5', effort: 'medium' },
  toasts: [],
  fitNonce: 0,
  modelsVersion: 0,

  setProject: (p, opts) => set((s) => ({ project: p, past: opts?.keepHistory ? [...s.past, JSON.stringify(s.project)].slice(-80) : [], future: [], selection: null, fitNonce: s.fitNonce + 1 })),
  update: (fn, opts) => {
    const s = get();
    const next = clone(s.project);
    fn(next);
    next.updatedAt = Date.now();
    if (opts?.commit === false) set({ project: next });
    else set({ project: next, past: [...s.past, JSON.stringify(s.project)].slice(-80), future: [] });
  },
  checkpoint: () => set((s) => ({ past: [...s.past, JSON.stringify(s.project)].slice(-80), future: [] })),
  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const prev = JSON.parse(s.past[s.past.length - 1]);
    set({ project: prev, past: s.past.slice(0, -1), future: [JSON.stringify(s.project), ...s.future], selection: null });
  },
  redo: () => {
    const s = get();
    if (!s.future.length) return;
    const nxt = JSON.parse(s.future[0]);
    set({ project: nxt, future: s.future.slice(1), past: [...s.past, JSON.stringify(s.project)], selection: null });
  },
  select: (selection) => set({ selection }),
  setHover: (hover) => set({ hover }),
  setTool: (tool, placing = null) => set({ tool, placing, selection: tool === 'select' ? get().selection : null }),
  set: (patch) => set(patch as Partial<State>),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
  },
}));

export const activeLevel = (p: Project): Level => p.levels.find((l) => l.id === p.activeLevelId) ?? p.levels[0];
export const useActiveLevel = () => useStore((s) => activeLevel(s.project));

// ---------- persistence (localStorage) ----------
const INDEX = 'homerise:index';
export interface ProjectMeta { id: string; name: string; updatedAt: number; thumb?: string; area?: number }
export function listProjects(): ProjectMeta[] {
  try { return (JSON.parse(localStorage.getItem(INDEX) || '[]') as ProjectMeta[]).sort((a, b) => b.updatedAt - a.updatedAt); } catch { return []; }
}
export function loadProject(id: string): Project | null {
  try { const s = localStorage.getItem(`homerise:p:${id}`); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function saveProject(p: Project, thumb?: string) {
  try {
    localStorage.setItem(`homerise:p:${p.id}`, JSON.stringify(p));
    const idx = listProjects().filter((m) => m.id !== p.id);
    const prev = listProjects().find((m) => m.id === p.id);
    idx.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, thumb: thumb ?? prev?.thumb });
    localStorage.setItem(INDEX, JSON.stringify(idx));
  } catch (e) { console.warn('save failed', e); }
}
export function deleteProject(id: string) {
  try { localStorage.removeItem(`homerise:p:${id}`); localStorage.setItem(INDEX, JSON.stringify(listProjects().filter((m) => m.id !== id))); } catch { /* ignore */ }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
if (typeof window !== 'undefined') {
  useStore.subscribe((s, prev) => {
    if (s.project === prev.project || s.startOpen) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveProject(useStore.getState().project), 600);
  });
}
