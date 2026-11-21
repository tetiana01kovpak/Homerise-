// Usage: node tests/shot.mjs <name> [script-file-with-steps.mjs]
// Opens the app in headless Chrome, runs optional steps, saves screenshots to tests/shots/, prints console errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
const name = process.argv[2] ?? 'home';
const stepsFile = process.argv[3];
const url = process.env.URL ?? 'http://localhost:5173/';
fs.mkdirSync('tests/shots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
await page.goto(url, { waitUntil: 'networkidle' });
const shot = async (n) => { await page.screenshot({ path: `tests/shots/${n}.png` }); console.log('shot', n); };
if (stepsFile) { const { pathToFileURL } = await import("node:url"); const path = await import("node:path"); const mod = await import(pathToFileURL(path.resolve(stepsFile)).href); await mod.default({ page, shot }); }
else { await page.waitForTimeout(1500); await shot(name); }
console.log(errors.length ? `ERRORS:\n${[...new Set(errors)].slice(0, 30).join('\n')}` : 'no console errors');
await browser.close();
