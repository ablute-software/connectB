// Public, read-only invitation lookup — the invitee isn't an org member yet
// so RLS can't grant them direct table access. Returns only what the
// /invite/[token] page needs to render, nothing more sensitive.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: invite, error } = await admin
    .from('org_invitations')
    .select('email, role, status, expires_at, org_id')
    .eq('token', params.token)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!invite) return NextResponse.json({ ok: false, error: 'Invitation not found.' }, { status: 404 });

  const { data: org } = await admin.from('orgs').select('name').eq('id', invite.org_id).maybeSingle();
  const expired = invite.status === 'pending' && new Date(invite.expires_at) < new Date();

  return NextResponse.json({
    ok: true,
    email: invite.email,
    role: invite.role,
    status: expired ? 'expired' : invite.status,
    org_name: org?.name ?? 'this org',
  });
}
