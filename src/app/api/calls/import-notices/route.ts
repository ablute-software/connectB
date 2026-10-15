// Prompt 909 (Adenda 2b) — the in-app notices of the person who imports from documents: "Proposal ready to review" / "We could not read the documents".
// Only the signed-in user's own, only the two import kinds, shown until seen. The applicant's notices (/api/calls/apply/notices) never include these.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { serverClient } from '@/lib/supabase-server';
import { callsMode } from '@/lib/calls/mode';
import { serviceClient } from '@/lib/calls/applicant/link';
import { IMPORT_NOTICE_KINDS } from '@/lib/calls/applicant/notices';

export const dynamic = 'force-dynamic';

async function me() {
  if (callsMode() === 'off') return { error: NextResponse.json({ ok: false }, { status: 404 }) } as const;
  const admin = serviceClient();
  if (!admin) return { error: NextResponse.json({ ok: true, notices: [] }) } as const;
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) } as const;
  return { admin, userId: user.id } as const;
}

export const GET = withActingOrg(async function GET() {
  const w = await me();
  if ('error' in w) return w.error;
  const { data } = await w.admin.from('call_notices').select('id, kind, title, body, call_id, created_at')
    .eq('user_id', w.userId).in('kind', IMPORT_NOTICE_KINDS).is('seen_at', null).order('created_at', { ascending: false }).limit(20);
  return NextResponse.json({
    ok: true,
    notices: ((data ?? []) as { id: string; kind: string; title: string; body: string | null; call_id: string; created_at: string }[])
      .map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, callId: n.call_id, createdAt: n.created_at })),
  });
});

/** POST { ids } or { callId }: mark the person's own import notices as seen (all those of one call when the call is opened). */
export const POST = withActingOrg(async function POST(req: Request) {
  const w = await me();
  if ('error' in w) return w.error;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; callId?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  const seen = new Date().toISOString();
  let q = w.admin.from('call_notices').update({ seen_at: seen }).eq('user_id', w.userId).in('kind', IMPORT_NOTICE_KINDS).is('seen_at', null);
  if (ids.length > 0) q = q.in('id', ids);
  else if (typeof body.callId === 'string' && body.callId) q = q.eq('call_id', body.callId);
  else return NextResponse.json({ ok: true });
  await q;
  return NextResponse.json({ ok: true });
});
