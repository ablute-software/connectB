// Prompt 908 — the back-office Calls route through its real handler over the stateful fake database: platform
// admin only; one row per call with the organisation (firm or incubator, Test flag), the admin who created it,
// application NUMBERS (never their content), the link token, the dates and the detail of the expanded row;
// and that it works whatever CALLS_MODE says, because it is the platform team's own view.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';

let db: CallsDb;
let isAdmin = true;

vi.mock('@/lib/backoffice-auth', () => ({
  requirePlatformAdmin: async () => (isAdmin
    ? { admin: fakeCallsAdmin(db), userId: 'bo-1' }
    : { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) }),
}));

import { GET, dynamic } from './route';
import { callLink } from '@/lib/calls/link';

const FIRM = '11111111-1111-4111-8111-111111111111';
const TEST_FIRM = '22222222-2222-4222-8222-222222222222';
const HUB = '33333333-3333-4333-8333-333333333333';

function call(id: string, o: Record<string, unknown>) {
  db.tables.calls.push({
    id, name: 'A call', description: null, opens_at: null, closes_at: null, timezone: 'Europe/Lisbon', visibility: 'listed', limit_unit: 'project',
    allow_multiple: false, content_language: 'en', currency: 'EUR', status: 'draft', link_token: null, config_version: 1, validated_at: null,
    validated_by: null, published_at: null, closed_at: null, duplicated_from: null, created_by: 'u-ana', created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z', ...o,
  });
}

beforeEach(() => {
  db = callsDb();
  isAdmin = true;
  delete process.env.CALLS_MODE;
  db.users.set('u-ana', { id: 'u-ana', email: 'alexandrameira@ablute.pt' });
  db.users.set('u-bob', { id: 'u-bob', email: 'bob@hub.test' });
  db.tables.catalog_entities.push({ id: FIRM, name: 'ablute_ — Internal QA', is_test: false }, { id: TEST_FIRM, name: 'zz-test-firm', is_test: true });
  db.tables.incubators.push({ id: HUB, name: 'Test Hub', is_test: false });
  db.tables.incubator_members.push({ user_id: 'u-bob', full_name: 'Bob Builder' });
  db.tables.matchdeal_investor_members.push({ id: 'm-ana', user_id: 'u-ana', catalog_entity_id: FIRM });
  db.tables.matchdeal_profiles.push({ membership_id: 'm-ana', kind: 'investor', representative_name: 'Alexandra Meira' });
});

describe('access', () => {
  it('is never prerendered at build time (the build once showed it as static)', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('refuses anyone who is not a platform admin, and returns nothing', async () => {
    isAdmin = false;
    const res = await GET();
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('Internal QA');
  });
});

describe('the list', () => {
  it('shows the firm, who created it, the counts and the link of a published call', async () => {
    call('c1', {
      promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, name: 'zz-test call 908', status: 'scheduled', link_token: 'tok-908-abcdefghijklmn',
      opens_at: '2026-12-01T09:00:00Z', closes_at: '2027-01-01T09:00:00Z', validated_at: '2026-10-09T11:00:00Z', validated_by: 'u-ana', published_at: '2026-10-09T11:05:00Z',
    });
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      id: 'c1', name: 'zz-test call 908', status: 'scheduled',
      organisation: { kind: 'catalog_entity', name: 'ablute_ — Internal QA', isTest: false },
      admin: { name: 'Alexandra Meira', email: 'alexandrameira@ablute.pt' },
      applications: { submitted: 0, inProgress: 0 },
      linkToken: 'tok-908-abcdefghijklmn', timezone: 'Europe/Lisbon',
      validatedBy: { email: 'alexandrameira@ablute.pt' }, validatedAt: '2026-10-09T11:00:00Z', publishedAt: '2026-10-09T11:05:00Z',
    });
    // The URL the back-office shows is the one the entity's editor shows: same helper, same token.
    expect(callLink('https://www.sherlockdeal.com', body.rows[0].linkToken)).toBe('https://www.sherlockdeal.com/call/tok-908-abcdefghijklmn');
  });

  it('an unpublished call has no link; a test firm is flagged; an incubator is named as such', async () => {
    call('c1', { promoter_kind: 'catalog_entity', catalog_entity_id: TEST_FIRM, name: 'Draft one', created_at: '2026-10-02T10:00:00Z' });
    call('c2', { promoter_kind: 'incubator', incubator_id: HUB, name: 'Hub call', created_by: 'u-bob', created_at: '2026-10-03T10:00:00Z' });
    const rows = (await (await GET()).json()).rows;
    const byId = Object.fromEntries(rows.map((r: { id: string }) => [r.id, r]));
    expect(byId.c1).toMatchObject({ linkToken: null, organisation: { name: 'zz-test-firm', isTest: true } });
    expect(byId.c2).toMatchObject({ organisation: { kind: 'incubator', name: 'Test Hub', isTest: false }, admin: { name: 'Bob Builder', email: 'bob@hub.test' } });
  });

  it('counts submitted and in-progress applications as NUMBERS and never returns what is in them', async () => {
    call('c1', { promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, status: 'open' });
    call('c2', { promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, name: 'Other call' });
    const secret = 'TOP-SECRET-ANSWER-FROM-A-STARTUP';
    db.tables.call_applications.push(
      { id: 'a1', call_id: 'c1', status: 'submitted', applicant_user_id: 'x1', draft_answers: { q: secret } },
      { id: 'a2', call_id: 'c1', status: 'submitted', applicant_user_id: 'x2', draft_answers: { q: secret } },
      { id: 'a3', call_id: 'c1', status: 'draft', applicant_user_id: 'x3', draft_answers: { q: secret } },
      { id: 'a4', call_id: 'c1', status: 'withdrawn', applicant_user_id: 'x4', draft_answers: {} },
      { id: 'a5', call_id: 'c2', status: 'draft', applicant_user_id: 'x5', draft_answers: { q: secret } },
    );
    db.tables.call_application_submissions.push({ id: 's1', application_id: 'a1', answers: { q: secret } });
    const res = await GET();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(secret);
    expect(text).not.toContain('x1');
    expect(text).not.toContain('applicant_user_id');
    const rows = JSON.parse(text).rows as { id: string; applications: unknown }[];
    expect(rows.find((r) => r.id === 'c1')!.applications).toEqual({ submitted: 2, inProgress: 1 });
    expect(rows.find((r) => r.id === 'c2')!.applications).toEqual({ submitted: 0, inProgress: 1 });
  });

  it('carries the phases, the fields per page and who confirmed it, for the expanded row', async () => {
    call('c1', { promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, validated_by: 'u-bob', validated_at: '2026-10-09T10:00:00Z' });
    db.tables.call_phases.push(
      { call_id: 'c1', position: 1, name: 'Evaluation', starts_on: '2026-11-01', ends_on: null },
      { call_id: 'c1', position: 0, name: 'Applications', starts_on: '2026-10-01', ends_on: '2026-10-31' },
    );
    for (const [page, n] of [[1, 3], [2, 1]] as const) for (let i = 0; i < n; i++) db.tables.call_form_fields.push({ call_id: 'c1', page });
    const r = (await (await GET()).json()).rows[0];
    expect(r.phases.map((p: { name: string }) => p.name)).toEqual(['Applications', 'Evaluation']);
    expect(r.fieldsPerPage).toEqual([{ page: 1, fields: 3 }, { page: 2, fields: 1 }]);
    expect(r.validatedBy).toMatchObject({ name: 'Bob Builder', email: 'bob@hub.test' });
  });

  it('shows the status as it is NOW without writing anything (a scheduled call whose time has come reads as open)', async () => {
    call('c1', { promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, status: 'scheduled', opens_at: '2020-01-01T00:00:00Z', closes_at: '2999-01-01T00:00:00Z' });
    const before = JSON.stringify(db.tables);
    expect((await (await GET()).json()).rows[0].status).toBe('open');
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(db.tables.calls[0].status).toBe('scheduled');
  });

  it('works whatever CALLS_MODE says: it is the platform team\'s own view', async () => {
    call('c1', { promoter_kind: 'catalog_entity', catalog_entity_id: FIRM });
    process.env.CALLS_MODE = 'off';
    expect((await (await GET()).json()).rows).toHaveLength(1);
    delete process.env.CALLS_MODE;
  });

  it('no calls yet is an empty list, not an error', async () => {
    expect(await (await GET()).json()).toEqual({ ok: true, rows: [] });
  });
});
