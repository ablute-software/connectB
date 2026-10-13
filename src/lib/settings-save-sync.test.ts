// Prompt 906 §A — the 07/10 report, replayed over the real route handlers and an in-memory database that
// actually applies writes: a founder with a sign-up-only profile fills the six gate fields one save at a time,
// and after EVERY save the two things the page shows — the "Investors can't find you yet — N fields missing"
// banner (/api/company/visibility, decided on the server) and the completeness percentage (the pure function
// the store feeds from the saved org) — describe the stored profile. No reload anywhere in this file.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb } from '@/test/fake-supabase';
import { calcCompanyCompleteness } from '@/lib/companyCompleteness';
import type { CompanyPerson, Org } from '@/lib/types';

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown }));

vi.mock('@/lib/supabase-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  authEnabled: true,
  serverClient: async () => h.session,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));
// An archive-relevant field (sectors, stage …) regenerates a summary with a model call when someone archived the
// startup. Nobody did here, and a test must never reach a model.
vi.mock('@/lib/startup-snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/startup-snapshot')>()),
  regenerateNowSummary: vi.fn(async () => undefined),
}));

const ORG = 'a9a9a9a9-0000-4000-8000-0000000009a6'; // zz-test-906-signup-only
const OTHER_ORG = 'b9b9b9b9-0000-4000-8000-0000000009b6'; // zz-test-906-other
const OWNER = 'user-906-owner';
const MEMBER = 'user-906-member';
const PERSON = 'person-906-contact';

let db: FakeDb;

function world(): FakeDb {
  const d = fakeDb({
    // what the sign-up form leaves behind: name, website, country, stage — and nothing else
    orgs: [
      { id: ORG, name: 'zz-test-906-signup-only', plan: 'idea', website: 'https://zz-test-906.example', stage: 'seed', country: 'Portugal',
        sectors: [], round_raising: true, daily_cap: 5, weekly_cap: 20, ai_credits_used_this_period: 7, owner_suspended_at: null },
      { id: OTHER_ORG, name: 'zz-test-906-other', plan: 'idea', sectors: ['health'], stage: 'seed' },
    ],
    org_members: [
      { user_id: OWNER, org_id: ORG, role: 'owner' },
      { user_id: MEMBER, org_id: ORG, role: 'member' },
    ],
    company_people: [{ id: PERSON, org_id: ORG, full_name: 'zz-test-906 contact', title: 'CEO', is_founder: true, sort_order: 0 }],
    matchdeal_profiles: [],
    investor_pipeline_admissions: [],
    investor_relationship_decisions: [],
    catalog_entities: [],
    analytics_events: [],
  });
  d.applyWrites = true;
  return d;
}

function asUser(user: string) {
  h.session = fakeSession(db, { userId: user, isDeveloper: false, email: `${user}@example.test` });
  h.admin = fakeAdmin(db);
}

function post(body: unknown): NextRequest {
  return new NextRequest('https://example.test/api/org/update', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function save(body: unknown) {
  const { POST } = await import('@/app/api/org/update/route');
  const res = await POST(post(body));
  return { status: res.status, json: await res.json() as { ok: boolean; org?: Record<string, unknown>; error?: string } };
}

async function banner() {
  const { GET } = await import('@/app/api/company/visibility/route');
  const res = await GET(new NextRequest('https://example.test/api/company/visibility?kind=startup'));
  return await res.json() as { ok: boolean; investorVisibility: string; gateMissingFieldLinks: { label: string; fieldId: string }[] };
}

/** The percentage the bar shows for what is stored right now. */
function storedPct(): { pct: number; missing: string[] } {
  const org = db.tables.orgs.find((o) => o.id === ORG) as unknown as Org;
  const people = db.tables.company_people.filter((p) => p.org_id === ORG) as unknown as CompanyPerson[];
  const { pct, missing } = calcCompanyCompleteness(org, people);
  return { pct, missing: missing.map((m) => m.id) };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
  db = world();
  asUser(OWNER);
});

describe('the 07/10 sequence: six gate fields, one save at a time, no reload', () => {
  it('starts the way the founder\'s page did: six of the nine gate fields missing', async () => {
    const b = await banner();
    expect(b.investorVisibility).toBe('incomplete');
    expect(b.gateMissingFieldLinks.map((m) => m.label).sort()).toEqual(
      ['current phase', 'founding year', 'primary contact', 'revenue', 'round target', 'sector'],
    );
  });

  it('after each save the banner and the percentage both move, and finish at "Investors can find you"', async () => {
    const steps: { patch: Record<string, unknown>; left: number }[] = [
      { patch: { sectors: ['AgriTech & FoodTech', 'Alternative Proteins'], sector: 'AgriTech & FoodTech, Alternative Proteins' }, left: 5 },
      { patch: { round_target_eur: 250000 }, left: 4 },
      { patch: { current_phase: 'launch_early_adopters' }, left: 3 },
      { patch: { founded_year: 2019 }, left: 2 },
      { patch: { revenue_eur: 0 }, left: 1 },
      { patch: { primary_contact_person_id: PERSON }, left: 0 },
    ];
    let previousPct = storedPct().pct;
    for (const step of steps) {
      const saved = await save(step.patch);
      expect(saved.status).toBe(200);
      expect(saved.json.ok).toBe(true);

      const b = await banner();
      expect(b.gateMissingFieldLinks, JSON.stringify(step.patch)).toHaveLength(step.left);
      const now = storedPct().pct;
      expect(now, JSON.stringify(step.patch)).toBeGreaterThan(previousPct);
      previousPct = now;
    }
    expect((await banner()).investorVisibility).toBe('visible');
  });

  it('a revenue of 0 and an employee count of 0 are answers, not blanks', async () => {
    await save({ revenue_eur: 0, employee_count: 0 });
    const { missing } = storedPct();
    expect(missing).not.toContain('identity.revenue');
    expect(missing).not.toContain('team.employee_count');
    // …and the gate agrees: revenue is no longer on the banner's list
    expect((await banner()).gateMissingFieldLinks.map((m) => m.label)).not.toContain('revenue');
    // the same answers as PostgREST gives them back (numeric columns arrive as strings)
    const asStored = { ...(db.tables.orgs[0] as unknown as Org), revenue_eur: '0' as unknown as number, employee_count: 0 };
    const again = calcCompanyCompleteness(asStored, []);
    expect(again.missing.map((m) => m.id)).not.toContain('identity.revenue');
    expect(again.missing.map((m) => m.id)).not.toContain('team.employee_count');
  });
});

describe('/api/org/update hands the stored org back', () => {
  it('returns the editable columns as the database holds them — and none of the rest of the row', async () => {
    const { json } = await save({ round_target_eur: 250000, current_phase: 'pilot' });
    expect(json.ok).toBe(true);
    expect(json.org).toMatchObject({ round_target_eur: 250000, current_phase: 'pilot', website: 'https://zz-test-906.example', stage: 'seed' });
    // the founder's browser already loads its org, but this route must not become a wider read than the columns it writes
    for (const never of ['id', 'plan', 'ai_credits_used_this_period', 'owner_suspended_at', 'name_internal']) {
      expect(Object.keys(json.org ?? {}), never).not.toContain(never);
    }
  });

  it('a role that may not edit the organisation gets a 403 and no org back', async () => {
    asUser(MEMBER);
    const { status, json } = await save({ round_target_eur: 1 });
    expect(status).toBe(403);
    expect(json.org).toBeUndefined();
    expect((db.tables.orgs[0] as { round_target_eur?: number }).round_target_eur).toBeUndefined();
  });

  it('never reads or writes another org: the org written is the caller\'s own', async () => {
    await save({ stage: 'series_a' });
    expect((db.tables.orgs.find((o) => o.id === OTHER_ORG) as { stage: string }).stage).toBe('seed');
    expect((db.tables.orgs.find((o) => o.id === ORG) as { stage: string }).stage).toBe('series_a');
  });
});
