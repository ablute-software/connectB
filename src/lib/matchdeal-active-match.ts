// P134 addenda (2026-08-05, Nuno's R2 decisions #1/#3) — "existe match
// MatchDeal feito" is one predicate, shared everywhere it's needed: the
// dossier's "Conversation on MatchDeal" link-out (§3, was already status='active'
// only) AND the founder's messaging-initiate gate (§1, new). Both must use
// the exact same definition or they'd silently drift apart.
//
// Qualifying matchdeal_matches row: status = 'active' (excludes
// pending_consent — not yet mutually confirmed; declined_by_startup,
// expired_no_followup, closed_by_startup — all terminal/ended states; and a
// superseded match, whose own status has already moved out of
// pending_consent/active by the time a newer row supersedes it — see
// migration 0053's own `matchdeal_one_open_match_per_pair` unique index,
// which only ever allows ONE row in ('pending_consent','active') per firm×
// startup pair at a time) AND not currently in cooldown (cooldown_until is
// null, or already in the past — cooldown is a timestamp on the row itself,
// not a separate status value).
import type { SupabaseClient } from '@supabase/supabase-js';

export async function findActiveMatchDealMatch(admin: SupabaseClient, startupProfileId: string, investorCatalogEntityId: string) {
  const { data } = await admin.from('matchdeal_matches').select('id, created_at, cooldown_until')
    .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('startup_profile_id', startupProfileId).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const cooldownUntil = data.cooldown_until as string | null;
  if (cooldownUntil && new Date(cooldownUntil) > new Date()) return null;
  return { id: data.id as string, createdAt: data.created_at as string };
}

export async function hasActiveMatchDealMatch(admin: SupabaseClient, startupProfileId: string, investorCatalogEntityId: string): Promise<boolean> {
  return !!(await findActiveMatchDealMatch(admin, startupProfileId, investorCatalogEntityId));
}
