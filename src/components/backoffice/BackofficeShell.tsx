'use client';
// Prompt 576 §3/§3a — the back-office's own sidebar, built from the same
// shared WorkspaceSidebar/WorkspaceHeader the founder shell uses (already a
// generic, group-aware, multi-consumer pair — see WorkspaceSidebar.tsx's own
// header), rather than a bespoke sidebar.
//
// Deliberately NOT threaded through <Shell> (src/components/shell.tsx)
// itself: that component's hooks and popups (useStore()'s local CRM data,
// WelcomeModal, ReminderPopup, InvestorInterestPopup, DocumentRequestPopup,
// the MatchDeal button, the outreach-discipline caps pill) are all
// founder-pipeline concerns with no meaning for a platform-admin session.
// Branching all of those on "is this backoffice" would touch founder-only
// code paths for zero founder-facing benefit — exactly the risk §8's "não
// redesenhar o produto do founder" is warning against. This sibling
// component reaches the same user-facing outcome (identical nav chrome,
// same collapse/grouping behaviour, same visual language) by reusing the
// same two lower-level building blocks, not by reusing Shell itself.
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { WorkspaceSidebar } from '@/components/workspace-shell/WorkspaceSidebar';
import { WorkspaceHeader } from '@/components/workspace-shell/WorkspaceHeader';
import { LogoutButton } from '@/components/workspace-shell/LogoutButton';
import type { WorkspaceNavItem } from '@/components/workspace-shell/types';
import { BRAND_NAME } from '@/lib/brand';
import { BackofficeSearch } from './BackofficeSearch';

interface QueueSummaryRow { key: string; count: number | null; slaDueInDays?: number | null }
interface Me { email?: string | null; role: string }

function sum(...vals: (number | null | undefined)[]): number {
  return vals.reduce<number>((s, v) => s + (v ?? 0), 0);
}

export function BackofficeShell({ me, children }: { me: Me | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<QueueSummaryRow[] | null>(null);
  // Prompt 576 Fase 2 — sourced from the real 4-signal /api/backoffice/
  // system-status now, not the single-signal email-only proxy Fase 1 used
  // as a placeholder. null (a signal with no baseline, e.g. AI costs before
  // a prior month exists) never turns this red — only a confirmed false does.
  const [systemNominal, setSystemNominal] = useState<boolean | null>(null);
  const [supportBadge, setSupportBadge] = useState(0);

  useEffect(() => {
    fetch('/api/backoffice/queue/summary').then((r) => r.json()).then((body) => {
      if (body.ok) setRows(body.rows);
    }).catch(() => {});
    fetch('/api/backoffice/system-status').then((r) => r.json()).then((body) => {
      if (body.ok) setSystemNominal(!(body.signals as { ok: boolean | null }[]).some((s) => s.ok === false));
    }).catch(() => {});
    fetch('/api/backoffice/support').then((r) => r.json()).then((body) => {
      if (body.ok) setSupportBadge(body.counts.navBadge as number);
    }).catch(() => {});
  }, []);

  const count = (key: string) => rows?.find((r) => r.key === key)?.count ?? null;
  const gdprSlaDays = rows?.find((r) => r.key === 'gdpr')?.slaDueInDays ?? null;

  // Prompt 576 §2's own fusion note names three folds explicitly (key_people
  // -> Contributions filter, domain_mismatch -> Investor identity filter,
  // contributions_by_user -> Insight). The remaining queue/summary keys
  // (submissions, investor_claims, community) aren't assigned anywhere in
  // writing yet — folded in below by nearest conceptual fit (new investor
  // entities; a trust/safety concern) so Attention's total is never higher
  // than the sum of what Review's own rows show. This is a Phase 1 judgment
  // call, not the real fusion — 572-574 replace it with the actual merge.
  //
  // Reachability, not just counting: these 6 items are "6 cartões apontam
  // para os separadores actuais um-para-um" per §2 — 6 fast paths into
  // /backoffice/queue, not a removal of its other 6 tabs (submissions,
  // fraud, key_people, community, domain_mismatch). QueueTable's own
  // internal tab bar is untouched by this file and still reaches all 12;
  // these links just don't each get a dedicated sidebar shortcut yet.
  const newInvestors = sum(count('candidates'), count('submissions'), count('investor_claims'));
  const contributions = sum(count('contributions')); // key_people is null — not reflected, never assumed zero
  const investorIdentity = sum(count('identity'), count('domain_mismatch'));
  const personClaims = sum(count('claims'));
  const gdpr = sum(count('gdpr'));
  const trustSafety = sum(count('suspicious'), count('fraud'), count('community'));
  const reviewTotal = newInvestors + contributions + investorIdentity + personClaims + gdpr + trustSafety;
  const attentionTotal = rows ? reviewTotal + supportBadge : 0;

  const fromPath = searchParams.get('from') || '/pipeline';
  const fromLabel = searchParams.get('fromLabel') || 'founder';

  function item(key: string, label: string, href: string, opts: Partial<WorkspaceNavItem> = {}): WorkspaceNavItem {
    return {
      key, label, href, icon: '·',
      active: href === '/backoffice' ? pathname === '/backoffice' : !!pathname?.startsWith(href),
      ...opts,
    };
  }

  const items: WorkspaceNavItem[] = [
    item('attention', 'Attention', '/backoffice', { icon: '⚑', badge: attentionTotal || undefined }),

    item('review-new', 'New investors', '/backoffice/queue?tab=candidates', {
      icon: '☰', group: 1, groupLabel: 'Review', groupMeta: reviewTotal > 0
        ? <span className="rounded-full bg-gray-700 px-1.5 text-[10px] font-bold text-white">{reviewTotal}</span> : undefined,
      badge: newInvestors || undefined, dimmed: !newInvestors,
    }),
    item('review-contributions', 'Contributions', '/backoffice/queue?tab=contributions', { icon: '☰', group: 1, badge: contributions || undefined, dimmed: !contributions }),
    item('review-identity', 'Investor identity', '/backoffice/queue?tab=identity', { icon: '☰', group: 1, badge: investorIdentity || undefined, dimmed: !investorIdentity }),
    item('review-claims', 'Person claims', '/backoffice/queue?tab=claims', { icon: '☰', group: 1, badge: personClaims || undefined, dimmed: !personClaims }),
    // Prompt 576 §3 — the label itself carries the deadline once it's
    // within a week; a simpler stand-in for the wireframe's always-present
    // clock glyph (WorkspaceNavItem has no slot for a second icon per row),
    // but it still means "nothing today" and "no such thing as a deadline
    // here" never look identical once a request is actually close to due.
    item('review-gdpr', gdprSlaDays !== null && gdprSlaDays <= 7 ? `GDPR — due in ${Math.max(gdprSlaDays, 0)}d` : 'GDPR',
      '/backoffice/queue?tab=gdpr', { icon: '☰', group: 1, badge: gdpr || undefined, dimmed: !gdpr }),
    item('review-trust', 'Trust & safety', '/backoffice/queue?tab=suspicious', { icon: '☰', group: 1, badge: trustSafety || undefined, dimmed: !trustSafety }),
    // Prompt 576 §2 only names Support as feeding Attention's aggregate
    // feed (Phase 2); it doesn't say where the existing ticket-list PAGE
    // itself lives. Review fits it best today — daily, decision-driven —
    // and it must keep a nav slot regardless: no existing route may become
    // unreachable in Phase 1.
    item('review-support', 'Customer Support', '/backoffice/support', { icon: '☰', group: 1, badge: supportBadge || undefined, dimmed: !supportBadge }),

    item('accounts-startups', 'Startups', '/backoffice/startups', { icon: '◉', group: 2, groupLabel: 'Accounts' }),
    item('accounts-investors', 'Investors', '/backoffice/investors', { icon: '◉', group: 2 }),
    item('accounts-plans', 'Plan requests', '/backoffice/plan-requests', { icon: '◉', group: 2, dimmed: true }),
    item('accounts-promo', 'Promo codes & offers', '/backoffice/promo-codes', { icon: '◉', group: 2, dimmed: true }),

    item('data-catalog', 'Catalog', '/backoffice/catalog', { icon: '▦', group: 3, groupLabel: 'Data' }),
    item('data-market', 'Market companies', '/backoffice/queue?tab=competitor_intel', { icon: '▦', group: 3, dimmed: true }),

    item('insight-metrics', 'Metrics', '/metrics', { icon: '◆', group: 4, groupLabel: 'Insight' }),
    item('insight-usage', 'Usage', '/metrics', { icon: '◆', group: 4, dimmed: true }),
    item('insight-costs', 'AI costs', '/backoffice/costs', { icon: '◆', group: 4 }),
    // No page exists yet for this (it moves here from the Queue's
    // key_people-adjacent UI once 572-574 land) — shown as a quiet
    // placeholder rather than either invented or silently dropped.
    { key: 'insight-contrib-by-user', label: 'Contributions by user', icon: '◆', active: false, group: 4, dimmed: true },

    // Prompt 576 Fase 2 — the unified 4-signal list (§7's format), one
    // level above the four individual detail pages it links out to.
    item('system-overview', 'Overview', '/backoffice/system', {
      icon: '●', group: 5, groupLabel: 'System',
      groupMeta: <span className={`inline-block h-[7px] w-[7px] rounded-full ${systemNominal === false ? 'bg-red-500' : 'bg-green-500'}`} />,
    }),
    item('system-email', 'Email delivery', '/backoffice/email-delivery', { icon: '●', group: 5 }),
    item('system-gap', 'Gap engine health', '/backoffice/gap-engine-health', { icon: '●', group: 5 }),
    // Neither has a browsable page yet — same placeholder treatment as
    // Contributions by user above, not a data change to invent one.
    { key: 'system-migrations', label: 'Migrations / ledger', icon: '●', active: false, group: 5, dimmed: true },
    { key: 'system-audit', label: 'Audit log', icon: '●', active: false, group: 5, dimmed: true },
    // Not named in the prompt's own System list, but a real, existing,
    // completely unlinked page (confirmed: zero links anywhere in the app)
    // — giving it a home is fixing an orphan, not inventing a feature.
    item('system-scanhealth', 'Scan health', '/backoffice/scan-health', { icon: '●', group: 5, dimmed: true }),
  ];

  const initials = (me?.email || 'O')[0]!.toUpperCase();

  return (
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      <WorkspaceSidebar
        brandName={BRAND_NAME}
        subtitle="Back-office"
        groupStyle="cards"
        beforeItems={
          <div className="mx-3 mt-1 flex flex-col gap-2 rounded-xl bg-gray-900 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-blue-300">
                <span aria-hidden>⛨</span> Operator mode
              </span>
            </div>
            <Link href={fromPath}
              className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 text-[12.5px] font-medium text-gray-900 transition hover:bg-gray-100">
              <span aria-hidden>←</span> Back to {fromLabel}
            </Link>
            <BackofficeSearch />
          </div>
        }
        items={items}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#0E7490] text-[11px] font-bold text-white">{initials}</div>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-gray-700">{me?.email ?? '—'}</div>
                <div className="text-[10px] uppercase tracking-wide text-[#0E7490]">Operator</div>
              </div>
            </div>
            <LogoutButton className="shrink-0" />
          </div>
        }
      />
      <div className="flex-1 md:ml-60">
        <WorkspaceHeader
          left={<div className="text-[15px] font-bold text-[#0E7490] md:hidden" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>{BRAND_NAME} · Back-office</div>}
          right={<span className="text-xs text-gray-300">Platform team console</span>}
        />
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
