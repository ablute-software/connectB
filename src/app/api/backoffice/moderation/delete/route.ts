// Prompt 123 Block C.2 — delete (soft: moderation_status='deleted', no row
// is ever dropped). Only reachable after 30 days suspended — enforced in
// applyModerationAction/canDelete, not just the UI's disabled button.
//
// Prompt 891 — `force: true` = "Delete now": skips the remaining quarantine
// on an already-SUSPENDED account (never straight from active), through the
// same audited bypassQuarantine path Prompt 245 opened for the Suspicious
// Accounts queue (bypassed_quarantine column). Nuno, 28/09/2026: 30 days
// is too long for the demo/test/internal orgs the founders create and
// discard; the wait stays the default, this is the explicit exception.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { applyModerationAction } from '@/lib/moderation-actions';
import type { ModerationTargetType } from '@/lib/account-moderation';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { targetType, targetId, justification, force } = await req.json().catch(() => ({})) as {
    targetType?: ModerationTargetType; targetId?: string; justification?: string; force?: boolean;
  };
  if (targetType !== 'org' && targetType !== 'investor') return NextResponse.json({ ok: false, error: 'targetType must be org or investor.' }, { status: 400 });
  if (!targetId || !justification) return NextResponse.json({ ok: false, error: 'targetId and justification are required.' }, { status: 400 });

  const result = await applyModerationAction(admin, {
    targetType, targetId, action: 'delete', justification, actorId: userId,
    bypassQuarantine: force === true, requireSuspendedForBypass: force === true,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
