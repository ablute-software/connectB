// Investor Workspace Fase 3 (prompt 56), Bloco 2 — founder publishes round
// updates; every investor with active access to this org gets an email
// summary. Reuses the existing Resend transactional helper, not a new
// mail path.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';

export async function GET() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'Not a member of any org.' }, { status: 403 });
  const { data: updates } = await sb.from('round_updates').select('*').eq('org_id', member.org_id).order('created_at', { ascending: false });
  return NextResponse.json({ updates: updates ?? [] });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { title?: string; body?: string };
  const { title, body: updateBody } = body;
  if (!title?.trim() || !updateBody?.trim()) return NextResponse.json({ ok: false, error: 'title and body are required.' }, { status: 400 });

  const { data: update, error } = await sb.from('round_updates')
    .insert({ org_id: member.org_id, title: title.trim(), body: updateBody.trim(), created_by: user.id })
    .select('id').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let emailedCount = 0;
  if (resendConfigured && url && serviceKey) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: org } = await admin.from('orgs').select('name').eq('id', member.org_id).single();
    const { data: grants } = await admin.from('access_grants').select('grantee_email, invited_email, confirmed_at, revoked_at, expires_at')
      .eq('org_id', member.org_id).is('revoked_at', null);
    const now = new Date();
    const emails = new Set((grants ?? [])
      .filter((g) => (!g.expires_at || new Date(g.expires_at as string) > now) && (!g.invited_email || g.confirmed_at))
      .map((g) => (g.grantee_email as string)?.trim().toLowerCase()).filter(Boolean));
    for (const to of emails) {
      const sent = await sendTransactionalEmail({
        to, subject: `${org?.name ?? 'A startup you\'re tracking'}: ${title.trim()}`,
        html: transactionalTemplate({
          heading: title.trim(), body: updateBody.trim(),
          ctaLabel: 'Open the portal', ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/portal`,
        }),
      }).catch(() => ({ sent: false }));
      if (sent.sent) emailedCount++;
    }
  }

  return NextResponse.json({ ok: true, id: update.id, emailedCount });
}
