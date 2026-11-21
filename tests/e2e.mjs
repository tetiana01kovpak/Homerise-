// End-to-end checks of the editor in real Chrome. Run: node tests/e2e.mjs  (dev server must be on :5173)
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL_ = process.env.URL ?? 'http://localhost:5173/';
fs.mkdirSync('tests/shots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`); ok ? pass++ : fail++; };
const state = () => page.evaluate(() => { const s = window.__homerise.getState(); const l = s.project.levels.find((x) => x.id === s.project.activeLevelId); return { walls: l.walls.length, rooms: l.rooms.length, openings: l.openings.length, items: l.items.length, levels: s.project.levels.length, sel: s.selection, past: s.past.length, tool: s.tool }; });
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, String(e.message).split('\n')[0]); } };

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

let cx = 0, cy = 0;
await step('draw room', async () => {
  await page.click('[data-testid=start-blank]');
  await page.waitForTimeout(800);
  const box = await page.locator('[data-testid=plan-svg]').boundingBox();
  cx = box.x + box.width / 2; cy = box.y + box.height / 2;
  await page.click('[data-testid=room-bedroom]');
  await page.mouse.move(cx - 150, cy - 100); await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 6 }); await page.mouse.move(cx + 150, cy + 100, { steps: 6 }); await page.mouse.up();
  const s = await state();
  check('drag creates a room with 4 walls', s.rooms === 1 && s.walls === 4, JSON.stringify(s));
});

await step('adjacent room', async () => {
  await page.click('[data-testid=room-bathroom]');
  await page.mouse.move(cx + 150, cy - 100); await page.mouse.down(); await page.mouse.move(cx + 260, cy + 100, { steps: 8 }); await page.mouse.up();
  const s = await state();
  check('adjacent room reuses the shared wall', s.rooms === 2 && s.walls === 7, JSON.stringify(s));
});

await step('openings', async () => {
  await page.click('[data-testid=opening-door]');
  await page.mouse.move(cx + 150, cy + 5); await page.mouse.click(cx + 150, cy);
  let s = await state();
  check('door placed on wall', s.openings === 1, JSON.stringify(s));
  await page.click('[data-testid=opening-window]');
  await page.mouse.move(cx, cy - 95); await page.mouse.click(cx, cy - 100);
  s = await state();
  check('window placed on exterior wall', s.openings === 2, JSON.stringify(s));
});

await step('furniture', async () => {
  await page.click('[data-testid=tool-item]');
  await page.fill('[data-testid=lib-search]', 'queen');
  await page.click('[data-testid=lib-bed-queen]');
  await page.mouse.move(cx - 60, cy - 60); await page.mouse.click(cx - 60, cy - 70);
  const s = await state();
  check('bed placed from library', s.items === 1 && s.sel?.kind === 'item', JSON.stringify(s));
  const snapped = await page.evaluate(() => { const it = window.__homerise.getState().project.levels[0].items[0]; const r = window.__homerise.getState().project.levels[0].rooms[0].points; return { y: it.y, top: Math.min(...r.map((p) => p.y)), d: it.d }; });
  check('bed snaps against the wall', Math.abs(snapped.y - snapped.d / 2 - snapped.top - 0.08) < 0.05, JSON.stringify(snapped));
});

await step('rotate/undo/redo', async () => {
  await page.keyboard.press('Escape');
  const rot0 = await page.evaluate(() => window.__homerise.getState().project.levels[0].items[0].rotation);
  await page.evaluate(() => { const st = window.__homerise.getState(); st.select({ kind: 'item', id: st.project.levels[0].items[0].id }); });
  await page.keyboard.press('e');
  const rot1 = await page.evaluate(() => window.__homerise.getState().project.levels[0].items[0].rotation);
  check('E rotates selected item 90°', Math.abs(rot1 - rot0 - Math.PI / 2) < 1e-6);
  await page.keyboard.press('Control+z');
  const rot2 = await page.evaluate(() => window.__homerise.getState().project.levels[0].items[0].rotation);
  check('undo restores rotation', Math.abs(rot2 - rot0) < 1e-6);
  await page.keyboard.press('Control+Shift+z');
  const rot3 = await page.evaluate(() => window.__homerise.getState().project.levels[0].items[0].rotation);
  check('redo re-applies rotation', Math.abs(rot3 - rot1) < 1e-6);
});

await step('wall tool', async () => {
  await page.keyboard.press('w');
  await page.mouse.click(cx - 150, cy + 180);
  await page.mouse.move(cx + 100, cy + 180, { steps: 5 });
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const wl = await page.evaluate(() => { const w = window.__homerise.getState().project.levels[0].walls.at(-1); return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y); });
  check('typed wall length is exact (4 m)', Math.abs(wl - 4) < 0.01, wl.toFixed(3));
  await page.screenshot({ path: 'tests/shots/e2e-drawn.png' });
  await page.keyboard.press('v');
  await page.evaluate(() => { const st = window.__homerise.getState(); st.select({ kind: 'wall', id: st.project.levels[0].walls.at(-1).id }); });
  await page.keyboard.press('Delete');
  const s = await state();
  check('delete removes the selected wall', s.walls === 7, JSON.stringify(s));
});

await step('levels', async () => {
  await page.click('[data-testid=levelbar] button[aria-label="Add level"]');
  await page.click('text=Add floor above');
  const s = await state();
  check('add floor above copies exterior walls', s.levels === 2 && s.walls > 0, JSON.stringify(s));
});

await step('exports', async () => {
  await page.evaluate(() => window.__homerise.getState().set({ startOpen: true }));
  await page.click('[data-testid=example-bungalow]');
  await page.waitForTimeout(1500);
  for (const [fmt, minBytes] of [['stl', 200000], ['glb', 100000], ['obj', 100000], ['usdz', 50000], ['ply', 100000]]) {
    await page.click('button:has-text("Export")');
    await page.click(`[data-testid=fmt-${fmt}]`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('[data-testid=export-model]')]);
    const p = await dl.path(); const size = fs.statSync(p).size;
    fs.copyFileSync(p, `tests/shots/export.${fmt}`);
    check(`export ${fmt.toUpperCase()}`, size > minBytes, `${(size / 1024).toFixed(0)} KB`);
    await page.keyboard.press('Escape');
  }
  for (const id of ['export-dxf', 'export-png', 'export-json']) {
    await page.click('button:has-text("Export")');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`[data-testid=${id}]`)]);
    const p = await dl.path(); const size = fs.statSync(p).size;
    fs.copyFileSync(p, `tests/shots/${id}.${id === 'export-png' ? 'png' : id === 'export-dxf' ? 'dxf' : 'json'}`);
    check(`export ${id.slice(7).toUpperCase()}`, size > 2000, `${(size / 1024).toFixed(0)} KB`);
    await page.keyboard.press('Escape');
  }
});

await step('custom models', async () => {
  await page.click('[data-testid=tool-item]');
  await page.setInputFiles('[data-testid=model-upload]', 'tests/shots/export.glb');
  await page.waitForTimeout(2500);
  const cm = await page.evaluate(() => window.__homerise.getState().project.customModels.length);
  check('custom GLB model imported into library', cm === 1);
  await page.setInputFiles('[data-testid=model-upload]', 'tests/shots/export.stl');
  await page.waitForTimeout(2500);
  const cm2 = await page.evaluate(() => window.__homerise.getState().project.customModels);
  check('custom STL model imported (unit autodetect)', cm2.length === 2 && cm2[1].w > 0.1 && cm2[1].w < 0.5 /* 1:100 mm print of an 18.6 m house = 0.186 m */, JSON.stringify(cm2[1]));
  await page.setInputFiles('[data-testid=model-upload]', 'tests/shots/export.obj');
  await page.waitForTimeout(2500);
  const n3 = await page.evaluate(() => window.__homerise.getState().project.customModels.length);
  check('custom OBJ model imported', n3 === 3);
  await page.click(`.lib-item >> nth=0`);
  const box = await page.locator('[data-testid=plan-svg]').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.click(box.x + 100, box.y + 100);
  const placed = await page.evaluate(() => window.__homerise.getState().project.levels.flatMap((l) => l.items).some((i) => i.catalogId.startsWith('custom:')));
  check('custom model placed in the scene', placed);
  await page.waitForTimeout(1500);
});

await step('persistence', async () => {
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'networkidle' });
  const recent = await page.locator('.recent .ex-card').count();
  check('project autosaved and listed after reload', recent >= 1, `${recent} recent`);
  await page.click('.recent .ex-card button >> nth=0');
  await page.waitForTimeout(2500);
  const cm = await page.evaluate(() => window.__homerise.getState().project.customModels.length);
  check('custom models survive reload (IndexedDB)', cm === 3);
});

await step('ai offline', async () => {
  await page.click('[data-testid=ai-toggle]');
  await page.fill('[data-testid=ai-input]', 'Give it a hip roof');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const roofKinds = await page.evaluate(() => window.__homerise.getState().project.levels.flatMap((l) => l.roofs.map((r) => r.kind)));
  check('AI panel (offline) switches roof style', roofKinds.length > 0 && roofKinds.every((k) => k === 'hip'), roofKinds.join(','));
  await page.screenshot({ path: 'tests/shots/e2e-ai.png' });
});

await step('generate from text', async () => {
  await page.evaluate(() => window.__homerise.getState().set({ startOpen: true }));
  await page.fill('[data-testid=start-prompt]', 'Modern 2 storey house with 4 bedrooms, 3 bathrooms, office and a double garage');
  await page.click('[data-testid=start-generate]');
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => { const p = window.__homerise.getState().project; return { levels: p.levels.length, beds: p.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bedroom').length, items: p.levels.reduce((s, l) => s + l.items.length, 0) }; });
  check('text prompt generates a furnished 2-storey home', info.levels === 2 && info.beds === 4 && info.items > 40, JSON.stringify(info));
});

await step('import plan image', async () => {
  await page.evaluate(() => window.__homerise.getState().set({ startOpen: true }));
  await page.setInputFiles('[data-testid=start-file]', 'tests/shots/export-png.png');
  await page.waitForSelector('[data-testid=import-run]');
  await page.click('[data-testid=import-auto]');
  await page.fill('[data-testid=import-width]', '18.6');
  await page.click('[data-testid=import-run]');
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => { const p = window.__homerise.getState().project; const l = p.levels[0]; const xs = l.walls.flatMap((w) => [w.a.x, w.b.x]); return { walls: l.walls.length, rooms: l.rooms.length, openings: l.openings.length, width: Math.max(...xs) - Math.min(...xs), name: p.name }; });
  check('floor-plan PNG converts to a 3D model (offline)', info.rooms >= 8 && info.walls >= 10 && info.openings >= 6 && Math.abs(info.width - 18.6) < 1.5, JSON.stringify(info));
  await page.screenshot({ path: 'tests/shots/e2e-import.png' });
});

check('no uncaught page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
