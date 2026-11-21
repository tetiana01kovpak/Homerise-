// Offline, deterministic "describe your home → HouseSpec" generator.
// Works without an API key; Claude produces richer specs when a key is configured.
import type { HouseSpec, SpecRoom, SpecLevel, SpecConnection } from '../model/spec';
import type { RoomType, RoofKind } from '../model/types';

export interface Brief {
  bedrooms: number;
  bathrooms: number;
  halfBath: boolean;
  stories: number;
  basement: boolean;
  garage: 0 | 1 | 2;
  office: boolean;
  laundry: boolean;
  openPlan: boolean;
  terrace: boolean;
  balcony: boolean;
  pool: boolean;
  ensuite: boolean;
  walkIn: boolean;
  gym: boolean;
  apartment: boolean;
  roof: RoofKind;
  style: string;
  targetArea?: number;
  name: string;
}

const WORDS: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, a: 1, an: 1 };
const num = (s?: string) => (s ? (WORDS[s.toLowerCase()] ?? parseFloat(s)) : NaN);

export function parseBrief(text: string): Brief {
  const t = ` ${text.toLowerCase()} `;
  const grab = (re: RegExp) => { const m = t.match(re); return m ? num(m[1]) : NaN; };
  const apartment = /\b(apartment|condo|studio|loft)\b|\bflat\b(?!\s*roof)/.test(t);
  let bedrooms = grab(/\b(\d+|one|two|three|four|five|six|seven|eight|a)[\s-]*(?:bed(?:room)?s?|br)\b/);
  if (/\bstudio\b/.test(t)) bedrooms = 0;
  if (isNaN(bedrooms)) bedrooms = apartment ? 1 : 3;
  let bathrooms = grab(/\b(\d+(?:\.5)?|one|two|three|four|five|a)[\s-]*(?:bath(?:room)?s?|ba)\b/);
  const halfBath = /\.5\s*bath|half[\s-]bath|powder room|guest (?:wc|toilet)/.test(t) || (!isNaN(bathrooms) && bathrooms % 1 !== 0);
  if (isNaN(bathrooms)) bathrooms = Math.max(1, Math.ceil(bedrooms / 2));
  bathrooms = Math.max(1, Math.floor(bathrooms));
  let stories = grab(/\b(\d+|one|two|three|single|double)[\s-]*(?:stor(?:e)?y|stories|storey|floor|level)s?\b/);
  if (/\b(bungalow|ranch|single[\s-]level)\b/.test(t)) stories = 1;
  if (/\btownhouse|duplex\b/.test(t) && isNaN(stories)) stories = 2;
  if (isNaN(stories)) stories = apartment ? 1 : bedrooms >= 4 ? 2 : 1;
  stories = Math.max(1, Math.min(3, Math.round(stories)));
  if (apartment) stories = 1;
  const garageN = grab(/\b(\d+|one|two|double|single|triple)[\s-]*car\b/);
  const garage: 0 | 1 | 2 = /no garage/.test(t) || apartment ? 0 : /garage|carport/.test(t) ? (garageN >= 2 || /double garage/.test(t) ? 2 : 1) : 0;
  let style = 'modern';
  for (const s of ['modern', 'contemporary', 'minimal', 'scandinavian', 'farmhouse', 'cottage', 'traditional', 'mediterranean', 'villa', 'colonial', 'craftsman', 'industrial', 'barn', 'japanese', 'tiny']) if (t.includes(s)) { style = s; break; }
  let roof: RoofKind = 'gable';
  if (/flat roof|modern|contemporary|minimal|industrial/.test(t) || apartment) roof = 'flat';
  if (/hip(ped)? roof|mediterranean|villa|colonial|italian/.test(t)) roof = 'hip';
  if (/gable|pitched|farmhouse|cottage|barn|scandinavian|traditional|craftsman/.test(t)) roof = 'gable';
  if (/shed roof|mono[\s-]?pitch|skillion/.test(t)) roof = 'shed';
  let targetArea: number | undefined;
  const m2 = t.match(/(\d{2,4})\s*(?:m2|m²|sqm|square met)/);
  const ft2 = t.match(/(\d{3,5})\s*(?:sq\.?\s*ft|sqft|square f|ft2|ft²)/);
  if (m2) targetArea = parseFloat(m2[1]);
  else if (ft2) targetArea = parseFloat(ft2[1]) / 10.7639;
  const name = text.trim().length ? capitalize(text.trim().split(/[.,\n]/)[0].slice(0, 48)) : 'New home';
  return {
    bedrooms: Math.max(0, Math.min(8, Math.round(bedrooms))), bathrooms: Math.min(6, bathrooms), halfBath, stories,
    basement: /basement|cellar|lower level/.test(t) && !apartment, garage,
    office: /office|study|workspace|work from home|wfh|den\b/.test(t), laundry: /laundry|utility/.test(t) || bedrooms >= 3,
    openPlan: /open[\s-]?(plan|concept|layout|kitchen)|loft|great room/.test(t) || style === 'modern' || apartment,
    terrace: /terrace|patio|deck|porch|outdoor living/.test(t) || (!apartment && /garden|yard|backyard/.test(t)),
    balcony: /balcony/.test(t), pool: /pool/.test(t) && !apartment,
    ensuite: /ensuite|en-suite|master bath|primary bath|master suite|primary suite/.test(t) || bathrooms >= 2,
    walkIn: /walk[\s-]?in/.test(t), gym: /gym|home theater|cinema|media room|games room|rec room|playroom/.test(t),
    apartment, roof, style, targetArea, name,
  };
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Cell { name: string; type: RoomType; area: number; minW: number; grow?: number }

/** Lay out a row of cells of the given depth across width W (fills W exactly). */
function layRow(cells: Cell[], x0: number, y: number, W: number, depth: number): SpecRoom[] {
  if (!cells.length) return [];
  const widths = cells.map((c) => Math.max(c.minW, c.area / depth));
  const sum = widths.reduce((a, b) => a + b, 0);
  const extra = W - sum;
  if (extra >= 0) {
    const g = cells.map((c) => c.grow ?? 1);
    const gs = g.reduce((a, b) => a + b, 0);
    cells.forEach((_, i) => (widths[i] += (extra * g[i]) / gs));
  } else {
    // shrink proportionally to the slack above min width
    const slack = cells.map((c, i) => widths[i] - c.minW * 0.85);
    const ss = slack.reduce((a, b) => a + b, 0) || 1;
    cells.forEach((_, i) => (widths[i] += (extra * slack[i]) / ss));
  }
  const out: SpecRoom[] = [];
  let x = x0;
  cells.forEach((c, i) => {
    const w = Math.round(widths[i] * 20) / 20;
    const isLast = i === cells.length - 1;
    out.push({ name: c.name, type: c.type, x: r2(x), y: r2(y), w: r2(isLast ? x0 + W - x : w), d: r2(depth) });
    x += w;
  });
  return out;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const rowWidth = (cells: Cell[], depth: number) => cells.reduce((s, c) => s + Math.max(c.minW, c.area / depth), 0);

export function briefToSpec(b: Brief): HouseSpec {
  used.clear();
  const scale = (/villa|mediterranean|luxury|colonial/.test(b.style) ? 1.15 : 1) * (b.bedrooms >= 5 ? 1.08 : 1);
  const bedArea = (i: number) => (i === 0 ? 15 : 11) * scale;
  const levels: SpecLevel[] = [];
  const conns: Record<string, SpecConnection[]> = {};

  // ---------- build the private (bedroom) set
  const privateCells: Cell[] = [];
  const bathCells: Cell[] = [];
  let bathsLeft = b.bathrooms;
  for (let i = 0; i < b.bedrooms; i++) {
    const isMaster = i === 0 && b.bedrooms >= 2;
    privateCells.push({ name: isMaster ? 'Primary Bedroom' : b.bedrooms === 1 ? 'Bedroom' : `Bedroom ${i + 1}`, type: 'bedroom', area: isMaster ? 15 * scale : bedArea(i), minW: isMaster ? 3.4 : 2.9, grow: isMaster ? 2 : 1 });
    if (isMaster && b.ensuite && bathsLeft > 1) {
      privateCells.push({ name: 'Ensuite', type: 'bathroom', area: 5.5, minW: 1.9, grow: 0.2 });
      bathsLeft--;
    }
    if (isMaster && b.walkIn) privateCells.push({ name: 'Walk-in Closet', type: 'closet', area: 4, minW: 1.5, grow: 0.1 });
  }
  for (let i = 0; i < bathsLeft; i++) bathCells.push({ name: bathsLeft > 1 ? `Bathroom ${i + 1}` : 'Bathroom', type: 'bathroom', area: 6, minW: 2.1, grow: 0.3 });
  // interleave baths between bedrooms
  const priv: Cell[] = [];
  let bi = 0;
  privateCells.forEach((c, i) => { priv.push(c); if (c.type === 'bedroom' && i > 0 && bi < bathCells.length && i % 2 === 1) priv.push(bathCells[bi++]); });
  while (bi < bathCells.length) priv.splice(Math.min(priv.length, 1 + bi * 2), 0, bathCells[bi++]);

  // ---------- public set
  const pub: Cell[] = [];
  const livingA = (b.apartment ? 22 : 26 + b.bedrooms * 2) * scale;
  if (b.openPlan && (b.bedrooms <= 2 || b.stories >= 3)) {
    pub.push({ name: 'Living Room', type: 'living', area: livingA - 6, minW: 3.6, grow: 3 });
    pub.push({ name: 'Kitchen & Dining', type: 'kitchen', area: 16, minW: 3.2, grow: 1.5 });
  } else if (b.openPlan) {
    pub.push({ name: 'Living Room', type: 'living', area: livingA, minW: 4, grow: 3 });
    pub.push({ name: 'Dining', type: 'dining', area: 11, minW: 3, grow: 1 });
    pub.push({ name: 'Kitchen', type: 'kitchen', area: 12, minW: 3, grow: 1 });
  } else {
    pub.push({ name: 'Living Room', type: 'living', area: livingA, minW: 4, grow: 3 });
    pub.push({ name: 'Dining Room', type: 'dining', area: 12, minW: 3, grow: 1 });
    pub.push({ name: 'Kitchen', type: 'kitchen', area: 12, minW: 2.8, grow: 1 });
  }
  if (b.bedrooms === 0) { pub.length = 0; pub.push({ name: 'Living & Sleeping', type: 'living', area: 24, minW: 4.2, grow: 3 }, { name: 'Kitchen', type: 'kitchen', area: 9, minW: 2.6, grow: 1 }); }

  const service: Cell[] = [];
  if (b.halfBath || (b.stories > 1)) service.push({ name: 'WC', type: 'wc', area: 2.6, minW: 1.3, grow: 0 });
  if (b.laundry && !b.basement) service.push({ name: 'Laundry', type: 'laundry', area: 4.5, minW: 1.8, grow: 0.2 });
  if (b.office) service.push({ name: 'Office', type: 'office', area: 9.5, minW: 2.7, grow: 0.5 });

  const entry: Cell = { name: 'Entry', type: 'hall', area: 4.8, minW: 2.0, grow: 0.3 };
  const HALL = b.apartment ? 1.2 : 1.3;
  let pubDepth = b.apartment ? 4.6 : b.bedrooms >= 4 ? 5.4 : 5.0;
  let privDepth = b.bedrooms >= 3 ? 3.9 : 3.7;
  const compact = b.bedrooms <= 1 && !b.basement && b.stories === 1;
  if (compact) {
    entry.minW = 1.4; entry.area = 3;
    for (const c of [...priv, ...pub]) c.minW = Math.max(1.7, c.minW - 0.6);
  }
  // Natural total area of the program (+ circulation) unless the user gave one.
  const allCells = [...priv, ...pub, ...service, entry];
  const naturalArea = allCells.reduce((s, c) => s + c.area, 0) * (compact ? 1.08 : 1.22);
  const targetArea = b.targetArea ?? naturalArea;
  /** Choose plan width W for the given rows, shrinking depths when the target is small. */
  const fit = (rows: [Cell[], 'pub' | 'priv'][], floors: number, hall: number) => {
    const natW = Math.max(...rows.map(([r, k]) => rowWidth(r, k === 'pub' ? pubDepth : privDepth)));
    // without an explicit area target, never squeeze rooms below their natural size
    const minW = Math.max(...rows.map(([r]) => r.reduce((s, c) => s + c.minW, 0)), compact ? 5 : 7, b.targetArea ? 0 : natW * 0.97);
    const perFloor = targetArea / floors;
    let W = perFloor / (pubDepth + privDepth + hall);
    if (W < minW) {
      const f = Math.max(compact ? 0.6 : 0.74, Math.min(1, (perFloor / minW - hall) / (pubDepth + privDepth)));
      pubDepth = Math.max(compact ? 3.2 : 3.6, pubDepth * f); privDepth = Math.max(compact ? 2.8 : 3.2, privDepth * f);
      W = minW;
    }
    W = Math.min(W, Math.max(natW * 1.5, minW));
    return Math.round(Math.max(minW, W) * 10) / 10;
  };

  const stairCell: Cell = { name: 'Stairs', type: 'hall', area: 4.0 * 1.25, minW: 1.25, grow: 0 };
  const twoStory = b.stories >= 2;
  const needStairs = twoStory || b.basement;
  let stairs: HouseSpec['stairs'];

  if (!twoStory) {
    // rows: [public (garden side, top)] [hall] [front: entry + private + service]
    const front: Cell[] = [entry];
    if (needStairs) front.push(stairCell);
    front.push(...priv, ...service.filter((s) => s.type !== 'office'));
    const back = [...pub];
    if (b.office) back.push(service.find((s) => s.type === 'office')!);
    // balance widths: move cells from the long row to the short one
    let W = Math.max(rowWidth(front, privDepth), rowWidth(back, pubDepth));
    for (let guard = 0; guard < 6; guard++) {
      const fw = rowWidth(front, privDepth), bw = rowWidth(back, pubDepth);
      if (fw > bw * 1.35 && front.length > 3) {
        const idx = front.findIndex((c, i) => i > 1 && c.type === 'bedroom' && c.name !== 'Primary Bedroom');
        if (idx < 0) break;
        const [moved] = front.splice(idx, 1); back.push(moved);
        // keep a bathroom next to moved bedroom if possible
        const bIdx = front.findIndex((c) => c.type === 'bathroom' && c.name !== 'Ensuite');
        if (bIdx >= 0 && bw + moved.area / pubDepth < fw - moved.area / privDepth) back.push(front.splice(bIdx, 1)[0]);
      } else break;
      W = Math.max(rowWidth(front, privDepth), rowWidth(back, pubDepth));
    }
    const hall = compact ? 0 : HALL;
    W = fit([[front, 'priv'], [back, 'pub']], 1, hall);
    const rooms: SpecRoom[] = [];
    if (!compact) fillRow(front, privDepth, W, false);
    rooms.push(...layRow(back, 0, 0, W, pubDepth));
    if (!compact) rooms.push({ name: 'Hallway', type: 'hall', x: 0, y: pubDepth, w: W, d: HALL });
    const frontRooms = layRow(front, 0, pubDepth + hall, W, privDepth);
    rooms.push(...frontRooms);
    const c: SpecConnection[] = [];
    if (b.ensuite) c.push({ a: 'Ensuite', b: 'Primary Bedroom' });
    if (b.walkIn) c.push({ a: 'Walk-in Closet', b: 'Primary Bedroom', kind: 'opening' });
    if (!compact) c.push({ a: 'Entry', b: 'Hallway', kind: 'opening' });
    if (compact) c.push({ a: 'Entry', b: pub[0].name, kind: 'opening' });
    if (garageFits(b)) addGarage(rooms, W, pubDepth + hall, privDepth, b);
    if (b.terrace) addTerrace(rooms, back, W);
    const st = rooms.find((r) => r.name === 'Stairs');
    if (st) stairs = { x: st.x + 0.08, y: st.y + 0.1, w: st.w - 0.16, d: st.d - 0.2, dir: 'down' };
    levels.push({ name: 'Ground floor', rooms, connections: c });
    conns.ground = c;
    if (b.basement) levels.unshift(basementLevel(W, pubDepth, HALL, privDepth, st!, b));
  } else {
    // two (or three) stories: ground = public + service; upper = private
    const groundBack = [...pub];
    const groundFront: Cell[] = [entry, stairCell, ...service];
    const upperFront: Cell[] = [{ ...stairCell, name: 'Landing', area: stairCell.area }];
    const upperBack: Cell[] = [];
    // split private set between front/back of upper floor
    priv.forEach((c, i) => (i % 2 === 0 ? upperBack : upperFront).push(c));
    // ensure ensuite next to primary
    const ensIdx = upperFront.findIndex((c) => c.name === 'Ensuite');
    if (ensIdx >= 0) { const [e] = upperFront.splice(ensIdx, 1); const pIdx = upperBack.findIndex((c) => c.name === 'Primary Bedroom'); upperBack.splice(pIdx + 1, 0, e); }
    const wcl = upperFront.findIndex((c) => c.name === 'Walk-in Closet');
    if (wcl >= 0) { const [e] = upperFront.splice(wcl, 1); const pIdx = upperBack.findIndex((c) => c.name === 'Primary Bedroom'); upperBack.splice(pIdx + 1, 0, e); }
    if (b.laundry && upperFront.length < 4 && !b.basement) {
      const li = groundFront.findIndex((c) => c.type === 'laundry');
      if (li >= 0) upperFront.push(groundFront.splice(li, 1)[0]);
    }
    // third floor: move a bedroom (+ a bathroom) up from the first floor
    const topCells: Cell[] = [];
    if (b.stories >= 3) {
      const take = (arr: Cell[], type: RoomType) => { const i = arr.findIndex((c) => c.type === type && c.name !== 'Primary Bedroom' && c.name !== 'Ensuite'); return i >= 0 ? arr.splice(i, 1)[0] : null; };
      const bed = take(upperFront, 'bedroom') ?? take(upperBack, 'bedroom');
      const bath = take(upperFront, 'bathroom') ?? take(upperBack, 'bathroom');
      if (bed) topCells.push(bed); if (bath) topCells.push(bath);
      if (!topCells.length) topCells.push({ name: 'Studio', type: 'office', area: 11, minW: 3, grow: 2 });
    }
    // balance rows: bring bedrooms down to an under-used ground floor, add a family room if the public side is short
    for (let guard = 0; guard < 4; guard++) {
      const widest = Math.max(rowWidth(upperBack, pubDepth), rowWidth(upperFront, privDepth));
      if (widest - rowWidth(groundFront, privDepth) < 3.4) break;
      const src = rowWidth(upperFront, privDepth) >= rowWidth(upperBack, pubDepth) ? upperFront : upperBack;
      const bi = src.findIndex((c) => c.type === 'bedroom' && c.name !== 'Primary Bedroom');
      if (bi < 0 || priv.filter((c) => c.type === 'bedroom').length < 4) break;
      const [bed] = src.splice(bi, 1); bed.name = groundFront.some((c) => c.name === 'Guest Bedroom') ? bed.name : 'Guest Bedroom';
      groundFront.push(bed);
      const bathIdx = src.findIndex((c) => c.type === 'bathroom' && c.name !== 'Ensuite');
      if (bathIdx >= 0 && !groundFront.some((c) => c.type === 'bathroom') && widest - rowWidth(groundFront, privDepth) > 2.2) groundFront.push(src.splice(bathIdx, 1)[0]);
    }
    {
      const widest = Math.max(rowWidth(upperBack, pubDepth), rowWidth(upperFront, privDepth), rowWidth(groundFront, privDepth));
      if (widest - rowWidth(groundBack, pubDepth) > 5) groundBack.push({ name: 'Family Room', type: 'living', area: 16, minW: 3.2, grow: 1 });
      if (widest - rowWidth(groundFront, privDepth) > 4 && !groundFront.some((c) => c.type === 'office')) groundFront.push({ name: 'Study', type: 'office', area: 9, minW: 2.6, grow: 1 });
    }
    const W = fit([[groundBack, 'pub'], [groundFront, 'priv'], [upperBack, 'pub'], [upperFront, 'priv']], b.stories, HALL);
    privDepth = Math.max(privDepth, 4.1); // stairs need ~4 m run
    fillRow(groundFront, privDepth, W, false); fillRow(upperFront, privDepth, W, true); fillRow(upperBack, pubDepth, W, true);
    const g: SpecRoom[] = [...layRow(groundBack, 0, 0, W, pubDepth), { name: 'Hallway', type: 'hall', x: 0, y: pubDepth, w: W, d: HALL }, ...layRow(groundFront, 0, pubDepth + HALL, W, privDepth)];
    if (garageFits(b)) addGarage(g, W, pubDepth + HALL, privDepth, b);
    if (b.terrace) addTerrace(g, groundBack, W);
    const u: SpecRoom[] = [...layRow(upperBack, 0, 0, W, pubDepth), { name: 'Upper Hall', type: 'hall', x: 0, y: pubDepth, w: W, d: HALL }, ...layRow(upperFront, 0, pubDepth + HALL, W, privDepth)];
    // align landing with stairs
    const st = g.find((r) => r.name === 'Stairs')!;
    alignCell(u, 'Landing', st);
    if (b.balcony) {
      const pr = u.find((r) => r.name === 'Primary Bedroom');
      if (pr) u.push({ name: 'Balcony', type: 'balcony', x: pr.x + 0.3, y: -1.6, w: Math.min(pr.w - 0.6, 3.6), d: 1.6 });
    }
    stairs = { x: st.x + 0.08, y: st.y + 0.1, w: st.w - 0.16, d: st.d - 0.2, dir: 'down' };
    const gc: SpecConnection[] = [{ a: 'Entry', b: 'Hallway', kind: 'opening' }, { a: 'Stairs', b: 'Hallway', kind: 'opening' }];
    const uc: SpecConnection[] = [{ a: 'Landing', b: 'Upper Hall', kind: 'opening' }];
    if (b.ensuite) uc.push({ a: 'Ensuite', b: 'Primary Bedroom' });
    if (b.walkIn) uc.push({ a: 'Walk-in Closet', b: 'Primary Bedroom', kind: 'opening' });
    if (b.balcony) uc.push({ a: 'Primary Bedroom', b: 'Balcony', kind: 'slidingDoor' });
    if (b.basement) levels.push(basementLevel(W, pubDepth, HALL, privDepth, st, b));
    levels.push({ name: 'Ground floor', rooms: g, connections: gc });
    levels.push({ name: 'First floor', rooms: u, connections: uc });
    if (b.stories >= 3) {
      const t: SpecRoom[] = [
        { name: 'Attic Lounge', type: 'living', x: 0, y: 0, w: W, d: pubDepth },
        { name: 'Top Hall', type: 'hall', x: 0, y: pubDepth, w: W, d: HALL },
        ...layRow([{ ...stairCell, name: 'Top Landing' }, ...topCells], 0, pubDepth + HALL, W, privDepth),
      ];
      alignCell(t, 'Top Landing', st);
      levels.push({ name: 'Second floor', rooms: t, connections: [{ a: 'Top Landing', b: 'Top Hall', kind: 'opening' }] });
    }
  }
  if (b.apartment) for (const l of levels) for (const r of l.rooms) if (r.name === 'Entry') r.name = 'Entry';

  return {
    name: b.name,
    levels,
    roof: b.apartment ? { kind: 'flat' } : { kind: b.roof, pitch: b.roof === 'shed' ? 12 : b.style === 'barn' || b.style === 'scandinavian' ? 40 : 30 },
    stairs: needStairs ? stairs : undefined,
    front: 'bottom',
    exteriorColor: b.style === 'scandinavian' ? '#2F3A40' : b.style === 'farmhouse' ? '#F7F5EF' : b.style === 'mediterranean' || b.style === 'villa' ? '#EFE2CC' : b.style === 'industrial' ? '#8C8F92' : '#F4F1EA',
    furnish: true,
    landscape: !b.apartment,
    style: b.style,
    features: b.pool ? ['pool'] : [],
  };
}

function garageFits(b: Brief) { return b.garage > 0; }

/** Absorb spare width in a row with a sensible extra room instead of inflating existing ones. */
const used = new Set<string>();
function fillRow(cells: Cell[], depth: number, W: number, upper: boolean) {
  const slack = W - rowWidth(cells, depth);
  if (slack > 3.4) cells.push(upper && !cells.some((c) => c.name === 'Family Lounge') && !used.has('lounge') ? (used.add('lounge'), { name: 'Family Lounge', type: 'living' as RoomType, area: (slack - 0.3) * depth, minW: 3, grow: 1 }) : { name: cells.some((c) => c.type === 'office') ? 'Playroom' : 'Study', type: 'office', area: (slack - 0.3) * depth, minW: 2.6, grow: 1 });
  else if (slack > 1.9) cells.push({ name: 'Storage', type: 'storage', area: (slack - 0.2) * depth, minW: 1.4, grow: 0.6 });
}

function addGarage(rooms: SpecRoom[], W: number, y0: number, depth: number, b: Brief) {
  const gw = b.garage === 2 ? 6.2 : 3.6;
  const gd = Math.max(6, depth + 1.3);
  rooms.push({ name: 'Garage', type: 'garage', x: W, y: y0 + depth - gd, w: gw, d: gd });
}

function addTerrace(rooms: SpecRoom[], back: Cell[], W: number) {
  const living = rooms.find((r) => r.type === 'living');
  const x = living ? living.x : 0;
  const w = living ? Math.min(W - x, Math.max(living.w, 5)) : W;
  rooms.push({ name: 'Terrace', type: 'terrace', x, y: -3.2, w, d: 3.2 });
  void back;
}

function alignCell(rooms: SpecRoom[], name: string, target: SpecRoom) {
  const c = rooms.find((r) => r.name === name);
  if (!c) return;
  // shift the landing to the stair x-range by swapping widths with its neighbours in the row
  const row = rooms.filter((r) => Math.abs(r.y - c.y) < 0.01).sort((a, b) => a.x - b.x);
  const others = row.filter((r) => r !== c);
  const total = row.reduce((s, r) => s + r.w, 0);
  const x0 = row[0].x;
  c.x = target.x; c.w = target.w;
  const left = others.filter((r) => r.x < target.x || r === others[0] && target.x > x0 + 0.5);
  void left;
  // re-flow others to fill [x0, target.x] and [target.x+w, x0+total]
  const leftSpan = target.x - x0, rightSpan = x0 + total - (target.x + target.w);
  const otherW = others.reduce((s, r) => s + r.w, 0);
  let leftCells: SpecRoom[] = [], rightCells: SpecRoom[] = [];
  void otherW;
  // greedily give the left span the cells that fit it best (by minimum width), the rest go right
  const minOf = (r: SpecRoom) => (r.type === 'bedroom' ? 2.8 : r.type === 'office' || r.type === 'living' ? 2.6 : r.type === 'bathroom' ? 1.9 : r.type === 'laundry' ? 1.8 : 1.3);
  let room = leftSpan;
  const pool = [...others];
  if (leftSpan >= 1.3) {
    for (;;) {
      const fits = pool.filter((r) => minOf(r) <= room + 1e-6).sort((a, b) => Math.abs(room - a.w) - Math.abs(room - b.w));
      if (!fits.length || room < 1.3) break;
      const pick = fits[0]; leftCells.push(pick); pool.splice(pool.indexOf(pick), 1); room -= Math.max(minOf(pick), Math.min(pick.w, room));
      if (room < 1.3) break;
    }
  }
  rightCells = pool;
  if (!rightCells.length && leftCells.length > 1 && rightSpan > 1.3) rightCells.push(leftCells.pop()!);
  const flow = (cells: SpecRoom[], start: number, span: number) => {
    // drop filler storage rooms if the real rooms would get too narrow
    while (cells.reduce((a, r) => a + minOf(r), 0) > span && cells.some((r) => r.type === 'storage' || r.name === 'Family Lounge')) {
      const k = cells.findIndex((r) => r.type === 'storage' || r.name === 'Family Lounge');
      rooms.splice(rooms.indexOf(cells[k]), 1); cells.splice(k, 1);
    }
    // keep real rooms at their size; filler rooms (lounges, storage) absorb the difference first
    const ws = cells.map((r) => r.w);
    let diff = span - ws.reduce((a, b) => a + b, 0);
    const isFill = (r: SpecRoom) => r.type === 'storage' || /lounge|study|playroom/i.test(r.name);
    for (const pass of [true, false]) {
      const idx = cells.map((r, i) => i).filter((i) => isFill(cells[i]) === pass);
      if (!idx.length || Math.abs(diff) < 0.01) continue;
      const tot = idx.reduce((a, i) => a + ws[i], 0) || 1;
      let used = 0;
      for (const i of idx) { const d = (diff * ws[i]) / tot; const nw = Math.max(pass ? minOf(cells[i]) : minOf(cells[i]) * 0.9, ws[i] + d); used += nw - ws[i]; ws[i] = nw; }
      diff -= used;
    }
    let x = start;
    cells.forEach((r, i) => { const w = i === cells.length - 1 ? start + span - x : r2(ws[i]); r.x = r2(x); r.w = r2(w); x += w; });
  };
  if (leftCells.length) flow(leftCells, x0, leftSpan); else if (leftSpan > 0.3) { /* extend landing */ c.x = x0; c.w = target.x + target.w - x0; }
  if (rightCells.length) flow(rightCells, target.x + target.w, rightSpan); else if (rightSpan > 0.3) c.w = x0 + total - c.x;
}

function basementLevel(W: number, pubDepth: number, hall: number, privDepth: number, st: SpecRoom, b: Brief): SpecLevel {
  const back: Cell[] = [{ name: b.gym ? 'Media & Gym' : 'Recreation Room', type: 'basement', area: 30, minW: 4, grow: 3 }, { name: 'Storage', type: 'storage', area: 8, minW: 2.2, grow: 1 }];
  const front: Cell[] = [{ name: 'Basement Stairs', type: 'hall', area: 5, minW: 1.25, grow: 0 }, { name: 'Utility', type: 'utility', area: 7, minW: 2.4, grow: 1 }, { name: 'Laundry', type: 'laundry', area: 7, minW: 2.4, grow: 1 }, { name: 'Basement Bath', type: 'bathroom', area: 5, minW: 2, grow: 0.5 }];
  const rooms = [...layRow(back, 0, 0, W, pubDepth), { name: 'Lower Hall', type: 'hall' as RoomType, x: 0, y: pubDepth, w: W, d: hall }, ...layRow(front, 0, pubDepth + hall, W, privDepth)];
  alignCell(rooms, 'Basement Stairs', st);
  return { name: 'Basement', height: 2.5, rooms, connections: [{ a: 'Basement Stairs', b: 'Lower Hall', kind: 'opening' }] };
}

export function generateFromText(text: string): HouseSpec {
  return briefToSpec(parseBrief(text));
}
