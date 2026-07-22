// BLOCO 3 — "Hoje": the one screen a developer opens first. Pulls the
// subset of every queue that actually needs attention now, in priority
// order (GDPR deadline first — it's a hard legal SLA). Read-only rollup;
// actions happen on the underlying Fila tabs, this just points at them.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALL_DAYS = 7;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const stallCutoff = new Date(Date.now() - STALL_DAYS * DAY_MS).toISOString();
  const weekAgo = new Date(Date.now() - 7 * DAY_MS).toISOString();

  const [
    { data: gdprPending },
    { data: stalledContributions },
    { data: pendingSubmissions },
    { data: failedRuns },
    { data: pendingClaims },
  ] = await Promise.all([
    admin.from('gdpr_requests').select('id, claimant_email, kind, created_at').eq('status', 'pending').order('created_at', { ascending: true }),
    admin.from('contributions').select('id, subject_type, subject_id, field, org_id, created_at').eq('status', 'submitted').lte('created_at', stallCutoff),
    admin.from('investor_submissions').select('id, org_id, payload, created_at').eq('status', 'pending_review'),
    admin.from('automation_runs').select('id, org_id, automation_id, error, created_at').eq('status', 'failed').gte('created_at', weekAgo),
    admin.from('profile_claims').select('id, claimant_email, match_score, created_at').eq('status', 'pending'),
  ]);

  const gdprItems = (gdprPending ?? []).map((r) => {
    const deadline = new Date(r.created_at).getTime() + 30 * DAY_MS;
    const daysLeft = Math.ceil((deadline - Date.now()) / DAY_MS);
    return { type: 'gdpr' as const, id: r.id, label: `${r.kind} — ${r.claimant_email}`, daysLeft, urgent: daysLeft <= 7 };
  }).sort((a, b) => a.daysLeft - b.daysLeft);

  return NextResponse.json({
    ok: true,
    gdpr: gdprItems,
    stalledContributions: (stalledContributions ?? []).map((c) => ({ ...c, daysStalled: Math.floor((Date.now() - new Date(c.created_at).getTime()) / DAY_MS) })),
    pendingSubmissions: pendingSubmissions ?? [],
    failedAutomationRuns: failedRuns ?? [],
    pendingClaims: pendingClaims ?? [],
  });
}
