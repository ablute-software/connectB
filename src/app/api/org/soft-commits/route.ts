// Investor Workspace Fase 3 (prompt 56), Bloco 3 — founder sees every soft
// commit for their org and confirms the ones that should count toward the
// round progress bar.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';

export async function GET() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'Not a member of any org.' }, { status: 403 });
  const { data: commits } = await sb.from('investor_soft_commits').select('*').eq('org_id', member.org_id).order('created_at', { ascending: false });
  return NextResponse.json({ commits: commits ?? [] });
}

export async function PATCH(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { id?: string; confirmed?: boolean };
  const { id, confirmed } = body;
  if (!id || confirmed === undefined) return NextResponse.json({ ok: false, error: 'id and confirmed are required.' }, { status: 400 });

  const { data: commit } = await sb.from('investor_soft_commits').select('org_id').eq('id', id).maybeSingle();
  if (!commit || commit.org_id !== member.org_id) return NextResponse.json({ ok: false, error: 'Soft commit not found.' }, { status: 404 });

  const { error } = await sb.from('investor_soft_commits')
    .update({ confirmed_by_founder: confirmed, confirmed_at: confirmed ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
