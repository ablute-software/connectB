// Accepts an invitation for the CALLER's own authenticated session — the
// invitee inserts into org_members via service role (can't satisfy
// is_org_member yet, so RLS can't do this for them directly), but the
// route validates the invitation belongs to that same authenticated email.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: invite, error } = await admin
    .from('org_invitations')
    .select('id, org_id, email, role, status, expires_at')
    .eq('token', params.token)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!invite) return NextResponse.json({ ok: false, error: 'Invitation not found.' }, { status: 404 });
  if (invite.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'This invitation was sent to a different email address.' }, { status: 403 });
  }
  if (invite.status !== 'pending') return NextResponse.json({ ok: false, error: `Invitation already ${invite.status}.` }, { status: 409 });
  if (new Date(invite.expires_at) < new Date()) {
    await admin.from('org_invitations').update({ status: 'expired' }).eq('id', invite.id);
    return NextResponse.json({ ok: false, error: 'Invitation expired.' }, { status: 409 });
  }

  const { error: memberErr } = await admin
    .from('org_members')
    .upsert({ org_id: invite.org_id, user_id: user.id, role: invite.role }, { onConflict: 'org_id,user_id' });
  if (memberErr) return NextResponse.json({ ok: false, error: memberErr.message }, { status: 500 });

  await admin.from('org_invitations').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invite.id);
  return NextResponse.json({ ok: true, org_id: invite.org_id });
}
