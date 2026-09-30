#!/usr/bin/env node
// Prompt 750 — the guard that stops this bug from coming back.
//
// WHAT IT CATCHES. `admin.storage.from('data-room').createSignedUrl(...)`
// mints a bearer link: whoever has the URL can open the file, with or
// without a session, until it expires. Nuno reproduced this live — a
// document opened from the investor portal navigated the browser straight
// to one of these URLs, which then opened from an anonymous window with no
// session at all. The fix (this prompt) is that every investor/guest-facing
// document/media route streams the bytes itself instead
// (streamStorageObject, src/lib/document-proxy.ts) — the Storage URL never
// reaches the browser. This script fails the moment a NEW
// `createSignedUrl(` call on the `data-room` bucket appears anywhere under
// `src/app/api/portal/**`, `src/app/api/guest/**`, or `src/lib/**` — the
// two route trees that serve investors and guests directly, plus `src/lib`
// because that is exactly where one of the two original leak sites lived
// (dossier-fetch.ts, called BY those routes rather than living in them —
// scanning only the route trees would have missed it a second time).
//
// ALLOWLIST, short and commented, exactly like this script's own convention
// elsewhere (see check-migration-order.mjs's GRANDFATHERED_DATE_ONLY): a
// file is exempt only if it is listed below AND the comment next to it
// states why serving a signed URL there is not the leak this guard exists
// to catch. A new site is never silently added here — see this prompt's
// own DECISIONS.md entry for the audit that produced this exact list.
//
//   node scripts/check-no-signed-url-leak.mjs            # exit 1 on a violation
//   node scripts/check-no-signed-url-leak.mjs --report   # print only, exit 0
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportOnly = process.argv.includes('--report');

const SCAN_ROOTS = [
  join(root, 'src', 'app', 'api', 'portal'),
  join(root, 'src', 'app', 'api', 'guest'),
  join(root, 'src', 'lib'),
];

// Path is relative to the repo root, forward slashes, exactly as `relative`
// below produces it.
const ALLOWLIST = new Map([
  // Brand logo (orgs.logo_url) — the same image this startup already shows
  // unauthenticated everywhere else in the app (MatchDeal card, dossier
  // header). Not a data-room document; nothing confidential if this one
  // URL outlives its TTL. Evaluated in Prompt 750, left as-is on purpose.
  ['src/app/api/portal/access-granted/route.ts', 'org logo, public brand image — see the inline comment at its own call site'],
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

const files = [];
for (const scanRoot of SCAN_ROOTS) walk(scanRoot, files);

// A signed URL minted through document-proxy.ts's own internal
// (60-second, never-sent-to-the-browser) mint is not the leak this guard
// catches — that file is the fix, not a violation of it. Every OTHER file
// under the scan roots is checked for its own direct
// `.storage.from('data-room')....createSignedUrl(` call.
const violations = [];
for (const file of files) {
  const relPath = relative(root, file).replace(/\\/g, '/');
  if (relPath === 'src/lib/document-proxy.ts') continue;
  const code = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const hasDataRoomBucket = /\.storage\.from\(\s*['"]data-room['"]\s*\)/.test(code);
  const hasSignedUrlCall = /\.createSignedUrl\s*\(/.test(code);
  if (!hasDataRoomBucket || !hasSignedUrlCall) continue;
  if (ALLOWLIST.has(relPath)) continue;
  violations.push(relPath);
}

console.log(`files scanned under src/app/api/{portal,guest} + src/lib: ${files.length}`);
console.log(`allowlisted (see this script's own header)     : ${[...ALLOWLIST.keys()].filter((p) => files.some((f) => relative(root, f).replace(/\\/g, '/') === p)).length}`);
console.log(`VIOLATIONS                                      : ${violations.length}`);
for (const v of violations) {
  console.log(`    ✗ ${v} — createSignedUrl('data-room') hands a bearer link to the browser. Use streamStorageObject (src/lib/document-proxy.ts) instead, or add this file to the allowlist above with a written reason.`);
}

if (reportOnly) process.exit(0);
process.exit(violations.length > 0 ? 1 : 0);
