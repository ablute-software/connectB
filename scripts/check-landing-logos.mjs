// Prompt 926 (30/10/2026) — what `npm run build` says about the strip of logos on the landing pages.
// (No "#!" line, unlike the other scripts: landing-logos.test.ts imports this file, and Vite only strips a hashbang that is followed by a bare LF, so on a Windows checkout
// with CRLF line endings the import dies with "SyntaxError: Invalid or unexpected token". It is always started as `node scripts/check-landing-logos.mjs`.)
//
// A company's logo on the public landing says, in public, that it uses Sherlock Deal, so the strip draws a logo only when the company's authorization is
// recorded in src/content/site/landing-logos.json (a date and a form), and only when a page has at least six such logos. The page enforces that on its own
// (src/lib/landing-logos.ts, which fails closed); THIS script is how the build tells a person what was left out and why, so a logo that is missing from the
// page is never a mystery:
//
//   WARNING (exit 0)  a logo without a complete authorization record: it is not shown. A file in the folder that the file does not list. How many logos each page has.
//   ERROR   (exit 1)  a row the page cannot trust (a name, a file name, a size or a page it does not understand; the same file twice), or a row with an authorization
//                     whose image is not in the folder: that would put a broken image on the public page, which is worse than failing a build.
//
// It states the same two rules as src/lib/landing-logos.ts in plain JavaScript (the build runs on whatever Node Vercel gives it, with no TypeScript loader);
// landing-logos.test.ts runs both through the same cases, as render-og-images.mjs and its content module are pinned together.
//
//   node scripts/check-landing-logos.mjs
//   node scripts/check-landing-logos.mjs --config <file.json> --folder <dir>      (the tests)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LOGO_STRIP_MIN = 6;
export const PAGES = ['startups', 'investors', 'both'];
export const FORMS = ['email', 'terms', 'owner'];
export const FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.(svg|png|webp)$/i;

export function isRealIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Why an authorization does not count, or null when it does (same words as src/lib/landing-logos.ts). */
export function authorizationProblem(a, today = new Date()) {
  if (a === 'pending') return 'authorization pending';
  if (typeof a !== 'object' || a === null) return 'no authorization recorded';
  if (!isRealIsoDate(a.date)) return 'authorization date missing or not a real yyyy-mm-dd date';
  if (a.date > today.toISOString().slice(0, 10)) return 'authorization date is in the future';
  if (!FORMS.includes(a.form)) return `authorization form missing or not one of: ${FORMS.join(', ')}`;
  return null;
}

const positive = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** The row a person can read in a log. */
const label = (e, i) => (e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim() !== '' ? `"${e.name}"${typeof e.file === 'string' ? ` (${e.file})` : ''}` : `row ${i + 1}`);

/**
 * @param {unknown} entries what the JSON file holds
 * @param {{ folderFiles: string[], today?: Date }} options the image files that are in the folder, and the date to judge authorizations by
 * @returns {{ warnings: string[], errors: string[], summary: string[], authorized: { startups: number, investors: number } }}
 */
export function checkLogos(entries, { folderFiles, today = new Date() }) {
  const warnings = [];
  const errors = [];
  const authorized = { startups: 0, investors: 0 };
  let ownerShown = 0; // logos shown on the owner's decision alone: named in the summary so they are not forgotten
  if (!Array.isArray(entries)) {
    return { warnings, errors: ['the file must hold a list of logos ([...])'], summary: [], authorized };
  }
  const inFolder = new Set(folderFiles);
  const seen = new Set();
  const listed = new Set();
  entries.forEach((e, i) => {
    const who = label(e, i);
    if (typeof e !== 'object' || e === null) { errors.push(`${who}: not an object`); return; }
    const shape = [];
    if (typeof e.name !== 'string' || e.name.trim() === '') shape.push('name is missing');
    if (typeof e.file !== 'string' || !FILE_PATTERN.test(e.file)) shape.push('file must be a plain name ending in .svg, .png or .webp (letters, digits, . _ -)');
    if (!positive(e.width) || !positive(e.height)) shape.push('width and height must be whole numbers above zero (the file\'s own size in pixels)');
    if (!PAGES.includes(e.pages)) shape.push(`pages must be one of: ${PAGES.join(', ')}`);
    if (typeof e.order !== 'number' || !Number.isFinite(e.order)) shape.push('order must be a number');
    if (shape.length) { errors.push(`${who}: ${shape.join('; ')}`); return; }
    if (seen.has(e.file)) { errors.push(`${who}: the file is listed twice`); return; }
    seen.add(e.file);
    listed.add(e.file);

    const problem = authorizationProblem(e.authorization, today);
    if (problem) {
      warnings.push(`${who} is NOT shown on the landing: ${problem}`);
      if (!inFolder.has(e.file)) warnings.push(`${who}: the image is not in public/landing/logos/ either`);
      return;
    }
    if (!inFolder.has(e.file)) { errors.push(`${who} is authorized but its image is not in public/landing/logos/: the page would show a broken picture`); return; }
    if (e.authorization.form === 'owner') ownerShown += 1;
    if (e.pages === 'startups' || e.pages === 'both') authorized.startups += 1;
    if (e.pages === 'investors' || e.pages === 'both') authorized.investors += 1;
  });
  for (const f of [...inFolder].sort()) {
    if (!listed.has(f)) warnings.push(`${f} is in public/landing/logos/ but no row of the file lists it: it is not shown`);
  }
  const summary = ['startups', 'investors'].map((p) => `${p} page: ${authorized[p]} authorized logo(s), ${LOGO_STRIP_MIN} needed: the strip is ${authorized[p] >= LOGO_STRIP_MIN ? 'SHOWN' : 'hidden'}`);
  if (ownerShown > 0) summary.push(`${ownerShown} logo(s) shown on the owner's decision (form "owner"): no proof from the company is on file; replace it with an email or accepted terms when it exists`);
  return { warnings, errors, summary, authorized };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const configPath = resolve(arg('--config') ?? join(root, 'src', 'content', 'site', 'landing-logos.json'));
  const folder = resolve(arg('--folder') ?? join(root, 'public', 'landing', 'logos'));
  const tag = '[landing-logos]';

  let entries;
  try {
    entries = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`${tag} ERROR: cannot read ${configPath}: ${err.message}`);
    process.exit(1);
  }
  const folderFiles = existsSync(folder) ? readdirSync(folder).filter((f) => FILE_PATTERN.test(f)) : [];
  const { warnings, errors, summary } = checkLogos(entries, { folderFiles });

  console.log(`${tag} ${Array.isArray(entries) ? entries.length : 0} logo(s) in the file`);
  for (const w of warnings) console.warn(`${tag} WARNING: ${w}`);
  for (const e of errors) console.error(`${tag} ERROR: ${e}`);
  for (const s of summary) console.log(`${tag} ${s}`);
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
