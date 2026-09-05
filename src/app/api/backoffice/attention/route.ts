// Prompt 576 Fase 2 — replaces /api/backoffice/today. Read-only rollup
// across every queue that has a decision waiting, GDPR's legal deadline
// first, then by age. No resolution happens here — every row's button
// deep-links into the Queue tab (or Support, or the System list) that
// actually carries the per-item decision UI; confirmed before writing this
// that GdprTab/SubmissionsTab/ClaimsTab already call the exact same
// /api/backoffice/{gdpr,submissions,claims}/[id]/{resolve,review} endpoints
// Today's own inline buttons did, so nothing is lost by removing them here.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { getQueueSummaryRows } from '@/lib/queue-summary';
import { getSystemSignals } from '@/lib/system-status';
import { needsAttention } from '@/lib/support-ticket-flags';

const DAY_MS = 24 * 60 * 60 * 1000;
const GDPR_DEADLINE_DAYS = 30;

export interface AttentionRow {
  tag: string; title: string; context: string; ageLabel: string;
  href: string; buttonLabel: string; urgent?: boolean;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [
    { data: gdprPending },
    { data: tickets },
    { data: failedRuns },
    queueRows,
    systemSignals,
  ] = await Promise.all([
    admin.from('gdpr_requests').select('id, claimant_email, kind, created_at').eq('status', 'pending').order('created_at', { ascending: true }),
    admin.from('support_tickets').select('id, created_at, status, first_response_at, last_activity_at, name, subject').eq('status', 'new').order('created_at', { ascending: true })
      .then(async (newOnes) => {
        const { data: open } = await admin.from('support_tickets').select('id, created_at, status, first_response_at, last_activity_at, name, subject').eq('status', 'open');
        return { data: [...(newOnes.data ?? []), ...(open ?? [])] };
      }),
    admin.from('automation_runs').select('id, error, created_at').eq('status', 'failed').gte('created_at', new Date(Date.now() - 7 * DAY_MS).toISOString()),
    getQueueSummaryRows(admin),
    getSystemSignals(admin),
  ]);

  const count = (key: string) => queueRows.find((r) => r.key === key)?.count ?? 0;
  const sum = (...vals: number[]) => vals.reduce((s, v) => s + v, 0);

  const rows: AttentionRow[] = [];

  // GDPR — always first when present, per its own hard legal deadline.
  // Not folded into the general sort below on purpose.
  if ((gdprPending ?? []).length > 0) {
    const oldest = gdprPending![0];
    const daysLeft = GDPR_DEADLINE_DAYS - daysSince(oldest.created_at);
    rows.push({
      tag: 'GDPR', title: `${gdprPending!.length} GDPR request(s) pending`,
      context: `Oldest: ${oldest.kind} — ${oldest.claimant_email}`,
      ageLabel: daysLeft < 0 ? `${-daysLeft}d overdue` : `oldest: ${daysLeft} days left of ${GDPR_DEADLINE_DAYS}`,
      href: '/backoffice/queue?tab=gdpr', buttonLabel: 'Review', urgent: daysLeft <= 7,
    });
  }

  const needy = (tickets ?? []).filter((t) => needsAttention(t, Date.now())).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (needy.length > 0) {
    const oldest = needy[0];
    rows.push({
      tag: 'Support', title: `${needy.length} ticket(s) need a look`,
      context: `${oldest.name} — ${oldest.subject}`,
      ageLabel: `oldest ${daysSince(oldest.created_at)}d`,
      href: '/backoffice/support', buttonLabel: 'Open',
    });
  }

  const reviewCategories: { tag: string; countValue: number; oldestDays: number | null; context: string; tab: string }[] = [
    {
      tag: 'New investors', countValue: sum(count('candidates'), count('submissions'), count('investor_claims')),
      oldestDays: queueRows.find((r) => r.key === 'candidates')?.oldestDays ?? null,
      context: 'Candidate firms with no existing catalog match', tab: 'candidates',
    },
    {
      tag: 'Contributions', countValue: count('contributions'),
      oldestDays: queueRows.find((r) => r.key === 'contributions')?.oldestDays ?? null,
      context: 'Submitted field edits awaiting a decision', tab: 'contributions',
    },
    {
      tag: 'Investor identity', countValue: sum(count('identity'), count('domain_mismatch')),
      oldestDays: null, context: 'Self-declared firms or domain mismatches awaiting verification', tab: 'identity',
    },
    {
      tag: 'Person claims', countValue: count('claims'),
      oldestDays: null, context: 'LinkedIn self-claims awaiting a match decision', tab: 'claims',
    },
    {
      tag: 'Trust & safety', countValue: sum(count('suspicious'), count('fraud')),
      oldestDays: null, context: 'Flagged accounts or founder-reported fraud', tab: 'suspicious',
    },
  ];
  for (const c of reviewCategories) {
    if (c.countValue === 0) continue;
    rows.push({
      tag: c.tag, title: `${c.countValue} ${c.tag.toLowerCase()} item(s) pending`, context: c.context,
      ageLabel: c.oldestDays !== null ? `oldest ${c.oldestDays}d` : '—',
      href: `/backoffice/queue?tab=${c.tab}`, buttonLabel: 'Review',
    });
  }

  if ((failedRuns ?? []).length > 0) {
    rows.push({
      tag: 'Automations', title: `${failedRuns!.length} failed automation run(s), last 7d`,
      context: failedRuns![0].error ?? 'Unknown error', ageLabel: `oldest ${daysSince(failedRuns![failedRuns!.length - 1].created_at)}d`,
      href: '/backoffice/queue', buttonLabel: 'Investigate',
    });
  }

  for (const s of systemSignals) {
    if (s.ok !== false) continue;
    rows.push({
      tag: 'System', title: `${s.name}: needs a look`, context: s.detail, ageLabel: 'just checked',
      href: '/backoffice/system', buttonLabel: 'Open',
    });
  }

  // GDPR stays pinned at index 0 whenever it's present, regardless of age —
  // its own hard legal deadline outranks the general sort. Everything else
  // sorts oldest-first; unknown-age rows (no oldestDays tracked, or a live
  // system check) land after every row that names a real age.
  const ageValue = (r: AttentionRow) => {
    const m = /(\d+)d/.exec(r.ageLabel);
    return m ? Number(m[1]) : -1;
  };
  const gdprRow = rows.find((r) => r.tag === 'GDPR') ?? null;
  const others = rows.filter((r) => r.tag !== 'GDPR').sort((a, b) => ageValue(b) - ageValue(a));
  const ordered = gdprRow ? [gdprRow, ...others] : others;

  const allClearTags = ['New investors', 'Contributions', 'Investor identity', 'Person claims', 'Trust & safety', 'GDPR', 'Support']
    .filter((tag) => !ordered.some((r) => r.tag === tag));

  return NextResponse.json({ ok: true, rows: ordered, allClear: allClearTags });
}
