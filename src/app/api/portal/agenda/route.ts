// Investor Workspace Agenda (prompt 59) — three sources merged into one
// timeline, no parallel meetings system: meetings reuse matchdeal's own
// matchdeal_meeting_proposals (the mobile pairing/swipe flow already
// produces these), round-close deadlines read straight off
// orgs.round_target_close_date, and manual follow-ups are the one genuinely
// new thing (migration 0060).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { eligibleOrgIds } from '@/lib/portal-access';
import { getAgendaItems } from '@/lib/investor-agenda';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const items = await getAgendaItems(admin, sb, user.id, email);
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string; note?: string; remindAt?: string };
  if (!body.orgId || !body.remindAt) return NextResponse.json({ ok: false, error: 'orgId and remindAt are required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, user.id, email, person?.id ?? null);
  if (!orgIds.includes(body.orgId)) return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });

  const { error } = await admin.from('investor_followups').insert({
    org_id: body.orgId, investor_email: email, note: body.note ?? null, remind_at: body.remindAt,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // investor_email match here IS the ownership check (this table has no
  // other RLS access for investors — see migration 0060's header) — a
  // service-role update without it would let any signed-in investor mark
  // any other investor's follow-up done.
  const { error } = await admin.from('investor_followups').update({ done: true }).eq('id', body.id).eq('investor_email', email);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Prompt 345 §C.2 — "cancel", distinct from PATCH's "mark done": a
// cancelled reminder was never acted on, so it shouldn't leave a done=true
// row reading as completed anywhere a caller filters on that column
// (PATCH's own semantics, used by the Agenda's own "Done" action on a
// follow-up). Deleted outright instead.
export async function DELETE(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Same ownership check as PATCH — investor_email match, since this table
  // has no other RLS access for investors (migration 0060's own header).
  const { error } = await admin.from('investor_followups').delete().eq('id', id).eq('investor_email', email);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
