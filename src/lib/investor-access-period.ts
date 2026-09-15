// Prompt 588 Bloco C.1 — stamps investor_billing.investor_access_started_at
// the first time an investor firm's profile is actually read (GET
// /api/portal/investor-profile — see that route's own call site). Kept as
// its own tiny, isolated write rather than folded into
// investor-billing-access.ts's readInvestorFirmBillingAccess(): that
// function is an existing, heavily-reused GATE ("is this firm blocked"),
// and this prompt's own scope is explicit — copy, plus this one new date,
// never a change to billing gate logic. A second read-then-write here
// (rather than a single atomic upsert) is deliberately simple: the
// worst case of a race is the timestamp being set twice within
// milliseconds of each other, harmless for an informational date that
// backs marketing copy, not a financial calculation.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function ensureInvestorAccessStarted(admin: SupabaseClient, catalogEntityId: string): Promise<void> {
  const { data: existing, error: readErr } = await admin.from('investor_billing')
    .select('investor_access_started_at').eq('catalog_entity_id', catalogEntityId).maybeSingle();
  if (readErr) { console.error('ensureInvestorAccessStarted read failed:', readErr.message); return; }

  if (!existing) {
    const { error } = await admin.from('investor_billing')
      .insert({ catalog_entity_id: catalogEntityId, investor_access_started_at: new Date().toISOString() });
    // A concurrent request may have inserted the row first (no unique-race
    // guard needed beyond the table's own primary key) — not an error worth
    // logging, the row exists either way.
    if (error && error.code !== '23505') console.error('ensureInvestorAccessStarted insert failed:', error.message);
    return;
  }
  if (existing.investor_access_started_at) return;

  const { error } = await admin.from('investor_billing')
    .update({ investor_access_started_at: new Date().toISOString() }).eq('catalog_entity_id', catalogEntityId);
  if (error) console.error('ensureInvestorAccessStarted update failed:', error.message);
}
