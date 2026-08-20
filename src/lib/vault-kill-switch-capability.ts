// Prompt 278 §4 — same probe pattern as every other migration-gated column
// (capability-probe.ts): a failing select means orgs.vault_access_frozen_at
// doesn't exist yet, and vaultFrozenForOrg() (data-room-server.ts) then
// treats every org as never frozen — today's behavior, unchanged — rather
// than throwing.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const vaultKillSwitchAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('vault_access_frozen_at').limit(1);
  return !error;
});
