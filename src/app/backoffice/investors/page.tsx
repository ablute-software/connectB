'use client';
// Prompt B — "Investors": the internal source of truth about the investor
// base. The public landing quotes rounded-down bands (500+ profiles, 25+
// countries); this page quotes the real numbers, because deciding what to
// build next on a rounded number is how you end up believing your own
// marketing. Read-only — the CRUD lives in Catálogo, linked at the bottom.
import { Suspense, useEffect, useMemo, useState } from 'react';
import { sortRows, sortIndicator } from '@/lib/table-sort';
import Link from 'next/link';
import { Card, Tabs } from '@/components/ui';
import type { DomainMatchVerdict } from '@/lib/investor-domain-match';
import { ModerationControls } from '@/components/backoffice/ModerationControls';
import { ModerationHistoryCard } from '@/components/backoffice/ModerationHistoryCard';
import { AccountStatusFilter } from '@/components/backoffice/AccountStatusFilter';
import type { ModerationStatus } from '@/lib/account-moderation';
import { INVESTOR_PLANS } from '@/lib/plans';
import { matchesAccountFilter, type AccountFilter } from '@/lib/account-filter';
import { useTableUrlState } from '@/lib/use-table-url-state';
import { PAGE_SIZES, pageCount, rangeLabel, toggleSort as urlToggleSort } from '@/lib/queue-table-state';

// Item 11 — matchdeal_profiles.plan_tier/plan_tier_requested store MatchDeal's
// own tier keys, not InvestorPlanTier ('pro_scout' etc) — same small local
// map InvestorPlansPanel.tsx already carries under its own MATCHDEAL_TO_TIER
// name (deliberately not centralized into lib/plans.ts, see that file's own
// comment above INVESTOR_PLANS). Names are read from INVESTOR_PLANS itself
// so the price/seat spec stays the single source of truth for naming.
const MATCHDEAL_TIERS = ['tier_a', 'tier_b', 'tier_c'] as const;
const MATCHDEAL_TO_INVESTOR_TIER: Record<string, 'pro_scout' | 'ace_spotter' | 'legendary_sleuth'> = {
  tier_a: 'pro_scout', tier_b: 'ace_spotter', tier_c: 'legendary_sleuth',
};
function tierName(matchdealTier: string | null): string {
  if (!matchdealTier) return '—';
  const t = MATCHDEAL_TO_INVESTOR_TIER[matchdealTier];
  return t ? (INVESTOR_PLANS.find((p) => p.tier === t)?.name ?? matchdealTier) : matchdealTier;
}

type Totals = {
  total: number; verified: number; imported: number; demo: number; backfilled: number;
  withPerson: number; withEmail: number; personPct: number; countries: number;
};
type AccessRequest = {
  id: string; created_at: string; email: string; firm_name: string | null; note: string | null;
  status: 'pending' | 'approved' | 'rejected'; contacted_at: string | null; reviewed_at: string | null;
  notified_at: string | null; notify_failed: boolean;
  domainMatch: DomainMatchVerdict;
};

// Anexo B claim-decision matrix, surfaced plainly to the reviewing admin —
// see src/lib/investor-domain-match.ts for the underlying rule.
function DomainMatchBadge({ v }: { v: DomainMatchVerdict }) {
  if (v.kind === 'match') {
    return (
      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
        ✅ Email domain matches {v.entityDomain} — auto-eligible for V1
      </span>
    );
  }
  const reason =
    v.kind === 'mismatch' ? `Email domain (${v.emailDomain}) does NOT match claimed entity's domain (${v.entityDomain})`
    : v.kind === 'generic_email' ? `Generic email provider (${v.emailDomain}) — never auto-eligible`
    : v.kind === 'no_entity_website' ? `"${v.entityName}" has no website on file — nothing to verify against`
    : v.firmName ? `"${v.firmName}" doesn't match any catalog entity` : 'No firm name given to verify against';
  return (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      ⚠️ {reason} — manual verification required
    </span>
  );
}

// Approving a request grants investor access — it can only be undone by
// manually revoking the resulting access_grants row, so this asks for one
// explicit click of confirmation rather than acting on the first click.
function AccessRequestsQueue() {
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function refresh() {
    fetch('/api/backoffice/investor-access-requests').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRequests(body.requests);
    });
  }
  useEffect(refresh, []);

  async function approve(id: string) {
    setBusyId(id); setConfirmingId(null);
    const res = await fetch(`/api/backoffice/investor-access-requests/${id}/approve`, { method: 'POST' });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setErr(body.error); return; }
    refresh();
  }
  async function reject(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/backoffice/investor-access-requests/${id}/reject`, { method: 'POST' });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setErr(body.error); return; }
    refresh();
  }
  async function resendNotification(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/backoffice/investor-access-requests/${id}/resend-notification`, { method: 'POST' });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setErr(body.error); return; }
    refresh();
  }

  if (err) return <Card title="Investor access requests"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!requests) return <Card title="Investor access requests"><p className="text-sm text-gray-400">Loading…</p></Card>;

  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  return (
    <Card title={`Investor access requests (${pending.length} pending)`}>
      <p className="mb-3 text-xs text-gray-500">
        Leads from the public &quot;request access&quot; form. Approving grants the email an
        access_grants row against ablute_&apos;s Data Room — the mechanism resolveRole() checks
        for the investor role, so the requester can then sign in as an investor.
      </p>
      {pending.length === 0 ? <p className="text-sm text-gray-400">No pending requests.</p> : (
        <ul className="mb-4 space-y-2">
          {pending.map((r) => (
            <li key={r.id} className={`rounded-xl border p-3 text-sm ${
              r.domainMatch.kind === 'match' ? 'border-green-200 bg-green-50/40' : 'border-amber-200 bg-amber-50/50'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.email}</span>
                {r.firm_name && <span className="text-gray-500">· {r.firm_name}</span>}
                <span className="text-xs text-gray-400">{r.created_at.slice(0, 10)}</span>
                <div className="ml-auto flex gap-2">
                  {confirmingId === r.id ? (
                    <>
                      <span className="text-xs text-amber-800">Grant investor access?</span>
                      <button disabled={busyId === r.id} onClick={() => approve(r.id)}
                        className="rounded-lg bg-green-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-40">
                        Confirm
                      </button>
                      <button onClick={() => setConfirmingId(null)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button disabled={busyId === r.id} onClick={() => setConfirmingId(r.id)}
                        className="rounded-lg bg-green-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-40">
                        Approve
                      </button>
                      <button disabled={busyId === r.id} onClick={() => reject(r.id)}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-1.5"><DomainMatchBadge v={r.domainMatch} /></div>
              {r.note && <p className="mt-1 text-xs text-gray-600">{r.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {resolved.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-400">{resolved.length} resolved</summary>
          <ul className="mt-2 space-y-1">
            {resolved.map((r) => (
              <li key={r.id} className="rounded-lg py-1 text-xs text-gray-500">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
                  <span>{r.email}</span>
                  {r.reviewed_at && <span className="text-gray-400">{r.reviewed_at.slice(0, 10)}</span>}
                </div>
                {/* Item 10 — a failed notification must be a visible, recoverable
                    state, not a second silent dead end after the pending request
                    itself used to be one. */}
                {r.notify_failed && (
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1">
                    <span className="text-amber-800">⚠️ Notification failed to send</span>
                    <button disabled={busyId === r.id} onClick={() => resendNotification(r.id)}
                      className="ml-auto rounded-md bg-amber-700 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-800 disabled:opacity-40">
                      Resend
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

// AP-15 — every Pipeline Interested/Pass decision, across all orgs, with
// the revocation/notification audit trail so support can answer "did the
// data room actually get revoked" without a raw SQL query.
type PipelineDecision = {
  id: string; orgName: string; investorName: string; decision: 'interested' | 'passed';
  reasonDetail: string | null; decidedAt: string; accessRevokedCount: number;
  notifiedAt: string | null; notifyFailed: boolean;
};

function PipelineDecisionsPanel() {
  const [decisions, setDecisions] = useState<PipelineDecision[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/pipeline-decisions').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setDecisions(body.decisions);
    }).catch(() => setErr('Failed to load.'));
  }, []);

  return (
    <Card title="Pipeline decisions">
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!decisions ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : decisions.length === 0 ? (
        <p className="text-sm text-gray-400">No Interested/Pass decisions recorded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {decisions.map((d) => (
            <div key={d.id} className="rounded-lg border border-gray-100 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-800">{d.investorName} → {d.orgName}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${d.decision === 'passed' ? 'bg-gray-100 text-gray-500' : 'bg-[#E8F4F8] text-[#0E7490]'}`}>
                  {d.decision === 'passed' ? 'Passed' : 'Interested'}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-gray-400">
                {new Date(d.decidedAt).toLocaleString()}
                {d.decision === 'passed' && ` · ${d.accessRevokedCount} grant(s) revoked`}
                {' · '}{d.notifyFailed ? 'notification failed' : d.notifiedAt ? 'founder notified' : 'not yet notified'}
              </div>
              {d.reasonDetail && <p className="mt-1 text-gray-600">{d.reasonDetail}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Prompt 123 Block C.3 — real REGISTERED investor accounts (firms with at
// least one matchdeal_investor_members seat), distinct from the catalog
// stats below (which count every imported/enriched entity, most never
// touched by a real signed-up user — see P124's own 358-vs-~8 flag). A
// column showing "—" with a tooltip means the underlying event doesn't
// exist yet — not a zero, an honest "not tracked" (per the doc's own
// instruction for "Files viewed").
// Prompt 569 §7 — the sortable columns, by the field they order on.
type InvestorSortKey =
  | 'name' | 'planTier' | 'registrationDate' | 'seats' | 'verificationStatus' | 'complete'
  | 'logsLast7Days' | 'lastLogin' | 'status' | 'accessRequestedLastMonth'
  | 'accessGrantedLastMonth' | 'filesViewedLastMonth' | 'visiblePipelineSize'
  | 'startupsInteractedWith' | 'startupComparisonsLastMonth' | 'aiAssistanceLastMonth';

// Prompt 576 Fase 3 — the URL-state hook needs the valid key list to guard
// against a hand-edited ?sort= naming a column that doesn't exist.
const INVESTOR_SORT_KEYS: InvestorSortKey[] = [
  'name', 'planTier', 'registrationDate', 'seats', 'verificationStatus', 'complete',
  'logsLast7Days', 'lastLogin', 'status', 'accessRequestedLastMonth',
  'accessGrantedLastMonth', 'filesViewedLastMonth', 'visiblePipelineSize',
  'startupsInteractedWith', 'startupComparisonsLastMonth', 'aiAssistanceLastMonth',
];

interface InvestorAccountRow {
  entityId: string; name: string; planTier: string | null;
  planTierRequested: string | null; planTierRequestedAt: string | null;
  registrationDate: string | null; seats: number;
  // Prompt 497 — what the tier includes, and whether this firm is above it.
  seatLimit: number; seatsOverLimit: boolean;
  complete: boolean;
  // Prompt 183 §A — verified/pending/rejected, now shown directly since
  // Accounts no longer hides non-verified rows that have real seats.
  verificationStatus: 'verified' | 'pending' | 'rejected';
  lastLogin: string | null; status: 'active' | 'quiet' | 'inactive';
  accessGrantedLastMonth: number; filesViewedLastMonth: number; startupsInteractedWith: number;
  moderationStatus: ModerationStatus; moderationQuarantineUntil: string | null;
  logsLast7Days: number | null; accessRequestedLastMonth: number | null; visiblePipelineSize: number | null;
  startupComparisonsLastMonth: number | null; aiAssistanceLastMonth: number | null;
  // Prompt 576 Fase 3 — is_internal (migration 0316), OR-across-members via
  // investorOrgRows() (backoffice-metrics.ts) — same convention planTier
  // already uses for "which per-seat value represents the firm".
  isInternal: boolean;
}

const INVESTOR_STATUS_STYLE: Record<InvestorAccountRow['status'], string> = {
  active: 'bg-green-50 text-green-700', quiet: 'bg-amber-50 text-amber-700', inactive: 'bg-gray-100 text-gray-500',
};

// Prompt 183 §A — same verified/pending/rejected palette the catalog table
// already uses (backoffice/catalog/page.tsx), for consistency.
const VERIFICATION_STYLE: Record<InvestorAccountRow['verificationStatus'], string> = {
  verified: 'bg-green-50 text-green-700', pending: 'bg-amber-50 text-amber-700', rejected: 'bg-red-50 text-red-700',
};

function NotTracked({ tooltip }: { tooltip: string }) {
  return <span className="text-gray-300" title={tooltip}>—</span>;
}

function InvestorAccountsTable() {
  const [accounts, setAccounts] = useState<InvestorAccountRow[] | null>(null);
  const [moderationAvailable, setModerationAvailable] = useState(false);
  const [err, setErr] = useState('');
  const [savingEntityId, setSavingEntityId] = useState<string | null>(null);
  // Prompt 576 Fase 3 — page/sort/dir/search/status filter in the URL, same
  // shape the Queue uses (queue-table-state.ts). sort absent still means
  // the pending-first default below — that special case is untouched.
  const [tableState, setTableState] = useTableUrlState({ sortableKeys: INVESTOR_SORT_KEYS });
  const q = tableState.filters.q ?? '';
  const statusFilter = (tableState.filters.status as AccountFilter | undefined) ?? 'all';
  const sortKey = tableState.sort as InvestorSortKey | null;
  const sortDir = tableState.dir;

  function load() {
    fetch('/api/backoffice/investor-accounts').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error); return; }
      setAccounts(body.accounts);
      setModerationAvailable(!!body.moderationAvailable);
    }).catch(() => setErr('Failed to load.'));
  }
  useEffect(load, []);

  // Item 11 step 3 — mirrors set-plan exactly: apply the requested tier
  // (accept), or re-apply the current tier (reject) — either way
  // plan_tier_requested/plan_tier_requested_at clear on the server.
  async function setInvestorPlan(entityId: string, tier: string) {
    setSavingEntityId(entityId);
    try {
      const res = await fetch('/api/backoffice/set-investor-plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId, tier }),
      });
      const body = await res.json();
      if (!body.ok) { alert(`Set plan failed: ${body.error}`); return; }
      load();
    } finally {
      setSavingEntityId(null);
    }
  }

  // Item 11 step 2 — "ordenando os pendentes primeiro", same as the
  // startups table's own pending-first Card above its full table (search
  // filter composes with this, not replaces it).
  // Prompt 569 §7 — seventeen columns and no way to order by any of them.
  //
  // sortKey starts null, and null means the pending-first order this table has
  // always opened on (item 11 step 2). Clicking a header takes over; there is
  // no way back to pending-first short of a reload, which is honest — a
  // sorted table that silently re-sorts itself is worse than one that stays
  // where you put it. The comparator and the toggle rule are shared with the
  // Startups table (table-sort.ts) rather than written a second time.
  const filteredSorted = useMemo(() => {
    let filtered = (accounts ?? []).filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));
    filtered = filtered.filter((a) => matchesAccountFilter(statusFilter, { moderationStatus: a.moderationStatus, isInternal: a.isInternal }));
    if (!sortKey) {
      return [...filtered].sort((a, b) => (b.planTierRequested ? 1 : 0) - (a.planTierRequested ? 1 : 0));
    }
    return sortRows(filtered, sortKey, sortDir, (row, key) => {
      // Two columns are not plain fields: "% Complete" is a boolean shown as a
      // tick, and "Seats" reads as "linked / plan" but orders by what is used.
      if (key === 'complete') return row.complete;
      if (key === 'seats') return row.seats;
      return (row as unknown as Record<string, unknown>)[key];
    });
  }, [accounts, q, statusFilter, sortKey, sortDir]);

  const total = filteredSorted.length;
  const totalPages = pageCount(total, tableState.pageSize);
  const page = Math.min(tableState.page, totalPages);
  const rows = useMemo(
    () => filteredSorted.slice((page - 1) * tableState.pageSize, page * tableState.pageSize),
    [filteredSorted, page, tableState.pageSize],
  );

  function toggleSort(key: InvestorSortKey) {
    const { dir } = urlToggleSort(tableState, key);
    setTableState({ sort: key, dir });
  }
  const pending = (accounts ?? []).filter((a) => a.planTierRequested);

  if (err) return <Card title="Investor accounts"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!accounts) return <Card title="Investor accounts"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <Card title={`Pending plan-change requests (${pending.length})`}>
          <ul className="divide-y divide-gray-100 text-sm">
            {pending.map((a) => (
              <li key={a.entityId} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-gray-500">
                  {tierName(a.planTier ?? 'tier_a')} → <b>{tierName(a.planTierRequested)}</b>
                  {a.planTierRequestedAt && ` · requested ${a.planTierRequestedAt.slice(0, 10)}`}
                </span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setInvestorPlan(a.entityId, a.planTierRequested!)} disabled={savingEntityId === a.entityId}
                    className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                    {savingEntityId === a.entityId ? 'Applying…' : 'Apply request'}
                  </button>
                  <button onClick={() => setInvestorPlan(a.entityId, a.planTier ?? 'tier_a')} disabled={savingEntityId === a.entityId}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={`Investor accounts (${rangeLabel({ ...tableState, page }, total)})`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setTableState({ filters: { ...tableState.filters, q: e.target.value } })} placeholder="Search by firm name…"
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <AccountStatusFilter value={statusFilter}
          onChange={(next) => setTableState({ filters: { ...tableState.filters, status: next === 'all' ? '' : next } })} />
        <p className="ml-auto text-xs text-gray-500">Real registered firms only — catalog stats below cover every imported entity.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              {([
                ['name', 'Org'], ['planTier', 'Plan'], ['registrationDate', 'Registered'],
                ['seats', 'Seats (linked / plan)'], ['verificationStatus', 'Verification'],
                ['complete', '% Complete'], ['logsLast7Days', 'Logs/7d'], ['lastLogin', 'Last login'],
                ['status', 'Status'],
              ] as [InvestorSortKey, string][]).map(([key, label]) => (
                <th key={key} className="cursor-pointer whitespace-nowrap py-1.5 pr-3 hover:text-gray-700"
                  onClick={() => toggleSort(key)}>
                  {label} {sortIndicator(sortKey === key, sortDir)}
                </th>
              ))}
              {/* Not sortable: it holds controls, not a value. */}
              <th className="pr-3">Delete/Suspend</th>
              {([
                ['accessRequestedLastMonth', 'Access req./mo'], ['accessGrantedLastMonth', 'Access granted/mo'],
                ['filesViewedLastMonth', 'Files viewed/mo'], ['visiblePipelineSize', 'Pipeline'],
                ['startupsInteractedWith', 'Startups'], ['startupComparisonsLastMonth', 'Comparisons/mo'],
                ['aiAssistanceLastMonth', 'AI assist/mo'],
              ] as [InvestorSortKey, string][]).map(([key, label]) => (
                <th key={key} className="cursor-pointer whitespace-nowrap pr-3 hover:text-gray-700"
                  onClick={() => toggleSort(key)}>
                  {label} {sortIndicator(sortKey === key, sortDir)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.entityId} className="border-t border-gray-50 align-top">
                <td className="py-2 pr-3 font-medium">
                  {a.name}
                  {a.isInternal && (
                    <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500"
                      title="Internal team account — what it produces doesn't need back-office review.">
                      Internal
                    </span>
                  )}
                </td>
                <td className="pr-3">
                  <div className="flex items-center gap-1.5">
                    <select value={a.planTier ?? 'tier_a'} disabled={savingEntityId === a.entityId}
                      onChange={(e) => setInvestorPlan(a.entityId, e.target.value)}
                      className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                      {MATCHDEAL_TIERS.map((t) => <option key={t} value={t}>{tierName(t)}</option>)}
                    </select>
                    {a.planTierRequested && (
                      <span title={`Requested ${tierName(a.planTierRequested)}`}
                        className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">req</span>
                    )}
                  </div>
                </td>
                <td className="pr-3 text-xs text-gray-400 whitespace-nowrap">{a.registrationDate ? a.registrationDate.slice(0, 10) : '—'}</td>
                {/* Prompt 497 — over-limit is flagged here, never acted on:
                    existing seats stay, only adding a new one is blocked. */}
                <td className="pr-3 text-gray-600">
                  <span className={a.seatsOverLimit ? 'font-semibold text-[#B00000]' : ''}>{a.seats}</span>
                  <span className="text-gray-400"> / {a.seatLimit}</span>
                  {a.seatsOverLimit && (
                    <span className="ml-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#B00000]"
                      title="More seats linked than this tier includes. Existing seats are left alone — only adding another is blocked.">
                      over
                    </span>
                  )}
                </td>
                <td className="pr-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${VERIFICATION_STYLE[a.verificationStatus]}`}>
                    {a.verificationStatus}
                  </span>
                </td>
                <td className="pr-3 text-gray-600">{a.complete ? 'Complete' : 'Incomplete'}</td>
                <td className="pr-3">
                  {a.logsLast7Days == null ? <NotTracked tooltip="Tracking starts once an investor activity-log event exists" /> : a.logsLast7Days}
                </td>
                <td className="pr-3 text-xs text-gray-400 whitespace-nowrap">{a.lastLogin ? a.lastLogin.slice(0, 10) : 'never'}</td>
                <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${INVESTOR_STATUS_STYLE[a.status]}`}>{a.status}</span></td>
                <td className="pr-3">
                  {moderationAvailable ? (
                    <ModerationControls targetType="investor" targetId={a.entityId} name={a.name} status={a.moderationStatus} quarantineUntil={a.moderationQuarantineUntil} onChanged={load} />
                  ) : <span className="text-xs text-gray-300">—</span>}
                </td>
                <td className="pr-3">
                  {a.accessRequestedLastMonth == null ? <NotTracked tooltip="Tracking starts once access-request initiation is logged" /> : a.accessRequestedLastMonth}
                </td>
                <td className="pr-3 text-gray-600">{a.accessGrantedLastMonth}</td>
                <td className="pr-3 text-gray-600">{a.filesViewedLastMonth}</td>
                <td className="pr-3">
                  {a.visiblePipelineSize == null ? <NotTracked tooltip="Needs its own formula — pipeline-unlock.ts is startup-side only" /> : a.visiblePipelineSize}
                </td>
                <td className="pr-3 text-gray-600">{a.startupsInteractedWith}</td>
                <td className="pr-3">
                  {a.startupComparisonsLastMonth == null ? <NotTracked tooltip="Tracking starts once a comparison-feature event exists" /> : a.startupComparisonsLastMonth}
                </td>
                <td>
                  {a.aiAssistanceLastMonth == null ? <NotTracked tooltip="Tracking starts once investor-side AI usage is logged" /> : a.aiAssistanceLastMonth}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Prompt 576 Fase 3 — same client-side page slicing as Startups; see
          that page's own comment for the ~200-row threshold to revisit. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <button disabled={page <= 1} onClick={() => setTableState({ page: page - 1 })}
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-30">← Prev</button>
        <span>Page {page} of {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setTableState({ page: page + 1 })}
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-30">Next →</button>
        <select value={tableState.pageSize} onChange={(e) => setTableState({ pageSize: Number(e.target.value) as typeof PAGE_SIZES[number] })}
          className="ml-1 rounded border border-gray-300 px-1.5 py-1">
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>
      {!moderationAvailable && <p className="mt-3 text-[11px] text-gray-400">Suspend/Delete activates once migration 0121 is applied.</p>}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-[#0E7490]">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}

function CatalogStatsTab() {
  const [data, setData] = useState<{ ok: boolean; error?: string; totals: Totals } | null>(null);

  useEffect(() => {
    fetch('/api/backoffice/investors').then((r) => r.json()).then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!data.ok) return <p className="text-sm text-[#B00000]">{data.error}</p>;

  const { totals } = data;
  const packable = totals.total - totals.demo;

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Real numbers for the global catalog. The public landing page shows rounded-down bands
        ({Math.floor(packable / 100) * 100}+ profiles, {Math.floor(totals.countries / 5) * 5}+ countries) — this is the ground truth.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total in catalog" value={totals.total} hint={`${totals.demo} demo entities excluded`} />
        <Stat label="Verified" value={totals.verified} hint="confirmed contact" />
        <Stat label="Imported" value={totals.imported} hint="pending enrichment" />
        <Stat label="Countries" value={totals.countries} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="With named contact" value={`${totals.personPct}%`} hint={`${totals.withPerson} of ${packable}`} />
        <Stat label="With direct email" value={totals.withEmail} />
        <Stat label="From backfill" value={totals.backfilled} hint="with provenance" />
      </div>

      <PipelineDecisionsPanel />

      <p className="text-sm text-gray-500">
        To edit, verify, or merge entities:{' '}
        <Link href="/backoffice/catalog" className="font-medium text-[#0E7490] underline">Catalog →</Link>
      </p>
    </div>
  );
}

// "Claim this profile" (2026-08-07) — evidence for domain_match/dispute/
// role-mailbox/freemail is a SNAPSHOT taken at claim time (migration
// 0145's own comment), read straight off the row — never recomputed here,
// so what the admin sees is exactly what the claimant's decision was based
// on, even if the entity's website changes later.
interface ClaimEvidence {
  claimantDomain: string | null; entityDomain: string | null;
  entityDomainIsFreemail: boolean; roleMailbox: boolean;
  isDispute: boolean; disputedOwnerEmails: string[]; requestedRole: string | null;
}
interface EntityClaimRow {
  id: string; catalog_entity_id: string; claimant_email: string;
  claimant_email_domain: string | null; entity_domain_at_claim: string | null;
  domain_match: boolean; status: 'pending' | 'approved' | 'rejected';
  requested_role: string | null; evidence: ClaimEvidence | null;
  resolved_at: string | null; notified_at: string | null; notify_failed: boolean; created_at: string;
  entity: { id: string; name: string; website: string | null; verification_status: string } | null;
}

function ClaimsQueue() {
  const [claims, setClaims] = useState<EntityClaimRow[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [err, setErr] = useState('');
  // Prompt 497 — a per-claim action failure is recoverable (the seat-limit
  // 409 is the first one this route can return: raise the firm's plan in
  // Accounts, or free a seat, then approve again). Kept separate from `err`
  // above, which is a load failure and correctly replaces the whole card —
  // blanking the queue because one approval was refused would hide the
  // other pending claims and the plan the admin needs to go change.
  const [actionErr, setActionErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    fetch('/api/backoffice/investor-entity-claims').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setClaims(body.claims);
      setAvailable(body.available !== false);
    }).catch(() => setErr('Failed to load.'));
  }
  useEffect(refresh, []);

  async function act(id: string, action: 'approve' | 'reject') {
    setBusyId(id); setActionErr('');
    try {
      const res = await fetch(`/api/backoffice/investor-entity-claims/${id}/${action}`, { method: 'POST' });
      const body = await res.json();
      if (!body.ok) { setActionErr(body.error ?? 'Action failed.'); return; }
      refresh();
    } finally { setBusyId(null); }
  }

  if (err) return <Card title="Profile claims"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!claims) return <Card title="Profile claims"><p className="text-sm text-gray-400">Loading…</p></Card>;
  if (!available) return <Card title="Profile claims"><p className="text-[11px] text-gray-400">Profile claims activates once migration 0145 is applied.</p></Card>;

  const pending = claims.filter((c) => c.status === 'pending');
  const resolved = claims.filter((c) => c.status !== 'pending');

  return (
    <Card title={`Profile claims (${pending.length} pending)`}>
      <p className="mb-3 text-xs text-gray-500">
        Domain match is evidence, never an auto-decision — every claim needs an explicit approve or reject here,
        even when the domain matches exactly.
      </p>
      {actionErr && (
        <p className="mb-3 rounded-lg border border-[#B00000]/30 bg-red-50 px-3 py-2 text-xs text-[#B00000]">{actionErr}</p>
      )}
      {pending.length === 0 ? <p className="text-sm text-gray-400">No pending claims.</p> : (
        <ul className="mb-4 space-y-2">
          {pending.map((c) => (
            <li key={c.id} className={`rounded-xl border p-3 text-sm ${c.domain_match ? 'border-green-200 bg-green-50/40' : 'border-amber-200 bg-amber-50/50'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.entity?.name ?? 'Unknown profile'}</span>
                <span className="text-gray-500">· {c.claimant_email}</span>
                <span className="text-xs text-gray-400">{c.created_at.slice(0, 10)}</span>
                <div className="ml-auto flex gap-2">
                  <button disabled={busyId === c.id} onClick={() => act(c.id, 'approve')}
                    className="rounded-lg bg-green-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-40">
                    Approve
                  </button>
                  <button disabled={busyId === c.id} onClick={() => act(c.id, 'reject')}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    Reject
                  </button>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {c.domain_match ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                    ✅ {c.claimant_email_domain} matches {c.entity_domain_at_claim}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    ⚠️ {c.claimant_email_domain ?? 'no domain'} does not match {c.entity_domain_at_claim ?? "this profile's domain"} — manual verification required
                  </span>
                )}
                {c.evidence?.roleMailbox && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600" title="Generic role inbox (info@/contact@/office@…) — confirm this is actually the claimant, not just anyone with access to a shared inbox.">
                    role mailbox
                  </span>
                )}
                {c.evidence?.isDispute && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-[#B00000]" title={`Already claimed by: ${c.evidence.disputedOwnerEmails.join(', ')}`}>
                    ⚠ dispute — already claimed
                  </span>
                )}
                {c.requested_role && <span className="text-[11px] text-gray-400">requested role: {c.requested_role}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {resolved.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-400">{resolved.length} resolved</summary>
          <ul className="mt-2 space-y-1">
            {resolved.map((c) => (
              <li key={c.id} className="rounded-lg py-1 text-xs text-gray-500">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
                {' '}{c.entity?.name ?? 'Unknown profile'} · {c.claimant_email}
                {c.resolved_at && <span className="text-gray-400"> · {c.resolved_at.slice(0, 10)}</span>}
                {c.notify_failed && <span className="ml-1 text-amber-700">⚠️ notification failed</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export default function InvestorsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Loading…</p>}>
      <InvestorsPageContent />
    </Suspense>
  );
}

// Prompt 576 Fase 3 — InvestorAccountsTable now reads useSearchParams() (via
// useTableUrlState); see startups/page.tsx's identical comment for why this
// boundary is required.
function InvestorsPageContent() {
  const [tab, setTab] = useState<'accounts' | 'claims' | 'catalog' | 'history'>('accounts');
  const [accounts, setAccounts] = useState<InvestorAccountRow[] | null>(null);

  useEffect(() => {
    fetch('/api/backoffice/investor-accounts').then((r) => r.json()).then((body) => { if (body.ok) setAccounts(body.accounts); }).catch(() => {});
  }, [tab]);

  const nameById = useMemo(() => new Map((accounts ?? []).map((a) => [a.entityId, a.name])), [accounts]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Investors</h1>
      <Tabs active={tab} onChange={(v) => setTab(v as 'accounts' | 'claims' | 'catalog' | 'history')}
        items={[{ key: 'accounts', label: 'Accounts' }, { key: 'claims', label: 'Profile claims' }, { key: 'catalog', label: 'Catalog stats' }, { key: 'history', label: 'History' }]} />
      {tab === 'accounts' && <InvestorAccountsTable />}
      {/* AccessRequestsQueue vive aqui, não em "Catalog stats": os dados são
          só sobre investidores (investor_access_requests), nada de catálogo.
          Estava montado dentro de CatalogStatsTab, portanto só aparecia no
          separador errado. */}
      {tab === 'claims' && (
        <div className="space-y-6">
          <ClaimsQueue />
          <AccessRequestsQueue />
        </div>
      )}
      {tab === 'catalog' && <CatalogStatsTab />}
      {tab === 'history' && <ModerationHistoryCard targetType="investor" nameById={nameById} />}
    </div>
  );
}
