// Prompt 706 Bloco C.2 — manual balance adjustment for support cases (e.g.
// "forgive" a month for a customer). Sets ai_credits_used_this_period
// directly; charge_ai_action's own lazy reset still applies on the org's
// next real call, so this never needs to touch ai_credits_reset_at itself.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { orgId, used } = await req.json().catch(() => ({})) as { orgId?: string; used?: number };
  if (!orgId) return NextResponse.json({ ok: false, error: 'Missing orgId.' }, { status: 400 });
  if (!Number.isInteger(used) || (used as number) < 0) {
    return NextResponse.json({ ok: false, error: 'used must be a non-negative whole number.' }, { status: 400 });
  }

  const { error } = await admin.from('orgs').update({ ai_credits_used_this_period: used }).eq('id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await logAdminAction(admin, { adminUserId: userId, action: 'ai_credits_manual_adjust', subjectType: 'orgs', subjectId: orgId, detail: { used } });
  return NextResponse.json({ ok: true });
}
