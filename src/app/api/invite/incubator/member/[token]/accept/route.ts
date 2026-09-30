// Prompt I-01 §C.1 — accept a member invite with the caller's own session;
// incubator_accept_member_invite() checks the address matches.
import { NextResponse } from 'next/server';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { incubatorErrorText } from '@/lib/incubators';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (!authEnabled) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data, error } = await sb.rpc('incubator_accept_member_invite', { p_token: params.token });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error, message: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true });
}
