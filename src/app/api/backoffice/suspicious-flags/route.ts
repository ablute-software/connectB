// Prompt 244/245 — Backoffice "Suspicious accounts" queue: list + create.
// A flag is entered MANUALLY by a developer who has already identified a
// case (this is not automatic pattern detection, confirmed explicitly by
// Nuno) — this route just records it.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { suspiciousFlagsAvailable } from '@/lib/suspicious-flags-capability';
import type { ModerationTargetType } from '@/lib/account-moderation';

export interface EvidenceRef { table: string; id: string; note?: string }

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  if (!(await suspiciousFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { data: rows, error } = await admin.from('suspicious_account_flags')
    .select('*').order('flagged_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const flaggedByIds = Array.from(new Set((rows ?? []).map((r) => r.flagged_by as string)));
  const emailById = new Map<string, string>();
  for (const id of flaggedByIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emailById.set(id, data.user.email);
  }

  return NextResponse.json({
    ok: true,
    flags: (rows ?? []).map((r) => ({
      id: r.id, targetType: r.target_type, targetId: r.target_id,
      companyName: r.company_name, email: r.email, accountCreatedAt: r.account_created_at,
      evidence: r.evidence, evidenceRefs: r.evidence_refs as EvidenceRef[],
      flaggedBy: emailById.get(r.flagged_by as string) ?? r.flagged_by,
      flaggedAt: r.flagged_at, status: r.status,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await suspiciousFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as {
    targetType?: ModerationTargetType; targetId?: string; companyName?: string; email?: string;
    accountCreatedAt?: string; evidence?: string; evidenceRefs?: EvidenceRef[];
  };
  const { targetType, targetId, companyName, email, accountCreatedAt, evidence, evidenceRefs } = body;
  if (targetType !== 'org' && targetType !== 'investor') return NextResponse.json({ ok: false, error: 'targetType must be org or investor.' }, { status: 400 });
  if (!targetId || !companyName?.trim() || !evidence?.trim()) {
    return NextResponse.json({ ok: false, error: 'targetId, companyName, and evidence are required.' }, { status: 400 });
  }

  const { data, error } = await admin.from('suspicious_account_flags').insert({
    target_type: targetType, target_id: targetId, company_name: companyName.trim(),
    email: email?.trim() || null, account_created_at: accountCreatedAt || null,
    evidence: evidence.trim(), evidence_refs: evidenceRefs ?? [],
    flagged_by: userId,
  }).select('id').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id });
}
