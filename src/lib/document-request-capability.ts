// Prompt 372 — migration 0243's new columns/table.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const accessRequestItemsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('access_request_items').select('id').limit(1);
  return !error;
});

export const documentRequestFieldsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('access_requests').select('kind, message, founder_seen_at').limit(1);
  return !error;
});

export const ndaDocumentLinkAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ndas').select('document_id').limit(1);
  return !error;
});

// Prompt 423 §A.2 — migration 0269's item_type column.
export const documentRequestItemTypeAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('access_request_items').select('item_type').limit(1);
  return !error;
});

// Prompt 518 §1 — migration 0290's folder_id column, which is what lets an
// "access" request (a whole folder, from "Request again") be reviewed and
// granted on the same screen as a document request. Same missing-column-safe
// probe as every other capability here, so the review screen degrades to
// document-only items rather than 500ing before the migration is applied.
export const accessRequestItemFolderAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('access_request_items').select('folder_id').limit(1);
  return !error;
});
