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
import { gdprDueAt } from '@/lib/gdpr';

const DAY_MS = 24 * 60 * 60 * 1000;

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
    admin.from('gdpr_requests').select('id, claimant_email, kind, created_at, extended_until').eq('status', 'pending').order('created_at', { ascending: true }),
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
    // Prompt 626 §D — the oldest request is no longer necessarily the most
    // urgent one: a request with a granted extension genuinely has longer, and
    // reporting it as the front of the queue would hide a newer one that does
    // not. What matters is the nearest DEADLINE, so that is what is picked.
    const withDue = gdprPending!.map((r) => ({ row: r, due: gdprDueAt(r.created_at, Date.now(), r.extended_until) }));
    withDue.sort((a, b) => a.due.daysLeft - b.due.daysLeft);
    const oldest = withDue[0].row;
    const due = withDue[0].due;
    rows.push({
      tag: 'GDPR', title: `${gdprPending!.length} GDPR request(s) pending`,
      context: `Nearest deadline: ${oldest.kind} — ${oldest.claimant_email}`,
      ageLabel: `nearest: ${due.label}`, href: '/backoffice/queue?tab=gdpr', buttonLabel: 'Review', urgent: due.overdue || due.daysLeft <= 7,
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
      // Prompt 573 — investor_claims (investor_entity_claims) moved to
      // Investor identity below: a claim targets an EXISTING catalog firm,
      // not a new one, so it was never really "new investors" work.
      tag: 'New investors', countValue: sum(count('candidates'), count('submissions')),
      oldestDays: queueRows.find((r) => r.key === 'candidates')?.oldestDays ?? null,
      context: 'Candidate firms with no existing catalog match', tab: 'new_investors',
    },
    {
      tag: 'Contributions', countValue: count('contributions'),
      oldestDays: queueRows.find((r) => r.key === 'contributions')?.oldestDays ?? null,
      context: 'Submitted field edits awaiting a decision', tab: 'contributions',
    },
    {
      // Prompt 573 — 'identity' now IS the real count (self-declared +
      // document + claim, non-internal); domain_mismatch is a filter on
      // this same queue, not a separate count folded in on top of it.
      tag: 'Investor identity', countValue: count('identity'),
      oldestDays: null, context: 'Self-declared firms, documents, or claims awaiting verification', tab: 'identity',
    },
    {
      tag: 'Person claims', countValue: count('claims'),
      oldestDays: null, context: 'LinkedIn self-claims awaiting a match decision', tab: 'claims',
    },
    {
      tag: 'Trust & safety', countValue: sum(count('suspicious'), count('fraud')),
      oldestDays: null, context: 'Flagged accounts or founder-reported fraud', tab: 'trust_safety',
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
