import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONDITION_TRIGGER_CHIPS, UNDETECTABLE_CONDITION_KINDS, conditionKindLabel, conditionNeedsConsent,
  detectConditionFulfillment, reapresentationMessage,
} from './reevaluation-conditions';

// Same hand-rolled fake-SupabaseClient pattern as reconciliation.test.ts —
// a table-keyed set of canned rows, filtered exactly the way the real
// query filters (eq/gt), so a wrong eq() value in the real code shows up
// as an empty result here too.
function makeFakeAdmin(rows: Record<string, Record<string, unknown>[]>): SupabaseClient {
  return {
    from: (table: string) => {
      const tableRows = rows[table] ?? [];
      const filters: { col: string; op: 'eq' | 'gt'; val: unknown }[] = [];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => { filters.push({ col, op: 'eq', val }); return builder; },
        gt: (col: string, val: unknown) => { filters.push({ col, op: 'gt', val }); return builder; },
        maybeSingle: () => {
          const matched = tableRows.filter((r) => filters.every((f) => (f.op === 'eq' ? r[f.col] === f.val : String(r[f.col]) > String(f.val))));
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        then: (resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) => {
          const matched = tableRows.filter((r) => filters.every((f) => (f.op === 'eq' ? r[f.col] === f.val : String(r[f.col]) > String(f.val))));
          resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const SINCE = '2026-09-01T00:00:00Z';

describe('detectConditionFulfillment', () => {
  it('never detects an undetectable kind (lead_investor_confirmed) — no source field exists', async () => {
    expect(UNDETECTABLE_CONDITION_KINDS.has('lead_investor_confirmed')).toBe(true);
    const admin = makeFakeAdmin({});
    expect(await detectConditionFulfillment(admin, 'org-1', 'lead_investor_confirmed', SINCE)).toBeNull();
  });

  it('detects a completed pilot from a done roadmap_events row, keyword-matched, deterministic', async () => {
    const admin = makeFakeAdmin({
      roadmap_events: [
        { id: 'r1', title: 'Pilot completed with Acme Health', description: null, status: 'done', updated_at: '2026-10-01T00:00:00Z', org_id: 'org-1' },
      ],
    });
    const result = await detectConditionFulfillment(admin, 'org-1', 'pilot_completed', SINCE);
    expect(result).toEqual({ factText: 'Pilot completed with Acme Health', sourceTable: 'roadmap_events', sourceId: 'r1' });
  });

  it('does not match an unrelated done roadmap event', async () => {
    const admin = makeFakeAdmin({
      roadmap_events: [{ id: 'r2', title: 'Hired a new CTO', description: null, status: 'done', updated_at: '2026-10-01T00:00:00Z', org_id: 'org-1' }],
    });
    expect(await detectConditionFulfillment(admin, 'org-1', 'pilot_completed', SINCE)).toBeNull();
  });

  it('detects a regulatory milestone in Portuguese too — bilingual keyword match', async () => {
    const admin = makeFakeAdmin({
      roadmap_events: [{ id: 'r3', title: 'Certificação regulatória obtida', description: null, status: 'done', updated_at: '2026-10-01T00:00:00Z', org_id: 'org-1' }],
    });
    const result = await detectConditionFulfillment(admin, 'org-1', 'regulatory_milestone', SINCE);
    expect(result?.factText).toBe('Certificação regulatória obtida');
  });

  it('detects a first-customer claim from an accepted tracao_gtm claim', async () => {
    const admin = makeFakeAdmin({
      company_claims: [{ id: 'c1', statement: 'Signed our first customer', category: 'tracao_gtm', status: 'accepted', updated_at: '2026-10-01T00:00:00Z', org_id: 'org-1' }],
    });
    const result = await detectConditionFulfillment(admin, 'org-1', 'first_customer', SINCE);
    expect(result).toEqual({ factText: 'Signed our first customer', sourceTable: 'company_claims', sourceId: 'c1' });
  });

  it('never matches a claim that is not yet accepted (status still proposed)', async () => {
    const admin = makeFakeAdmin({
      company_claims: [{ id: 'c2', statement: 'First customer signed', category: 'tracao_gtm', status: 'proposed', updated_at: '2026-10-01T00:00:00Z', org_id: 'org-1' }],
    });
    expect(await detectConditionFulfillment(admin, 'org-1', 'first_customer', SINCE)).toBeNull();
  });

  it('detects recurring revenue distinctly from a first customer', async () => {
    const admin = makeFakeAdmin({
      company_claims: [{ id: 'c3', statement: 'Now at €10k MRR', category: 'tracao_gtm', status: 'accepted', updated_at: '2026-10-01T00:00:00Z', org_id: 'org-1' }],
    });
    expect(await detectConditionFulfillment(admin, 'org-1', 'recurring_revenue', SINCE)).not.toBeNull();
    expect(await detectConditionFulfillment(admin, 'org-1', 'first_customer', SINCE)).toBeNull();
  });

  it('detects team_complete from any accepted equipa claim (no keyword needed — the category alone is the signal)', async () => {
    const admin = makeFakeAdmin({
      company_claims: [{ id: 'c4', statement: 'Hired a Head of Sales', category: 'equipa', status: 'accepted', updated_at: '2026-10-01T00:00:00Z', org_id: 'org-1' }],
    });
    const result = await detectConditionFulfillment(admin, 'org-1', 'team_complete', SINCE);
    expect(result?.sourceTable).toBe('company_claims');
  });

  it('detects a new round condition from orgs.updated_at moving past the condition date', async () => {
    const admin = makeFakeAdmin({
      orgs: [{ id: 'org-1', round_target_eur: 2000000, round_min_ticket_eur: 20000, round_instruments: ['safe'], updated_at: '2026-10-01T00:00:00Z' }],
    });
    const result = await detectConditionFulfillment(admin, 'org-1', 'new_round_condition', SINCE);
    expect(result?.sourceTable).toBe('orgs');
  });

  it('does not fire a new-round-condition fact when the org has not changed since', async () => {
    const admin = makeFakeAdmin({ orgs: [{ id: 'org-1', round_target_eur: 2000000, updated_at: '2026-08-01T00:00:00Z' }] });
    expect(await detectConditionFulfillment(admin, 'org-1', 'new_round_condition', SINCE)).toBeNull();
  });

  it('never fires the SAME roadmap event for two different condition kinds it does not match', async () => {
    const admin = makeFakeAdmin({
      roadmap_events: [{ id: 'r5', title: 'Pilot completed', description: null, status: 'done', updated_at: '2026-10-01T00:00:00Z', org_id: 'org-1' }],
    });
    expect(await detectConditionFulfillment(admin, 'org-1', 'technical_validation', SINCE)).toBeNull();
    expect(await detectConditionFulfillment(admin, 'org-1', 'regulatory_milestone', SINCE)).toBeNull();
  });
});

describe('conditionNeedsConsent', () => {
  it('needs consent for every kind except date and never_show_again', () => {
    expect(conditionNeedsConsent('pilot_completed')).toBe(true);
    expect(conditionNeedsConsent('date')).toBe(false);
    expect(conditionNeedsConsent('never_show_again')).toBe(false);
  });
});

describe('CONDITION_TRIGGER_CHIPS', () => {
  it('only offers the follow-up question for the four documented chips', () => {
    expect(CONDITION_TRIGGER_CHIPS.has('too_early')).toBe(true);
    expect(CONDITION_TRIGGER_CHIPS.has('traction')).toBe(true);
    expect(CONDITION_TRIGGER_CHIPS.has('team_execution')).toBe(true);
    expect(CONDITION_TRIGGER_CHIPS.has('valuation')).toBe(true);
    expect(CONDITION_TRIGGER_CHIPS.has('geography')).toBe(false);
  });
});

describe('reapresentationMessage — template only, never a model', () => {
  it('cites the declared fact and date, and says it is unverified', () => {
    const msg = reapresentationMessage(conditionKindLabel('pilot_completed'), 'Pilot completed with Acme Health', '2026-11-15T00:00:00Z');
    expect(msg).toContain('pilot completed');
    expect(msg).toContain('Pilot completed with Acme Health');
    expect(msg).toContain('15 Nov 2026');
    expect(msg).toContain('Declared by the startup, not verified.');
  });
});
