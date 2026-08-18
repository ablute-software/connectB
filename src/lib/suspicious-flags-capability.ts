// Prompt 244/245 — migration 0180 (blocked_emails, suspicious_account_flags,
// suspicious_account_flag_actions, account_access_state()). Gates the
// Backoffice "Suspicious accounts" tab — same capability-probe convention
// as account-moderation-capability.ts.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const suspiciousFlagsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('suspicious_account_flags').select('id').limit(1);
  return !error;
});
