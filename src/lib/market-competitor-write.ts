// Prompt 384 §E — the ONE structured-competitor write path (search the
// shared market_companies library by domain then name, update-or-create,
// then upsert the org's own org_competitors relation row), extracted out of
// /api/market-data/competitors/route.ts's own `findOrCreateCompany` so
// research/respond/route.ts's `players` branch can call the exact same
// dedup logic instead of merging into the old org_market_data.competitors
// free-text array. Two write paths for "add this competitor" is exactly the
// "two lists of the same concept" bug §E exists to close — this is the
// single path both now use.
import type { SupabaseClient } from '@supabase/supabase-js';
import { findMatchingMarketCompany } from './market-companies-dedup';
import { marketCompanyExtendedFieldsAvailable, orgCompetitorsCompetitorTypeAvailable } from './market-data-capability';
import type { CompetitorClassification, ScoredClassification } from './market-competition';

export interface CompetitorCandidate {
  name: string; domain?: string | null; sectors?: string[]; description?: string | null;
  companyType?: string | null; sourceUrl?: string | null; sourceQuality?: string | null;
  positioning?: string | null; note?: string | null; addedBy?: 'ai' | 'founder';
  // Prompt 447 §B / Prompt 450 — only ever set for a web-research-sourced
  // accept (market-competition.ts's classifyCompetitor output); absent for
  // a manual add or a document-sourced one. NOT_COMPETITOR/UNRESOLVED/
  // STATUS_QUO never reach here — respond/route.ts rejects those three
  // before addOrUpdateCompetitor is ever called, so in practice this is
  // always one of the 6 real competitor classifications.
  competitorType?: ScoredClassification | null;
}

// Deliberate, not perfect mapping — relation keeps the closest value so the
// existing UI that already reads relation doesn't break; competitor_type
// stores the original finer classification for whoever needs it later.
// competitor_type itself is stored lowercase (the column's existing
// convention, and the exact casing the check constraint uses) even though
// ScoredClassification is uppercase — the lowercase happens at the write
// below, once, at the DB boundary.
export function relationForCompetitorType(t: ScoredClassification): 'direct' | 'indirect' | 'adjacent' {
  if (t === 'DIRECT') return 'direct';
  if (t === 'EMERGING' || t === 'POTENTIAL_ENTRANT' || t === 'ADJACENT') return 'adjacent';
  return 'indirect'; // FUNCTIONAL, BUDGET
}

async function findOrCreateCompany(admin: SupabaseClient, candidate: CompetitorCandidate): Promise<string> {
  const { data: existing } = await admin.from('market_companies').select('id, name, domain');
  const match = findMatchingMarketCompany(candidate, (existing ?? []) as { id: string; name: string; domain: string | null }[]);
  const extendedAvailable = await marketCompanyExtendedFieldsAvailable();
  const now = new Date().toISOString();
  const base = {
    name: candidate.name, domain: candidate.domain ?? null, sectors: candidate.sectors ?? [], description: candidate.description ?? null,
    source_url: candidate.sourceUrl ?? null, source_date: candidate.sourceUrl ? now.slice(0, 10) : null, source_quality: candidate.sourceQuality ?? null,
    updated_at: now,
    ...(extendedAvailable ? { company_type: candidate.companyType ?? null } : {}),
  };
  if (match) {
    await admin.from('market_companies').update(base).eq('id', match.id);
    return match.id;
  }
  const { data: created, error } = await admin.from('market_companies').insert(base).select('id').single();
  if (error) throw new Error(error.message);
  return created!.id as string;
}

// Returns the org_competitors row's company id, or throws — the caller
// decides how to surface a failure (an API error response vs. leaving a
// research item pending rather than silently accepted).
export async function addOrUpdateCompetitor(admin: SupabaseClient, orgId: string, candidate: CompetitorCandidate): Promise<string> {
  const companyId = await findOrCreateCompany(admin, candidate);
  // Prompt 447 §B — 'direct' stays the default for a candidate with no
  // competitorType (manual add, or document-sourced) — the exact existing
  // behavior, unchanged, confirmed before this edit.
  const relation = candidate.competitorType ? relationForCompetitorType(candidate.competitorType) : 'direct';
  const competitorTypeAvailable = await orgCompetitorsCompetitorTypeAvailable();
  const { error } = await admin.from('org_competitors').upsert({
    org_id: orgId, market_company_id: companyId, relation,
    note: candidate.note ?? null, positioning: candidate.positioning ?? null, added_by: candidate.addedBy ?? 'founder', updated_at: new Date().toISOString(),
    ...(competitorTypeAvailable ? { competitor_type: candidate.competitorType ? candidate.competitorType.toLowerCase() : null } : {}),
  }, { onConflict: 'org_id,market_company_id' });
  if (error) throw new Error(error.message);
  return companyId;
}

// ---------------------------------------------------------------------------
// Prompt 483 — filling in a classification an accepted competitor never got.
//
// §3 asked to confirm how the link between an accepted market_research_items
// row and the org_competitors row it created is recorded today, and NOT to
// assume a key that does not exist. Confirmed against migration 0246 and
// addOrUpdateCompetitor above: THERE IS NO SUCH KEY. org_competitors holds
// id / org_id / market_company_id / relation / note / positioning / added_by
// / timestamps / competitor_type, and nothing that points back at a research
// item. The only link is the one addOrUpdateCompetitor itself walks:
//
//   market_research_items.structured.name (or .company)
//     -> findMatchingMarketCompany (domain first, then lower(name))
//       -> market_companies.id
//         -> org_competitors.market_company_id   [unique per org]
//
// So this rejoins them by walking the SAME path with the SAME matcher,
// never by a name comparison of its own — a second, subtly different notion
// of "the same company" is exactly the class of bug 384 §E collapsed into
// one write path in the first place.
//
// Two things this deliberately does NOT touch:
//   - `relation`. It is founder-editable (market-data/competitors/route.ts,
//     action 'edit' accepts body.relation), so deriving it again from the
//     new classification could silently overwrite a correction the founder
//     made by hand. §2's "nunca ao contrário" applies to it more strongly
//     than to competitor_type, which has no founder-facing edit path at all.
//   - any org_competitors row whose competitor_type is already set (§2),
//     enforced twice: read first, and `.is('competitor_type', null)` on the
//     update itself, so a concurrent write cannot be clobbered either.
//
// Fails CLOSED on the capability probe: no competitor_type column means
// there is nothing to fill and nothing is reported as filled.
export function isScoredClassification(value: unknown): value is ScoredClassification {
  // The three excluded values are excluded for two different reasons, both
  // pre-existing: NOT_COMPETITOR and UNRESOLVED are not valid values of the
  // competitor_type CHECK at all (migrations 0275/0276), and STATUS_QUO,
  // though a valid column value, is one of the three respond/route.ts
  // refuses to create a competitor from. A backfill that wrote any of them
  // would be inventing a competitor the accept gate would have rejected.
  const scored: CompetitorClassification[] = ['DIRECT', 'FUNCTIONAL', 'BUDGET', 'EMERGING', 'POTENTIAL_ENTRANT', 'ADJACENT'];
  return typeof value === 'string' && (scored as string[]).includes(value);
}

export async function backfillCompetitorTypeFromClassification(
  admin: SupabaseClient, orgId: string, companyName: string, classification: ScoredClassification,
): Promise<boolean> {
  if (!(await orgCompetitorsCompetitorTypeAvailable())) return false;

  // Scoped to THIS org's competitors and their companies — never a read of
  // the whole shared market_companies library (findOrCreateCompany above
  // does that because it may have to create one; this may not).
  const { data: rows } = await admin.from('org_competitors')
    .select('id, competitor_type, market_company_id, market_companies(id, name, domain)')
    .eq('org_id', orgId);
  const owned = (rows ?? []) as unknown as {
    id: string; competitor_type: string | null; market_company_id: string;
    market_companies: { id: string; name: string; domain: string | null } | null;
  }[];

  const companies = owned
    .map((r) => r.market_companies)
    .filter((c): c is { id: string; name: string; domain: string | null } => c !== null);
  const match = findMatchingMarketCompany({ name: companyName }, companies);
  if (!match) return false;

  const target = owned.find((r) => r.market_company_id === match.id);
  if (!target) return false;
  if (target.competitor_type !== null) return false; // §2 — never overwrite

  const { data: updated, error } = await admin.from('org_competitors')
    .update({ competitor_type: classification.toLowerCase(), updated_at: new Date().toISOString() })
    .eq('id', target.id).eq('org_id', orgId).is('competitor_type', null)
    .select('id');
  if (error) return false;
  // Reported as filled only if a row really was — the count this feeds is
  // shown to the founder as a statement of fact.
  return (updated ?? []).length > 0;
}
