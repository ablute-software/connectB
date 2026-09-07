// Prompt 573 §C — one "Investor identity" queue for the three things that
// verify an investor's identity, unchanged in what each DOES (approve/reject
// still POST to their own three existing routes — entities/[id]/review,
// documents/[id]/review, investor-entity-claims/[id]/{approve,reject}) but
// now returned as one shape so the backoffice can list, filter and open
// them side by side instead of three separate cards.
//
// §A.1's own "Investor identity 53" mystery: that number is the real,
// correctly-computed count of entities/[?]/domain-mismatch rows (the same
// hasDomainMismatch() the Domain Mismatch tab itself uses) — not a bug, and
// not really about THIS queue at all; it only ever showed up here because
// BackofficeShell's own Phase-1 fold summed it into the Investor identity
// badge. The counting rule this prompt actually specifies (§A.1: "só por
// decidir e só não-internos") is a different thing — undecided, non-internal
// rows across the 3 real origins below — and queue-summary.ts now computes
// exactly that; domain_mismatch is a same-queue FILTER (see §C), never
// folded into the count again.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { findCatalogMatch, type CatalogRow, type Alias } from '@/lib/catalog-dedupe';
import { checkMxRecords } from '@/lib/investor-domain-mx';
import { evaluateClaimDomain } from '@/lib/investor-entity-claims';
import { investorEntityClaimsAvailable } from '@/lib/investor-entity-claims-capability';
import type { UnifiedIdentityRow } from '@/lib/investor-identity-row';

function displayName(user: { email?: string | null } | null | undefined): string | null {
  return user?.email ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const claimsAvailable = await investorEntityClaimsAvailable();

  const [
    { data: selfDeclaredEntities }, { data: addedEntities },
    { data: documents }, claimsResult,
    { data: catalogRows }, { data: aliasRows },
  ] = await Promise.all([
    // Prompt 573 §A.2/§C — self-declared covers BOTH write paths: a firm
    // (investor_added, via investor_added_entities) and an individual
    // (self_declared_individual, via /api/portal/investor-profile/
    // self-declare — that route writes catalog_entities + a member row
    // directly, with NO investor_added_entities row at all, confirmed by
    // reading it). Starting from catalog_entities itself is the only query
    // shape that sees both.
    admin.from('catalog_entities')
      .select('id, name, website, verification_status, verified_at, verified_by, matchdeal_investor_members(user_id, is_internal, verification_method)')
      .in('source', ['investor_added', 'self_declared_individual']),
    admin.from('investor_added_entities').select('catalog_entity_id, added_by_email, created_at'),
    admin.from('investor_verification_documents')
      .select('id, investor_email, catalog_entity_id, file_name, storage_path, status, created_at, malware_scan_status, reviewed_by, reviewed_at, reviewer_notes, catalog_entities(id, name, website, matchdeal_investor_members(verification_method))'),
    claimsAvailable
      ? admin.from('investor_entity_claims')
          .select('id, catalog_entity_id, claimant_email, claimant_email_domain, entity_domain_at_claim, domain_match, status, requested_role, evidence, resolved_by, resolved_at, notify_failed, verification_method, created_at, catalog_entities(id, name, website)')
      : Promise.resolve({ data: [] as never[] }),
    admin.from('catalog_entities').select('id, name, website'),
    admin.from('entity_aliases').select('catalog_id, alias'),
  ]);

  const catalog: CatalogRow[] = (catalogRows ?? []).map((c) => ({ id: c.id as string, name: c.name as string, website: c.website as string | null }));
  const aliases: Alias[] = (aliasRows ?? []).map((a) => ({ catalog_id: a.catalog_id as string, alias: a.alias as string }));
  function probableMatch(entityId: string, name: string, website: string | null) {
    const rest = catalog.filter((c) => c.id !== entityId);
    const hit = findCatalogMatch({ name, website }, rest, aliases);
    if (!hit) return null;
    const row = catalog.find((c) => c.id === hit.id);
    return row ? { id: row.id, name: row.name, website: row.website } : null;
  }
  const documentCountByEntity = new Map<string, number>();
  for (const d of documents ?? []) {
    const eid = d.catalog_entity_id as string;
    documentCountByEntity.set(eid, (documentCountByEntity.get(eid) ?? 0) + 1);
  }
  const addedByEntity = new Map((addedEntities ?? []).map((e) => [e.catalog_entity_id as string, e]));

  // domain_match, computed the SAME way for every kind (evaluateClaimDomain
  // itself), against whatever email is the "requester's own" for that kind
  // — never against a website the row's own subject entity happens to
  // carry for an unrelated reason. §C's own required copy: no website on
  // file for the entity means "can't check", not a false ✗.
  function domainFacts(requesterEmail: string, entityWebsite: string | null, entityEmail: string | null) {
    if (!entityWebsite) return { domainMatch: null as boolean | null, claimantDomain: null as string | null, entityDomain: null as string | null };
    const v = evaluateClaimDomain({ claimantEmail: requesterEmail, entityWebsite, entityEmail });
    return { domainMatch: v.domainMatch, claimantDomain: v.claimantDomain, entityDomain: v.entityDomain };
  }

  const resolverIds = new Set<string>();
  for (const e of selfDeclaredEntities ?? []) if (e.verified_by) resolverIds.add(e.verified_by as string);
  for (const d of documents ?? []) if (d.reviewed_by) resolverIds.add(d.reviewed_by as string);
  for (const c of (claimsResult.data ?? []) as Record<string, unknown>[]) if (c.resolved_by) resolverIds.add(c.resolved_by as string);
  const resolverEmailById = new Map(await Promise.all([...resolverIds].map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    return [id, displayName(data?.user)] as const;
  })));

  const rows: UnifiedIdentityRow[] = [];

  for (const e of selfDeclaredEntities ?? []) {
    const members = (Array.isArray(e.matchdeal_investor_members) ? e.matchdeal_investor_members : e.matchdeal_investor_members ? [e.matchdeal_investor_members] : []) as { user_id: string; is_internal: boolean; verification_method: string }[];
    const isInternal = members.length > 0 && members.every((m) => m.is_internal);
    const added = addedByEntity.get(e.id as string);
    const requesterEmail = (added?.added_by_email as string | undefined) ?? '(self-declared individual)';
    rows.push({
      id: e.id as string, kind: 'self_declared', status: e.verification_status === 'pending' ? 'pending' : 'resolved',
      entityId: e.id as string, entityName: e.name as string, entityWebsite: e.website as string | null,
      requesterEmail, createdAt: (added?.created_at as string | undefined) ?? (e.verified_at as string | undefined) ?? new Date(0).toISOString(),
      ...domainFacts(requesterEmail, e.website as string | null, null),
      probableCatalogMatch: probableMatch(e.id as string, e.name as string, e.website as string | null),
      isInternal, documentCount: documentCountByEntity.get(e.id as string) ?? 0,
      resolvedByEmail: e.verified_by ? resolverEmailById.get(e.verified_by as string) ?? null : null,
      resolvedAt: e.verified_at as string | null, resolutionMethod: members[0]?.verification_method ?? null,
    });
  }

  for (const d of documents ?? []) {
    const entity = d.catalog_entities as unknown as { id: string; name: string; website: string | null; matchdeal_investor_members: { verification_method: string }[] | { verification_method: string } | null } | null;
    const entityMembers = entity ? (Array.isArray(entity.matchdeal_investor_members) ? entity.matchdeal_investor_members : entity.matchdeal_investor_members ? [entity.matchdeal_investor_members] : []) : [];
    const flagged = d.malware_scan_status === 'flagged';
    const { data: signed } = flagged || d.status !== 'pending_review' ? { data: null } : await admin.storage.from('data-room').createSignedUrl(d.storage_path as string, 300);
    rows.push({
      id: d.id as string, kind: 'document', status: d.status === 'pending_review' ? 'pending' : 'resolved',
      entityId: entity?.id ?? d.catalog_entity_id as string, entityName: entity?.name ?? 'Unknown', entityWebsite: entity?.website ?? null,
      requesterEmail: d.investor_email as string, createdAt: d.created_at as string,
      ...domainFacts(d.investor_email as string, entity?.website ?? null, null),
      documentFileName: d.file_name as string, documentUrl: signed?.signedUrl ?? null, malwareFlagged: flagged, malwareScanStatus: d.malware_scan_status as string,
      probableCatalogMatch: entity ? probableMatch(entity.id, entity.name, entity.website) : null,
      isInternal: false, documentCount: documentCountByEntity.get(d.catalog_entity_id as string) ?? 0,
      resolvedByEmail: d.reviewed_by ? resolverEmailById.get(d.reviewed_by as string) ?? null : null,
      resolvedAt: d.reviewed_at as string | null, resolutionNotes: d.reviewer_notes as string | null,
      resolutionMethod: entityMembers[0]?.verification_method ?? null,
    });
  }

  for (const c of (claimsResult.data ?? []) as Record<string, unknown>[]) {
    const entity = c.catalog_entities as unknown as { id: string; name: string; website: string | null } | null;
    if (!entity) continue;
    const evidence = c.evidence as { isDispute?: boolean } | null;
    rows.push({
      id: c.id as string, kind: 'claim', status: c.status === 'pending' ? 'pending' : 'resolved',
      entityId: entity.id, entityName: entity.name, entityWebsite: entity.website,
      requesterEmail: c.claimant_email as string, createdAt: c.created_at as string,
      domainMatch: entity.website ? (c.domain_match as boolean) : null,
      claimantDomain: c.claimant_email_domain as string | null, entityDomain: c.entity_domain_at_claim as string | null,
      isDispute: evidence?.isDispute ?? false,
      probableCatalogMatch: null, // a claim already targets a specific existing entity — nothing to match against
      isInternal: false, // a claim is definitionally an external assertion of ownership — nothing to hide it behind
      documentCount: documentCountByEntity.get(entity.id) ?? 0,
      resolvedByEmail: c.resolved_by ? resolverEmailById.get(c.resolved_by as string) ?? null : null,
      resolvedAt: c.resolved_at as string | null, notifyFailed: c.notify_failed as boolean,
      resolutionMethod: c.verification_method as string | null,
    });
  }

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return NextResponse.json({ ok: true, rows, claimsAvailable });
}

// Prompt 573 §C — MX lookup is fetched lazily, per row, only when the panel
// actually opens one (a DNS round trip per queue row on every list load
// would be real added latency for a fact nobody may ever look at).
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const { domain } = await req.json().catch(() => ({})) as { domain?: string };
  const result = await checkMxRecords(domain ?? null);
  return NextResponse.json({ ok: true, result });
}
