// Prompt 348 §D — founder-authored updates sent to watchers, through the
// PRIVATE watching channel only — never src/app/network (My Network feed).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ updates: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ updates: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await admin.from('watch_updates').select('id, body, target, recipient_investor_catalog_entity_ids, created_at')
    .eq('org_id', member.org_id as string).order('created_at', { ascending: false });
  return NextResponse.json({ updates: data ?? [] });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { body?: string; recipientInvestorCatalogEntityIds?: string[] };
  if (!body.body?.trim()) return NextResponse.json({ ok: false, error: 'An update needs some text.' }, { status: 400 });
  if (body.body.length > 2000) return NextResponse.json({ ok: false, error: 'Keep it under 2000 characters.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const target = body.recipientInvestorCatalogEntityIds && body.recipientInvestorCatalogEntityIds.length > 0 ? 'selected' : 'all';
  const { error } = await admin.from('watch_updates').insert({
    org_id: member.org_id as string, author_user_id: user.id, body: body.body.trim(), target,
    recipient_investor_catalog_entity_ids: target === 'selected' ? body.recipientInvestorCatalogEntityIds : null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
