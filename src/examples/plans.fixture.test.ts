// Writes realistic floor-plan drawings (as exported by Homerise) + ground truth for vision testing.
// Run: npx vitest run src/examples/plans.fixture.test.ts  then  node tests/svg2png.mjs
import { it } from 'vitest';
import fs from 'node:fs';
import { EXAMPLE_PROMPTS } from './prompts';
import { generateFromText } from '../ai/generator';
import { buildFromSpec } from '../state/build';
import { planSVG } from '../io/export';
import { levelBounds, wallLength } from '../model/geometry';

it('write plan fixtures', () => {
  fs.mkdirSync('tests/fixtures/plans', { recursive: true });
  for (const ex of EXAMPLE_PROMPTS) {
    const p = buildFromSpec(generateFromText(ex.prompt));
    p.name = ex.title;
    const lv = p.levels.find((l) => Math.abs(l.elevation) < 0.01)!;
    for (const furniture of [true, false]) {
      const id = `${ex.id}${furniture ? '' : '-clean'}`;
      fs.writeFileSync(`tests/fixtures/plans/${id}.svg`, planSVG(p, lv, { furniture }));
    }
    const b = levelBounds({ ...lv, items: [] })!;
    const ext = lv.walls.filter((w) => w.exterior);
    const xs = ext.flatMap((w) => [w.a.x, w.b.x]);
    const outer = Math.max(...xs) - Math.min(...xs) + 0.3;
    fs.writeFileSync(`tests/fixtures/plans/${ex.id}.json`, JSON.stringify({
      id: ex.id, note: 'meters; SVG drawn at 60 px/m with 1.6 m padding (+70 px title band); PNG rendered at 2x => 120 px/m',
      bounds: b, outerWidth: +outer.toFixed(2),
      walls: lv.walls.filter((w) => w.kind !== 'railing').map((w) => ({ a: w.a, b: w.b, thickness: w.thickness, exterior: !!w.exterior })),
      openings: lv.openings.map((o) => { const w = lv.walls.find((x) => x.id === o.wallId)!; const L = wallLength(w); return { kind: o.kind, width: o.width, at: { x: w.a.x + (w.b.x - w.a.x) * o.t / L, y: w.a.y + (w.b.y - w.a.y) * o.t / L } }; }),
      rooms: lv.rooms.filter((r) => r.type !== 'terrace').map((r) => ({ name: r.name, type: r.type })),
    }, null, 1));
  }
});
