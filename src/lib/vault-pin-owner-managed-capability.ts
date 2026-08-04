// Prompt 118 §3 / tail verification (mini_prompt_verificacao_cauda_0115_0118)
// — migration 0118 (PROPOSE ONLY, not applied) adds owner-managed Vault PIN
// codes via vault_pin_status_v2/vault_pin_set_for_user/vault_pin_clear_for_user/
// vault_pin_list. Gates both the new RosterCard PIN controls and which
// VaultPinGate status RPC the client calls (_v2 once available, the
// untouched original otherwise) — additive, so this flips on the moment
// Nuno applies 0118, no deploy required.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const vaultPinOwnerManagedAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('vault_data_room_pins').select('required_by_owner').limit(1);
  return !error;
});
