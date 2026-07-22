import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json() as { name?: string; description?: string; price_eur?: number; active?: boolean; addCatalogId?: string; removeCatalogId?: string };
  const patch: Record<string, unknown> = {};
  for (const f of ['name', 'description', 'price_eur', 'active'] as const) if (f in body) patch[f] = body[f];

  if (Object.keys(patch).length) {
    const { error } = await admin.from('packs').update(patch).eq('id', params.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (body.addCatalogId) {
    const { error } = await admin.from('pack_items').upsert({ pack_id: params.id, catalog_id: body.addCatalogId });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (body.removeCatalogId) {
    const { error } = await admin.from('pack_items').delete().eq('pack_id', params.id).eq('catalog_id', body.removeCatalogId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await logAdminAction(admin, { adminUserId: userId, action: 'pack_update', subjectType: 'pack', subjectId: params.id, detail: body });
  return NextResponse.json({ ok: true });
}
