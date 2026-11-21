// node tests/montage.mjs out.png img1.png img2.png ... — tiles screenshots (cropped to the workspace) into one sheet.
import { chromium } from 'playwright';
import fs from 'node:fs';
const [out, ...imgs] = process.argv.slice(2);
const crop = process.env.CROP ?? '360,56,940,894'; // x,y,w,h of workspace when side panels open
const [cx, cy, cw, ch] = crop.split(',').map(Number);
const cols = +(process.env.COLS ?? 5), W = 520, H = Math.round((W * ch) / cw);
const tiles = imgs.map((f) => `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;display:inline-block;margin:3px;border-radius:6px"><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="position:absolute;left:${-cx * W / cw}px;top:${-cy * W / cw}px;width:${1600 * W / cw}px"><span style="position:absolute;left:6px;top:4px;font:12px sans-serif;background:#fff;padding:1px 5px;border-radius:4px">${f.split(/[\/]/).pop()}</span></div>`).join('');
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: cols * (W + 6) + 10, height: 400 } });
await p.setContent(`<body style="margin:4px;background:#ddd">${tiles}</body>`);
await p.screenshot({ path: out, fullPage: true });
await b.close();
