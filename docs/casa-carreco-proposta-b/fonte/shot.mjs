import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const files = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
for (const f of files) {
  const svg = fs.readFileSync(f, 'utf8');
  const m = svg.match(/viewBox='0 0 (\d+) (\d+)'/);
  await p.setViewportSize({ width: +m[1], height: +m[2] });
  await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await p.screenshot({ path: f.replace('.svg', '.png') });
}
await b.close();
