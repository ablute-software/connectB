// Prompt 584 §C — direct dossier editor for admins. There was no way for
// an admin to edit an already-published catalog_entities row at all: the
// merge tool only fills empty fields (fieldsFilled: {} on every real
// merge except one), catalog_candidate_edited only ever touches a
// pipeline entities row before promotion, and catalog_update has been
// used exactly once, only for verification_status. Confirmed before
// writing this: the RLS policy catalog_admin_write is already ALL
// (insert/update/delete) for is_platform_admin() — no migration needed
// for the write itself.
//
// §B's gate: an "unclaimed" catalog entity is one with no 'approved' row
// in investor_entity_claims — that table is empty in production today
// (0 rows), so this never blocks anything yet, but becomes load-bearing
// the day a VC claims a profile and starts managing it themselves.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

// Exactly the prompt's own list. Everything else on catalog_entities has
// its own audited flow (verification, moderation, merge, enrichment,
// team-page cache) and must stay unreachable through this generic editor
// — enforced by only ever reading these exact keys off the request body,
// never spreading it.
const EDITABLE_FIELDS = [
  'name', 'website', 'thesis', 'sectors', 'stage_min', 'stage_max',
  'check_min_eur', 'check_max_eur', 'hq_city', 'hq_country', 'geographies',
  'email', 'phone', 'address', 'postal_code', 'key_people',
  'general_partner_emails', 'aum', 'current_funds', 'latest_fund',
  'last_investment_found', 'notes',
] as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  const { id } = params;

  const { data: entity, error } = await admin.from('catalog_entities').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!entity) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const { data: claim } = await admin.from('investor_entity_claims')
    .select('id').eq('catalog_entity_id', id).eq('status', 'approved').maybeSingle();

  const editable: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) editable[field] = entity[field] ?? null;

  return NextResponse.json({ ok: true, fields: editable, claimed: !!claim });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  const { id } = params;

  const { data: claim } = await admin.from('investor_entity_claims')
    .select('id').eq('catalog_entity_id', id).eq('status', 'approved').maybeSingle();
  if (claim) {
    return NextResponse.json({ ok: false, error: 'This profile has been claimed by its owner — direct editing is disabled.' }, { status: 403 });
  }

  const { data: existing, error: fetchErr } = await admin.from('catalog_entities').select('*').eq('id', id).maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  // Diff before writing — a save that changed nothing produces no patch,
  // no UPDATE call, and no audit row, per the prompt's own fixture. Also
  // where the "from"/"to" audit values come from: real before/after, not
  // just field names (the one thing this improves over the existing
  // catalog_candidate_edited action, which only ever logged names).
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const toValue = body[field] ?? null;
    const fromValue = (existing as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(toValue) === JSON.stringify(fromValue)) continue;
    patch[field] = toValue;
    changes[field] = { from: fromValue, to: toValue };
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, changed: false });

  // Menor — sectors_normalized (migration 0148) has no safe way to be
  // recomputed from arbitrary free text an admin types here: the real
  // mapping is a one-time, 300-row lookup table with several ambiguous
  // cases Nuno resolved by hand, not a general function (confirmed by
  // reading it — src/lib/sector-taxonomy.ts only exports the taxonomy
  // list, not a normalizer). Invalidating it (rather than leaving a stale
  // value pointing at sectors that no longer exist) is the honest
  // outcome the prompt itself offers as an acceptable option: this entity
  // drops out of normalized-sector matching (catalog_top_matches reads
  // sectors_normalized) until someone re-maps it, instead of silently
  // matching against the wrong sectors.
  if ('sectors' in patch) patch.sectors_normalized = null;

  const { error: updateErr } = await admin.from('catalog_entities').update(patch).eq('id', id);
  if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_entity_dossier_edit',
    subjectType: 'catalog_entity', subjectId: id, detail: { fields: changes },
  });

  return NextResponse.json({ ok: true, changed: true });
}
