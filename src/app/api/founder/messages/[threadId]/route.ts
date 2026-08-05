// P134-C — founder side of one Sherlock messaging thread. GET returns the
// messages (marking founder_last_read_at); POST sends a reply. The thread's
// own startup_org_id must match the founder's org — never trusted from the
// URL alone.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { dealMessagesAvailable } from '@/lib/deal-messages-capability';
import { getThreadMessages, postMessage, markThreadRead } from '@/lib/deal-messages';

async function resolveFounderOrgId(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (member?.org_id as string | undefined) ?? null;
}

export async function GET(_req: Request, { params }: { params: { threadId: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ messages: [] }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await dealMessagesAvailable())) return NextResponse.json({ messages: [] });

  const orgId = await resolveFounderOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: thread } = await admin.from('deal_threads').select('id, startup_org_id').eq('id', params.threadId).maybeSingle();
  if (!thread || thread.startup_org_id !== orgId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const messages = await getThreadMessages(admin, params.threadId);
  await markThreadRead(admin, params.threadId, 'founder');
  return NextResponse.json({ messages });
}

export async function POST(req: Request, { params }: { params: { threadId: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await dealMessagesAvailable())) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const orgId = await resolveFounderOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { body?: string; links?: unknown; documentIds?: string[] };
  if (!body.body?.trim()) return NextResponse.json({ ok: false, error: "Message can't be empty." }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: thread } = await admin.from('deal_threads').select('id, startup_org_id').eq('id', params.threadId).maybeSingle();
  if (!thread || thread.startup_org_id !== orgId) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  // Founder attaching their own documents — validated as belonging to
  // their own org (the data room is already theirs; no grant check needed
  // the way the investor side needs one).
  const requestedDocIds = [...new Set(body.documentIds ?? [])];
  let allowedDocIds: string[] = [];
  if (requestedDocIds.length > 0) {
    const { data: ownDocs } = await admin.from('documents').select('id').in('id', requestedDocIds).eq('org_id', orgId);
    allowedDocIds = (ownDocs ?? []).map((d) => d.id as string);
  }

  const { error } = await postMessage(admin, {
    threadId: params.threadId, senderSide: 'founder', senderUserId: user.id,
    body: body.body, links: body.links, documentIds: allowedDocIds,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
