'use client';
// Prompt B — "Investors": the internal source of truth about the investor
// base. The public landing quotes rounded-down bands (500+ profiles, 25+
// countries); this page quotes the real numbers, because deciding what to
// build next on a rounded number is how you end up believing your own
// marketing. Read-only — the CRUD lives in Catálogo, linked at the bottom.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Tabs } from '@/components/ui';
import type { DomainMatchVerdict } from '@/lib/investor-domain-match';
import { ModerationControls } from '@/components/backoffice/ModerationControls';
import { ModerationHistoryCard } from '@/components/backoffice/ModerationHistoryCard';
import type { ModerationStatus } from '@/lib/account-moderation';

type Totals = {
  total: number; verified: number; imported: number; demo: number; backfilled: number;
  withPerson: number; withEmail: number; personPct: number; countries: number;
};
type AccessRequest = {
  id: string; created_at: string; email: string; firm_name: string | null; note: string | null;
  status: 'pending' | 'approved' | 'rejected'; contacted_at: string | null; reviewed_at: string | null;
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
              <li key={r.id} className="flex items-center gap-2 text-xs text-gray-500">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
                <span>{r.email}</span>
                {r.reviewed_at && <span className="text-gray-400">{r.reviewed_at.slice(0, 10)}</span>}
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
interface InvestorAccountRow {
  entityId: string; name: string; planTier: string | null; registrationDate: string | null; seats: number;
  complete: boolean; lastLogin: string | null; status: 'active' | 'quiet' | 'inactive';
  accessGrantedLastMonth: number; filesViewedLastMonth: number; startupsInteractedWith: number;
  moderationStatus: ModerationStatus; moderationQuarantineUntil: string | null;
  logsLast7Days: number | null; accessRequestedLastMonth: number | null; visiblePipelineSize: number | null;
  startupComparisonsLastMonth: number | null; aiAssistanceLastMonth: number | null;
}

const INVESTOR_STATUS_STYLE: Record<InvestorAccountRow['status'], string> = {
  active: 'bg-green-50 text-green-700', quiet: 'bg-amber-50 text-amber-700', inactive: 'bg-gray-100 text-gray-500',
};

function NotTracked({ tooltip }: { tooltip: string }) {
  return <span className="text-gray-300" title={tooltip}>—</span>;
}

function InvestorAccountsTable() {
  const [accounts, setAccounts] = useState<InvestorAccountRow[] | null>(null);
  const [moderationAvailable, setModerationAvailable] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  function load() {
    fetch('/api/backoffice/investor-accounts').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error); return; }
      setAccounts(body.accounts);
      setModerationAvailable(!!body.moderationAvailable);
    }).catch(() => setErr('Failed to load.'));
  }
  useEffect(load, []);

  const rows = useMemo(() => (accounts ?? []).filter((a) => a.name.toLowerCase().includes(q.toLowerCase())), [accounts, q]);

  if (err) return <Card title="Investor accounts"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!accounts) return <Card title="Investor accounts"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <Card title={`Investor accounts (${rows.length}${q ? ` of ${accounts.length}` : ''})`}>
      <div className="mb-3 flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by firm name…"
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <p className="ml-auto text-xs text-gray-500">Real registered firms only — catalog stats below cover every imported entity.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="whitespace-nowrap py-1.5 pr-3">Org</th><th className="pr-3">Plan</th><th className="pr-3">Registered</th>
              <th className="pr-3">Seats</th><th className="pr-3">% Complete</th><th className="pr-3">Logs/7d</th>
              <th className="pr-3">Last login</th><th className="pr-3">Status</th><th className="pr-3">Delete/Suspend</th>
              <th className="pr-3">Access req./mo</th><th className="pr-3">Access granted/mo</th><th className="pr-3">Files viewed/mo</th>
              <th className="pr-3">Pipeline</th><th className="pr-3">Startups</th><th className="pr-3">Comparisons/mo</th><th>AI assist/mo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.entityId} className="border-t border-gray-50 align-top">
                <td className="py-2 pr-3 font-medium">{a.name}</td>
                <td className="pr-3 text-gray-500">{a.planTier ?? '—'}</td>
                <td className="pr-3 text-xs text-gray-400 whitespace-nowrap">{a.registrationDate ? a.registrationDate.slice(0, 10) : '—'}</td>
                <td className="pr-3 text-gray-600">{a.seats}</td>
                <td className="pr-3 text-gray-600">{a.complete ? 'Complete' : 'Incomplete'}</td>
                <td className="pr-3">
                  {a.logsLast7Days == null ? <NotTracked tooltip="Tracking starts once an investor activity-log event exists" /> : a.logsLast7Days}
                </td>
                <td className="pr-3 text-xs text-gray-400 whitespace-nowrap">{a.lastLogin ? a.lastLogin.slice(0, 10) : 'never'}</td>
                <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${INVESTOR_STATUS_STYLE[a.status]}`}>{a.status}</span></td>
                <td className="pr-3">
                  {moderationAvailable ? (
                    <ModerationControls targetType="investor" targetId={a.entityId} status={a.moderationStatus} quarantineUntil={a.moderationQuarantineUntil} onChanged={load} />
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
      {!moderationAvailable && <p className="mt-3 text-[11px] text-gray-400">Suspend/Delete activates once migration 0121 is applied.</p>}
    </Card>
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

      <AccessRequestsQueue />

      <PipelineDecisionsPanel />

      <p className="text-sm text-gray-500">
        To edit, verify, or merge entities:{' '}
        <Link href="/backoffice/catalog" className="font-medium text-[#0E7490] underline">Catalog →</Link>
      </p>
    </div>
  );
}

export default function InvestorsPage() {
  const [tab, setTab] = useState<'accounts' | 'catalog' | 'history'>('accounts');
  const [accounts, setAccounts] = useState<InvestorAccountRow[] | null>(null);

  useEffect(() => {
    fetch('/api/backoffice/investor-accounts').then((r) => r.json()).then((body) => { if (body.ok) setAccounts(body.accounts); }).catch(() => {});
  }, [tab]);

  const nameById = useMemo(() => new Map((accounts ?? []).map((a) => [a.entityId, a.name])), [accounts]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Investors</h1>
      <Tabs active={tab} onChange={(v) => setTab(v as 'accounts' | 'catalog' | 'history')}
        items={[{ key: 'accounts', label: 'Accounts' }, { key: 'catalog', label: 'Catalog stats' }, { key: 'history', label: 'History' }]} />
      {tab === 'accounts' && <InvestorAccountsTable />}
      {tab === 'catalog' && <CatalogStatsTab />}
      {tab === 'history' && <ModerationHistoryCard targetType="investor" nameById={nameById} />}
    </div>
  );
}
