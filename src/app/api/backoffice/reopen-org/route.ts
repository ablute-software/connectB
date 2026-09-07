// Prompt 602 §C — "recuperável durante uma janela definida": a platform admin
// reopens an account the OWNER closed, inside the retention window, on the
// owner's request through support. Reverses what close_org() and the close
// route did — closure marks, the platform suspension it added (only if the
// org was not already platform-suspended before), the MatchDeal profile
// suspension it added. Access grants stay revoked: the founder re-grants.
// After the window, this route refuses — "irrecuperável pela app".
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { canReopen } from '@/lib/account-security';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  const { orgId, reason } = await req.json().catch(() => ({})) as { orgId?: string; reason?: string };
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!reason || reason.trim().length < 4) return NextResponse.json({ ok: false, error: 'A reason is required (who asked, through which channel).' }, { status: 400 });

  const { data: org } = await admin.from('orgs').select('id, name, closed_at, closed_reason, purge_after').eq('id', orgId).maybeSingle();
  if (!org) return NextResponse.json({ ok: false, error: 'No org with that id.' }, { status: 404 });
  const now = new Date();
  if (!canReopen({ closedAt: org.closed_at, closedReason: org.closed_reason, purgeAfter: org.purge_after }, now)) {
    return NextResponse.json({ ok: false, error: org.closed_at ? 'This closure cannot be reopened from the app (not owner-closed, or the retention window has ended).' : 'This account is not closed.' }, { status: 409 });
  }

  const { data: ev } = await admin.from('account_security_events').select('detail').eq('org_id', orgId).eq('kind', 'org_closed').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const wasPlatformSuspended = !!(ev?.detail as { wasPlatformSuspended?: boolean } | null)?.wasPlatformSuspended;

  const patch: Record<string, unknown> = { closed_at: null, closed_by: null, closed_reason: null, purge_after: null };
  if (!wasPlatformSuspended) patch.platform_suspended_at = null;
  const { error } = await admin.from('orgs').update(patch).eq('id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await admin.from('matchdeal_profiles').update({ platform_suspended_at: null })
    .eq('membership_id', orgId).eq('kind', 'startup').gte('platform_suspended_at', new Date(new Date(org.closed_at as string).getTime() - 60_000).toISOString());

  await admin.from('account_security_events').insert({ user_id: null, org_id: orgId, kind: 'org_reopened', actor_user_id: userId, detail: { reason: reason.trim(), wasPlatformSuspended } });
  await logAdminAction(admin, { adminUserId: userId, action: 'org_reopened', subjectType: 'org', subjectId: orgId, detail: { orgName: org.name, reason: reason.trim(), closedAt: org.closed_at, wasPlatformSuspended } });
  return NextResponse.json({ ok: true });
}
