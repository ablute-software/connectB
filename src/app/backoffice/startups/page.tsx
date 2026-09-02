'use client';
// BLOCO 3 — Startups: org health + moderation.
//
// Prompt 123 Block A — "No drill-in, no impersonation" above is superseded:
// Developer Viewer opens a real, read-only, fully-audited view into a
// startup's workspace (see developer-viewer.ts's own header for the
// three-layer write-block this depends on). That comment stood for a real
// privacy commitment; this isn't a silent reversal of it — every entry is
// logged to admin_audit_log (viewer_enter/viewer_exit, with duration), the
// frame is permanent and impossible to miss, and nothing can be written
// while it's active. Plans & Account batch adds per-org plan management
// (view/set + pending upgrade requests) for the platform team, since
// there's no billing infra yet — the flip is manual.
//
// Prompt 123 Block C.1 — full column rewrite: Org · Plan · Registration
// date · Members (expandable) · % Completeness · Logs last 7 days · Last
// login · Status · Delete/Suspend · Files in Vault · Size of Visible
// Pipeline (reuses pipeline-unlock.ts's own formula, never recalculated
// separately) · Stage · AI drafts this month · AI reviews this month, plus
// sortable columns, search, and a History subtab (Block C.2).
import { useEffect, useMemo, useState } from 'react';
import { Card, Tabs } from '@/components/ui';
import { PLANS, planName, normalizePlan, parsePlanRequest } from '@/lib/plans';
import type { PlanTier } from '@/lib/types';
import { markViewerOrigin } from '@/components/DeveloperViewerFrame';
import { ModerationControls } from '@/components/backoffice/ModerationControls';
import { ModerationHistoryCard } from '@/components/backoffice/ModerationHistoryCard';
import { NetworkStrikesTab } from '@/components/backoffice/NetworkStrikesTab';
import type { ModerationStatus } from '@/lib/account-moderation';

const PERIOD_LABEL: Record<'monthly' | 'annual', string> = { monthly: 'Mensal', annual: 'Anual' };

interface OrgRow {
  orgId: string; name: string; plan: string; createdAt: string;
  planChangeRequested: string | null; planChangeRequestedAt: string | null;
  members: number; completenessPct: number; interactionsThisWeek: number; lastLogin: string | null;
  status: 'active' | 'quiet' | 'inactive';
  filesInVault: number; visiblePipelineSize: number; eligiblePoolSize: number;
  stage: string | null; aiDraftsThisMonth: number; aiReviewsThisMonth: number;
  moderationStatus: ModerationStatus; moderationQuarantineUntil: string | null;
  // Prompt 184 §4 — informative only, never used to filter or hide a row.
  // MatchDeal is an extra tool, not a requirement to be managed here.
  matchDealStatus: 'complete' | 'incomplete' | 'not_started';
}

const STATUS_STYLE: Record<OrgRow['status'], string> = {
  active: 'bg-green-50 text-green-700', quiet: 'bg-amber-50 text-amber-700', inactive: 'bg-gray-100 text-gray-500',
};

const MATCHDEAL_STYLE: Record<OrgRow['matchDealStatus'], string> = {
  complete: 'bg-green-50 text-green-700', incomplete: 'bg-amber-50 text-amber-700', not_started: 'bg-gray-100 text-gray-500',
};
const MATCHDEAL_LABEL: Record<OrgRow['matchDealStatus'], string> = {
  complete: 'Complete', incomplete: 'Incomplete', not_started: 'Not started',
};

type SortKey = 'name' | 'plan' | 'createdAt' | 'members' | 'completenessPct' | 'interactionsThisWeek' | 'lastLogin' | 'status' | 'filesInVault' | 'visiblePipelineSize' | 'stage' | 'aiDraftsThisMonth' | 'aiReviewsThisMonth' | 'matchDealStatus';

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return 0;
}

function MembersCell({ orgId, count }: { orgId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<{ userId: string; email: string; role: string }[] | null>(null);

  function toggle() {
    setOpen((o) => !o);
    if (!members) fetch(`/api/backoffice/org-members?orgId=${orgId}`).then((r) => r.json()).then((body) => {
      if (body.ok) setMembers(body.members);
    });
  }

  return (
    <div>
      <button onClick={toggle} className="text-gray-700 hover:text-[#0E7490] hover:underline">{count}</button>
      {open && (
        <div className="mt-1 rounded-lg border border-gray-100 bg-gray-50 p-2 text-[11px]">
          {!members ? <span className="text-gray-400">Loading…</span> : members.length === 0 ? <span className="text-gray-400">No members.</span> : (
            <ul className="space-y-0.5">
              {members.map((m) => <li key={m.userId}>{m.email} <span className="text-gray-400">· {m.role}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StartupsTable() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [planManagement, setPlanManagement] = useState(false);
  const [moderationAvailable, setModerationAvailable] = useState(false);
  const [err, setErr] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  async function openViewer(orgId: string) {
    setEnteringId(orgId);
    try {
      const res = await fetch('/api/backoffice/viewer/enter', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId }),
      });
      const body = await res.json();
      if (!body.ok) { alert(`Could not open viewer: ${body.error}`); return; }
      markViewerOrigin();
      window.location.href = '/';
    } finally { setEnteringId(null); }
  }

  function load() {
    fetch('/api/backoffice/startups').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setOrgs(body.orgs);
      setPlanManagement(!!body.planManagement);
      setModerationAvailable(!!body.moderationAvailable);
    });
  }
  useEffect(load, []);

  async function setPlan(orgId: string, tier: PlanTier) {
    setSavingId(orgId);
    try {
      const res = await fetch('/api/backoffice/set-plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, tier }),
      });
      const body = await res.json();
      if (!body.ok) { alert(`Set plan failed: ${body.error}`); return; }
      load();
    } finally {
      setSavingId(null);
    }
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const rows = useMemo(() => {
    let list = orgs ?? [];
    if (q) list = list.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => cmp(a[sortKey], b[sortKey]) * dir);
  }, [orgs, q, sortKey, sortDir]);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!orgs) return <p className="text-sm text-gray-400">Loading…</p>;

  const pending = orgs.filter((o) => o.planChangeRequested);
  const columns: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Org' }, { key: 'plan', label: 'Plan' }, { key: 'createdAt', label: 'Registered' },
    { key: 'completenessPct', label: '% Complete' }, { key: 'interactionsThisWeek', label: 'Logs/7d' },
    { key: 'lastLogin', label: 'Last login' }, { key: 'status', label: 'Status' }, { key: 'filesInVault', label: 'Files' },
    { key: 'visiblePipelineSize', label: 'Pipeline' }, { key: 'stage', label: 'Stage' },
    { key: 'aiDraftsThisMonth', label: 'AI drafts' }, { key: 'aiReviewsThisMonth', label: 'AI review' },
    { key: 'matchDealStatus', label: 'MatchDeal' },
  ];

  return (
    <div className="space-y-5">
      {planManagement && pending.length > 0 && (
        <Card title={`Pending plan-change requests (${pending.length})`}>
          <ul className="divide-y divide-gray-100 text-sm">
            {pending.map((o) => {
              const req = parsePlanRequest(o.planChangeRequested);
              return (
                <li key={o.orgId} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{o.name}</span>
                  <span className="text-xs text-gray-500">
                    {planName(normalizePlan(o.plan))} → <b>{planName(req.tier)}</b> ({PERIOD_LABEL[req.period]})
                    {o.planChangeRequestedAt && ` · pedido ${o.planChangeRequestedAt.slice(0, 10)}`}
                  </span>
                  <button
                    onClick={() => setPlan(o.orgId, req.tier)}
                    disabled={savingId === o.orgId}
                    className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                    {savingId === o.orgId ? 'A aplicar…' : 'Aplicar pedido'}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title={`Orgs (${rows.length}${q ? ` of ${orgs.length}` : ''})`}>
        <div className="mb-3 flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…"
            className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          <p className="ml-auto text-xs text-gray-500">Counts and computed scores only — never entity/person names or pipeline content.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                {columns.map((c) => (
                  <th key={c.key} className="cursor-pointer whitespace-nowrap py-1.5 pr-3 hover:text-gray-700" onClick={() => toggleSort(c.key)}>
                    {c.label} {sortKey === c.key && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                ))}
                <th className="whitespace-nowrap py-1.5 pr-3">Delete/Suspend</th>
                <th className="whitespace-nowrap py-1.5">Viewer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.orgId} className="border-t border-gray-50 align-top">
                  <td className="py-2 pr-3 font-medium">{o.name}</td>
                  <td className="pr-3">
                    {planManagement ? (
                      <div className="flex items-center gap-1.5">
                        <select value={normalizePlan(o.plan)} disabled={savingId === o.orgId}
                          onChange={(e) => setPlan(o.orgId, e.target.value as PlanTier)}
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                          {PLANS.map((p) => <option key={p.tier} value={p.tier}>{p.name}</option>)}
                        </select>
                        {o.planChangeRequested && (
                          <span title={`Requested ${planName(parsePlanRequest(o.planChangeRequested).tier)} (${PERIOD_LABEL[parsePlanRequest(o.planChangeRequested).period]})`}
                            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">req</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-500">{planName(normalizePlan(o.plan))}</span>
                    )}
                  </td>
                  <td className="pr-3 text-xs text-gray-400 whitespace-nowrap">{o.createdAt.slice(0, 10)}</td>
                  <td className="pr-3"><MembersCell orgId={o.orgId} count={o.members} /></td>
                  <td className="pr-3 text-gray-600">{o.completenessPct}%</td>
                  <td className="pr-3 text-gray-600">{o.interactionsThisWeek}</td>
                  <td className="pr-3 text-xs text-gray-400 whitespace-nowrap">{o.lastLogin ? o.lastLogin.slice(0, 10) : 'never'}</td>
                  <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[o.status]}`}>{o.status}</span></td>
                  <td className="pr-3 text-gray-600">{o.filesInVault}</td>
                  <td className="pr-3 text-gray-600 whitespace-nowrap">{o.visiblePipelineSize} / {o.eligiblePoolSize}</td>
                  <td className="pr-3 text-gray-600">{o.stage ?? '—'}</td>
                  <td className="pr-3 text-gray-600">{o.aiDraftsThisMonth}</td>
                  <td className="pr-3 text-gray-600">{o.aiReviewsThisMonth}</td>
                  <td className="pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${MATCHDEAL_STYLE[o.matchDealStatus]}`}>
                      {MATCHDEAL_LABEL[o.matchDealStatus]}
                    </span>
                  </td>
                  <td className="pr-3">
                    {moderationAvailable ? (
                      <ModerationControls targetType="org" targetId={o.orgId} status={o.moderationStatus} quarantineUntil={o.moderationQuarantineUntil} onChanged={load} />
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td>
                    <button onClick={() => openViewer(o.orgId)} disabled={enteringId === o.orgId}
                      title="Open this startup's workspace read-only — logged, exit anytime"
                      className="rounded-lg border border-orange-200 px-2 py-1 text-[11px] font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-40 whitespace-nowrap">
                      {enteringId === o.orgId ? 'Opening…' : 'Open as viewer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!planManagement && (
          <p className="mt-3 text-[11px] text-gray-400">Plan management activates once migration 0028 is applied.</p>
        )}
        {!moderationAvailable && (
          <p className="mt-1 text-[11px] text-gray-400">Suspend/Delete activates once migration 0121 is applied.</p>
        )}
      </Card>
    </div>
  );
}

// Prompt 531 §9 — Strikes joins Orgs and History as a third tab here rather
// than as a new back-office area: My Network moderation is startup
// moderation, and the request is explicit that it belongs inside Startups.
type StartupsTab = 'orgs' | 'strikes' | 'history';

export default function BackofficeStartupsPage() {
  const [tab, setTab] = useState<StartupsTab>('orgs');
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);

  useEffect(() => {
    fetch('/api/backoffice/startups').then((r) => r.json()).then((body) => { if (body.ok) setOrgs(body.orgs); }).catch(() => {});
  }, [tab]);

  const nameById = useMemo(() => new Map((orgs ?? []).map((o) => [o.orgId, o.name])), [orgs]);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Startups</h1>
      <Tabs active={tab} onChange={(v) => setTab(v as StartupsTab)}
        items={[{ key: 'orgs', label: 'Orgs' }, { key: 'strikes', label: 'Strikes' }, { key: 'history', label: 'History' }]} />
      {tab === 'orgs' && <StartupsTable />}
      {tab === 'strikes' && <NetworkStrikesTab />}
      {tab === 'history' && <ModerationHistoryCard targetType="org" nameById={nameById} />}
    </div>
  );
}
