// Prompt 244/245 — a single flag's detail, plus every action recorded
// against it (suspicious_account_flag_actions), most recent first.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { suspiciousFlagsAvailable } from '@/lib/suspicious-flags-capability';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  if (!(await suspiciousFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { data: flag, error: flagErr } = await admin.from('suspicious_account_flags').select('*').eq('id', params.id).maybeSingle();
  if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });
  if (!flag) return NextResponse.json({ ok: false, error: 'Flag not found.' }, { status: 404 });

  const { data: actionRows, error: actionsErr } = await admin.from('suspicious_account_flag_actions')
    .select('*').eq('flag_id', params.id).order('created_at', { ascending: false });
  if (actionsErr) return NextResponse.json({ ok: false, error: actionsErr.message }, { status: 500 });

  const actorIds = Array.from(new Set([flag.flagged_by as string, ...(actionRows ?? []).map((r) => r.actor as string)]));
  const emailById = new Map<string, string>();
  for (const id of actorIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emailById.set(id, data.user.email);
  }

  return NextResponse.json({
    ok: true,
    flag: {
      id: flag.id, targetType: flag.target_type, targetId: flag.target_id,
      companyName: flag.company_name, email: flag.email, accountCreatedAt: flag.account_created_at,
      evidence: flag.evidence, evidenceRefs: flag.evidence_refs,
      flaggedBy: emailById.get(flag.flagged_by as string) ?? flag.flagged_by,
      flaggedAt: flag.flagged_at, status: flag.status,
    },
    actions: (actionRows ?? []).map((r) => ({
      id: r.id, actionType: r.action_type, suspendHours: r.suspend_hours, emailId: r.email_id,
      actor: emailById.get(r.actor as string) ?? r.actor, createdAt: r.created_at, notes: r.notes,
    })),
  });
}
