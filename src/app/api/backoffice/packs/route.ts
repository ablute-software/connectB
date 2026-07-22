import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: packs, error }, { data: items }] = await Promise.all([
    admin.from('packs').select('*').order('created_at', { ascending: false }),
    admin.from('pack_items').select('pack_id, catalog_id'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const itemsByPack = new Map<string, string[]>();
  for (const it of items ?? []) itemsByPack.set(it.pack_id, [...(itemsByPack.get(it.pack_id) ?? []), it.catalog_id]);

  return NextResponse.json({ ok: true, packs: (packs ?? []).map((p) => ({ ...p, catalogIds: itemsByPack.get(p.id) ?? [] })) });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json();
  const { data: created, error } = await admin.from('packs').insert({
    name: body.name, description: body.description || null, price_eur: body.price_eur ?? 0, active: body.active ?? true,
  }).select().single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'pack_create', subjectType: 'pack', subjectId: created.id, detail: { name: created.name } });
  return NextResponse.json({ ok: true, pack: created });
}
