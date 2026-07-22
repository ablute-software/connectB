// BLOCO 3 — cross-org distribution log (who received what). Previously
// read from the founder-scoped client store (`db.unlocks`, one org only);
// this is the real anti-duplication ledger across every org.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: deliveries, error } = await admin
    .from('catalog_deliveries')
    .select('id, org_id, catalog_id, via_pack, delivered_at')
    .order('delivered_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const orgIds = [...new Set((deliveries ?? []).map((d) => d.org_id))];
  const catalogIds = [...new Set((deliveries ?? []).map((d) => d.catalog_id))];
  const packIds = [...new Set((deliveries ?? []).map((d) => d.via_pack).filter(Boolean))] as string[];

  const [{ data: orgs }, { data: catalog }, { data: packs }] = await Promise.all([
    orgIds.length ? admin.from('orgs').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    catalogIds.length ? admin.from('catalog_entities').select('id, name').in('id', catalogIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    packIds.length ? admin.from('packs').select('id, name').in('id', packIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const catalogName = new Map((catalog ?? []).map((c) => [c.id, c.name]));
  const packName = new Map((packs ?? []).map((p) => [p.id, p.name]));

  return NextResponse.json({
    ok: true,
    deliveries: (deliveries ?? []).map((d) => ({
      ...d, orgName: orgName.get(d.org_id) ?? '(unknown org)', catalogName: catalogName.get(d.catalog_id) ?? '(deleted)',
      packName: d.via_pack ? packName.get(d.via_pack) ?? null : null,
    })),
  });
}
