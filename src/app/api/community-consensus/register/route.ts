// Prompt 266 §1-3 (Phase a — engine, exact-match only; §4's AI arbiter is
// layered on in a follow-up change, same route). Called by ContributionBox
// right after it inserts a founder's own entity-field contribution — this
// is the "does this ALSO now agree with another org's contribution for the
// same catalog investor" check.
//
// Founder-facing, entity-scoped (same auth shape as .../enrich): the
// founder only ever proves they own the SOURCE entity; the route itself
// resolves everything else (catalog_id, other orgs' sources) via
// service-role, since cross-org visibility is exactly the point.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { communityConsensusAvailable } from '@/lib/community-consensus-capability';
import { catalogFieldIsBlank, isCommunityEligibleField, normalizedValuesMatch } from '@/lib/community-consensus';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, skipped: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { entityId?: string; field?: string; value?: unknown; contributionId?: string };
  if (!body.entityId || !body.field) return NextResponse.json({ ok: false, error: 'entityId and field are required.' }, { status: 400 });

  // §5 — scope check first, before any I/O: an ineligible field (contact-
  // reachable, or unknown) never even resolves the entity.
  if (!isCommunityEligibleField(body.field)) return NextResponse.json({ ok: true, skipped: 'field not eligible' });
  if (catalogFieldIsBlank(body.value)) return NextResponse.json({ ok: true, skipped: 'empty value' });

  if (!(await communityConsensusAvailable())) return NextResponse.json({ ok: true, skipped: 'not configured' });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: entity, error: entityErr } = await admin.from('entities').select('id, org_id').eq('id', body.entityId).maybeSingle();
  if (entityErr || !entity) return NextResponse.json({ ok: false, error: entityErr?.message ?? 'Entity not found.' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  // Manual entities (no catalog_deliveries row) never resolve to a shared
  // catalog identity — nothing to compare against, silently skipped, not
  // an error (this is the common, expected case for most entities).
  const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('entity_id', body.entityId).maybeSingle();
  const catalogId = delivery?.catalog_id as string | undefined;
  if (!catalogId) return NextResponse.json({ ok: true, skipped: 'no catalog link' });

  // §5 non-clobbering — the SAME test entity-enrichment.ts already applies
  // to founder entities, mirrored against the shared catalog row: a field
  // backoffice/catalog already has on file is never touched by this engine.
  const { data: catalogEntity } = await admin.from('catalog_entities').select(body.field).eq('id', catalogId).maybeSingle();
  if (!catalogEntity || !catalogFieldIsBlank((catalogEntity as Record<string, unknown>)[body.field])) {
    return NextResponse.json({ ok: true, skipped: 'catalog already has a value' });
  }

  const { data: existing } = await admin.from('catalog_field_consensus').select('id, value, score').eq('catalog_id', catalogId).eq('field', body.field).maybeSingle();

  if (!existing) {
    const { data: created, error: createErr } = await admin.from('catalog_field_consensus')
      .insert({ catalog_id: catalogId, field: body.field, value: body.value, score: 0 }).select('id').single();
    if (createErr) return NextResponse.json({ ok: false, error: createErr.message }, { status: 500 });
    await admin.from('catalog_field_consensus_sources').insert({
      consensus_id: created.id, org_id: entity.org_id, contribution_id: body.contributionId ?? null, value: body.value,
    });
    return NextResponse.json({ ok: true, status: 'first_source' });
  }

  // This org already has a source on this exact consensus row — treat as a
  // correction to their own prior value (upsert), never a second org "for
  // free". Idempotent: submitting the same value twice changes nothing.
  const { data: ownSource } = await admin.from('catalog_field_consensus_sources').select('id').eq('consensus_id', existing.id).eq('org_id', entity.org_id).maybeSingle();
  if (ownSource) {
    await admin.from('catalog_field_consensus_sources').update({ value: body.value, contribution_id: body.contributionId ?? null }).eq('id', ownSource.id);
    return NextResponse.json({ ok: true, status: 'source_updated' });
  }

  const matches = normalizedValuesMatch(existing.value, body.value);
  await admin.from('catalog_field_consensus_sources').insert({
    consensus_id: existing.id, org_id: entity.org_id, contribution_id: body.contributionId ?? null, value: body.value,
  });

  if (matches && existing.score === 0) {
    // Prompt 266 §2 — "2 entradas concordantes de 2 orgs diferentes" ->
    // score starts at 2. Only fires the FIRST time this row crosses that
    // line (score===0 guard) — a 3rd+ agreeing org adds a source but never
    // re-bumps the baseline; from here score only moves by vote.
    await admin.from('catalog_field_consensus').update({ score: 2, updated_at: new Date().toISOString() }).eq('id', existing.id);
    return NextResponse.json({ ok: true, status: 'promoted' });
  }

  return NextResponse.json({ ok: true, status: matches ? 'source_added' : 'disagreement_recorded' });
}
