#!/usr/bin/env node
// Prompt 530 — demo-mode verification of the People & Access fix, kept
// because the bug it pins (one investor rendered once per grant) is a
// rendering-level regression no unit test can catch on its own: the
// grouping is covered by src/lib/data-room-access-relationships.test.ts,
// this covers the panel that reads it.
//
// Run it against a server started with `npm run dev:verify` — CLAUDE.md's
// Prompt 250 rule: that script forces the three Supabase env vars to '' in
// the spawned process regardless of .env.local, so nothing here can reach
// a real project. Every fixture it writes is named zz-test-*.
//
//   npm run dev:verify        # terminal 1
//   node scripts/_verify_people_access.mjs
//
// Demo-mode verification of the People & Access fix.
// Runs against `npm run dev:verify` (Supabase env vars forced to '' — see
// /api/me returning authEnabled:false), in a headless Chromium this script
// launches itself. No real credentials are reachable from this process.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(60000);
const fails = [];
// The Vault privacy notice is a full-viewport modal on first visit — accept
// it the way a founder would, so the clicks below land on the panel.
// Three first-visit overlays stack on this page (page tour on top, then the
// welcome modal, then the Vault privacy notice). Dismiss them topmost-first,
// the way a founder would, so the clicks below land on the panel.
async function dismissOverlays() {
  for (let round = 0; round < 15; round++) {
    const overlays = page.locator('div.fixed.inset-0');
    const n = await overlays.count();
    if (n === 0) return;
    let clicked = false;
    for (let i = n - 1; i >= 0 && !clicked; i--) {
      const top = overlays.nth(i);
      const closeTour = top.locator('button[aria-label="Close tour"]').first();
      if (await closeTour.isVisible().catch(() => false)) {
        await closeTour.click({ force: true }).catch(() => {});
        clicked = true; break;
      }
      for (const name of ['Got it', 'Start exploring', 'Finish', 'Done', 'Next', 'Close', 'Skip']) {
        const b = top.getByRole('button', { name, exact: true }).first();
        if (await b.isVisible().catch(() => false)) {
          await b.click({ force: true }).catch(() => {});
          clicked = true; break;
        }
      }
    }
    if (!clicked) break;
    await page.waitForTimeout(400);
  }
  // Last resort, and a test-harness concession only: the first-visit
  // onboarding modals are unrelated to what is under test here, and one of
  // them has no dismiss control this script can reach. Removing the leftover
  // overlay nodes affects nothing in the panel below — no app code, no
  // store state, no grant.
  await page.evaluate(() => {
    document.querySelectorAll('div.fixed.inset-0').forEach((el) => el.remove());
  });
  await page.waitForTimeout(200);
}
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails.push(name);
}

// Seed: 60 document grants to ONE unknown email + a folder grant to a known person.
await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const seeded = await page.evaluate(() => {
  const KEY = 'ablute-crm-demo-v3';
  const db = JSON.parse(localStorage.getItem(KEY));
  const now = new Date().toISOString();
  // The demo seed ships one document; the bug only shows at scale, so build
  // the reported scenario: 60 documents in a real data-room subfolder.
  const docs = Array.from({ length: 60 }, (_, i) => ({
    id: `zz-test-doc-${i}`, folder_id: 'f-dr-03', name: `zz-test Financial ${i}.pdf`,
    version: 'v1', visibility: 'on_grant', watermark: false, downloadable: false, position: i,
  }));
  docs.push({
    id: 'zz-test-doc-expired', folder_id: 'f-dr-06', name: 'zz-test Team CVs.pdf',
    version: 'v1', visibility: 'on_grant', watermark: false, downloadable: false, position: 0,
  });
  db.documents = [...db.documents, ...docs];

  const grants = docs.slice(0, 60).map((d, i) => ({
    id: `zz-test-g${i}`, document_id: d.id, granted_at: now,
    nda_required: false, invited_email: 'investor@example.com', invited_name: 'Unknown Investor',
  }));
  // one expired grant, to prove expired grants stay visible and extendable
  grants.push({
    id: 'zz-test-expired', document_id: 'zz-test-doc-expired', granted_at: now,
    expires_at: '2020-01-01T00:00:00Z', nda_required: false,
    invited_email: 'investor@example.com', invited_name: 'Unknown Investor',
  });
  // a person-scoped folder grant, so an ASSOCIATED entity row exists too
  const person = db.people[0];
  grants.push({ id: 'zz-test-person', person_id: person.id, folder_id: 'f-dr-05', granted_at: now, nda_required: false });
  db.grants = grants;
  localStorage.setItem(KEY, JSON.stringify(db));
  return { docCount: docs.length, personName: person.full_name, entityId: person.entity_id, totalDocs: db.documents.length };
});
console.log('seeded:', JSON.stringify(seeded));

await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await dismissOverlays();
await page.getByRole('button', { name: 'People & Access' }).click();
await page.waitForTimeout(1000);
await dismissOverlays(); // the People & Access tab has its own page tour

// --- Entities column ---
const rows = page.locator('[data-tour-id="people-entities"] ul > li');
const rowCount = await rows.count();
const rowTexts = await rows.allInnerTexts();
check('61 grants to one email produce a small Entities list, not 61 rows', rowCount <= 3, `rows=${rowCount}`);
const guestRow = rowTexts.find((t) => t.includes('investor@example.com') || t.includes('Unknown Investor'));
check('the guest recipient appears exactly once',
  rowTexts.filter((t) => t.includes('investor@example.com') || t.includes('Unknown Investor')).length === 1);
check('the guest row is Por associar', !!guestRow && guestRow.includes('Por associar'), guestRow?.replace(/\n/g, ' | '));
check('the guest row counts files and people, not grants',
  !!guestRow && /60 files granted · 1 person/.test(guestRow.replace(/\n/g, ' ')), guestRow?.replace(/\n/g, ' | '));
check('the guest row flags its expired grant', !!guestRow && guestRow.includes('Expired grant'));

// --- Search: filters while typing, case-insensitive, on email ---
const search = page.getByLabel('Search entities');
await search.fill('INVESTOR@EX');
await page.waitForTimeout(300);
const afterSearch = await page.locator('[data-tour-id="people-entities"] ul > li').allInnerTexts();
check('typing part of an email filters the list case-insensitively',
  afterSearch.length >= 1 && afterSearch.every((t) => t.toLowerCase().includes('investor@ex')), `rows=${afterSearch.length}`);
await search.fill('zzzz-no-such-entity');
await page.waitForTimeout(300);
check('a no-match query shows the plain empty state',
  await page.getByText('No matching entities found.').isVisible());
await search.fill('');
await page.waitForTimeout(300);
check('clearing the search restores the list',
  (await page.locator('[data-tour-id="people-entities"] ul > li').count()) === rowCount);

// --- Access Matrix for the Por associar recipient ---
await page.locator('[data-tour-id="people-entities"] ul > li').filter({ hasText: 'Unknown Investor' }).first().click();
await page.waitForTimeout(500);
const matrix = page.locator('[data-tour-id="people-matrix"]');
const matrixText = await matrix.innerText();
// An unconfirmed guest's grants read "Awaiting confirmation", not "Can
// view" — that is grantStatus('pending_confirmation'), and the point is
// that the matrix is POPULATED at all, which it never was before.
check('selecting a Por associar recipient loads a populated Access Matrix',
  matrixText.includes('Awaiting confirmation') || matrixText.includes('✓ Can view'),
  matrixText.slice(0, 160).replace(/\n/g, ' | '));
check('the matrix header repeats the file/people summary', /60 files granted/.test(matrixText.replace(/\n/g, ' ')));
check('expired grants stay visible with an Expired grant tag', matrixText.includes('Expired grant'));

// --- Folders collapse/expand ---
const firstFolderToggle = matrix.locator('button[aria-expanded]').first();
const beforeCollapse = await firstFolderToggle.getAttribute('aria-expanded');
await firstFolderToggle.click();
await page.waitForTimeout(200);
const afterCollapse = await firstFolderToggle.getAttribute('aria-expanded');
check('folders collapse and expand', beforeCollapse !== afterCollapse, `${beforeCollapse} -> ${afterCollapse}`);
await firstFolderToggle.click();
await page.waitForTimeout(200);

// --- Revoke ONE document, count drops by exactly 1, no new row ---
const filesBefore = Number((await matrix.innerText()).match(/(\d+) files granted/)[1]);
const revokeBtn = matrix.getByRole('button', { name: 'Revoke', exact: true }).first();
await revokeBtn.click();
await page.waitForTimeout(400);
// the app's own confirm modal, not window.confirm
const confirmModal = page.locator('div.fixed.inset-0').last();
const confirmBtn = confirmModal.locator('div[role="alertdialog"] button').last(); // "Delete" (destructive default)
if (await confirmBtn.isVisible().catch(() => false)) { await confirmBtn.click(); await page.waitForTimeout(600); }
const matrixAfter = await matrix.innerText();
const filesAfter = Number(matrixAfter.match(/(\d+) files granted/)[1]);
check('revoking one document drops the file count by exactly 1', filesAfter === filesBefore - 1, `${filesBefore} -> ${filesAfter}`);
const rowsAfter = await page.locator('[data-tour-id="people-entities"] ul > li').count();
check('revoking does not add or remove an Entity row', rowsAfter === rowCount, `${rowCount} -> ${rowsAfter}`);
check('the selected entity stays selected', (await matrix.innerText()).includes('Unknown Investor') || (await page.locator('[data-tour-id="people-matrix"] h3, [data-tour-id="people-matrix"]').first().innerText()).includes('Access matrix —'));

// --- Add a document back: count rises, still one row ---
const notShared = matrix.getByRole('button', { name: "Can't view" }).first();
await notShared.click();
await page.waitForTimeout(200);
await matrix.getByRole('button', { name: 'Grant access' }).click();
await page.waitForTimeout(700);
const matrixAfterGrant = await matrix.innerText();
const filesAfterGrant = Number(matrixAfterGrant.match(/(\d+) files granted/)[1]);
check('adding a document raises the file count by 1', filesAfterGrant === filesAfter + 1, `${filesAfter} -> ${filesAfterGrant}`);
check('adding a document does not create a second Entity',
  (await page.locator('[data-tour-id="people-entities"] ul > li').count()) === rowCount);

// --- Extend / reactivate an expired grant ---
const extendBtn = matrix.getByRole('button', { name: 'Extend / reactivate' }).first();
await extendBtn.scrollIntoViewIfNeeded();
await extendBtn.click();
await page.waitForTimeout(300);
const future = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
await matrix.locator('input[type="date"]').first().fill(future);
await matrix.getByRole('button', { name: 'Save', exact: true }).first().click();
await page.waitForTimeout(800);
const afterExtend = await matrix.innerText();
const filesAfterExtend = Number(afterExtend.match(/(\d+) files granted/)[1]);
check('extending an expired grant brings its document back', filesAfterExtend === filesAfterGrant + 1, `${filesAfterGrant} -> ${filesAfterExtend}`);
check('the reactivated grant no longer reads as expired in the matrix', !afterExtend.includes('Expired grant'));
check('extending does not create a second Entity',
  (await page.locator('[data-tour-id="people-entities"] ul > li').count()) === rowCount);

// --- Guest → registered investor: the same email resolves into the entity ---
await page.evaluate(() => {
  const KEY = 'ablute-crm-demo-v3';
  const db = JSON.parse(localStorage.getItem(KEY));
  // The recipient signs up / is matched: a people row now carries the address.
  db.people[0].email_verified = 'investor@example.com';
  localStorage.setItem(KEY, JSON.stringify(db));
});
await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await dismissOverlays();
await page.getByRole('button', { name: 'People & Access' }).click();
await page.waitForTimeout(1000);
await dismissOverlays();
const resolvedTexts = await page.locator('[data-tour-id="people-entities"] ul > li').allInnerTexts();
check('resolving the guest to a known person does not leave two rows',
  resolvedTexts.length === 1, `rows=${resolvedTexts.length}: ${resolvedTexts.map((t) => t.split('\n')[0]).join(' / ')}`);
check('the surviving row is the associated entity, not Por associar',
  resolvedTexts.length === 1 && !resolvedTexts[0].includes('Por associar'), resolvedTexts[0]?.replace(/\n/g, ' | '));
check('the grants survive the resolution',
  /6[01] files granted/.test(resolvedTexts[0]?.replace(/\n/g, ' ') ?? ''), resolvedTexts[0]?.replace(/\n/g, ' | '));

// --- Granted so far: one row per recipient ---
await page.getByRole('button', { name: 'Documents & Vault Data Room' }).first().click();
await page.waitForTimeout(600);
const granted = await page.getByText('Granted so far', { exact: false }).first().innerText();
check('Granted so far groups by recipient', /— \d+ (person|people)/.test(granted), granted);

await browser.close();
console.log(fails.length === 0 ? '\nALL CHECKS PASSED' : `\nFAILED: ${fails.join(', ')}`);
process.exit(fails.length === 0 ? 0 : 1);
