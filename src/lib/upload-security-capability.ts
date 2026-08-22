// Prompt 301 §3 — capability probe for migration 0205's malware_scan_*
// columns on documents/document_versions. Negatives re-probe after a short
// TTL, same as every other probe in this codebase.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const malwareScanAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('documents').select('malware_scan_status').limit(1);
  return !error;
});

// Prompt 305 §A — migration 0207's malware_scan_* columns on the four
// secondary upload paths. One probe per table/column, same pattern as
// every other probe here — a single combined probe would report "available"
// only once ALL four exist, hiding a partial-rollout state.
export const investorVerificationScanAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('investor_verification_documents').select('malware_scan_status').limit(1);
  return !error;
});

export const ndaScanAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('ndas').select('malware_scan_status').limit(1);
  return !error;
});

export const matchdealPhotoScanAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('matchdeal_profiles').select('photo_malware_scan_status').limit(1);
  return !error;
});

export const supportAttachmentScanAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('support_attachment_scans').select('id').limit(1);
  return !error;
});
