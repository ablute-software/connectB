// Prompt 187 §A — "promover para o catálogo" for a manual entities row with
// no likely duplicate already there. Creates one new catalog_entities row,
// source='startup_submitted' (a new provenance value — catalog_entities.source
// has no DB check constraint, only the comment "'team' | 'user_submission'",
// so this is a plain additive value, no migration needed).
//
// Deliberately the ONLY mechanism for "add to other startups' pipelines"
// too — the prompt's own text frames that as a possible second action, but
// flags it needs confirming with Nuno, then immediately answers its own
// question: adding directly to catalog_entities is "o caminho correto e
// mais simples... evitar inventar um segundo caminho de distribuição
// direta org-a-org" — every other org's Pipeline already sources from the
// catalog via catalog_top_matches/unlockPack, so promoting here already IS
// "add to other startups' pipelines", automatically, once verified. No
// second action built.
//
// verification_status defaults to 'pending', same as every other
// catalog_entities creation path (POST /api/backoffice/catalog) — a
// promoted row gets the same manual-verify step as a hand-typed one, not a
// silent shortcut to 'verified'.
//
// Prompt 191 §D/§E — the provenance note now leads with the org's real
// name (readable in the Catalog table) instead of its UUID, with the
// technical trail kept as a parenthetical for debugging; and the source
// entities row is marked catalog_review_status='promoted' after a
// successful insert so it stops reappearing in "Added by startups" — see
// migration 0169 (proposed, not yet applied) for that column.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { manualEntityId } = await req.json().catch(() => ({})) as { manualEntityId?: string };
  if (!manualEntityId) return NextResponse.json({ ok: false, error: 'manualEntityId is required.' }, { status: 400 });

  const { data: manual, error: manualErr } = await admin.from('entities')
    .select('id, org_id, name, type, hq_city, hq_country, invests_in_geographies, stage_min, stage_max, check_min_eur, check_max_eur, sectors, thesis, website, source')
    .eq('id', manualEntityId).maybeSingle();
  if (manualErr) return NextResponse.json({ ok: false, error: manualErr.message }, { status: 500 });
  if (!manual) return NextResponse.json({ ok: false, error: 'Manual entity not found.' }, { status: 404 });
  if (manual.source !== 'manual') return NextResponse.json({ ok: false, error: 'Not a manually-added entity.' }, { status: 400 });

  const { data: org } = await admin.from('orgs').select('name').eq('id', manual.org_id).maybeSingle();
  const orgName = org?.name ?? '(deleted org)';

  const { data: created, error } = await admin.from('catalog_entities').insert({
    name: manual.name, type: manual.type, hq_city: manual.hq_city, hq_country: manual.hq_country,
    geographies: manual.invests_in_geographies ?? [],
    sectors: manual.sectors ?? [], stage_min: manual.stage_min, stage_max: manual.stage_max,
    check_min_eur: manual.check_min_eur, check_max_eur: manual.check_max_eur,
    thesis: manual.thesis, website: manual.website,
    verification_status: 'pending', source: 'startup_submitted',
    notes: `Added by startup ${orgName}. (promoted from entities.id=${manual.id})`,
  }).select().single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const { error: statusErr } = await admin.from('entities').update({ catalog_review_status: 'promoted' }).eq('id', manual.id);
  if (statusErr) return NextResponse.json({ ok: false, error: `Catalog entry created, but couldn't mark the source row as promoted: ${statusErr.message}` }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_promote_from_manual', subjectType: 'catalog_entity', subjectId: created.id,
    detail: { name: created.name, fromEntityId: manual.id, fromOrgId: manual.org_id },
  });

  return NextResponse.json({ ok: true, entity: created });
}
