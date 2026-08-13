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

  // Prompt 187 §C — catalog_people (via catalog_person_affiliations, the
  // real join table — catalog_people.entity_id itself is "convenience
  // only, NOT source of truth" per its own migration comment) joined in so
  // the UI can finally show contacts that already exist: 1075 real rows in
  // production, 335 of 534 catalog entities already have someone attached,
  // and the old GET here never read this table at all.
  const [{ data: catalog, error }, { data: aliases }, { data: affiliations }] = await Promise.all([
    admin.from('catalog_entities').select('*').order('created_at', { ascending: false }),
    admin.from('entity_aliases').select('catalog_id, alias'),
    admin.from('catalog_person_affiliations')
      .select('entity_id, title, is_primary, catalog_people(id, full_name, linkedin_url, hook_status, do_not_contact)'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const aliasByEntity = new Map<string, string[]>();
  for (const a of aliases ?? []) aliasByEntity.set(a.catalog_id, [...(aliasByEntity.get(a.catalog_id) ?? []), a.alias]);

  type ContactRow = { id: string; fullName: string; linkedinUrl: string | null; hookStatus: string; doNotContact: boolean; title: string | null; isPrimary: boolean };
  const contactsByEntity = new Map<string, ContactRow[]>();
  for (const a of affiliations ?? []) {
    const person = a.catalog_people as unknown as { id: string; full_name: string; linkedin_url: string | null; hook_status: string; do_not_contact: boolean } | null;
    if (!person) continue;
    const entityId = a.entity_id as string;
    const row: ContactRow = {
      id: person.id, fullName: person.full_name, linkedinUrl: person.linkedin_url,
      hookStatus: person.hook_status, doNotContact: person.do_not_contact,
      title: a.title as string | null, isPrimary: !!a.is_primary,
    };
    contactsByEntity.set(entityId, [...(contactsByEntity.get(entityId) ?? []), row]);
  }

  return NextResponse.json({
    ok: true,
    catalog: (catalog ?? []).map((c) => ({ ...c, aliases: aliasByEntity.get(c.id) ?? [], contacts: contactsByEntity.get(c.id) ?? [] })),
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
