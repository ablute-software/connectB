// node render.mjs [cam1,cam2] [w] [h] [ao]  — renders sem ecrã (Chromium + swiftshader)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.dirname(new URL(import.meta.url).pathname);
const nm = path.resolve(root, '../../../node_modules');   // three@0.169 instalado na raiz do repositório (ignorado pelo git)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const p = url.startsWith('/node_modules/') ? path.join(nm, url.slice('/node_modules/'.length)) : path.join(root, url);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const port = srv.address().port;
const cams = (process.argv[2] || 'aerial').split(',');
const W = +process.argv[3] || 1600, H = +process.argv[4] || 1000, ao = process.argv[5] || '1';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
for (const c of cams) {
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/render.html?cam=${c}&w=${W}&h=${H}&ao=${ao}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 900000 });
  const el = await page.$('canvas'); await el.screenshot({ path: path.join(root, 'out', `render_${c}.png`) });
  console.log(c, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
await browser.close(); srv.close();
