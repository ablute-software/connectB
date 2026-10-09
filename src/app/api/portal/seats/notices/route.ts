// Prompt 904 Adenda 1 — "You've been added to X". The back-office adds someone to a firm by email and leaves a
// notice keyed by that EMAIL; this route shows it to whoever signs in with that address, once (and marks it seen
// when dismissed). Only the signed-in user's own CONFIRMED address is ever looked up, never one the caller types.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';

type Me = { error: NextResponse; admin?: undefined; email?: undefined } | { error?: undefined; admin: SupabaseClient; email: string };

async function whoAmI(): Promise<Me> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: true, notices: [] }) };
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  // An unconfirmed address proves nothing about who is typing it.
  if (!user.email || !user.email_confirmed_at) return { error: NextResponse.json({ ok: true, notices: [] }) };
  return { admin: createClient(url, service, { auth: { persistSession: false } }), email: user.email.trim().toLowerCase() };
}

export async function GET() {
  const me = await whoAmI();
  if (me.error) return me.error;
  const notices = await makeSeatStore(me.admin).unseenNotices(me.email);
  if (notices.length === 0) return NextResponse.json({ ok: true, notices: [] });
  const { data: ents } = await me.admin.from('catalog_entities').select('id, name').in('id', [...new Set(notices.map((n) => n.entityId))]);
  const nameBy = new Map((ents ?? []).map((e) => [e.id as string, e.name as string]));
  return NextResponse.json({
    ok: true,
    notices: notices.map((n) => ({ id: n.id, firmName: nameBy.get(n.entityId) ?? 'your firm', createdAt: n.createdAt })),
  });
}

export async function POST(req: Request) {
  const me = await whoAmI();
  if (me.error) return me.error;
  const body = await req.json().catch(() => ({})) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  await makeSeatStore(me.admin).markNoticesSeen(me.email, ids);
  return NextResponse.json({ ok: true });
}
