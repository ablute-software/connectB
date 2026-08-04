// Prompt 123 Block C.2 — delete (soft: moderation_status='deleted', no row
// is ever dropped). Only reachable after 30 days suspended — enforced in
// applyModerationAction/canDelete, not just the UI's disabled button.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { applyModerationAction } from '@/lib/moderation-actions';
import type { ModerationTargetType } from '@/lib/account-moderation';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { targetType, targetId, justification } = await req.json().catch(() => ({})) as {
    targetType?: ModerationTargetType; targetId?: string; justification?: string;
  };
  if (targetType !== 'org' && targetType !== 'investor') return NextResponse.json({ ok: false, error: 'targetType must be org or investor.' }, { status: 400 });
  if (!targetId || !justification) return NextResponse.json({ ok: false, error: 'targetId and justification are required.' }, { status: 400 });

  const result = await applyModerationAction(admin, { targetType, targetId, action: 'delete', justification, actorId: userId });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
