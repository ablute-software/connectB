// Local visual verification harness for MD-08. Not part of the app build.
//
// Drives the REAL /pair route in a real browser at iPhone size, with the
// Supabase REST/auth calls and the pairing consume route intercepted, so
// the screenshots show the actual components and the actual CSS rather
// than a mock-up of them. Run against `next dev` on :3000.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'artifacts/pair-visual';
mkdirSync(OUT, { recursive: true });

const USER = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'founder@ablute.pt', app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString() };

const PROFILES = [
  {
    id: 'p1', kind: 'investor', entity_name: 'Aurora Seed Partners', photo_url: null, entity_logo_url: null,
    description: 'Pre-seed and seed fund backing health, wellness and deep-tech founders across Europe.',
    sectors: ['health', 'digital health', 'AI/ML'], country: 'Portugal', investment_stage_sought: null,
    stages_invested: ['pre_seed', 'seed'], founded_year: null, target_round_amount: null, team_summary: null,
    ticket_min: 25000, ticket_max: 150000, specific_criteria: null, representative_name: 'Mariana Silva', entity_type: 'vc',
  },
  {
    id: 'p2', kind: 'investor', entity_name: 'Iberian Angels Collective', photo_url: null, entity_logo_url: null,
    description: 'Sector-agnostic angel syndicate active pre-seed through Series A across Iberia.',
    sectors: ['consumer', 'saas', 'marketplace', 'fintech'], country: 'Portugal', investment_stage_sought: null,
    stages_invested: ['pre_seed', 'seed', 'series_a'], founded_year: null, target_round_amount: null, team_summary: null,
    ticket_min: 10000, ticket_max: 80000, specific_criteria: null, representative_name: 'Tomás Ferreira', entity_type: 'angel_network',
  },
  {
    id: 'p3', kind: 'investor', entity_name: 'Northbound Ventures', photo_url: null, entity_logo_url: null,
    description: 'Early-stage European fund with a hardware and robotics thesis.',
    sectors: ['hardware', 'robotics', 'deep tech'], country: 'Spain', investment_stage_sought: null,
    stages_invested: ['seed', 'series_a'], founded_year: null, target_round_amount: null, team_summary: null,
    ticket_min: 250000, ticket_max: 1200000, specific_criteria: null, representative_name: 'Elena Duarte', entity_type: 'vc',
  },
];

let swipeResponse = null; // null = no match; a uuid = match

async function stub(page) {
  await page.route('**://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) }));

  await page.route('**/rest/v1/rpc/matchdeal_eligible_deck', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILES) }));

  await page.route('**/rest/v1/rpc/matchdeal_record_exposure', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));

  await page.route('**/rest/v1/rpc/matchdeal_record_swipe', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(swipeResponse) }));

  await page.route('**/api/matchdeal/pairing/consume', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, pairingId: 'x', pairedAt: new Date().toISOString(), kind: 'startup', ownProfileId: 'own-1' }),
    }));
}

// @supabase/ssr reads the session from a cookie before it will even call
// /auth/v1/user, so an unauthenticated context short-circuits to null and
// never reaches the stub above. Planting a well-formed cookie is what puts
// the page on its real signed-in code path.
function authCookie(origin) {
  const session = {
    access_token: 'stub-access-token', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: USER,
  };
  return {
    name: 'sb-stub-auth-token',
    value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`,
    url: origin,
  };
}

const shots = [];
async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  shots.push(file);
  console.log('shot:', file);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));

// 1. No token at all.
await stub(page);
await page.goto('http://localhost:3000/pair', { waitUntil: 'domcontentloaded' });
await shot(page, '01-no-token');

// 2. Signed out, with a token.
await page.goto('http://localhost:3000/pair?token=demo', { waitUntil: 'domcontentloaded' });
await shot(page, '02-need-login');

// 3. Signed in -> paired -> deck.
await ctx.addCookies([authCookie('http://localhost:3000')]);
await page.goto('http://localhost:3000/pair?token=demo', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await shot(page, '03-deck');

// 4. Mid-drag to the right (LIKE stamp showing).
const card = page.getByRole('group').first();
const box = await card.boundingBox();
if (!box) throw new Error('card not found — the deck did not render');
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 70, cy - 10, { steps: 12 });
await shot(page, '04-drag-like');
await page.mouse.move(cx - 70, cy - 10, { steps: 16 });
await shot(page, '05-drag-pass');
await page.mouse.up();
await page.waitForTimeout(500);
await shot(page, '06-after-release-snapback');

// 5. A completed swipe via the buttons, with a match.
swipeResponse = '11111111-1111-4111-8111-111111111111';
await page.getByRole('button', { name: 'Like' }).click();
await page.waitForTimeout(300);
await shot(page, '07-match');
await page.getByRole('status').click();
await page.waitForTimeout(200);

// 6. Exhaust the deck to reach the empty state.
swipeResponse = null;
for (let i = 0; i < 3; i += 1) {
  const btn = page.getByRole('button', { name: 'Pass' });
  if (await btn.count() === 0) break;
  await btn.click();
  await page.waitForTimeout(320);
}
await shot(page, '08-deck-exhausted');

await browser.close();
console.log('\nAll screenshots written:', shots.length);
