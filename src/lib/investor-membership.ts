// Prompt 106 §C — single source of truth for "find this user's active
// matchdeal_investor_members row." Confirmed live: alexandrameira@ablute.pt
// has had up to 6 active rows at once (1 real + 5 identical-timestamp
// demo-seed rows never cleaned up — see portal-access.ts's P83 Bloco 0
// note). `.maybeSingle()` on a query that can return more than one row
// either throws (a PostgREST error most callers weren't even checking) or
// returns null — either way the caller reads "not linked" for a user who
// very much is. Confirmed independently in 11 call sites; fixed once, here.
// Same "oldest active wins" convention as portal-access.ts already used —
// a real long-standing membership beats anything seeded in later, and it's
// deterministic across repeated calls (unlike picking an arbitrary row).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ActiveInvestorMember {
  id: string;
  catalog_entity_id: string;
  domain_verified: boolean;
}

export async function resolveActiveInvestorMember(
  admin: SupabaseClient, userId: string,
): Promise<ActiveInvestorMember | null> {
  const { data, error } = await admin.from('matchdeal_investor_members')
    .select('id, catalog_entity_id, domain_verified')
    .eq('user_id', userId).eq('status', 'active')
    .order('created_at', { ascending: true }).limit(1);
  if (error) {
    console.error('resolveActiveInvestorMember failed:', error.message);
    return null;
  }
  return (data?.[0] as ActiveInvestorMember | undefined) ?? null;
}
