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
