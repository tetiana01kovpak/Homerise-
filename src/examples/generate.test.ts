import { describe, it, expect } from 'vitest';
import { EXAMPLE_PROMPTS } from './prompts';
import { parseBrief, generateFromText } from '../ai/generator';
import { buildFromSpec } from '../state/build';
import { evaluateProject } from './evaluate';

describe('text → house examples', () => {
  const rows: string[] = [];
  for (const ex of EXAMPLE_PROMPTS) {
    it(ex.id, () => {
      const b = parseBrief(ex.prompt);
      const p = buildFromSpec(generateFromText(ex.prompt));
      const rep = evaluateProject(p, { requireFurniture: true });
      const beds = p.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bedroom').length;
      const baths = p.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bathroom').length;
      rows.push(`${ex.id.padEnd(10)} score=${rep.score} beds=${beds} baths=${baths} levels=${p.levels.length} area=${rep.stats.area.toFixed(0)} living=${rep.stats.livingArea.toFixed(0)} doors=${rep.stats.doors} win=${rep.stats.windows} roofs=${rep.stats.roofs}\n   ${rep.issues.map((i) => `${i.severity}:${i.level}:${i.msg}`).join('\n   ')}`);
      expect(beds).toBe(ex.expect.bedrooms);
      expect(baths).toBeGreaterThanOrEqual(ex.expect.bathroomsMin);
      expect(p.levels.length).toBe(ex.expect.levels);
      if (ex.expect.roof) expect(b.roof).toBe(ex.expect.roof);
      if (ex.expect.garage) expect(p.levels.some((l) => l.rooms.some((r) => r.type === 'garage'))).toBe(true);
      expect(rep.stats.livingArea).toBeGreaterThanOrEqual(ex.expect.area[0]); expect(rep.stats.livingArea).toBeLessThanOrEqual(ex.expect.area[1]);
      expect(rep.issues.filter((i) => i.severity === 'error')).toEqual([]);
    });
  }
  it('report', () => { console.log(rows.join('\n')); });
});
