import { useMemo } from 'react';
import { Trash2, Copy, RotateCw, Square, PenLine, DoorOpen, Sofa, Triangle, Type, Ruler, CheckCircle2, TriangleAlert, CircleAlert, FlipHorizontal2, Sparkles, Home } from 'lucide-react';
import { useStore, activeLevel } from '../state/store';
import { NumberField, Swatches, Section, unitFactor, unitLabel } from './common';
import { absArea, perimeter, wallLength, formatArea, centroid } from '../model/geometry';
import { ROOM_DEFAULTS, OPENING_DEFAULTS, fitOpening, paintRoomWalls, levelArea, totalArea, guessRoomType } from '../model/ops';
import { FLOOR_MATERIALS, WALL_COLORS } from '../view3d/materials';
import { getCatalogItem } from '../catalog';
import { deleteSelection, duplicateSelection, rotateSelection } from '../state/actions';
import { furnishRoom } from '../model/furnish';
import { evaluateProject } from '../examples/evaluate';
import type { RoomType, OpeningKind, RoofKind } from '../model/types';

const floorSwatch = (id: string) => {
  const m = FLOOR_MATERIALS.find((x) => x.id === id)!;
  return `linear-gradient(135deg, ${m.color} 0%, ${m.tone ?? m.color} 100%)`;
};

function Head({ icon: Icon, title, sub }: { icon: typeof Square; title: string; sub?: string }) {
  return <div className="prop-head"><div className="prop-icon"><Icon size={17} /></div><div style={{ minWidth: 0 }}><div className="prop-title">{title}</div>{sub && <div className="prop-sub">{sub}</div>}</div></div>;
}
function Actions({ dup, rotate, extra }: { dup?: boolean; rotate?: boolean; extra?: React.ReactNode }) {
  return <div className="row" style={{ marginTop: 4 }}>
    {rotate && <button className="btn" onClick={() => rotateSelection(90)} title="Rotate 90° (E)"><RotateCw size={14} /> Rotate</button>}
    {dup && <button className="btn" onClick={duplicateSelection} title="Duplicate (Ctrl+D)"><Copy size={14} /></button>}
    {extra}
    <div className="spacer" />
    <button className="btn danger" onClick={deleteSelection} title="Delete (Del)"><Trash2 size={14} /> Delete</button>
  </div>;
}

export function Properties() {
  const sel = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const level = activeLevel(project);
  const units = project.settings.units;
  const U = unitLabel(units), F = unitFactor(units);
  const up = useStore.getState().update;

  let body: React.ReactNode = null;
  if (sel?.kind === 'item') {
    const it = level.items.find((i) => i.id === sel.id);
    if (it) {
      const def = getCatalogItem(it.catalogId);
      const custom = it.catalogId.startsWith('custom:');
      const set = (fn: (x: NonNullable<typeof it>) => void) => up((p) => { const x = activeLevel(p).items.find((i) => i.id === sel.id); if (x) fn(x); });
      body = <>
        <Section><Head icon={Sofa} title={it.name ?? def?.name ?? 'Object'} sub={custom ? 'Custom model' : def?.category} /></Section>
        <Section title="Size">
          <div className="grid3">
            <NumberField label="Width" value={it.w} unit={U} factor={F} min={0.05} onChange={(v) => set((x) => { x.w = v; })} />
            <NumberField label="Depth" value={it.d} unit={U} factor={F} min={0.05} onChange={(v) => set((x) => { x.d = v; })} />
            <NumberField label="Height" value={it.h} unit={U} factor={F} min={0.02} onChange={(v) => set((x) => { x.h = v; })} />
          </div>
          {def && <button className="btn ghost" style={{ marginTop: 8, height: 28, fontSize: 12 }} onClick={() => set((x) => { x.w = def.size.w; x.d = def.size.d; x.h = def.size.h; })}>Reset to default size</button>}
        </Section>
        <Section title="Position">
          <div className="grid3">
            <NumberField label="Rotation" value={(((it.rotation * 180) / Math.PI) % 360 + 360) % 360} unit="°" digits={0} step={15} onChange={(v) => set((x) => { x.rotation = (v * Math.PI) / 180; })} />
            <NumberField label="Elevation" value={it.elevation} unit={U} factor={F} step={0.05} onChange={(v) => set((x) => { x.elevation = v; })} />
          </div>
        </Section>
        {!custom && <Section title="Color"><Swatches value={it.color ?? def?.defaultColor} colors={['#E9E4DA', '#C9C2B6', '#8E959E', '#4A5058', '#23272D', '#B0907A', '#7A5A43', '#A3B5A0', '#6C8CA6', '#2F4A66', '#C9826B', '#D9B85C']} onChange={(c) => set((x) => { x.color = c; })} /></Section>}
        <Section><Actions dup rotate /></Section>
      </>;
    }
  } else if (sel?.kind === 'room') {
    const r = level.rooms.find((x) => x.id === sel.id);
    if (r) {
      const set = (fn: (x: NonNullable<typeof r>) => void) => up((p) => { const x = activeLevel(p).rooms.find((i) => i.id === sel.id); if (x) fn(x); });
      const a = absArea(r.points);
      body = <>
        <Section><Head icon={Square} title={r.name} sub={`${formatArea(a, units)} · perimeter ${(perimeter(r.points) * F).toFixed(1)} ${U}`} /></Section>
        <Section title="Room">
          <label className="field"><span>Name</span><input className="input" value={r.name} onChange={(e) => up((p) => { const x = activeLevel(p).rooms.find((i) => i.id === sel.id); if (x) x.name = e.target.value; }, { commit: false })} onBlur={() => useStore.getState().checkpoint()} data-testid="room-name" /></label>
          <label className="field" style={{ marginTop: 10 }}><span>Type</span>
            <select className="input" value={r.type} onChange={(e) => set((x) => { const t = e.target.value as RoomType; const auto = Object.values(ROOM_DEFAULTS).some((d) => d.label === x.name) || x.name === 'Room'; x.type = t; if (auto) x.name = ROOM_DEFAULTS[t].label; x.floor = ROOM_DEFAULTS[t].floor; })}>
              {(Object.keys(ROOM_DEFAULTS) as RoomType[]).map((t) => <option key={t} value={t}>{ROOM_DEFAULTS[t].label}</option>)}
            </select>
          </label>
        </Section>
        <Section title="Floor">
          <div className="grid3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {FLOOR_MATERIALS.map((m) => <button key={m.id} className={`mat ${r.floor === m.id ? 'on' : ''}`} onClick={() => set((x) => { x.floor = m.id; })} title={m.name}><i style={{ background: floorSwatch(m.id) }} />{m.name.split(' ')[0]}</button>)}
          </div>
        </Section>
        <Section title="Wall paint"><Swatches onChange={(c) => up((p) => { const L = activeLevel(p); const x = L.rooms.find((i) => i.id === sel.id); if (x) paintRoomWalls(L, x, c); })} /></Section>
        <Section><Actions extra={<button className="btn" onClick={() => { up((p) => { const L = activeLevel(p); const x = L.rooms.find((i) => i.id === sel.id); if (x) furnishRoom(L, x, { replace: true }); }); useStore.getState().toast(`Furnished ${r.name}`, 'success'); }}><Sparkles size={14} /> Furnish</button>} /></Section>
      </>;
    }
  } else if (sel?.kind === 'wall') {
    const w = level.walls.find((x) => x.id === sel.id);
    if (w) {
      const set = (fn: (x: NonNullable<typeof w>) => void) => up((p) => { const x = activeLevel(p).walls.find((i) => i.id === sel.id); if (x) fn(x); });
      body = <>
        <Section><Head icon={PenLine} title={w.kind === 'railing' ? 'Railing' : w.exterior ? 'Exterior wall' : 'Interior wall'} sub={`${(wallLength(w) * F).toFixed(2)} ${U} long`} /></Section>
        <Section title="Dimensions">
          <div className="grid3">
            <NumberField label="Length" value={wallLength(w)} unit={U} factor={F} min={0.1} onChange={(v) => set((x) => { const L = wallLength(x); x.b = { x: x.a.x + ((x.b.x - x.a.x) / L) * v, y: x.a.y + ((x.b.y - x.a.y) / L) * v }; })} />
            <NumberField label="Thickness" value={w.thickness} unit={U} factor={F} step={0.01} min={0.03} onChange={(v) => set((x) => { x.thickness = v; })} />
            <NumberField label="Height" value={w.height ?? level.height} unit={U} factor={F} min={0.2} onChange={(v) => set((x) => { x.height = v; })} />
          </div>
        </Section>
        <Section title="Type">
          <div className="seg small">{(['wall', 'railing', 'invisible'] as const).map((k) => <button key={k} className={(w.kind ?? 'wall') === k ? 'on' : ''} onClick={() => set((x) => { x.kind = k; if (k === 'railing') x.height = 1.05; })}>{k === 'invisible' ? 'Room divider' : k[0].toUpperCase() + k.slice(1)}</button>)}</div>
        </Section>
        <Section title="Paint — side A"><Swatches value={w.colorLeft} onChange={(c) => set((x) => { x.colorLeft = c; })} /></Section>
        <Section title="Paint — side B"><Swatches value={w.colorRight} onChange={(c) => set((x) => { x.colorRight = c; })} /></Section>
        <Section><Actions /></Section>
      </>;
    }
  } else if (sel?.kind === 'opening') {
    const o = level.openings.find((x) => x.id === sel.id);
    const w = o && level.walls.find((x) => x.id === o.wallId);
    if (o && w) {
      const set = (fn: (x: NonNullable<typeof o>) => void) => up((p) => { const L = activeLevel(p); const x = L.openings.find((i) => i.id === sel.id); const wl = x && L.walls.find((y) => y.id === x.wallId); if (x && wl) { fn(x); fitOpening(x, wl); } });
      const isWin = o.kind.includes('indow');
      body = <>
        <Section><Head icon={DoorOpen} title={OPENING_DEFAULTS[o.kind].label} sub={`on a ${(wallLength(w) * F).toFixed(2)} ${U} wall`} /></Section>
        <Section title="Type">
          <select className="input" value={o.kind} onChange={(e) => set((x) => { const k = e.target.value as OpeningKind; const d = OPENING_DEFAULTS[k]; x.kind = k; x.width = d.width; x.height = d.height; x.sill = d.sill; })}>
            {(Object.keys(OPENING_DEFAULTS) as OpeningKind[]).map((k) => <option key={k} value={k}>{OPENING_DEFAULTS[k].label}</option>)}
          </select>
        </Section>
        <Section title="Size">
          <div className="grid3">
            <NumberField label="Width" value={o.width} unit={U} factor={F} min={0.3} onChange={(v) => set((x) => { x.width = v; })} />
            <NumberField label="Height" value={o.height} unit={U} factor={F} min={0.3} max={level.height - o.sill} onChange={(v) => set((x) => { x.height = v; })} />
            {isWin && <NumberField label="Sill" value={o.sill} unit={U} factor={F} min={0} max={level.height - 0.3} onChange={(v) => set((x) => { x.sill = v; })} />}
          </div>
          <NumberField label="Distance from wall start" value={o.t - o.width / 2} unit={U} factor={F} min={0} onChange={(v) => set((x) => { x.t = v + x.width / 2; })} />
        </Section>
        {!isWin && <Section><div className="row"><button className="btn" onClick={() => set((x) => { x.flip = !x.flip; })}><FlipHorizontal2 size={14} /> Flip swing</button><button className="btn" onClick={() => set((x) => { x.hinge = x.hinge === 'right' ? 'left' : 'right'; })}>Hinge side</button></div></Section>}
        <Section><Actions /></Section>
      </>;
    }
  } else if (sel?.kind === 'roof') {
    const r = level.roofs.find((x) => x.id === sel.id);
    if (r) {
      const set = (fn: (x: NonNullable<typeof r>) => void) => up((p) => { const x = activeLevel(p).roofs.find((i) => i.id === sel.id); if (x) fn(x); });
      body = <>
        <Section><Head icon={Triangle} title="Roof" sub={`${(r.w * F).toFixed(1)} × ${(r.d * F).toFixed(1)} ${U}`} /></Section>
        <Section title="Shape"><div className="seg small">{(['gable', 'hip', 'shed', 'flat'] as RoofKind[]).map((k) => <button key={k} className={r.kind === k ? 'on' : ''} onClick={() => set((x) => { x.kind = k; if (k === 'flat') x.pitch = 0; else if (!x.pitch) x.pitch = 30; })}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div></Section>
        <Section title="Geometry">
          <div className="grid3">
            <NumberField label="Pitch" value={r.pitch} unit="°" digits={0} step={1} min={0} max={60} onChange={(v) => set((x) => { x.pitch = v; })} />
            <NumberField label="Overhang" value={r.overhang} unit={U} factor={F} min={0} max={2} onChange={(v) => set((x) => { x.overhang = v; })} />
          </div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <NumberField label="Width" value={r.w} unit={U} factor={F} min={1} onChange={(v) => set((x) => { x.w = v; })} />
            <NumberField label="Depth" value={r.d} unit={U} factor={F} min={1} onChange={(v) => set((x) => { x.d = v; })} />
          </div>
          {r.kind !== 'flat' && <div className="row" style={{ marginTop: 8 }}><span className="prop-sub">Ridge</span><div className="seg small"><button className={r.ridge === 'x' ? 'on' : ''} onClick={() => set((x) => { x.ridge = 'x'; })}>Horizontal</button><button className={r.ridge === 'y' ? 'on' : ''} onClick={() => set((x) => { x.ridge = 'y'; })}>Vertical</button></div></div>}
        </Section>
        <Section title="Color"><Swatches value={r.color} colors={['#4A4F57', '#2E3238', '#6B4F3F', '#9C5B44', '#7F8C8D', '#B7A58A', '#3F5B4E', '#5A6E86', '#8A8D91', '#C9C2B6', '#1F2226', '#A0522D']} onChange={(c) => set((x) => { x.color = c; })} /></Section>
        <Section><Actions /></Section>
      </>;
    }
  } else if (sel?.kind === 'label') {
    const l = level.labels.find((x) => x.id === sel.id);
    if (l) body = <>
      <Section><Head icon={Type} title="Text label" /></Section>
      <Section><label className="field"><span>Text</span><input className="input" autoFocus value={l.text} onChange={(e) => up((p) => { const x = activeLevel(p).labels.find((i) => i.id === sel.id); if (x) x.text = e.target.value; }, { commit: false })} onBlur={() => useStore.getState().checkpoint()} /></label>
        <div style={{ marginTop: 10 }}><NumberField label="Size" value={l.size ?? 1} unit="×" digits={1} step={0.1} min={0.5} max={4} onChange={(v) => up((p) => { const x = activeLevel(p).labels.find((i) => i.id === sel.id); if (x) x.size = v; })} /></div></Section>
      <Section><Actions /></Section>
    </>;
  } else if (sel?.kind === 'dim') {
    body = <><Section><Head icon={Ruler} title="Dimension line" /></Section><Section><Actions /></Section></>;
  }

  return (
    <aside className="side right" data-testid="properties">
      <div className="side-body" style={{ paddingTop: 16 }}>{body ?? <Overview />}</div>
    </aside>
  );
}

function Overview() {
  const project = useStore((s) => s.project);
  const level = activeLevel(project);
  const units = project.settings.units;
  const report = useMemo(() => evaluateProject(project), [project]);
  const st = useStore.getState;
  const rooms = [...level.rooms].sort((a, b) => absArea(b.points) - absArea(a.points));
  const bed = project.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bedroom').length;
  const bath = project.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bathroom' || r.type === 'wc').length;
  const errs = report.issues.filter((i) => i.severity === 'error'), warns = report.issues.filter((i) => i.severity === 'warn');
  return <>
    <Section><Head icon={Home} title={level.name} sub={`${project.levels.length} level${project.levels.length > 1 ? 's' : ''} · ${formatArea(totalArea(project), units)} total`} /></Section>
    <Section>
      <div className="stat-grid">
        <div className="stat"><b>{formatArea(levelArea(level), units)}</b><span>This floor</span></div>
        <div className="stat"><b>{level.rooms.length}</b><span>Rooms</span></div>
        <div className="stat"><b>{bed}</b><span>Bedrooms</span></div>
        <div className="stat"><b>{bath}</b><span>Bathrooms</span></div>
      </div>
    </Section>
    {rooms.length > 0 && <Section title="Rooms">
      {rooms.map((r) => <div key={r.id} className="room-row" onClick={() => st().select({ kind: 'room', id: r.id })}><span className="dot" style={{ background: ROOM_DEFAULTS[r.type]?.color }} />{r.name}<span className="ar">{formatArea(absArea(r.points), units)}</span></div>)}
    </Section>}
    {project.levels.some((l) => l.walls.length) && <Section title="Plan check" right={<span style={{ textTransform: 'none', letterSpacing: 0, color: report.score >= 90 ? 'var(--success)' : report.score >= 70 ? '#B7791F' : 'var(--danger)', fontWeight: 600 }}>{report.score}/100</span>}>
      {!report.issues.length && <div className="check-item"><CheckCircle2 size={15} color="var(--success)" /> Every room is reachable, lit and covered.</div>}
      {[...errs, ...warns].slice(0, 8).map((i, k) => <div key={k} className="check-item">{i.severity === 'error' ? <CircleAlert size={15} color="var(--danger)" /> : <TriangleAlert size={15} color="#D69E2E" />}<span>{i.msg}{i.level !== '-' && project.levels.length > 1 ? <span style={{ color: 'var(--text-3)' }}> · {i.level}</span> : null}</span></div>)}
    </Section>}
    <Section title="Exterior">
      <div className="prop-sub" style={{ marginBottom: 8 }}>Facade color</div>
      <Swatches value={project.settings.exteriorWallColor} colors={['#F4F1EA', '#FFFFFF', '#E8DFD0', '#D9CBB4', '#C9B79C', '#B9C3C9', '#8C8F92', '#5B6770', '#2F3A40', '#7B4B3A', '#A3684D', '#E2D3BE']} onChange={(c) => st().update((p) => { p.settings.exteriorWallColor = c; })} />
      <div className="prop-sub" style={{ margin: '12px 0 8px' }}>Interior walls</div>
      <Swatches value={project.settings.interiorWallColor} colors={WALL_COLORS} onChange={(c) => st().update((p) => { p.settings.interiorWallColor = c; })} />
    </Section>
  </>;
}

export { centroid, guessRoomType };
