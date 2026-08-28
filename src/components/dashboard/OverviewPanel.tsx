'use client';
// Dashboard — campaign at a glance. Moved from src/app/dashboard/page.tsx
// (formerly its own route) into the Overview/Review & Optimization
// separadores on /dashboard — logic unchanged, only the export changed from
// a page default to a named panel.
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, EntityLink, fmtRoundEur, statusLabel } from '@/components/ui';
import { outboundCounts, passReasonAlert } from '@/lib/rules';
import { followUpTaskDisplayTitle } from '@/lib/relationship';
import { can, type OrgRole } from '@/lib/permissions';
import { authEnabled } from '@/lib/supabase';
import { PageTour } from '@/components/onboarding/PageTour';
import { MatchDealVisibilityBanner } from './MatchDealVisibilityBanner';
// Prompt 327 Pedido A — moved from CompanyPanel.tsx: these three are
// operational RESULTS of the Sherlock relationship with investors (a
// decision the platform recorded, a contact request, the caps that shape
// outreach volume), not facts the company declares about itself — they
// belong next to the rest of the campaign's own operational status, not on
// the "about the company" page. InvestorQACard/RoundUpdatesCard/
// SoftCommitsCard share the same characteristic but weren't named in the
// request — left in place, flagged in the report for a follow-up decision.
import { InvestorDecisionsCard, InterestLevelRequestsCard, WatchersCard, WatchUpdatesCard } from '@/components/company/InvestorEngagementCards';
import { OutreachSettingsCard } from '@/components/company/OutreachSettingsCard';
import type { EntityStatus } from '@/lib/types';
import { EraSelector, useEraFilter } from './EraSelector';
import { funnelByEra, interactionsInEra, datedInEra, entitiesActiveInEra } from '@/lib/dashboard-era';

const STATUS_ORDER: EntityStatus[] = ['not_contacted', 'contacted', 'in_conversation', 'diligence', 'passed', 'invested', 'dormant'];
const STATUS_BAR: Record<EntityStatus, string> = {
  not_contacted: 'bg-gray-300', contacted: 'bg-cyan-300', in_conversation: 'bg-cyan-500',
  diligence: 'bg-[#0E7490]', passed: 'bg-red-400', invested: 'bg-green-600', dormant: 'bg-gray-400',
};

export function OverviewPanel() {
  const { db } = useStore();
  const [openList, setOpenList] = useState<'followups' | 'passes' | null>(null);
  // Prompt 327 Pedido A — same permission resolution CompanyPanel.tsx used
  // for OutreachSettingsCard, moved here unchanged so its edit gate behaves
  // identically after relocating.
  const [orgRole, setOrgRole] = useState<OrgRole | null>(null);
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => setOrgRole(me.orgRole ?? null)).catch(() => {});
  }, []);
  const canEditOutreach = !authEnabled || can(orgRole, 'manage_org_settings');
  const caps = outboundCounts(db);
  const alert = passReasonAlert(db);
  // Prompt 361 — these four ("inherently now" cards) never filter by era:
  // they describe the campaign's CURRENT operational state, not history.
  // A "current" sublabel (below) makes that explicit once a non-'all' era
  // is selected, so it never reads as silently ignoring the selector.
  const active = db.entities.filter((e) => ['in_conversation', 'diligence'].includes(e.status)).length;
  const followupsDue = db.tasks.filter((t) => !t.done && t.kind === 'follow_up'
    && t.due_at && new Date(t.due_at) < new Date(Date.now() + 7 * 86400_000));
  // P106 §3 — was softCircled (sum of interest_eur, a different concept:
  // aggregate soft-circled interest per investor) against a hardcoded
  // €1.3M. Round progress reads the actual round fields the founder set on
  // the About/Round card instead.
  const roundTarget = db.org.round_target_eur;
  const roundSecured = db.org.round_secured_eur ?? 0;
  const roundPct = roundTarget ? Math.min(100, (roundSecured / roundTarget) * 100) : 0;

  const joinedAt = db.org.created_at ?? null;
  const [era, setEra] = useEraFilter(db.org.id);

  const passes = interactionsInEra(db.interactions.filter((i) => i.classification === 'pass'), era, joinedAt);
  const eraFunnel = funnelByEra(db, era, joinedAt);
  const funnel = [
    { label: 'contacted', n: eraFunnel.contacted }, { label: 'replied', n: eraFunnel.replied },
    { label: 'meeting', n: eraFunnel.meeting }, { label: 'diligence', n: eraFunnel.diligence }, { label: 'committed', n: eraFunnel.committed },
  ];

  const passCounts = new Map<string, { count: number; sample?: string }>();
  for (const p of passes) {
    const k = p.pass_reason_category ?? 'other';
    const cur = passCounts.get(k) ?? { count: 0 };
    passCounts.set(k, { count: cur.count + 1, sample: cur.sample ?? p.pass_reason });
  }

  const eraEntities = entitiesActiveInEra(db, era, joinedAt);
  const eraViews = datedInEra(db.views, era, joinedAt, (v) => v.viewed_at);
  const viewsByDoc = new Map<string, number>();
  for (const v of eraViews) viewsByDoc.set(v.document_id, (viewsByDoc.get(v.document_id) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <PageTour pageKey="guide_dashboard" />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Dashboard</h1>
      </div>

      <MatchDealVisibilityBanner />

      <EraSelector era={era} onChange={setEra} joinedAt={joinedAt} />

      {alert && (
        <div className="rounded-lg border-l-4 border-[#B00000] bg-red-50 px-4 py-3 text-sm">
          <span className="font-semibold text-[#B00000]">⚠ Same pass reason ({alert.category.replace('_', ' ')}) at {alert.count} investors — the pitch may be the problem. Review before sending more.</span>
        </div>
      )}

      <div data-tour-id="dashboard-top-cards" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><div className="text-2xl font-bold text-[#0E7490]">{active}</div>
          <div className="text-xs text-gray-500">Active conversations{era !== 'all' && <span className="text-gray-400"> · current</span>}<br />benchmark: seeds close on 15–40</div></Card>
        <Card><div className="text-2xl font-bold">{caps.week}<span className="text-sm font-normal text-gray-400">/{caps.weeklyCap}</span></div>
          <div className="mt-1 h-1.5 rounded bg-gray-100"><div className={`h-full rounded ${caps.week >= caps.weeklyCap - 2 ? 'bg-amber-500' : 'bg-[#0E7490]'}`} style={{ width: `${Math.min(100, caps.week / caps.weeklyCap * 100)}%` }} /></div>
          <div className="text-xs text-gray-500">Sent this week{era !== 'all' && <span className="text-gray-400"> · current</span>}</div></Card>
        <button onClick={() => setOpenList(openList === 'followups' ? null : 'followups')} className="text-left">
          <Card><div className="text-2xl font-bold">{followupsDue.length}</div>
            <div className="text-xs text-gray-500">Follow-ups due next 7 days{era !== 'all' && <span className="text-gray-400"> · current</span>} <span className="text-[#0E7490]">— {openList === 'followups' ? 'hide' : 'view'}</span></div></Card>
        </button>
        <button onClick={() => setOpenList(openList === 'passes' ? null : 'passes')} className="text-left">
          <Card><div className="text-2xl font-bold">{passes.length}</div>
            <div className="text-xs text-gray-500">Passes (with reasons) <span className="text-[#0E7490]">— {openList === 'passes' ? 'hide' : 'view'}</span></div></Card>
        </button>
      </div>

      {openList === 'followups' && (
        <Card title="Follow-ups due next 7 days">
          {followupsDue.length === 0 ? <p className="text-sm text-gray-400">None in the next 7 days.</p> : (
            <ul className="space-y-1.5 text-sm">
              {followupsDue.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span>{followUpTaskDisplayTitle(t)} {t.entity_id && <EntityLink id={t.entity_id}>{db.entities.find((e) => e.id === t.entity_id)?.name}</EntityLink>}</span>
                  <span className="text-xs text-gray-400">{t.due_at?.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {openList === 'passes' && (
        <Card title="Passes — investor + reason">
          {passes.length === 0 ? <p className="text-sm text-gray-400">No passes yet.</p> : (
            <ul className="space-y-1.5 text-sm">
              {passes.map((p) => (
                <li key={p.id}>
                  {p.entity_id && <EntityLink id={p.entity_id}><span className="font-medium">{db.entities.find((e) => e.id === p.entity_id)?.name}</span></EntityLink>}
                  {p.pass_reason_category && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">{p.pass_reason_category.replace('_', ' ')}</span>}
                  {p.pass_reason && <span className="block text-xs text-gray-500">“{p.pass_reason}”</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card title={`Round progress${era !== 'all' ? ' · current' : ''}`} tint="blue">
          {roundTarget ? (
            <>
              <div className="text-xl font-bold text-[#0E7490]">{fmtRoundEur(roundSecured)} <span className="text-sm font-normal text-gray-500">/ {fmtRoundEur(roundTarget)} target</span></div>
              <div className="mt-2 h-3 overflow-hidden rounded bg-white">
                <div className="h-full bg-[#0E7490]" style={{ width: `${roundPct}%` }} />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              Complete your round target to track your fundraising progress.{' '}
              <Link href="/settings#settings-round" className="font-medium text-[#0E7490] hover:underline">Set it in About</Link>.
            </p>
          )}
          {/* Prompt 126 A — was a flex row per bar, with the number/%
              columns as siblings of variable width/count (the top row,
              "contacted", has no % sibling at all, i===0). Flexbox
              resolves each bar's % width against however much space its
              OWN row's siblings leave over — a different available width
              per row — so a 3-digit "contacted" (no % sibling eating
              space) rendered visibly wider than its 100%-of-max share
              should be, next to rows that do have a % sibling. Fixed with
              a real CSS grid: one shared column template for the whole
              funnel, so the bar column is the exact same pixel width on
              every row regardless of what else that row shows. */}
          <div data-tour-id="dashboard-funnel" className="mt-4 grid items-center gap-x-2 gap-y-1.5 text-sm" style={{ gridTemplateColumns: '4.5rem 1fr 2.75rem 2.5rem' }}>
            {funnel.map((f, i) => (
              <Fragment key={f.label}>
                <span className="text-xs text-gray-500">{f.label}</span>
                <div className="h-4 rounded bg-[#0E7490]/80" style={{ width: `${Math.max(4, f.n / Math.max(1, funnel[0].n) * 100)}%` }} />
                <span className="text-right text-xs font-medium">{f.n}</span>
                <span className="text-right text-[10px] text-gray-400">
                  {i > 0 && funnel[i - 1].n > 0 ? `${Math.round(f.n / funnel[i - 1].n * 100)}%` : ''}
                </span>
              </Fragment>
            ))}
          </div>
        </Card>

        <Card title={era === 'all' ? 'Status breakdown' : 'Status breakdown — entities active in this era'}>
          <div className="space-y-1.5">
            {STATUS_ORDER.map((s) => {
              const n = eraEntities.filter((e) => e.status === s).length;
              return (
                <div key={s} className="flex items-center gap-2 text-sm">
                  <span className="w-28 text-xs text-gray-500">{statusLabel[s]}</span>
                  <div className={`h-3 rounded ${STATUS_BAR[s]}`} style={{ width: `${Math.max(3, n / Math.max(1, eraEntities.length) * 100)}%` }} />
                  <span className="text-xs">{n}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <div data-tour-id="dashboard-pass-reasons">
        <Card title="Pass reasons">
          {passCounts.size === 0 ? <p className="text-sm text-gray-400">No passes yet — when they come, the reasons are the most valuable data you collect.</p> : (
            <ul className="space-y-1.5 text-sm">
              {[...passCounts.entries()].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => (
                <li key={k}>
                  <span className="font-medium">{k.replace('_', ' ')}</span> — {v.count}
                  {v.sample && <span className="block text-xs text-gray-500">“{v.sample.slice(0, 80)}”</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Upcoming follow-ups">
          {followupsDue.length === 0 ? <p className="text-sm text-gray-400">None in the next 7 days.</p> : (
            <ul className="space-y-1.5 text-sm">
              {followupsDue.slice(0, 6).map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span>{followUpTaskDisplayTitle(t)} {t.entity_id && <EntityLink id={t.entity_id}>→</EntityLink>}</span>
                  <span className="text-xs text-gray-400">{t.due_at?.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={era === 'all' ? 'Data room engagement' : 'Data room engagement — this era'}>
          {eraViews.length === 0 ? <p className="text-sm text-gray-400">No investor views yet. Views appear here the moment a grantee opens a document.</p> : (
            <ul className="space-y-1.5 text-sm">
              {[...viewsByDoc.entries()].map(([docId, n]) => (
                <li key={docId} className="flex justify-between">
                  <span>{db.documents.find((d) => d.id === docId)?.name}</span>
                  <span className="text-xs text-gray-500">{n} view(s)</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Overrides log (${db.overrides.length})`}>
        {db.overrides.length === 0 ? <p className="text-sm text-gray-400">No rules overridden. Good.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Date</th><th>Rule</th><th>Entity</th><th>Justification</th></tr></thead>
            <tbody>
              {db.overrides.map((o) => (
                <tr key={o.id} className="border-t border-gray-100">
                  <td className="py-1.5 text-xs text-gray-500">{o.created_at.slice(0, 10)}</td>
                  <td className="text-xs">{o.rule.replace('_', ' ')}</td>
                  <td className="text-xs">{o.entity_id && <EntityLink id={o.entity_id}>{db.entities.find((e) => e.id === o.entity_id)?.name}</EntityLink>}</td>
                  <td className="text-xs text-gray-600">{o.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <InvestorDecisionsCard />
      <InterestLevelRequestsCard />
      <WatchersCard />
      <WatchUpdatesCard />
      <OutreachSettingsCard canEdit={canEditOutreach} />
    </div>
  );
}
