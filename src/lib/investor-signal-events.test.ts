import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decisionDedupKey, isNotStartupFaultChip, swipePassReasonForChips } from './investor-signal-events';
// recordInvestorSignal/recordInvestorSignalForEntity live in the sibling
// -server file (see its own header comment: keeping them here would pull
// server-only code into investor-signal-events.ts, which a client
// component also imports for its client-safe exports above).
import { recordInvestorSignal, recordInvestorSignalForEntity } from './investor-signal-events-server';

describe('isNotStartupFaultChip', () => {
  it('marks the three chips that are about the investor, not the startup', () => {
    expect(isNotStartupFaultChip('portfolio_competitor')).toBe(true);
    expect(isNotStartupFaultChip('no_capacity_now')).toBe(true);
    expect(isNotStartupFaultChip('already_knew')).toBe(true);
  });

  it('leaves every other chip unmarked', () => {
    expect(isNotStartupFaultChip('too_early')).toBe(false);
    expect(isNotStartupFaultChip('sector_thesis')).toBe(false);
    expect(isNotStartupFaultChip('valuation')).toBe(false);
  });
});

describe('swipePassReasonForChips', () => {
  it('maps the first chip that has a fixed-category equivalent', () => {
    expect(swipePassReasonForChips(['too_early'])).toBe('too_early');
    expect(swipePassReasonForChips(['sector_thesis'])).toBe('outside_thesis');
    expect(swipePassReasonForChips(['ticket_size'])).toBe('ticket_too_small');
  });

  it('picks the FIRST mappable chip when several are selected', () => {
    expect(swipePassReasonForChips(['valuation', 'ticket_size', 'too_early'])).toBe('ticket_too_small');
  });

  it('falls back to "other" for a chip with no fixed-category equivalent, or no chips at all', () => {
    expect(swipePassReasonForChips(['valuation'])).toBe('other');
    expect(swipePassReasonForChips(['no_capacity_now', 'already_knew'])).toBe('other');
    expect(swipePassReasonForChips([])).toBe('other');
  });
});

describe('decisionDedupKey', () => {
  it('is stable and unique per (firm, org, decision)', () => {
    const key = decisionDedupKey('firm-1', 'org-1', 'decision-1');
    expect(key).toBe('firm-1:org-1:decisao:decision-1');
    expect(decisionDedupKey('firm-1', 'org-1', 'decision-2')).not.toBe(key);
    expect(decisionDedupKey('firm-2', 'org-1', 'decision-1')).not.toBe(key);
  });
});

// Prompt 741 §B.1 — recordInvestorSignal/recordInvestorSignalForEntity's own
// contract: never throws, degrades to a no-op when there's no firm to
// attribute the event to. A minimal fake admin covering exactly the tables
// these two (plus findOrOpenEpisode/isFirmTestOrInternal, which they call
// internally) touch — not a general-purpose Supabase fake.
interface FakeSignalDb {
  investorMemberRows?: { id: string; catalog_entity_id: string }[];
  openEpisodeId?: string | null;
  episodeInsertError?: { code: string; message: string } | null;
  isTest?: boolean;
  isInternal?: boolean;
  eventInsertError?: { code: string; message: string } | null;
}

function limitResult<T>(rows: T[]) {
  return {
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: T[]; error: null }) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
}

function fakeSignalAdmin(db: FakeSignalDb): SupabaseClient {
  return {
    from(table: string) {
      // resolveActiveInvestorMember's own chain (.eq().eq().order().limit())
      // and isFirmTestOrInternal's (.eq().eq().limit().maybeSingle()) both
      // issue exactly two .eq() calls against this table, then diverge.
      if (table === 'matchdeal_investor_members') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({ limit: () => limitResult(db.investorMemberRows ?? []) }),
                limit: () => limitResult(db.isInternal ? [{ id: 'member-internal' }] : []),
              }),
            }),
          }),
        };
      }
      if (table === 'catalog_entities') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { is_test: !!db.isTest }, error: null }) }) }) };
      }
      if (table === 'investor_opportunity_episodes') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ is: () => ({
            maybeSingle: () => Promise.resolve({ data: db.openEpisodeId ? { id: db.openEpisodeId } : null, error: null }),
          }) }) }) }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({
            data: null, error: db.episodeInsertError ?? { code: 'unexpected', message: 'fakeSignalAdmin: no episodeInsertError configured' },
          }) }) }),
        };
      }
      if (table === 'investor_signal_events') {
        return { insert: () => ({ select: () => ({ single: () => Promise.resolve(
          db.eventInsertError ? { data: null, error: db.eventInsertError } : { data: { id: 'event-1' }, error: null },
        ) }) }) };
      }
      throw new Error(`fakeSignalAdmin: unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe('recordInvestorSignal / recordInvestorSignalForEntity', () => {
  it('writes nothing when the user cannot be resolved to an active investor firm', async () => {
    const admin = fakeSignalAdmin({ investorMemberRows: [] });
    const result = await recordInvestorSignal(admin, {
      userId: 'user-1', orgId: 'org-1', level: 'avaliacao_substantiva', kind: 'document_opened',
    });
    expect(result).toEqual({ id: null, deduped: false });
  });

  it('a repeated dedup key comes back deduped, not as a thrown error', async () => {
    const admin = fakeSignalAdmin({
      openEpisodeId: 'episode-1', isTest: false, isInternal: false,
      eventInsertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    const result = await recordInvestorSignalForEntity(admin, {
      investorCatalogEntityId: 'firm-1', orgId: 'org-1', level: 'avaliacao_substantiva', kind: 'document_opened',
      dedupKey: 'firm-1:org-1:document_opened:doc-1:user-1:2026-09-26',
    });
    expect(result).toEqual({ id: null, deduped: true });
  });

  it('swallows a write failure instead of throwing, so it never blocks the real action it rides along with', async () => {
    const admin = fakeSignalAdmin({ openEpisodeId: null, episodeInsertError: { code: 'unexpected', message: 'db is down' } });
    await expect(recordInvestorSignalForEntity(admin, {
      investorCatalogEntityId: 'firm-1', orgId: 'org-1', level: 'progressao', kind: 'documents_requested',
    })).resolves.toEqual({ id: null, deduped: false });
  });
});
