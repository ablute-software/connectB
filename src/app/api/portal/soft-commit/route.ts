// Investor Workspace Fase 3 (prompt 56), Bloco 3 — soft commit: a concrete
// amount, explicitly non-binding (enforced in the UI copy, not here).
// Founder is notified immediately by email; the amount only feeds the
// round progress bar once the founder confirms it (see /api/org/soft-commits
// PATCH and buildSnapshot's securedShown in /api/portal/access).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { org_id?: string; amount_eur?: number };
  const { org_id, amount_eur } = body;
  if (!org_id || !amount_eur || amount_eur <= 0) return NextResponse.json({ ok: false, error: 'org_id and a positive amount_eur are required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, org_id);
  if (closedBlock) return closedBlock;
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: grants } = await admin.from('access_grants').select('confirmed_at, invited_email, revoked_at, expires_at')
    .eq('org_id', org_id).is('revoked_at', null).or(orParts.join(','));
  const now = new Date();
  const hasAccess = (grants ?? []).some((g) => (!g.expires_at || new Date(g.expires_at as string) > now) && (!g.invited_email || g.confirmed_at));
  if (!hasAccess) return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });

  const { error } = await admin.from('investor_soft_commits').insert({ org_id, investor_email: email, amount_eur });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  if (resendConfigured) {
    const { data: org } = await admin.from('orgs').select('name, sender_email').eq('id', org_id).single();
    const to = (org?.sender_email as string | null) ?? null;
    if (to) {
      await sendTransactionalEmail({
        to, subject: `Soft commit: €${amount_eur.toLocaleString('en-US')} from ${email}`,
        html: transactionalTemplate({
          heading: 'A new soft commit', body: `${email} indicated a non-binding interest of €${amount_eur.toLocaleString('en-US')}.`,
          ctaLabel: 'Review in your workspace', ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/company`,
        }),
        context: { kind: 'other' },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
