// Prompt 933 — the HTTP half of «an address that matches nothing is a 404»: a script that asks a RUNNING server and fails (exit 1) when an answer is not the one the prompt asks for. A unit test cannot say this:
// the status of a not-found page is decided by Next, after the middleware, and only a real server shows it (on 05/11/2026 `/qualquer-coisa` answered 307 → /login, `/for-startups/qualquer-coisa` answered
// Next's own 404 and `/api/isto-nao-existe` answered 307 → an HTML page).
//
//   npm run verify:not-found                       # against `next start` on http://127.0.0.1:3000
//   npm run verify:not-found -- http://127.0.0.1:3411
//   npm run verify:not-found -- https://www.sherlockdeal.com    # read-only: GET requests, nothing is written
//
// It needs the server to have authentication ON (a real build with Supabase env), otherwise the middleware is skipped and a protected path would not redirect — the script says so and stops when `/dashboard` does not.
// The words it looks for are TITLE below; src/components/site/not-found-page.test.tsx fails when they stop being the card's.
export const TITLE = 'No leads here';

const base = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const failures = [];
let checks = 0;

async function ask(path, init = {}) {
  // 'manual': a 307 must be SEEN, not followed — following it is exactly how the old behaviour looked like a page.
  const res = await fetch(base + path, { redirect: 'manual', headers: { 'user-agent': 'sherlock-verify-not-found/1' }, ...init });
  const body = init.method === 'HEAD' ? '' : await res.text();
  return { status: res.status, location: res.headers.get('location'), type: res.headers.get('content-type') ?? '', body };
}

function expect(label, ok, detail) {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

const login = (r) => r.status === 307 && /\/login\?next=/.test(r.location ?? '');
const describe = (r) => `${r.status}${r.location ? ` → ${r.location}` : ''} ${r.type}`.trim();

// ── 1. the three behaviours of the prompt ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const path of ['/qualquer-coisa-que-nao-existe', '/for-startups/qualquer-coisa', '/faq/qualquer-coisa', '/investors/qualquer-coisa']) {
  const r = await ask(path);
  expect(`GET ${path} is a 404, not a redirect`, r.status === 404 && !r.location, describe(r));
  expect(`GET ${path} shows the page of the brand, not Next's`, r.body.includes(TITLE) && !r.body.includes('This page could not be found'), r.body.includes(TITLE) ? 'Next\'s own text is there' : 'the card is not there');
}
{
  const r = await ask('/qualquer-coisa-que-nao-existe', { method: 'HEAD' });
  expect('HEAD /qualquer-coisa-que-nao-existe is a 404', r.status === 404, describe(r));
}
{
  // (GET only: the script writes nothing anywhere, so it is safe against production; every method is covered by src/lib/route-zones.test.ts)
  const r = await ask('/api/isto-nao-existe');
  let json = null;
  try { json = JSON.parse(r.body); } catch { /* not JSON */ }
  expect('GET /api/isto-nao-existe is a 404 in JSON', r.status === 404 && r.type.includes('application/json') && json?.ok === false, describe(r));
}
{
  // a path inside a zone that has no such route: the zone's login for a caller with no session when the zone is behind one...
  const r = await ask('/api/calls/qualquer-coisa-que-nao-existe');
  expect('GET /api/calls/<nothing> without a session is still sent to /login (the zone is behind one)', login(r), describe(r));
}
{
  // ...and the catch-all of src/app/api (404 JSON, not the HTML page) where the zone is public: /api/me is, and nothing lives under it
  const r = await ask('/api/me/qualquer-coisa-que-nao-existe');
  let json = null;
  try { json = JSON.parse(r.body); } catch { /* not JSON */ }
  expect('GET /api/me/<nothing> (inside a zone, no such route) is a 404 in JSON', r.status === 404 && r.type.includes('application/json') && json?.ok === false, describe(r));
}

// ── 2. what is behind a session still is ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const dashboard = await ask('/dashboard');
if (!login(dashboard)) {
  console.error(`/dashboard without a session answered ${describe(dashboard)}: this server has authentication off (a build without Supabase env is demo mode and skips the middleware), so nothing below would mean anything. Stopping.`);
  process.exit(1);
}
expect('GET /dashboard without a session goes to /login?next=%2Fdashboard', dashboard.location.includes('next=%2Fdashboard'), describe(dashboard));
for (const path of ['/pipeline', '/calls', '/settings', '/backoffice', '/network', '/documents', '/entities/ent-1', '/welcome/commitments', '/suspended']) {
  const r = await ask(path);
  expect(`GET ${path} without a session goes to /login`, login(r), describe(r));
}
for (const path of ['/api/org/update', '/api/pipeline-unlock', '/api/backoffice/metrics/overview']) {
  const r = await ask(path);
  expect(`GET ${path} without a session goes to /login`, login(r), describe(r));
}
// the old gate was closed by default and the new one is open for what nothing answers: none of these may reach a protected page
for (const path of ['/Dashboard', '/DASHBOARD/x', '//dashboard', '/dashboard//x', '/%64ashboard', '/dash%62oard', '/dashboard%2Fx', '/%2564ashboard', '/pipeline%2F', '/api//calls', '/api/%63alls/x', '/%61pi/calls']) {
  const r = await ask(path);
  expect(`GET ${path} (a protected path in disguise) never serves the page`, login(r) || r.status === 404 || r.status === 308 || r.status === 400, describe(r));
}

// ── 3. what is public still is, and the sitemap announces no page that is not there ──────────────────────────────────────────────────────────────────────────────────
for (const path of ['/', '/investors', '/faq', '/about', '/for-startups', '/contact', '/terms', '/login', '/signup', '/robots.txt', '/sitemap.xml', '/api/me', '/api/version']) {
  const r = await ask(path);
  expect(`GET ${path} is public (200)`, r.status === 200, describe(r));
}
{
  const r = await ask('/sitemap.xml');
  const urls = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  expect('the sitemap lists pages', urls.length >= 5, `${urls.length} urls`);
  for (const path of urls) {
    const p = await ask(path);
    expect(`the sitemap's ${path} is a page that exists (200)`, p.status === 200, describe(p));
  }
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`✗ ${failures.length} of ${checks} checks failed against ${base}:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${checks} checks passed against ${base}`);
