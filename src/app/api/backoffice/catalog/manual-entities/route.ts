// Prompt 187 §A — "Added by startups": every entities row any org's founder
// added by hand (source='manual'), across ALL orgs — the cross-org listing
// that never existed before this prompt (confirmed: the only prior
// all-org read of `entities` was a pure aggregate count, see
// sample-coverage/route.ts, which never returned row-level data). Joined
// to orgs.name so the back-office can show "added by: {org}"; flagged
// against catalog_entities using the exact same match logic
// MergeDuplicatesTool already uses (manual-entity-match.ts, built on
// catalog-dedupe.ts's own normalizeName/normalizeDomain — not a second
// algorithm).
//
// Prompt 191 §B/§E — two additions: (1) joins `people` by entity_id (the
// same FK the startup's own org already uses) so the row can show real
// contacts instead of nothing; (2) only returns catalog_review_status =
// 'pending' rows — promote/merge/dismiss (manual-entities/[id]/route.ts,
// promote/route.ts, merge/route.ts) mark the source entities row
// 'promoted'/'merged'/'dismissed' once handled, so a treated row stops
// reappearing here without ever deleting the underlying entities row
// (still real CRM data for its own org). Requires migration 0169
// (proposed, not yet applied) — see that file's own header.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { findLikelyCatalogMatch } from '@/lib/manual-entity-match';
import type { Alias, CatalogRow } from '@/lib/catalog-dedupe';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: manualRows, error }, { data: orgs }, { data: catalogRows }, { data: aliases }] = await Promise.all([
    admin.from('entities')
      .select('id, org_id, name, website, hq_city, hq_country, invests_in_geographies, stage_min, stage_max, check_min_eur, check_max_eur, sectors, thesis, email, phone, created_at')
      .eq('source', 'manual').eq('catalog_review_status', 'pending')
      .order('created_at', { ascending: false }),
    admin.from('orgs').select('id, name'),
    admin.from('catalog_entities').select('id, name, website, verification_status'),
    admin.from('entity_aliases').select('catalog_id, alias'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const catalogById = new Map((catalogRows ?? []).map((c) => [c.id as string, c]));
  const catalogForMatch: CatalogRow[] = (catalogRows ?? []).map((c) => ({ id: c.id, name: c.name, website: c.website }));
  const aliasRows: Alias[] = (aliases ?? []) as Alias[];

  const manualIds = (manualRows ?? []).map((m) => m.id as string);
  const { data: peopleRows } = manualIds.length
    ? await admin.from('people').select('id, entity_id, full_name, role, linkedin_url, email_verified, email_guess, phone').in('entity_id', manualIds)
    : { data: [] };
  const contactsByEntity = new Map<string, { id: string; fullName: string; role: string | null; email: string | null; linkedinUrl: string | null; phone: string | null }[]>();
  for (const p of peopleRows ?? []) {
    const entityId = p.entity_id as string;
    const contact = {
      id: p.id as string, fullName: p.full_name as string, role: p.role as string | null,
      email: (p.email_verified as string | null) ?? (p.email_guess as string | null), linkedinUrl: p.linkedin_url as string | null, phone: p.phone as string | null,
    };
    contactsByEntity.set(entityId, [...(contactsByEntity.get(entityId) ?? []), contact]);
  }

  const manualEntities = (manualRows ?? []).map((m) => {
    const match = findLikelyCatalogMatch({ name: m.name as string, website: m.website as string | null }, catalogForMatch, aliasRows);
    const matchedCatalogEntity = match ? catalogById.get(match.catalogId) ?? null : null;
    return {
      id: m.id, orgId: m.org_id, orgName: orgNameById.get(m.org_id as string) ?? '(deleted org)',
      name: m.name, website: m.website, hqCity: m.hq_city, hqCountry: m.hq_country,
      geographies: m.invests_in_geographies ?? [], stageMin: m.stage_min, stageMax: m.stage_max,
      checkMinEur: m.check_min_eur, checkMaxEur: m.check_max_eur, sectors: m.sectors ?? [], thesis: m.thesis,
      email: m.email, phone: m.phone, createdAt: m.created_at,
      contacts: contactsByEntity.get(m.id as string) ?? [],
      likelyDuplicate: match && matchedCatalogEntity ? {
        catalogId: match.catalogId, reason: match.reason,
        catalogEntity: {
          id: matchedCatalogEntity.id, name: matchedCatalogEntity.name, website: matchedCatalogEntity.website,
          verificationStatus: matchedCatalogEntity.verification_status,
        },
      } : null,
    };
  });

  return NextResponse.json({ ok: true, manualEntities });
}
