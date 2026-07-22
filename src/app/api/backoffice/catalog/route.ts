// BLOCO 3 — catalog_entities CRUD. Platform admin only. This is the public
// investor catalog (no org_id — shared across every org via packs), so
// unlike every other backoffice route it's fine to expose the full row set
// without an org-boundary check.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: catalog, error }, { data: aliases }] = await Promise.all([
    admin.from('catalog_entities').select('*').order('created_at', { ascending: false }),
    admin.from('entity_aliases').select('catalog_id, alias'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const aliasByEntity = new Map<string, string[]>();
  for (const a of aliases ?? []) aliasByEntity.set(a.catalog_id, [...(aliasByEntity.get(a.catalog_id) ?? []), a.alias]);

  return NextResponse.json({
    ok: true,
    catalog: (catalog ?? []).map((c) => ({ ...c, aliases: aliasByEntity.get(c.id) ?? [] })),
  });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json();
  const { data: created, error } = await admin.from('catalog_entities').insert({
    name: body.name, type: body.type, hq_city: body.hq_city || null, hq_country: body.hq_country || null,
    sectors: body.sectors ?? [], stage_min: body.stage_min || null, stage_max: body.stage_max || null,
    check_min_eur: body.check_min_eur || null, check_max_eur: body.check_max_eur || null,
    thesis: body.thesis || null, website: body.website || null,
    verification_status: body.verification_status ?? 'pending', source: 'team', notes: body.notes || null,
  }).select().single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'catalog_create', subjectType: 'catalog_entity', subjectId: created.id, detail: { name: created.name } });
  return NextResponse.json({ ok: true, entity: created });
}
