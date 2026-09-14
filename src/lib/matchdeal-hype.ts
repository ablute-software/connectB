import 'server-only';
// Prompt 401 §2 — single-org read of the SAME matchdeal_startup_hype view
// (0053, is_hype, security_invoker fixed by 0135 — do not touch that view)
// the Hype List (/api/matchdeal/hype) already reads, factored out so the
// dossier route doesn't duplicate the join. The Hype List's own multi-org
// query is untouched — this is only for "is exactly this one org hype".
import type { SupabaseClient } from '@supabase/supabase-js';

// Prompt 402 — the one plan tier the Hype badge is gated on, shared so the
// dossier route and the Pipeline row/card (Prompt 681 §2.4's 🔥 Hype
// marker) can't drift into two different tiers.
export const HYPE_GATE_PLAN_TIER = 'legendary_sleuth';

export async function isStartupHype(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data: profile } = await admin.from('matchdeal_profiles')
    .select('id').eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  if (!profile) return false;
  const { data: hypeRow } = await admin.from('matchdeal_startup_hype')
    .select('is_hype').eq('startup_profile_id', profile.id as string).maybeSingle();
  return !!hypeRow?.is_hype;
}
