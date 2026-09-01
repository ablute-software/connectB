// Prompt 519 §2 — push what an investor declared about THEMSELVES into the
// shared catalog row, so it reaches the founder wherever they look.
//
// THE DISCONNECT. The investor fills their profile via POST
// /api/portal/investor-profile, which writes matchdeal_profiles. The startup
// reads the "Entity summary" from entity.* and, when empty, from
// computeEntitySummaryPrefill(entity, matchEntityToCatalog(entity, db.catalog))
// — and db.catalog is a raw select('*') of catalog_entities, never joined to
// matchdeal_profiles. A bridge does exist, resolveClaimedInvestorProfile, but
// it is called from exactly ONE place: the monthly delivery cron, at the
// moment it first creates the entities row, requiring an approved claim AND
// is_complete at that exact instant — and even then it writes only to
// `entities`, so an investor who completes their profile later never reaches
// a pipeline that already exists. Which is the normal case: outreach usually
// starts long before the investor reacts.
//
// WHY SYNC TO catalog_entities (option b) RATHER THAN TEACH THE PREFILL TO
// JOIN (option a). The prefill is only one of several readers. unlockPack
// copies straight from catalog_entities and never calls the bridge at all;
// so does the monthly delivery. Fixing the prefill would leave both of those
// still showing an empty dossier. Writing once, at the moment the investor
// saves, means every existing and future reader benefits with no further
// change — including the ones nobody has written yet.
//
// PRIVACY, checked explicitly against CLAUDE.md's startup-performance rule
// because this moves data toward a shared surface: that rule protects
// FOUNDER-private performance data (pass counts, outreach velocity, pipeline
// stats, round progress) from reaching investor-facing surfaces. This is the
// opposite direction and the opposite subject — it is the INVESTOR's own
// declaration about themselves, travelling to the founder who is deciding
// whether to approach them. No founder performance data is read, written or
// derived anywhere in this file. There is no conflict.
//
// It is also strictly narrower than what the investor already publishes:
// every field below is one they typed into their own public-facing profile.
// Nothing is inferred, and nothing private to their MatchDeal activity
// (swipes, likes, decisions) is touched.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface InvestorDeclaredFields {
  website?: string | null;
  sectors?: string[] | null;
  thesis?: string | null;
  check_min_eur?: number | null;
  check_max_eur?: number | null;
  geographies?: string[] | null;
  stage_min?: string | null;
  stage_max?: string | null;
}

/**
 * undefined means "the investor said nothing here" — and a field they left
 * blank must never blank out what the catalog already holds. Only a value
 * they actually provided is written.
 */
function declaredValue<T>(declared: T | null | undefined): T | undefined {
  if (declared === null || declared === undefined) return undefined;
  if (Array.isArray(declared) && declared.length === 0) return undefined;
  if (typeof declared === 'string' && declared.trim() === '') return undefined;
  return declared;
}

/**
 * Copy an investor's own declarations onto their catalog_entities row.
 *
 * NEVER THROWS and never fails its caller: this runs alongside the investor
 * saving their profile, and a catalog write that goes wrong must not make
 * their own save appear to fail. Returns which fields it actually wrote.
 *
 * Deliberately does NOT touch verification_status, moderation, enrichment
 * columns or anything else the platform owns — only the descriptive fields
 * the investor themselves supplied.
 */
export async function syncInvestorProfileToCatalog(
  admin: SupabaseClient, catalogEntityId: string,
): Promise<{ updated: string[]; error?: string }> {
  try {
    const { data: profile } = await admin.from('matchdeal_profiles')
      .select('website, sectors, description, ticket_min, ticket_max, stages_invested, geographies, updated_at')
      .eq('kind', 'investor')
      .in('membership_id', await membershipIdsFor(admin, catalogEntityId))
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (!profile) return { updated: [] };

    const patch: InvestorDeclaredFields = {};
    const set = <K extends keyof InvestorDeclaredFields>(k: K, v: InvestorDeclaredFields[K]) => {
      const kept = declaredValue(v);
      if (kept !== undefined) patch[k] = kept as InvestorDeclaredFields[K];
    };
    set('website', profile.website as string | null);
    set('sectors', profile.sectors as string[] | null);
    set('thesis', profile.description as string | null);
    set('check_min_eur', profile.ticket_min != null ? Number(profile.ticket_min) : null);
    set('check_max_eur', profile.ticket_max != null ? Number(profile.ticket_max) : null);
    set('geographies', profile.geographies as string[] | null);

    // stages_invested is a LIST on the profile and a min/max PAIR on the
    // catalog row. Mapping it needs the canonical stage order, so it is done
    // against that rather than by taking the array's first and last element,
    // which would depend on the order the investor happened to tick boxes in.
    const stages = ((profile.stages_invested as string[] | null) ?? []).filter((x) => STAGE_ORDER.includes(x));
    if (stages.length > 0) {
      const sorted = [...stages].sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
      patch.stage_min = sorted[0];
      patch.stage_max = sorted[sorted.length - 1];
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) return { updated: [] };

    const { error } = await admin.from('catalog_entities').update(patch).eq('id', catalogEntityId);
    if (error) return { updated: [], error: error.message };
    return { updated: keys };
  } catch (e) {
    return { updated: [], error: (e as Error).message };
  }
}

// Mirrors the `stage` enum's own order (types.ts / the Postgres enum), not
// the order stages_invested happens to be stored in.
const STAGE_ORDER = ['pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus', 'later', 'other'];

async function membershipIdsFor(admin: SupabaseClient, catalogEntityId: string): Promise<string[]> {
  const { data } = await admin.from('matchdeal_investor_members')
    .select('id').eq('catalog_entity_id', catalogEntityId).eq('status', 'active');
  return (data ?? []).map((m) => m.id as string);
}
