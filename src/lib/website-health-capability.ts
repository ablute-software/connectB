// Prompt 919 — migration-gate probe for what 20261016140000_website_health.sql adds: the org_website_audits table and orgs.website_score_visible.
// Same pattern as every other migration-gated feature (capability-probe.ts): until the migration is applied the card does not appear and the
// investor side shows nothing, instead of the Readiness page or a dossier failing on a table that is not there yet.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const websiteHealthAvailable = makeCapabilityProbe(async (admin) => {
  const table = await admin.from('org_website_audits').select('id').limit(1);
  if (table.error) return false;
  const column = await admin.from('orgs').select('website_score_visible').limit(1);
  return !column.error;
});
