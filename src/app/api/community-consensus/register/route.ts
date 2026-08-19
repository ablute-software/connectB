// Prompt 266 §1-4 — engine: §1-3's exact-match promotion (Phase a) plus
// §4's AI arbiter (Phase b), same route. Called by ContributionBox right
// after it inserts a founder's own entity-field contribution — this is the
// "does this ALSO now agree with another org's contribution for the same
// catalog investor" check.
//
// Founder-facing, entity-scoped (same auth shape as .../enrich): the
// founder only ever proves they own the SOURCE entity; the route itself
// resolves everything else (catalog_id, other orgs' sources) via
// service-role, since cross-org visibility is exactly the point.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { communityConsensusAvailable } from '@/lib/community-consensus-capability';
import { catalogFieldIsBlank, isCommunityEligibleField, normalizedValuesMatch, orderedArbitrationPair } from '@/lib/community-consensus';

// §4 — "mesmo facto, escrito diferente?" (e.g. "Managing Partner: J. Smith"
// vs "John Smith (Managing Partner)"; "€1M-5M" vs "1-5 milhoes"). One
// tool-forced call, same shape as every other structured-output Anthropic
// call in this codebase (enrich, form-questions, ...) — deterministic
// exact-match (normalizedValuesMatch) always runs FIRST; this only fires
// when that already said "different" (§4's own "determinístico primeiro,
// AI como 2º filtro").
async function arbitrateEquality(apiKey: string, model: string, field: string, a: string, b: string): Promise<{ sameValue: boolean; canonicalValue: string | null }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      system: 'You judge whether two short values, submitted independently by two different people for the same field about '
        + 'the same investor, describe the SAME underlying fact just worded differently — e.g. "Managing Partner: J. Smith" '
        + 'and "John Smith (Managing Partner)" are the same fact; "€1M-5M" and "1-5 milhoes" are the same fact (currency/'
        + 'language differ, the range itself doesn’t). A genuinely different name, role, range or number is NOT the same '
        + 'fact even if superficially similar — when in doubt, say they differ. Always finish by calling judge_equality.',
      messages: [{ role: 'user', content: `Field: ${field}\nValue A: ${a}\nValue B: ${b}` }],
      tools: [{
        name: 'judge_equality',
        description: 'Report whether the two values describe the same underlying fact.',
        input_schema: {
          type: 'object',
          properties: {
            same_value: { type: 'boolean' },
            canonical_value: { type: 'string', description: 'Only when same_value is true: one clean value combining both, e.g. "John Smith (Managing Partner)".' },
          },
          required: ['same_value'],
        },
      }],
      tool_choice: { type: 'tool', name: 'judge_equality' },
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const toolUse = (data.content as { type: string; name?: string; input?: unknown }[]).find((b) => b.type === 'tool_use' && b.name === 'judge_equality');
  const input = (toolUse?.input ?? {}) as { same_value?: boolean; canonical_value?: string };
  return { sameValue: !!input.same_value, canonicalValue: input.canonical_value ?? null };
}

// Cache-first (§4's "cache do veredito" — never repeat the same comparison
// twice): orderedArbitrationPair makes a reversed (b, a) call hit the same
// row. Arrays (sectors, invests_in_geographies, structured key_people)
// never reach here — normalizedValuesMatch already compares those
// structurally/order-independently, so a real mismatch there is a real
// disagreement, not a wording difference. A missing API key or a flaky
// call degrades to null (treated as "still disagreement") — never blocks
// the founder's own contribution, same fire-and-forget spirit as the rest
// of this route.
async function arbitratedMatch(admin: SupabaseClient, catalogId: string, field: string, existingValue: unknown, newValue: unknown): Promise<{ sameValue: boolean; canonicalValue: string | null } | null> {
  if (Array.isArray(existingValue) || Array.isArray(newValue)) return null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const [valueA, valueB] = orderedArbitrationPair(String(existingValue), String(newValue));
  const { data: cached } = await admin.from('catalog_field_arbitration_cache').select('same_value, canonical_value')
    .eq('catalog_id', catalogId).eq('field', field).eq('value_a', valueA).eq('value_b', valueB).maybeSingle();
  if (cached) return { sameValue: cached.same_value as boolean, canonicalValue: (cached.canonical_value as string | null) ?? null };

  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  try {
    const verdict = await arbitrateEquality(apiKey, model, field, valueA, valueB);
    await admin.from('catalog_field_arbitration_cache').insert({
      catalog_id: catalogId, field, value_a: valueA, value_b: valueB,
      same_value: verdict.sameValue, canonical_value: verdict.canonicalValue,
    });
    return verdict;
  } catch {
    return null;
  }
}

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

  // §4 — the two values disagreed textually, but this is still only the
  // SECOND source on a row that hasn't promoted yet: worth one AI check
  // before treating it as a real disagreement. A 3rd+ org landing on an
  // already-promoted (or already AI-rejected-as-different) row never
  // re-triggers this (existing.score !== 0) — same "no second promotion
  // path" scope as the exact-match branch above.
  if (!matches && existing.score === 0) {
    const verdict = await arbitratedMatch(admin, catalogId, body.field, existing.value, body.value);
    if (verdict?.sameValue) {
      await admin.from('catalog_field_consensus').update({
        score: 2, value: verdict.canonicalValue ?? existing.value, updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
      return NextResponse.json({ ok: true, status: 'promoted_by_ai' });
    }
  }

  return NextResponse.json({ ok: true, status: matches ? 'source_added' : 'disagreement_recorded' });
}
