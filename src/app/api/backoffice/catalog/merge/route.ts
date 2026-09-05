// BLOCO 3 — merge duplicate catalog_entities. IRM_SPEC §9b-3c: "merge,
// never blind-overwrite" — non-empty beats empty on the keeper, both-
// non-empty-and-different is left alone (not silently picked) and noted in
// the audit log for a human to reconcile later. Every merged row's name
// becomes an alias of the keeper so future duplicate detection catches it
// (and future imports can match it) without re-doing this work.
//
// Prompt 187 §A — extended to accept a manualEntityId (an `entities`
// row, source='manual') as the field source INSTEAD of mergeIds, per the
// prompt's own explicit instruction to reuse this route rather than build
// a second one. Deliberately a separate code path, not the same one with
// entities rows mixed into `losers`: a manual entity is a live CRM row
// that belongs to some founder's own org — it is never deleted, aliased,
// or re-pointed the way a losing catalog_entities row is (pack_items/
// catalog_deliveries/investor_submissions all reference catalog_entities
// ids specifically; none of that applies to an entities row). Only the
// keeper's own empty fields get filled in; everything after the merge
// completes with the manual entity untouched, still living in its own
// org's pipeline exactly as before.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

const MERGEABLE_FIELDS = [
  'hq_city', 'hq_country', 'sectors', 'stage_min', 'stage_max',
  'check_min_eur', 'check_max_eur', 'thesis', 'website',
] as const;

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

async function mergeFromManualEntity(admin: SupabaseClient, userId: string, keepId: string, manualEntityId: string) {
  const { data: keeper, error: keeperErr } = await admin.from('catalog_entities').select('*').eq('id', keepId).maybeSingle();
  if (keeperErr) return NextResponse.json({ ok: false, error: keeperErr.message }, { status: 500 });
  if (!keeper) return NextResponse.json({ ok: false, error: 'keepId not found.' }, { status: 404 });

  const { data: manual, error: manualErr } = await admin.from('entities')
    .select('id, org_id, name, hq_city, hq_country, invests_in_geographies, stage_min, stage_max, check_min_eur, check_max_eur, sectors, thesis, website, source')
    .eq('id', manualEntityId).maybeSingle();
  if (manualErr) return NextResponse.json({ ok: false, error: manualErr.message }, { status: 500 });
  if (!manual) return NextResponse.json({ ok: false, error: 'manualEntityId not found.' }, { status: 404 });
  if (manual.source !== 'manual') return NextResponse.json({ ok: false, error: 'Not a manually-added entity.' }, { status: 400 });

  // `entities.invests_in_geographies` maps onto catalog_entities.geographies
  // — different column names, same concept — so it's handled explicitly
  // rather than folded into the field-name-identical MERGEABLE_FIELDS loop.
  const manualAsCatalogShape: Record<string, unknown> = { ...manual, geographies: manual.invests_in_geographies };

  const patch: Record<string, unknown> = {};
  const conflicts: Record<string, unknown[]> = {};
  for (const field of [...MERGEABLE_FIELDS, 'geographies'] as const) {
    const keeperVal = (keeper as Record<string, unknown>)[field];
    if (!isEmpty(keeperVal)) continue;
    const manualVal = manualAsCatalogShape[field];
    if (isEmpty(manualVal)) continue;
    patch[field] = manualVal;
  }

  // Prompt 191 §D — same "fill only if empty, never overwrite" rule the
  // loop above already applies to every other field, extended to notes:
  // a keeper that already has curator notes keeps them untouched; only an
  // empty notes field gets the readable provenance line. This never flips
  // catalog_entities.source (a merge only ever patches an existing row),
  // so the §D badge in CatalogTable — gated on source='startup_submitted'
  // — won't show for a merged row; that's the prompt's own literal
  // condition, not an oversight here.
  if (isEmpty(keeper.notes)) {
    const { data: org } = await admin.from('orgs').select('name').eq('id', manual.org_id).maybeSingle();
    patch.notes = `Added by startup ${org?.name ?? '(deleted org)'}. (merged from entities.id=${manual.id})`;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('catalog_entities').update(patch).eq('id', keepId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Prompt 191 §E — marks the source row treated so it stops reappearing
  // in "Added by startups"; see migration 0169 (proposed, not yet
  // applied) for the catalog_review_status column.
  const { error: statusErr } = await admin.from('entities').update({ catalog_review_status: 'merged' }).eq('id', manual.id);
  if (statusErr) return NextResponse.json({ ok: false, error: `Merged into the catalog, but couldn't mark the source row as merged: ${statusErr.message}` }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_merge_from_manual', subjectType: 'catalog_entity', subjectId: keepId,
    detail: { fromEntityId: manual.id, fromOrgId: manual.org_id, fieldsFilled: patch, conflicts },
  });

  return NextResponse.json({ ok: true, keptId: keepId, mergedCount: 1, conflicts });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { keepId, mergeIds, manualEntityId, reason, confirmInversion } = await req.json() as {
    keepId?: string; mergeIds?: string[]; manualEntityId?: string; reason?: string; confirmInversion?: boolean;
  };
  if (!keepId) return NextResponse.json({ ok: false, error: 'keepId is required.' }, { status: 400 });

  if (manualEntityId) return mergeFromManualEntity(admin, userId, keepId, manualEntityId);

  if (!mergeIds?.length) return NextResponse.json({ ok: false, error: 'mergeIds or manualEntityId is required.' }, { status: 400 });
  if (mergeIds.includes(keepId)) return NextResponse.json({ ok: false, error: 'keepId cannot also be in mergeIds.' }, { status: 400 });
  // Prompt 580 §B.3 — a catalog-to-catalog merge deletes rows and repoints
  // real founder pipelines; the AccountActionPanel-style confirm flow this
  // now goes through always sends a reason, but the route enforces it
  // independently rather than trusting the UI alone (the same "never only
  // UI" discipline backoffice-auth.ts already documents for the admin gate).
  if (!reason?.trim()) return NextResponse.json({ ok: false, error: 'A reason is required.' }, { status: 400 });

  const { data: rows, error: rowsErr } = await admin.from('catalog_entities').select('*').in('id', [keepId, ...mergeIds]);
  if (rowsErr) return NextResponse.json({ ok: false, error: rowsErr.message }, { status: 500 });
  const keeper = rows?.find((r) => r.id === keepId);
  if (!keeper) return NextResponse.json({ ok: false, error: 'keepId not found.' }, { status: 404 });
  const losers = rows?.filter((r) => mergeIds.includes(r.id)) ?? [];
  if (losers.length !== mergeIds.length) return NextResponse.json({ ok: false, error: 'One or more mergeIds not found.' }, { status: 404 });

  // Prompt 580 §B.2 — merging a verified row INTO a pending one is the
  // exact inversion that corrupted btov Partners on 2026-08-13 (a verified,
  // real firm with deliveries and pipelines merged into a pending row).
  // The server refuses it without an explicit second confirmation from the
  // client — not a UI nudge alone, since a fast click can miss those.
  const invertsVerification = keeper.verification_status !== 'verified' && losers.some((l) => l.verification_status === 'verified');
  if (invertsVerification && !confirmInversion) {
    return NextResponse.json({
      ok: false, requiresInversionConfirm: true,
      error: 'This merges a verified entry into a pending one. Confirm explicitly to proceed.',
    }, { status: 409 });
  }

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
    detail: {
      mergedFrom: losers.map((l) => ({ id: l.id, name: l.name })), fieldsFilled: patch,
      conflictsLeftForReview: conflicts, reason: reason.trim(), invertedVerification: invertsVerification,
    },
  });

  return NextResponse.json({ ok: true, keptId: keepId, mergedCount: losers.length, conflicts });
}
