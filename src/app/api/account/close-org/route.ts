// Prompt 602 §C/§D — the owner CLOSES the account (the word is deliberate:
// access ends now, data is kept for the retention window; effective deletion
// is a separate GDPR request). Only an owner, re-authenticated with the
// current password, having typed the org's name.
//
// Reuses migration 0305's close_org(): closed_at, platform_suspended_at, the
// startup's MatchDeal profiles suspended, every access grant revoked — the
// org leaves the market and every investor view. On top: who closed it and
// why, the retention clock, every member's sessions ended, the Stripe
// subscription cancelled, an email to every member saying who closed it,
// and the audit line.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { computePurgeAfter, orgNameMatches } from '@/lib/account-security';
import {
  cancelStripeSubscription, notifyOrgClosed, orgMemberEmails, recordSecurityEvent, requestOrigin, serviceAdmin, terminateSessions, verifyCurrentPassword,
} from '@/lib/account-security-server';

export async function POST(req: Request) {
  const admin = serviceAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not available in this workspace.' }, { status: 200 });
  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { currentPassword, confirmName } = await req.json().catch(() => ({})) as { currentPassword?: string; confirmName?: string };
  if (!currentPassword || !confirmName) return NextResponse.json({ ok: false, error: 'Your password and the company name are required.' }, { status: 400 });

  const { data: self } = await admin.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!self) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (self.role !== 'owner') return NextResponse.json({ ok: false, error: 'Only the owner can close the account.' }, { status: 403 });

  const { data: org } = await admin.from('orgs').select('id, name, closed_at, platform_suspended_at, stripe_subscription_id').eq('id', self.org_id).maybeSingle();
  if (!org) return NextResponse.json({ ok: false, error: 'Org not found.' }, { status: 404 });
  if (org.closed_at) return NextResponse.json({ ok: false, error: 'This account is already closed.' }, { status: 409 });
  if (!orgNameMatches(confirmName, org.name as string)) return NextResponse.json({ ok: false, error: 'The name you typed does not match the company name.' }, { status: 400 });
  if (!(await verifyCurrentPassword(user.email, currentPassword))) return NextResponse.json({ ok: false, error: 'The password is incorrect.' }, { status: 401 });

  const now = new Date();
  const nowIso = now.toISOString();
  const purgeAfter = computePurgeAfter(nowIso);
  const wasPlatformSuspended = !!org.platform_suspended_at;

  const { error: closeErr } = await admin.rpc('close_org', { p_org_id: org.id });
  if (closeErr) return NextResponse.json({ ok: false, error: closeErr.message }, { status: 500 });
  const { error: markErr } = await admin.from('orgs').update({ closed_by: user.id, closed_reason: 'owner', purge_after: purgeAfter }).eq('id', org.id);
  if (markErr) return NextResponse.json({ ok: false, error: markErr.message }, { status: 500 });

  // §C — "a subscrição é cancelada": in Stripe.
  let stripe: { ok: boolean; error?: string } | null = null;
  if (org.stripe_subscription_id) stripe = await cancelStripeSubscription(org.stripe_subscription_id as string);

  // §C — "acesso termina para todos os membros": the middleware gate answers
  // 'closed' from the next request on; ending the sessions makes it
  // immediate for open tabs too, the owner's own included.
  const members = await orgMemberEmails(admin, org.id);
  let sessionsEnded = 0;
  for (const m of members) sessionsEnded += await terminateSessions(admin, m.userId, null);

  let emailsSent = 0;
  for (const m of members) {
    const r = await notifyOrgClosed({ to: m.email, orgId: org.id, orgName: org.name as string, ownerEmail: user.email, when: now, purgeAfter, isOwner: m.userId === user.id });
    if (r.sent) emailsSent++;
  }

  const { ip, userAgent } = requestOrigin(req);
  await recordSecurityEvent(admin, {
    userId: user.id, orgId: org.id, kind: 'org_closed', actorUserId: user.id, ip, userAgent,
    detail: { purgeAfter, wasPlatformSuspended, members: members.length, sessionsEnded, emailsSent, stripe },
  });
  await admin.from('admin_audit_log').insert({
    admin_user_id: null, action: 'org_closed_by_owner', subject_type: 'org', subject_id: org.id,
    detail: { orgName: org.name, ownerUserId: user.id, ownerEmail: user.email, purgeAfter, wasPlatformSuspended, members: members.length, sessionsEnded, emailsSent, stripe, ip, userAgent },
  });

  return NextResponse.json({ ok: true, purgeAfter, sessionsEnded, emailsSent, stripe });
}
