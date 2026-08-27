import 'server-only';
// Prompt 401 §2 — single-org read of the SAME matchdeal_startup_hype view
// (0053, is_hype, security_invoker fixed by 0135 — do not touch that view)
// the Hype List (/api/matchdeal/hype) already reads, factored out so the
// dossier route doesn't duplicate the join. The Hype List's own multi-org
// query is untouched — this is only for "is exactly this one org hype".
import type { SupabaseClient } from '@supabase/supabase-js';

export async function isStartupHype(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data: profile } = await admin.from('matchdeal_profiles')
    .select('id').eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  if (!profile) return false;
  const { data: hypeRow } = await admin.from('matchdeal_startup_hype')
    .select('is_hype').eq('startup_profile_id', profile.id as string).maybeSingle();
  return !!hypeRow?.is_hype;
}
