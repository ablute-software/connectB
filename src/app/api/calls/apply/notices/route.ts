// Prompt 907 (I3, I5) — the in-app notices of the applicant (spec §23): "application received", "your draft is still unsubmitted, 48 h left",
// "new deadline". Shown to the person they are for, until they dismiss them — the same pattern as investor_seat_notices. Only the signed-in
// user's own notices are ever read or marked.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { serverClient } from '@/lib/supabase-server';
import { callsMode } from '@/lib/calls/mode';
import { serviceClient } from '@/lib/calls/applicant/link';

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
  const { data } = await w.admin.from('call_notices').select('id, kind, title, body, link_path, created_at').eq('user_id', w.userId).is('seen_at', null).order('created_at', { ascending: false }).limit(20);
  return NextResponse.json({
    ok: true,
    notices: ((data ?? []) as { id: string; kind: string; title: string; body: string | null; link_path: string | null; created_at: string }[])
      .map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, linkPath: n.link_path, createdAt: n.created_at })),
  });
});

export const POST = withActingOrg(async function POST(req: Request) {
  const w = await me();
  if ('error' in w) return w.error;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  if (ids.length > 0) await w.admin.from('call_notices').update({ seen_at: new Date().toISOString() }).eq('user_id', w.userId).in('id', ids).is('seen_at', null);
  return NextResponse.json({ ok: true });
});
