// Prompt 353 — founder-side list/reorder/delete for the Photos & media
// gallery. Upload (file) and link (video) go through their own dedicated
// routes (upload/route.ts, link/route.ts) since they have very different
// bodies; this route is the read + edit-in-place half.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { validateCaption } from '@/lib/company-media';

async function resolveOrgId(sb: Awaited<ReturnType<typeof serverClient>>, userId: string): Promise<string | null> {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ items: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const orgId = await resolveOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ items: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await admin.from('company_media')
    .select('id, kind, category, caption, storage_path, external_url, malware_scan_status, sort_order, created_at')
    .eq('org_id', orgId).order('sort_order', { ascending: true });
  return NextResponse.json({ items: data ?? [] });
}

export async function PATCH(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const orgId = await resolveOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as {
    orderedIds?: string[]; id?: string; caption?: string; category?: 'company' | 'technology' | 'team';
  };

  // Reorder: an array of every item's id in its new display order — sets
  // sort_order = array index for each, same "position = index" convention
  // reorderByDrag (data-room.ts) already uses.
  if (Array.isArray(body.orderedIds)) {
    const { data: existing } = await admin.from('company_media').select('id').eq('org_id', orgId);
    const ownIds = new Set((existing ?? []).map((r) => r.id as string));
    if (!body.orderedIds.every((id) => ownIds.has(id)) || body.orderedIds.length !== ownIds.size) {
      return NextResponse.json({ ok: false, error: 'Order list must match this org\'s own items exactly.' }, { status: 400 });
    }
    await Promise.all(body.orderedIds.map((id, i) => admin.from('company_media').update({ sort_order: i }).eq('id', id)));
    return NextResponse.json({ ok: true });
  }

  // Edit caption/category on one item.
  if (body.id) {
    const patch: Record<string, unknown> = {};
    if (body.caption !== undefined) {
      const err = validateCaption(body.caption);
      if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
      patch.caption = body.caption.trim();
    }
    if (body.category !== undefined) patch.category = body.category;
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });
    const { error } = await admin.from('company_media').update(patch).eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'orderedIds or id is required.' }, { status: 400 });
}

export async function DELETE(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const orgId = await resolveOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: row } = await admin.from('company_media').select('id, storage_path').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  if (row.storage_path) await admin.storage.from('data-room').remove([row.storage_path as string]);
  const { error } = await admin.from('company_media').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
