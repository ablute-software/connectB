// Prompt 277 A.3 — the one review decision a fraud flag ever gets:
// confirm or dismiss. Deliberately simpler than suspicious_account_flags'
// repeatable action history (alert/suspend/delete over time) — this queue
// is "was this report right or not", a single terminal outcome per flag,
// not an evolving account-lifecycle case.
//
// confirmed: flag -> actioned/confirmed. The founder's entity stays
// hard_filter_status='resolved_blocked' (already set when the report was
// filed) — nothing to change there. When the entity is catalog-linked
// (catalog_id set) and the admin opts in (suspendCatalogEntity), ALSO
// calls applyModerationAction() — the SAME state machine every other
// suspend/delete in this codebase uses, never a second, parallel one —
// so every other founder stops seeing this investor too, not just the
// one who reported it.
//
// dismissed: flag -> actioned/dismissed. The founder's entity is released
// back to 'open' (hard_filter_status + audit columns cleared), same as
// Unblock — the report wasn't confirmed, so the founder isn't left
// permanently stuck on a state platform review rejected.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { entityFraudFlagsAvailable } from '@/lib/entity-fraud-flags-capability';
import { applyModerationAction } from '@/lib/moderation-actions';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await entityFraudFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as { outcome?: 'confirmed' | 'dismissed'; notes?: string; suspendCatalogEntity?: boolean };
  if (body.outcome !== 'confirmed' && body.outcome !== 'dismissed') {
    return NextResponse.json({ ok: false, error: "outcome must be 'confirmed' or 'dismissed'." }, { status: 400 });
  }

  const { data: flag, error: flagErr } = await admin.from('entity_fraud_flags').select('*').eq('id', params.id).maybeSingle();
  if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });
  if (!flag) return NextResponse.json({ ok: false, error: 'Flag not found.' }, { status: 404 });
  if (flag.status === 'actioned') return NextResponse.json({ ok: false, error: 'Already reviewed.' }, { status: 409 });

  const now = new Date().toISOString();
  const { error: updateFlagErr } = await admin.from('entity_fraud_flags').update({
    status: 'actioned', outcome: body.outcome, reviewed_by: userId, reviewed_at: now,
    reviewer_notes: body.notes?.trim() || null,
  }).eq('id', params.id);
  if (updateFlagErr) return NextResponse.json({ ok: false, error: updateFlagErr.message }, { status: 500 });

  if (body.outcome === 'dismissed') {
    const { error: revertErr } = await admin.from('entities').update({
      hard_filter_status: 'open', hard_filter_resolved_at: null, hard_filter_resolved_by: null,
    }).eq('id', flag.entity_id);
    if (revertErr) return NextResponse.json({ ok: false, error: revertErr.message }, { status: 500 });
  } else if (body.outcome === 'confirmed' && body.suspendCatalogEntity && flag.catalog_id) {
    const result = await applyModerationAction(admin, {
      targetType: 'investor', targetId: flag.catalog_id as string, action: 'suspend',
      justification: body.notes?.trim() || `Confirmed fraud/scam report (flag ${flag.id}).`, actorId: userId,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  await logAdminAction(admin, {
    adminUserId: userId, action: 'entity_fraud_flag_resolved', subjectType: 'entity_fraud_flag',
    subjectId: params.id, detail: { outcome: body.outcome, entityId: flag.entity_id, catalogId: flag.catalog_id },
  });

  return NextResponse.json({ ok: true });
}
