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
import { marketCompanyExtendedFieldsAvailable } from './market-data-capability';

export interface CompetitorCandidate {
  name: string; domain?: string | null; sectors?: string[]; description?: string | null;
  companyType?: string | null; sourceUrl?: string | null; sourceQuality?: string | null;
  positioning?: string | null; note?: string | null; addedBy?: 'ai' | 'founder';
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
  const { error } = await admin.from('org_competitors').upsert({
    org_id: orgId, market_company_id: companyId, relation: 'direct',
    note: candidate.note ?? null, positioning: candidate.positioning ?? null, added_by: candidate.addedBy ?? 'founder', updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,market_company_id' });
  if (error) throw new Error(error.message);
  return companyId;
}
