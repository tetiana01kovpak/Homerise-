// Tools the AI Designer (Claude) can call to read and edit the open project.
import type Anthropic from '@anthropic-ai/sdk';
import { useStore, activeLevel } from '../state/store';
import type { Project, Level, RoomType, OpeningKind, RoofKind, Item } from '../model/types';
import { uid } from '../model/types';
import { summarizeProject, decomposeRects, type HouseSpec } from '../model/spec';
import { addRectRoom, addWallMerged, addOpening, sharedEdge, openingOnSegment, OPENING_DEFAULTS, ROOM_DEFAULTS, paintRoomWalls, addLevel, guessRoomType } from '../model/ops';
import { furnishRoom, furnishProject } from '../model/furnish';
import { nearestWall, bounds } from '../model/geometry';
import { CATALOG, getCatalogItem, searchCatalog } from '../catalog';
import { snapToWall } from '../model/place';
import { buildFromSpec } from '../state/build';
import { HOUSE_SPEC_SCHEMA } from './claude';
import { FLOOR_MATERIALS } from '../view3d/materials';
import { evaluateProject } from '../examples/evaluate';

type Tool = Anthropic.Beta.BetaTool;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required });
const num = (description?: string) => ({ type: 'number', description });
const str = (description?: string, e?: readonly string[]) => (e ? { type: 'string', enum: e, description } : { type: 'string', description });

const ROOM_TYPES = Object.keys(ROOM_DEFAULTS);
const OPENINGS = Object.keys(OPENING_DEFAULTS);

export const TOOLS: Tool[] = [
  { name: 'get_plan', description: 'Get the current project: levels, rooms (with id, type, bounding box [minX,minY,maxX,maxY] in meters), items and roofs, plus a quality report. Call this before editing.', input_schema: obj({}) },
  { name: 'search_catalog', description: 'Search the built-in furniture/object library. Returns ids, names and default sizes (w×d×h m).', input_schema: obj({ query: str('e.g. "sofa", "bed king", "tree"'), category: str('optional category id') }) },
  { name: 'create_house', description: 'Replace the whole project with a newly designed house. Use for "design me a…" or large redesigns. Rooms are axis-aligned rectangles in meters; furniture and landscaping are added automatically.', input_schema: HOUSE_SPEC_SCHEMA as unknown as Tool['input_schema'] },
  { name: 'add_room', description: 'Add a rectangular room (creates its walls) on a level.', input_schema: obj({ name: str(), type: str('room type', ROOM_TYPES), x: num('left (m)'), y: num('top (m)'), w: num('width (m)'), d: num('depth (m)'), level_id: str('defaults to the active level') }, ['name', 'type', 'x', 'y', 'w', 'd']) },
  { name: 'update_room', description: 'Rename a room, change its type, floor material or wall paint color.', input_schema: obj({ room_id: str(), name: str(), type: str(undefined, ROOM_TYPES), floor: str('floor material id', FLOOR_MATERIALS.map((m) => m.id)), wall_color: str('hex color for the walls facing this room') }, ['room_id']) },
  { name: 'delete', description: 'Delete an object by id (room, wall, opening, item, roof).', input_schema: obj({ id: str() }, ['id']) },
  { name: 'add_wall', description: 'Add a straight wall between two points (meters).', input_schema: obj({ x1: num(), y1: num(), x2: num(), y2: num(), thickness: num('default 0.15'), level_id: str() }, ['x1', 'y1', 'x2', 'y2']) },
  { name: 'connect_rooms', description: 'Add a door / opening on the wall shared by two rooms.', input_schema: obj({ room_a: str('room id'), room_b: str('room id'), kind: str(undefined, OPENINGS) }, ['room_a', 'room_b']) },
  { name: 'add_opening', description: 'Place a door or window on the wall nearest to a point.', input_schema: obj({ x: num(), y: num(), kind: str(undefined, OPENINGS), width: num(), level_id: str() }, ['x', 'y', 'kind']) },
  { name: 'add_item', description: 'Place a catalog object. If against_wall is true it snaps its back to the nearest wall and faces into the room.', input_schema: obj({ catalog_id: str(), x: num(), y: num(), rotation_deg: num('0 = front faces +y (down in plan)'), against_wall: { type: 'boolean' }, color: str('hex'), w: num(), d: num(), h: num(), level_id: str() }, ['catalog_id', 'x', 'y']) },
  { name: 'update_item', description: 'Move, rotate, resize or recolor an item.', input_schema: obj({ item_id: str(), x: num(), y: num(), rotation_deg: num(), color: str(), w: num(), d: num(), h: num() }, ['item_id']) },
  { name: 'furnish', description: 'Automatically furnish a room (replacing its furniture) or, without room_id, every empty room.', input_schema: obj({ room_id: str() }) },
  { name: 'set_roof', description: 'Rebuild the roofs of the house with a style.', input_schema: obj({ kind: str(undefined, ['gable', 'hip', 'flat', 'shed']), pitch: num('degrees'), color: str('hex') }, ['kind']) },
  { name: 'add_level', description: 'Add a floor above or a basement below.', input_schema: obj({ where: str(undefined, ['above', 'below']) }, ['where']) },
  { name: 'set_colors', description: 'Change facade (exterior wall) and default interior wall colors.', input_schema: obj({ exterior: str('hex'), interior: str('hex') }) },
];

const lvl = (p: Project, id?: string): Level => (id && p.levels.find((l) => l.id === id)) || activeLevel(p);
function findAny(p: Project, id: string) {
  for (const l of p.levels) {
    if (l.rooms.some((x) => x.id === id)) return { l, kind: 'room' as const };
    if (l.walls.some((x) => x.id === id)) return { l, kind: 'wall' as const };
    if (l.openings.some((x) => x.id === id)) return { l, kind: 'opening' as const };
    if (l.items.some((x) => x.id === id)) return { l, kind: 'item' as const };
    if (l.roofs.some((x) => x.id === id)) return { l, kind: 'roof' as const };
  }
  return null;
}

export function rebuildRoofs(p: Project, kind: RoofKind, pitch?: number, color?: string) {
  const sorted = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const rects = (l?: Level) => (l ? l.rooms.filter((r) => r.type !== 'terrace' && r.type !== 'balcony').map((r) => { const b = bounds(r.points); return { name: r.name, x: b.minX, y: b.minY, w: b.w, d: b.h }; }) : []);
  sorted.forEach((l, i) => {
    if (l.elevation < -0.5) return;
    l.roofs = decomposeRects(rects(l), rects(sorted[i + 1])).map((r) => ({ id: uid('roof'), kind, x: r.x, y: r.y, w: r.w, d: r.d, pitch: kind === 'flat' ? 0 : pitch ?? 30, overhang: kind === 'flat' ? 0.15 : 0.45, ridge: r.w >= r.d ? 'x' : 'y', color: color ?? (kind === 'flat' ? '#8A8D91' : '#4A4F57') }));
  });
}

/** Execute a tool call against the store. Returns a JSON-able result. */
export function runTool(name: string, input: Record<string, unknown>): { ok: boolean; result: unknown; summary: string } {
  const st = useStore.getState();
  const I = input as Record<string, never>;
  try {
    switch (name) {
      case 'get_plan': {
        const p = st.project;
        const rep = evaluateProject(p);
        return { ok: true, result: { ...summarizeProject(p), activeLevelId: p.activeLevelId, units: 'meters; x right, y down', quality: { score: rep.score, issues: rep.issues.slice(0, 20) } }, summary: 'Read the plan' };
      }
      case 'search_catalog': {
        const items = (I.query ? searchCatalog(I.query, (I.category as never) ?? 'all') : CATALOG).slice(0, 40).map((c) => ({ id: c.id, name: c.name, category: c.category, size: c.size }));
        return { ok: true, result: items, summary: `Searched library for “${I.query ?? 'all'}”` };
      }
      case 'create_house': {
        const spec = input as unknown as HouseSpec;
        const p = buildFromSpec({ ...spec, furnish: true, landscape: true });
        p.id = st.project.id; p.customModels = st.project.customModels;
        st.setProject(p, { keepHistory: true });
        const rep = evaluateProject(p);
        return { ok: true, result: { levels: p.levels.map((l) => ({ id: l.id, name: l.name, rooms: l.rooms.length })), quality: rep }, summary: `Designed “${spec.name}”` };
      }
      case 'add_room': {
        let id = '';
        st.update((p) => { const l = lvl(p, I.level_id); id = addRectRoom(l, I.x, I.y, I.w, I.d, (ROOM_TYPES.includes(I.type) ? I.type : guessRoomType(I.name)) as RoomType, I.name, p.settings.wallThickness).id; });
        return { ok: true, result: { room_id: id }, summary: `Added ${I.name}` };
      }
      case 'update_room': {
        let found = false;
        st.update((p) => { for (const l of p.levels) { const r = l.rooms.find((x) => x.id === I.room_id); if (!r) continue; found = true; if (I.name) r.name = I.name; if (I.type) r.type = I.type as RoomType; if (I.floor) r.floor = I.floor; if (I.wall_color) paintRoomWalls(l, r, I.wall_color); } });
        return { ok: found, result: found ? 'updated' : 'room not found', summary: 'Updated room' };
      }
      case 'delete': {
        const f = findAny(st.project, I.id);
        if (!f) return { ok: false, result: 'not found', summary: 'Delete failed' };
        st.update((p) => { const l = p.levels.find((x) => x.id === f.l.id)!; const k = ({ room: 'rooms', wall: 'walls', opening: 'openings', item: 'items', roof: 'roofs' } as const)[f.kind]; (l[k] as { id: string }[]) = (l[k] as { id: string }[]).filter((x) => x.id !== I.id); if (f.kind === 'wall') l.openings = l.openings.filter((o) => o.wallId !== I.id); });
        return { ok: true, result: 'deleted', summary: `Removed a ${f.kind}` };
      }
      case 'add_wall': {
        st.update((p) => { addWallMerged(lvl(p, I.level_id), { x: I.x1, y: I.y1 }, { x: I.x2, y: I.y2 }, I.thickness ?? p.settings.wallThickness); });
        return { ok: true, result: 'added', summary: 'Added a wall' };
      }
      case 'connect_rooms': {
        let ok = false;
        st.update((p) => { for (const l of p.levels) { const a = l.rooms.find((r) => r.id === I.room_a), b = l.rooms.find((r) => r.id === I.room_b); if (!a || !b) continue; const e = sharedEdge(a, b); if (e) ok = !!openingOnSegment(l, e.p, e.q, (I.kind ?? 'door') as OpeningKind); } });
        return { ok, result: ok ? 'connected' : 'rooms do not share a wall long enough', summary: 'Connected rooms' };
      }
      case 'add_opening': {
        let ok = false;
        st.update((p) => { const l = lvl(p, I.level_id); const nw = nearestWall({ x: I.x, y: I.y }, l.walls, 0.8); if (nw) ok = !!addOpening(l, nw.wall.id, I.kind as OpeningKind, nw.t, I.width ? { width: I.width } : {}); });
        return { ok, result: ok ? 'placed' : 'no wall nearby or not enough space', summary: `Added ${OPENING_DEFAULTS[I.kind as OpeningKind]?.label ?? 'opening'}` };
      }
      case 'add_item': {
        const def = getCatalogItem(I.catalog_id);
        if (!def) return { ok: false, result: `unknown catalog_id ${I.catalog_id}; use search_catalog`, summary: 'Unknown object' };
        let id = '';
        st.update((p) => {
          const l = lvl(p, I.level_id);
          const it: Item = { id: uid('it'), catalogId: def.id, x: I.x, y: I.y, rotation: ((I.rotation_deg ?? 0) * Math.PI) / 180, elevation: def.elevation ?? 0, w: I.w ?? def.size.w, d: I.d ?? def.size.d, h: I.h ?? def.size.h, color: I.color, name: def.name };
          if (I.against_wall) { const s = snapToWall(l, it, 1.5); if (s) Object.assign(it, { x: s.x, y: s.y, rotation: s.rotation }); }
          l.items.push(it); id = it.id;
        });
        return { ok: true, result: { item_id: id }, summary: `Placed ${def.name}` };
      }
      case 'update_item': {
        let ok = false;
        st.update((p) => { for (const l of p.levels) { const it = l.items.find((x) => x.id === I.item_id); if (!it) continue; ok = true; if (I.x !== undefined) it.x = I.x; if (I.y !== undefined) it.y = I.y; if (I.rotation_deg !== undefined) it.rotation = (I.rotation_deg * Math.PI) / 180; if (I.color) it.color = I.color; if (I.w) it.w = I.w; if (I.d) it.d = I.d; if (I.h) it.h = I.h; } });
        return { ok, result: ok ? 'updated' : 'not found', summary: 'Updated an object' };
      }
      case 'furnish': {
        let n = 0;
        st.update((p) => { if (I.room_id) { for (const l of p.levels) { const r = l.rooms.find((x) => x.id === I.room_id); if (r) n += furnishRoom(l, r, { replace: true }); } } else n = furnishProject(p, { onlyEmpty: true }); });
        return { ok: true, result: { placed: n }, summary: `Placed ${n} objects` };
      }
      case 'set_roof': {
        st.update((p) => rebuildRoofs(p, I.kind as RoofKind, I.pitch, I.color));
        st.set({ view3d: { ...st.view3d, showRoof: true, levels: 'all' } });
        return { ok: true, result: 'roof rebuilt', summary: `Set a ${I.kind} roof` };
      }
      case 'add_level': {
        st.update((p) => { addLevel(p, I.where === 'below' ? 'below' : 'above'); });
        return { ok: true, result: { active_level_id: useStore.getState().project.activeLevelId }, summary: I.where === 'below' ? 'Added a basement' : 'Added a floor' };
      }
      case 'set_colors': {
        st.update((p) => { if (I.exterior) p.settings.exteriorWallColor = I.exterior; if (I.interior) p.settings.interiorWallColor = I.interior; });
        return { ok: true, result: 'updated', summary: 'Changed colors' };
      }
    }
    return { ok: false, result: `unknown tool ${name}`, summary: name };
  } catch (e) {
    return { ok: false, result: String((e as Error).message ?? e), summary: `${name} failed` };
  }
}
