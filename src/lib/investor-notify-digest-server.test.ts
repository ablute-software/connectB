import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runInvestorNotifyDigestSweep } from './investor-notify-digest-server';

// The bug this file pins down: runInvestorNotifyDigestSweep used to read
// investor_pipeline_admissions and put EVERY admission with a presented_at
// straight into the digest email, with no check that the org is still
// visible TODAY. Between presentation and the 9am sweep a startup can close
// its account, get suspended (owner/platform/back-office), or get excluded
// from discovery outright — and in the closed case, mailing its name out
// actively undoes real GDPR Article 14 work done elsewhere in this codebase.
//
// The fix reuses eligiblePipelineOrgIds (portal-access.ts), which itself
// reuses filterEligibleOrgs (pipeline-eligibility.ts) — the ONE shared
// "still eligible" predicate, already unit-tested field-by-field in
// pipeline-eligibility.test.ts. This file does not re-derive those field
// rules; it pins the SWEEP's own behaviour: a filtered-out admission never
// reaches the email, it still counts toward the watermark advance, it never
// counts toward the emailed total, and an all-filtered member gets no email
// at all (never an empty digest) while its watermark still moves forward so
// tomorrow's run doesn't re-examine the same now-invisible admission again.
//
// This is a DB-dependent sweep (unlike investor-notify-digest.ts's pure
// decideNotifyDigestForMember, tested in investor-notify-digest.test.ts), so
// it follows this codebase's established pattern for that combination —
// same as catalog-monthly-delivery-server.test.ts: a minimal, chainable fake
// of the supabase-js query builder, answering per table from fixtures, with
// every write recorded so tests can assert on what did (and did not)
// happen. sendTransactionalEmail is mocked the same way
// resend-logging.test.ts asserts side effects — by recording calls, not by
// hitting the real provider.

const sentEmails: { to: string; subject: string; html: string; text?: string }[] = [];
let sendOutcome: { sent: boolean } = { sent: true };

vi.mock('./resend', async () => {
  const actual = await vi.importActual<typeof import('./resend')>('./resend');
  return {
    ...actual,
    sendTransactionalEmail: async (opts: { to: string; subject: string; html: string; text?: string }) => {
      sentEmails.push(opts);
      return sendOutcome;
    },
  };
});

beforeEach(() => {
  sentEmails.length = 0;
  sendOutcome = { sent: true };
});

interface OrgFixture {
  id: string;
  name: string;
  sectors: string[];
  stage: string;
  country: string;
  closed_at?: string | null;
  is_test?: boolean;
  website?: string;
  round_target_eur?: number;
  current_phase?: string;
  founded_year?: number;
  revenue_eur?: number;
  primary_contact_person_id?: string;
  owner_suspended_at?: string | null;
  platform_suspended_at?: string | null;
  discovery_excluded_reason?: string | null;
  moderation_status?: string | null;
  moderation_suspended_until?: string | null;
}

// The nine profile-gate fields spelled out for real (isProfileGateComplete is
// reused, never reimplemented — pipeline-eligibility.test.ts's own
// convention), so a "visible" fixture actually passes every eligibility rule
// rather than coincidentally passing because a field was never checked.
function visibleOrg(id: string, name: string, overrides: Partial<OrgFixture> = {}): OrgFixture {
  return {
    id, name, sectors: ['healthtech'], stage: 'seed', country: 'PT',
    closed_at: null, is_test: false,
    website: 'https://example.com', round_target_eur: 1_300_000, current_phase: 'raising',
    founded_year: 2024, revenue_eur: 0, primary_contact_person_id: 'person-1',
    owner_suspended_at: null, platform_suspended_at: null,
    discovery_excluded_reason: null, moderation_status: 'active', moderation_suspended_until: null,
    ...overrides,
  };
}

interface MemberFixture {
  id: string;
  user_id: string;
  catalog_entity_id: string;
  notify_new_eligible_last_sent_at: string | null;
}

type Filter = { col: string; val: unknown; kind: 'eq' | 'in' | 'gt' };

interface FixtureOpts {
  members: MemberFixture[];
  admissionsByCatalogEntity: Record<string, { org_id: string; presented_at: string }[]>;
  orgs: OrgFixture[];
  mdProfiles?: { membership_id: string; owner_suspended_at?: string | null; platform_suspended_at?: string | null }[];
  internalMembers?: { id: string; catalog_entity_id: string }[];
  testCatalogEntityIds?: Set<string>;
  userEmails?: Record<string, string>;
}

function getEq(filters: Filter[], col: string) { return filters.find((f) => f.col === col && f.kind === 'eq')?.val; }
function getIn(filters: Filter[], col: string) { return filters.find((f) => f.col === col && f.kind === 'in')?.val as unknown[] | undefined; }
function getGt(filters: Filter[], col: string) { return filters.find((f) => f.col === col && f.kind === 'gt')?.val as string | undefined; }

function makeFakeAdmin(opts: FixtureOpts) {
  const watermarkUpdates: { id: string; value: string }[] = [];

  function resolveMulti(table: string, filters: Filter[], mode: 'select' | 'update', updatePayload: Record<string, unknown> | null) {
    if (table === 'matchdeal_investor_members') {
      if (mode === 'update') {
        const id = getEq(filters, 'id') as string;
        watermarkUpdates.push({ id, value: updatePayload?.notify_new_eligible_last_sent_at as string });
        return { data: null, error: null };
      }
      // The eligible-members list query — same fixed WHERE clause every
      // call, so (like catalog-monthly-delivery-server.test.ts's non-claim
      // tables) the fixture already represents the filtered result.
      return { data: opts.members, error: null };
    }
    if (table === 'investor_pipeline_admissions') {
      const catalogEntityId = getEq(filters, 'investor_catalog_entity_id') as string;
      const gtVal = getGt(filters, 'presented_at');
      let rows = opts.admissionsByCatalogEntity[catalogEntityId] ?? [];
      if (gtVal) rows = rows.filter((r) => r.presented_at > gtVal);
      return { data: rows, error: null };
    }
    if (table === 'orgs') {
      const inIds = getIn(filters, 'id');
      if (inIds) return { data: opts.orgs.filter((o) => inIds.includes(o.id)), error: null };
      // select('*') with no filter — eligiblePipelineOrgIds's own deliberately
      // wide read, per portal-access.ts's header.
      return { data: opts.orgs, error: null };
    }
    if (table === 'matchdeal_profiles') {
      const inIds = getIn(filters, 'membership_id');
      const rows = (opts.mdProfiles ?? []).filter((p) => !inIds || inIds.includes(p.membership_id));
      return { data: rows, error: null };
    }
    return { data: null, error: null };
  }

  function resolveSingle(table: string, filters: Filter[]) {
    if (table === 'matchdeal_investor_members') {
      const catalogEntityId = getEq(filters, 'catalog_entity_id') as string;
      const match = (opts.internalMembers ?? []).find((m) => m.catalog_entity_id === catalogEntityId);
      return { data: match ? { id: match.id } : null, error: null };
    }
    if (table === 'catalog_entities') {
      const id = getEq(filters, 'id') as string;
      return { data: { is_test: opts.testCatalogEntityIds?.has(id) ?? false }, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const filters: Filter[] = [];
    let mode: 'select' | 'update' = 'select';
    let updatePayload: Record<string, unknown> | null = null;
    const b: Record<string, unknown> = {};
    const self = () => b as never;
    Object.assign(b, {
      select: self,
      update: (payload: Record<string, unknown>) => { mode = 'update'; updatePayload = payload; return self(); },
      eq: (col: string, val: unknown) => { filters.push({ col, val, kind: 'eq' }); return self(); },
      in: (col: string, val: unknown) => { filters.push({ col, val, kind: 'in' }); return self(); },
      gt: (col: string, val: unknown) => { filters.push({ col, val, kind: 'gt' }); return self(); },
      not: self,
      order: self,
      limit: self,
      maybeSingle: () => Promise.resolve(resolveSingle(table, filters)),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolveMulti(table, filters, mode, updatePayload)).then(resolve),
    });
    return b;
  }

  const admin = {
    from: (table: string) => builder(table),
    auth: {
      admin: {
        getUserById: async (userId: string) => ({
          data: { user: { email: opts.userEmails?.[userId] ?? `${userId}@example.com` } },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient;

  return { admin, watermarkUpdates };
}

const NOW = new Date('2026-09-30T09:00:00.000Z');

const MEMBER: MemberFixture = {
  id: 'member-1', user_id: 'user-1', catalog_entity_id: 'firm-1', notify_new_eligible_last_sent_at: null,
};

describe('runInvestorNotifyDigestSweep — visibility filter (reuses eligiblePipelineOrgIds)', () => {
  it('an admission for a CLOSED org does not appear in the email body', async () => {
    const orgVisible = visibleOrg('org-visible', 'Ablute');
    const orgClosed = visibleOrg('org-closed', 'Estojo', { closed_at: '2026-09-20T00:00:00.000Z' });
    const { admin } = makeFakeAdmin({
      members: [MEMBER],
      admissionsByCatalogEntity: {
        'firm-1': [
          { org_id: 'org-visible', presented_at: '2026-09-21T00:00:00.000Z' },
          { org_id: 'org-closed', presented_at: '2026-09-22T00:00:00.000Z' },
        ],
      },
      orgs: [orgVisible, orgClosed],
    });

    const result = await runInvestorNotifyDigestSweep(admin, NOW);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].html).toContain('Ablute');
    expect(sentEmails[0].html).not.toContain('Estojo');
    expect(sentEmails[0].text).not.toContain('Estojo');
    expect(sentEmails[0].subject).toBe('1 new startup in your pipeline'); // count reflects only the visible one
    expect(result.orgsSkippedNotVisible).toBe(1);
    expect(result.emailsSent).toBe(1);
  });

  it('an admission for a back-office SUSPENDED org (not yet past moderation_suspended_until) does not appear', async () => {
    const orgVisible = visibleOrg('org-visible', 'Ablute');
    const orgSuspended = visibleOrg('org-suspended', 'Estojo', {
      moderation_status: 'suspended', moderation_suspended_until: '2099-01-01T00:00:00.000Z',
    });
    const { admin } = makeFakeAdmin({
      members: [MEMBER],
      admissionsByCatalogEntity: {
        'firm-1': [
          { org_id: 'org-visible', presented_at: '2026-09-21T00:00:00.000Z' },
          { org_id: 'org-suspended', presented_at: '2026-09-22T00:00:00.000Z' },
        ],
      },
      orgs: [orgVisible, orgSuspended],
    });

    const result = await runInvestorNotifyDigestSweep(admin, NOW);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].html).toContain('Ablute');
    expect(sentEmails[0].html).not.toContain('Estojo');
    expect(result.orgsSkippedNotVisible).toBe(1);
  });

  it('ALL admissions filtered out -> no email sent, but the watermark still advances', async () => {
    const orgClosed = visibleOrg('org-closed', 'Estojo', { closed_at: '2026-09-20T00:00:00.000Z' });
    const { admin, watermarkUpdates } = makeFakeAdmin({
      members: [MEMBER],
      admissionsByCatalogEntity: {
        'firm-1': [{ org_id: 'org-closed', presented_at: '2026-09-22T00:00:00.000Z' }],
      },
      orgs: [orgClosed],
    });

    const result = await runInvestorNotifyDigestSweep(admin, NOW);

    expect(sentEmails).toHaveLength(0); // no call to sendTransactionalEmail at all
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(0);
    expect(result.orgsSkippedNotVisible).toBe(1);
    // The presentation was examined and is now accounted for — tomorrow's
    // run must not re-examine the same now-invisible admission.
    expect(watermarkUpdates).toEqual([{ id: 'member-1', value: NOW.toISOString() }]);
  });

  it('sanity: a mix of one visible and two filtered (closed + suspended) sends an email with ONLY the visible one, correct count', async () => {
    const orgVisible = visibleOrg('org-visible', 'Ablute');
    const orgClosed = visibleOrg('org-closed', 'Estojo', { closed_at: '2026-09-20T00:00:00.000Z' });
    const orgSuspended = visibleOrg('org-suspended', 'Krohnsty', {
      moderation_status: 'suspended', moderation_suspended_until: '2099-01-01T00:00:00.000Z',
    });
    const { admin, watermarkUpdates } = makeFakeAdmin({
      members: [MEMBER],
      admissionsByCatalogEntity: {
        'firm-1': [
          { org_id: 'org-closed', presented_at: '2026-09-21T00:00:00.000Z' },
          { org_id: 'org-visible', presented_at: '2026-09-22T00:00:00.000Z' },
          { org_id: 'org-suspended', presented_at: '2026-09-23T00:00:00.000Z' },
        ],
      },
      orgs: [orgVisible, orgClosed, orgSuspended],
    });

    const result = await runInvestorNotifyDigestSweep(admin, NOW);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toBe('1 new startup in your pipeline');
    expect(sentEmails[0].html).toContain('Ablute');
    expect(sentEmails[0].html).not.toContain('Estojo');
    expect(sentEmails[0].html).not.toContain('Krohnsty');
    expect(result.orgsSkippedNotVisible).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(watermarkUpdates).toEqual([{ id: 'member-1', value: NOW.toISOString() }]);
  });

  it('nothing filtered: unchanged behaviour, every admission is genuinely visible', async () => {
    const orgA = visibleOrg('org-a', 'Ablute');
    const orgB = visibleOrg('org-b', 'Sherlock');
    const { admin } = makeFakeAdmin({
      members: [MEMBER],
      admissionsByCatalogEntity: {
        'firm-1': [
          { org_id: 'org-a', presented_at: '2026-09-21T00:00:00.000Z' },
          { org_id: 'org-b', presented_at: '2026-09-22T00:00:00.000Z' },
        ],
      },
      orgs: [orgA, orgB],
    });

    const result = await runInvestorNotifyDigestSweep(admin, NOW);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toBe('2 new startups in your pipeline');
    expect(result.orgsSkippedNotVisible).toBe(0);
    expect(result.emailsSent).toBe(1);
  });
});
