import { chromium } from 'playwright';
import fs from 'node:fs';
const dir = 'tests/fixtures/plans';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ deviceScaleFactor: 2 });
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.svg'))) {
  const svg = fs.readFileSync(`${dir}/${f}`, 'utf8');
  const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/);
  await p.setViewportSize({ width: +w, height: +h });
  await p.setContent(`<body style="margin:0">${svg}</body>`);
  await p.screenshot({ path: `${dir}/${f.replace('.svg', '.png')}`, clip: { x: 0, y: 0, width: +w, height: +h } });
}
await b.close();
console.log('ok');
