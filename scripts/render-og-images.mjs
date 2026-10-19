// Prompt 920 addendum (19/10/2026) — regenerates the two Open Graph images the public site declares:
//
//   src/app/opengraph-image.jpg             (+ .alt.txt)   the home, and the default of every page that declares none
//   src/app/investors/opengraph-image.jpg   (+ .alt.txt)   /investors
//
// What LinkedIn, WhatsApp, Slack and an answer engine's link card show when a page is shared. Next serves a static `opengraph-image.jpg` next to a
// route as that route's og:image (and adds og:image:alt from the .alt.txt), so there is no runtime and nothing to build: the card is a file. JPEG at quality 90, not PNG: the flat gradient made the PNG 320 KB, and WhatsApp
// (the most common place a link to a startup gets pasted) drops a preview image much above 300 KB; this one is under 100 KB and indistinguishable.
//
// Why a file and not a generated image (next/og, `opengraph-image.tsx`): the generated one cannot be BUILT on Windows — @vercel/og locates its
// bundled font with path.join(import.meta.url, …), which turns a file:/// URL into a backslash path and throws "Invalid URL" during `next build`
// (confirmed 19/10/2026, Next 14.2.35: "Export encountered errors … /opengraph-image") — and this project's gate is a local `npm run build`. A file also
// carries the brand's own typography (Fraunces for the headline, Inter for the rest, as the landing's hero), which the generated image's one bundled
// sans could not.
//
// The two texts below are the pages' own words (src/content/site/pages.ts OG_HOME, investors.ts OG_INVESTORS); a test (public-page-structure.test.ts)
// fails if they drift from those constants or if the .alt.txt files stop matching them, so a copy change cannot ship with a stale picture.
//
// Run it only when the text or the logo changes (it needs network for the two Google fonts, and the `playwright` dev dependency):
//
//   CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" node scripts/render-og-images.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// `<em>` marks the words the landing's hero would italicise in amber. Plain text (tags stripped) must equal OG_HOME / OG_INVESTORS in the content modules.
const CARDS = [
  {
    dir: 'src/app',
    headlineHtml: 'Find the <em>right investors</em> for your startup, and the <em>right startups</em> for your thesis.',
    sub: 'Matched by sector, stage, ticket size and geography.',
    altPrefix: 'Sherlock Deal — ',
  },
  {
    dir: 'src/app/investors',
    headlineHtml: 'Find the <em>startups that fit</em> your thesis, before anyone sends you a deck.',
    sub: 'Scored against your mandate: sectors, stages, cheque range, geographies and instruments.',
    altPrefix: 'Sherlock Deal for investors — ',
  },
];

// The landing's tokens (src/app/landing.module.css): hero background, --amber #d9a441, lead #b9d2d7, note #8fb0b7; the Lens motif of the hero.
const page = ({ headlineHtml, sub }) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;1,600&family=Inter:wght@400;500;800&display=block" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px;overflow:hidden}
  body{position:relative;font-family:'Inter',sans-serif;color:#fff;
    background:radial-gradient(1000px 520px at 78% -12%, #1d5a67 0%, transparent 62%), linear-gradient(160deg, #0c272e 0%, #123a44 55%, #0e3038 100%)}
  .lens{position:absolute;right:-110px;bottom:-130px;opacity:.12}
  .col{position:absolute;inset:58px 72px 54px 72px;display:flex;flex-direction:column;justify-content:space-between}
  .lockup{display:flex;align-items:center;gap:16px;font-weight:800;font-size:46px;letter-spacing:-.02em;line-height:1}
  .lockup .deal{color:#d9a441}
  h1{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:70px;line-height:1.08;letter-spacing:-.01em;max-width:930px}
  h1 em{font-style:italic;color:#d9a441}
  .sub{margin-top:26px;font-size:30px;line-height:1.35;color:#b9d2d7;max-width:860px}
  .url{font-size:24px;font-weight:500;color:#8fb0b7}
</style></head><body>
<svg class="lens" width="620" height="620" viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="13" stroke="#fff" stroke-width="2"/><line x1="30" y1="30" x2="44" y2="44" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M14 20.5l4 4 8-8" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
<div class="col">
  <div class="lockup">
    <svg width="56" height="56" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#2a7f8e"/><text x="10" y="37" font-family="Georgia,'Times New Roman',serif" font-size="31" font-weight="700" fill="#fff">S</text><circle cx="35.5" cy="15" r="7" fill="none" stroke="#fff" stroke-width="2.9"/><line x1="40.5" y1="20" x2="44.5" y2="24" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>
    <span>sherlock<span class="deal">deal</span></span>
  </div>
  <div><h1>${headlineHtml}</h1><p class="sub">${sub}</p></div>
  <div class="url">sherlockdeal.com</div>
</div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1200, height: 630 } });
for (const card of CARDS) {
  const p = await ctx.newPage();
  await p.setContent(page(card), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const img = await p.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await p.close();
  const plain = card.headlineHtml.replace(/<[^>]+>/g, '');
  writeFileSync(join(ROOT, card.dir, 'opengraph-image.jpg'), img);
  // No trailing newline: Next reads the file as the alt text, byte for byte.
  writeFileSync(join(ROOT, card.dir, 'opengraph-image.alt.txt'), `${card.altPrefix}${plain}`);
  console.log(`${card.dir}/opengraph-image.jpg  ${img.length} bytes  (alt: ${card.altPrefix}${plain})`);
}
await browser.close();
