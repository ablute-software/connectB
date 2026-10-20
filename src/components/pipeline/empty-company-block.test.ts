// Nuno, 20/10/2026, on Mob2is: "I do not understand why the pipeline is empty — if an action is missing it should be on the screen, with the option to fix it".
// These render the real empty-state block for each situation and read what a founder (and a Developer Viewer) would: the sentence, the numbers, the buttons.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: { org: { id: 'org-1', name: 'zz-test Mob2is', plan: 'idea' as string, round_raising: true as boolean | null | undefined }, packs: [{ id: 'p1', name: 'Starter Europe' }] as { id: string; name: string }[] },
  actor: { viewer: false, canManageOrgSettings: true },
}));
vi.mock('@/lib/store', () => ({ useStore: () => ({ db: h.db, unlockPack: vi.fn(), updateOrg: vi.fn() }) }));
vi.mock('@/lib/use-org-actor', () => ({ useOrgActor: () => h.actor }));

import { EmptyCompanyBlock, type UnlockState } from './EmptyCompanyBlock';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
const unlock = (over: Partial<UnlockState> = {}): UnlockState => ({
  gateComplete: true, catalogQuotaTarget: 3, deliverable: 0, unlimited: false, missing: [], plan: 'idea', quota: 3, delivered: 0, ...over,
});
const render = (u: UnlockState | null, variant: 'screen' | 'banner' = 'screen') => renderToStaticMarkup(createElement(EmptyCompanyBlock, { variant, unlock: u }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const hrefs = (markup: string) => Array.from(markup.matchAll(/href="([^"]+)"/g)).map((m) => m[1]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  h.db.org = { id: 'org-1', name: 'zz-test Mob2is', plan: 'idea', round_raising: true };
  h.db.packs = [{ id: 'p1', name: 'Starter Europe' }];
  h.actor = { viewer: false, canManageOrgSettings: true };
});
afterEach(() => { vi.useRealTimers(); });

describe('the empty Pipeline says WHY, per situation', () => {
  it('Mob2is: three investors are waiting for one click — it says so, and offers the click', () => {
    const out = render(unlock({ deliverable: 3 }));
    expect(text(out)).toContain('Your profile is complete — unlock your first 3 matched investors, or import your own contacts.');
    expect(text(out)).toContain('Unlock my pipeline');
    expect(text(out)).not.toContain('monthly renewal');
  });

  it('the profile is not complete: the fields still missing, and the way to complete it', () => {
    const out = render(unlock({ gateComplete: false, missing: ['website', 'revenue'], quota: 0 }));
    expect(text(out)).toContain('still missing: website, revenue');
    expect(text(out)).toContain('Complete your profile');
    expect(text(out)).not.toContain('Unlock my pipeline');
    expect(hrefs(out)).toContain('/settings');
  });

  it('every investor of the plan was delivered: "all 3", the date of the next batch, the upgrade, and the import', () => {
    const out = render(unlock({ quota: 3, delivered: 3, deliverable: 0 }));
    const t = text(out);
    expect(t).toContain('You have received all 3 investors your plan includes so far.');
    expect(t).toContain('The next batch arrives on 1 November 2026');
    expect(t).toContain('or upgrade your plan to unlock more now');
    expect(t).toContain('View plans');
    expect(t).toContain('Import contacts instead');
    expect(t).not.toContain('Unlock my pipeline');
    expect(hrefs(out)).toContain('/plans');
  });

  it('on the highest plan there is no upgrade to offer — the date and the import remain', () => {
    h.db.org.plan = 'motherfunding';
    const out = render(unlock({ quota: 25, delivered: 25, plan: 'motherfunding' }));
    expect(text(out)).toContain('1 November 2026');
    expect(text(out)).not.toContain('View plans');
    expect(text(out)).not.toContain('upgrade');
    expect(hrefs(out)).not.toContain('/plans');
  });

  it('allowance left, nothing in the catalog that matches: the numbers, what matching uses, and a way to the profile', () => {
    const out = render(unlock({ quota: 8, delivered: 5, deliverable: 0 }));
    const t = text(out);
    expect(t).toContain('5 of 8 delivered so far');
    expect(t).toContain('sectors, stage, ticket size and country');
    expect(t).toContain('Review your profile');
    expect(t).not.toContain('monthly renewal');
    expect(hrefs(out)).toContain('/settings?tab=company');
  });

  it('"Import contacts instead" goes to the importer (Import history), not to the Company tab it used to land on', () => {
    expect(hrefs(render(unlock({ deliverable: 3 })))).toContain('/settings?tab=import-history');
    expect(hrefs(render(unlock({ quota: 3, delivered: 3 })))).toContain('/settings?tab=import-history');
  });

  it('before the route answers (or in demo mode) it is the screen it always was: one investor to unlock if the pack is there, the generic line if not', () => {
    expect(text(render(null))).toContain('unlock your first 1 matched investor');
    h.db.packs = [];
    expect(text(render(null))).toContain('Your next batch of investors arrives with your plan’s monthly renewal');
  });

  it('the banner variant (investors exist, none classified) says the same thing in its own container', () => {
    const out = render(unlock({ quota: 3, delivered: 3 }), 'banner');
    expect(text(out)).toContain('You have received all 3 investors');
    expect(out).toContain('rounded-2xl');
  });
});

describe('a Developer Viewer reads the founder\'s screen — and can press nothing', () => {
  it('the Unlock button is there, as the founder sees it, but disabled and explained', () => {
    h.actor = { viewer: true, canManageOrgSettings: false };
    const out = render(unlock({ deliverable: 3 }));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*title="Read-only: you are viewing this company as a developer"[^>]*>\s*Unlock my pipeline/);
  });

  it('a founder\'s Unlock button is enabled', () => {
    const out = render(unlock({ deliverable: 3 }));
    expect(out).toMatch(/<button(?![^>]*disabled="")[^>]*>\s*Unlock my pipeline/);
  });
});

describe('a company that is marked "not currently raising"', () => {
  it('no note when it is raising, or has not answered', () => {
    h.db.org.round_raising = true;
    expect(text(render(unlock({ deliverable: 3 })))).not.toContain('Not currently raising');
    h.db.org.round_raising = null;
    expect(text(render(unlock({ deliverable: 3 })))).not.toContain('Not currently raising');
  });

  it('the note names the company, says what investors see and that the pipeline is unaffected — and offers the change', () => {
    h.db.org.round_raising = false;
    const t = text(render(unlock({ deliverable: 3 })));
    expect(t).toContain('zz-test Mob2is is marked “Not currently raising”.');
    expect(t).toContain('“This round has closed” on your card');
    expect(t).toContain('does not change the investors on this page');
    expect(t).toContain('Mark as raising');
  });

  it('an owner or admin gets an enabled button; a Developer Viewer gets it disabled; a manager or member gets the note without it', () => {
    h.db.org.round_raising = false;
    const founder = render(unlock({ deliverable: 3 }));
    expect(founder).toMatch(/<button(?![^>]*disabled="")[^>]*>\s*Mark as raising/);

    h.actor = { viewer: true, canManageOrgSettings: false };
    const viewer = render(unlock({ deliverable: 3 }));
    expect(viewer).toMatch(/<button[^>]*disabled=""[^>]*>\s*Mark as raising/);

    h.actor = { viewer: false, canManageOrgSettings: false };
    const member = render(unlock({ deliverable: 3 }));
    expect(text(member)).toContain('Not currently raising');
    expect(text(member)).not.toContain('Mark as raising');
  });

  it('the change is two steps and writes only that one field (the source: confirm first, then updateOrg({ round_raising: true }))', () => {
    const src = read('./EmptyCompanyBlock.tsx');
    expect(src).toContain('onClick={() => setConfirming(true)} disabled={viewer}');
    expect(src).toContain('onClick={() => { updateOrg({ round_raising: true }); setConfirming(false); }}');
    expect(src.match(/updateOrg\(/g)).toHaveLength(1);
  });
});

describe('the page uses it', () => {
  const page = read('../../app/pipeline/page.tsx');

  it('imports the block and the state type instead of carrying its own copy', () => {
    expect(page).toContain("import { EmptyCompanyBlock, STARTER_PACK_NAME, type UnlockState } from '@/components/pipeline/EmptyCompanyBlock';");
    expect(page).not.toContain('function EmptyCompanyBlock(');
    expect(page).not.toContain('type UnlockState =');
  });

  it('hands the numbers the route already had (quota, delivered) to it', () => {
    expect(page).toContain("quota: typeof b.quota === 'number' ? b.quota : null, delivered: typeof b.delivered === 'number' ? b.delivered : 0,");
  });
});
