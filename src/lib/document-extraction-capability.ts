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
