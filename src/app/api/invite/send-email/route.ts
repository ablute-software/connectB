// NEXT_STEPS Phase 5 — send the invite email if Resend is configured; the
// invitation row itself is already created client-side (RLS-gated) by the
// time this is called. Env-gated: without RESEND_API_KEY this just reports
// sent:false and the caller keeps showing the copyable link, unchanged.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { BRAND_NAME, APP_URL } from '@/lib/brand';

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ ok: false, sent: false, error: 'token required' }, { status: 400 });

  if (!resendConfigured) return NextResponse.json({ ok: true, sent: false });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, sent: false });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: invite, error } = await admin.from('org_invitations').select('email, role, org_id').eq('token', token).maybeSingle();
  if (error || !invite) return NextResponse.json({ ok: false, sent: false, error: error?.message ?? 'invitation not found' }, { status: 404 });

  const { data: org } = await admin.from('orgs').select('name').eq('id', invite.org_id).maybeSingle();
  // Built from APP_URL (not the request origin) so the accept link always points
  // at the canonical domain — the cutover is one env change, no code edit.
  const acceptUrl = `${APP_URL}/invite/${token}`;

  const result = await sendTransactionalEmail({
    to: invite.email,
    subject: `You've been invited to ${org?.name ?? 'a workspace'} on ${BRAND_NAME}`,
    html: transactionalTemplate({
      heading: `Join ${org?.name ?? 'the team'} on ${BRAND_NAME}`,
      body: `You've been invited as ${invite.role === 'member' ? 'a team member' : `an ${invite.role}`}. Click below to accept — this link expires in 14 days.`,
      ctaLabel: 'Accept invitation',
      ctaUrl: acceptUrl,
      footer: `If you weren't expecting this, you can ignore this email.`,
    }),
  });

  return NextResponse.json({ ok: true, sent: result.sent, error: result.sent ? undefined : result.error });
}
