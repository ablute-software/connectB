// BLOCO 3 — merge duplicate catalog_entities. IRM_SPEC §9b-3c: "merge,
// never blind-overwrite" — non-empty beats empty on the keeper, both-
// non-empty-and-different is left alone (not silently picked) and noted in
// the audit log for a human to reconcile later. Every merged row's name
// becomes an alias of the keeper so future duplicate detection catches it
// (and future imports can match it) without re-doing this work.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

const MERGEABLE_FIELDS = [
  'hq_city', 'hq_country', 'sectors', 'stage_min', 'stage_max',
  'check_min_eur', 'check_max_eur', 'thesis', 'website',
] as const;

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { keepId, mergeIds } = await req.json() as { keepId?: string; mergeIds?: string[] };
  if (!keepId || !mergeIds?.length) return NextResponse.json({ ok: false, error: 'keepId and mergeIds are required.' }, { status: 400 });
  if (mergeIds.includes(keepId)) return NextResponse.json({ ok: false, error: 'keepId cannot also be in mergeIds.' }, { status: 400 });

  const { data: rows, error: rowsErr } = await admin.from('catalog_entities').select('*').in('id', [keepId, ...mergeIds]);
  if (rowsErr) return NextResponse.json({ ok: false, error: rowsErr.message }, { status: 500 });
  const keeper = rows?.find((r) => r.id === keepId);
  if (!keeper) return NextResponse.json({ ok: false, error: 'keepId not found.' }, { status: 404 });
  const losers = rows?.filter((r) => mergeIds.includes(r.id)) ?? [];
  if (losers.length !== mergeIds.length) return NextResponse.json({ ok: false, error: 'One or more mergeIds not found.' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  const conflicts: Record<string, unknown[]> = {};
  for (const field of MERGEABLE_FIELDS) {
    const keeperVal = (keeper as Record<string, unknown>)[field];
    if (!isEmpty(keeperVal)) continue;
    for (const loser of losers) {
      const loserVal = (loser as Record<string, unknown>)[field];
      if (isEmpty(loserVal)) continue;
      if (patch[field] === undefined) patch[field] = loserVal;
      else if (JSON.stringify(patch[field]) !== JSON.stringify(loserVal)) {
        conflicts[field] = [...(conflicts[field] ?? [patch[field]]), loserVal];
      }
    }
  }
  // A field with a recorded conflict is genuinely ambiguous — don't guess, leave it for a human.
  for (const field of Object.keys(conflicts)) delete patch[field];

  if (keeper.verification_status !== 'verified' && losers.some((l) => l.verification_status === 'verified')) {
    patch.verification_status = 'verified';
    patch.verified_at = new Date().toISOString();
    patch.verified_by = userId;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('catalog_entities').update(patch).eq('id', keepId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Re-point every reference before deleting the losers.
  for (const loser of losers) {
    await admin.from('entity_aliases').insert({ catalog_id: keepId, alias: loser.name }).select().maybeSingle();
    const { data: loserAliases } = await admin.from('entity_aliases').select('alias').eq('catalog_id', loser.id);
    for (const a of loserAliases ?? []) {
      await admin.from('entity_aliases').insert({ catalog_id: keepId, alias: a.alias }).select().maybeSingle();
    }

    const { data: items } = await admin.from('pack_items').select('pack_id').eq('catalog_id', loser.id);
    for (const it of items ?? []) {
      const { data: dupe } = await admin.from('pack_items').select('pack_id').eq('pack_id', it.pack_id).eq('catalog_id', keepId).maybeSingle();
      if (!dupe) await admin.from('pack_items').update({ catalog_id: keepId }).eq('pack_id', it.pack_id).eq('catalog_id', loser.id);
    }
    await admin.from('pack_items').delete().eq('catalog_id', loser.id);

    const { data: deliveries } = await admin.from('catalog_deliveries').select('org_id').eq('catalog_id', loser.id);
    for (const d of deliveries ?? []) {
      const { data: dupe } = await admin.from('catalog_deliveries').select('id').eq('org_id', d.org_id).eq('catalog_id', keepId).maybeSingle();
      if (!dupe) await admin.from('catalog_deliveries').update({ catalog_id: keepId }).eq('org_id', d.org_id).eq('catalog_id', loser.id);
      else await admin.from('catalog_deliveries').delete().eq('org_id', d.org_id).eq('catalog_id', loser.id);
    }

    await admin.from('investor_submissions').update({ merged_catalog_id: keepId }).eq('merged_catalog_id', loser.id);
  }

  const { error: delErr } = await admin.from('catalog_entities').delete().in('id', mergeIds);
  if (delErr) return NextResponse.json({ ok: false, error: `Merged fields and references, but couldn't delete the old rows: ${delErr.message}` }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_merge', subjectType: 'catalog_entity', subjectId: keepId,
    detail: { mergedFrom: losers.map((l) => ({ id: l.id, name: l.name })), fieldsFilled: patch, conflictsLeftForReview: conflicts },
  });

  return NextResponse.json({ ok: true, keptId: keepId, mergedCount: losers.length, conflicts });
}
