// Prompt 313 — migration-gate probes for the two things migration 0208
// adds, same pattern as every other migration-gated feature
// (capability-probe.ts). Two separate probes even though both columns ship
// in the same migration: readExistingClaims only ever needs to know about
// document_refs, and the extraction pipeline only ever needs to know about
// document_extractions — keeping them apart means neither caller has to
// reason about the other's table.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const documentExtractionsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('document_extractions').select('id').limit(1);
  return !error;
});

export const documentRefsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('company_claims').select('document_refs').limit(1);
  return !error;
});

// Prompt 358 Phase 1 — migration 0234's gap_disposition column, same
// probe-gated pattern.
export const gapDispositionAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('company_claims').select('gap_disposition').limit(1);
  return !error;
});

// Prompt 472 §D — migration 0280's two new columns on company_claims. One
// probe covers both, probed on founder_prompt_state: they always ship in
// the same migration, so there is no real skew case between them worth a
// second probe — same reasoning marketFactsAvailable's own comment gives
// for its four tables.
export const founderPromptStateAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('company_claims').select('founder_prompt_state').limit(1);
  return !error;
});

// Prompt 358 Phase 2 — migration 0235's two tables. Separate probes for the
// same reason as above: the reconciliation engine only ever needs
// gap_reconciliations, and the question ledger only ever needs gap_questions.
export const gapReconciliationsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('gap_reconciliations').select('id').limit(1);
  return !error;
});

export const gapQuestionsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('gap_questions').select('id').limit(1);
  return !error;
});

// Prompt 480 — migration 0282's lock table. This probe fails OPEN, unlike
// most in this file: with the table absent, reconciliation runs exactly as
// it does today (unlocked), which is the behaviour that shipped for months.
// Failing closed would mean a missing table silently disables reconciliation
// altogether — trading a rare double-run for a permanent outage, which is
// the worse of the two by a wide margin.
export const reconciliationLocksAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('reconciliation_locks').select('org_id').limit(1);
  return !error;
});

// Prompt 359 Block D — migration 0238's suggestion memory.
export const roadmapEventSuggestionsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('roadmap_event_suggestions').select('id').limit(1);
  return !error;
});

// Prompt 359 Block A — migration 0237's roadmap_events table.
export const roadmapEventsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('roadmap_events').select('id').limit(1);
  return !error;
});

// Prompt 541 §B — migration 0298's orgs.round_fields_source column. Lives
// here rather than in its own file because its only caller is the Round
// suggestion path, which is the same document_extractions pipeline this
// file already gates. Fails CLOSED (no column -> no provenance -> the
// suggestion endpoint reports unavailable): without it there is no way to
// tell a founder's own number from a three-week-old draft deck's, and
// offering suggestions blind is exactly the behaviour the precedence rule
// exists to prevent.
export const roundFieldsSourceAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('round_fields_source').limit(1);
  return !error;
});
