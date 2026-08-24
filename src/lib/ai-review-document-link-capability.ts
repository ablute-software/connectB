// Prompt 302 §2 — migration 0206 (ai_reviews.document_version). document_id
// itself needs no probe (day-one column, migration 0001) — only the new
// column gates the write/read of the document-link feature.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const aiReviewDocumentLinkAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ai_reviews').select('document_version').limit(1);
  return !error;
});

// Prompt 360 Part B — migration 0240's second document slot, for
// cross_document_review specifically (every other kind never uses it).
export const aiReviewDocumentLinkBAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ai_reviews').select('document_id_b').limit(1);
  return !error;
});
