// Prompt 728 §2 — the ONE place a catalog person becomes a real
// org-scoped `people` row. Every caller that used to build that row by
// hand (addPerson with individually-copied fields) goes through this
// instead once a catalog_person_id is involved, so "materialize this
// catalog person" always means the same thing: same seniority_rank
// (from the catalog affiliation, never max+1 — that numbering is for
// hand-added contacts, not a catalog import), same hook-with-source
// discipline, same idempotent-under-concurrency guarantee.
//
// Generic over a minimal Supabase-shaped client (not the real
// SupabaseClient type) so this is unit-testable with a hand-rolled fake
// that can actually simulate the race the unique index
// (people_entity_catalog_person_uidx, proposed — not yet applied) is
// meant to close: two callers both pass the "does this exist yet" check
// before either insert lands, and only one insert survives.
import type { HookStatus, Person } from './types';

// Deliberately loose (self-referential builder, not the real SupabaseClient
// type) — this only needs to model the handful of chains this file actually
// calls, and stay easy to satisfy with a hand-rolled fake in tests.
export interface MaterializeQueryBuilder {
  eq(col: string, val: unknown): MaterializeQueryBuilder;
  is(col: string, val: null): MaterializeQueryBuilder;
  ilike(col: string, val: string): MaterializeQueryBuilder;
  order(col: string, opts: { ascending: boolean }): MaterializeQueryBuilder;
  limit(n: number): MaterializeQueryBuilder;
  select(cols: string): MaterializeQueryBuilder;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }>;
}
export interface MaterializeClient {
  from(table: string): {
    select(cols: string): MaterializeQueryBuilder;
    insert(row: Record<string, unknown>): MaterializeQueryBuilder;
  };
}

export interface EnsureOrgPersonParams { orgId: string; entityId: string; catalogPersonId: string }
export interface EnsureOrgPersonResult { person: Person; created: boolean; needsLinkReview: boolean }

function mapRow(row: Record<string, unknown>): Person {
  return row as unknown as Person;
}

// Prompt 728 §2.4 — an old local person with the SAME normalized name at
// the SAME entity, but no catalog_person_id: never auto-merged (a name
// match is not proof of identity — see the same principle applied to
// domain matches in Prompt 721's own addendum). needs_link_review has no
// column of its own yet (confirmed: not present on `people` today) — left
// as a reported gap, per this prompt's own explicit instruction, rather
// than adding a new field in this pass. The caller still gets the
// materialized catalog row back; a human decides the merge separately.
export async function ensureOrgPersonFromCatalog(
  client: MaterializeClient, params: EnsureOrgPersonParams,
): Promise<EnsureOrgPersonResult> {
  const { orgId, entityId, catalogPersonId } = params;

  const { data: existing } = await client.from('people').select('*')
    .eq('entity_id', entityId).eq('catalog_person_id', catalogPersonId).maybeSingle();
  if (existing) return { person: mapRow(existing), created: false, needsLinkReview: false };

  const { data: catalogPerson } = await client.from('catalog_people')
    .select('id, full_name, linkedin_url, linkedin_verified, hook_status, hook_source, catalog_people_research(hook)')
    .eq('id', catalogPersonId).maybeSingle();
  if (!catalogPerson) throw new Error('Catalog person not found.');

  const { data: affiliation } = await client.from('catalog_person_affiliations')
    .select('title, seniority_rank').eq('person_id', catalogPersonId).eq('current', true)
    .order('is_primary', { ascending: false }).limit(1).maybeSingle();

  const researchRaw = catalogPerson.catalog_people_research as { hook: string | null } | { hook: string | null }[] | null;
  const research = Array.isArray(researchRaw) ? researchRaw[0] : researchRaw;
  // hook_status='researched' only when hook_source is ALSO present — a
  // researched-but-sourceless status (shouldn't happen upstream, but never
  // trusted blindly) still means "don't materialize a hook" here.
  const hasSource = catalogPerson.hook_status === 'researched' && !!catalogPerson.hook_source;

  const { data: sameNameLocal } = await client.from('people').select('id')
    .eq('entity_id', entityId).is('catalog_person_id', null).ilike('full_name', catalogPerson.full_name as string).maybeSingle();

  const insertRow = {
    org_id: orgId, entity_id: entityId, full_name: catalogPerson.full_name,
    role: affiliation?.title ?? null, seniority_rank: (affiliation?.seniority_rank as number | undefined) ?? 1,
    linkedin_url: catalogPerson.linkedin_url, linkedin_verified: !!catalogPerson.linkedin_verified,
    catalog_person_id: catalogPersonId,
    hook: hasSource ? (research?.hook ?? null) : null,
    hook_status: (hasSource ? 'researched' : 'to_research') as HookStatus,
    data_source: 'Added from catalog',
  };

  const { data: inserted, error } = await client.from('people').insert(insertRow).select('*').maybeSingle();
  if (error) {
    // 23505 = unique_violation — lost the race to another concurrent
    // caller for the SAME (entity_id, catalog_person_id): reread and hand
    // back the winner's row, never a second row, never an error surfaced
    // to the founder.
    if (error.code === '23505') {
      const { data: winner } = await client.from('people').select('*')
        .eq('entity_id', entityId).eq('catalog_person_id', catalogPersonId).maybeSingle();
      if (winner) return { person: mapRow(winner), created: false, needsLinkReview: false };
    }
    throw new Error(error.message);
  }
  return { person: mapRow(inserted!), created: true, needsLinkReview: !!sameNameLocal };
}
