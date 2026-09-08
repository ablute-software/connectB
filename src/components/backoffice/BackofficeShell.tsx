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
  // contributions_by_user -> Insight) — both now real (Prompt 572 built the
  // People filter old key_people counted toward; Prompt 573 built the
  // domain_mismatch filter below, AND made queue-summary's own 'identity'
  // count the real thing directly — self-declared + document + claim,
  // non-internal — so nothing needs folding on top of it any more; the old
  // `investor_claims` key that used to live under "new investor entities"
  // is gone, its count is inside 'identity' itself now). `submissions` and
  // `community` remain Phase 1 judgment calls, not yet replaced by 574.
  //
  // Reachability, not just counting: these 6 items are "6 cartões apontam
  // para os separadores actuais um-para-um" per §2 — 6 fast paths into
  // /backoffice/queue, not a removal of its other tabs (submissions, fraud,
  // community). QueueTable's own internal tab bar is untouched by this file;
  // these links just don't each get a dedicated sidebar shortcut yet.
  const newInvestors = sum(count('candidates'), count('submissions'));
  const contributions = sum(count('contributions')); // key_people is null — not reflected, never assumed zero
  const investorIdentity = sum(count('identity'));
  const personClaims = sum(count('claims'));
  const gdpr = sum(count('gdpr'));
  // Prompt 601 §F — tech masters in lapse awaiting a person's look.
  const badgeLapse = sum(count('badge_lapse'));
  // Prompt 599 §1 — aligned with the board: a fused count is null (unknown),
  // never a silent partial sum, when any part is null. `community` is a real
  // number now (queue-summary.ts, same change), so in practice this only
  // ever nulls out if its tables can't be read — and then the row still
  // shows, badge-less, exactly as the board shows a dash instead of "0".
  const trustSafetyParts = [count('suspicious'), count('fraud'), count('community')];
  const trustSafety: number | null = trustSafetyParts.some((v) => v === null) ? null : sum(...trustSafetyParts);
  const reviewTotal = newInvestors + contributions + investorIdentity + personClaims + gdpr + badgeLapse + (trustSafety ?? 0);
  const attentionTotal = rows ? reviewTotal + supportBadge : 0;

  const fromPath = searchParams.get('from') || '/pipeline';
  const fromLabel = searchParams.get('fromLabel') || 'founder';

  // Prompt 599 §1 — usePathname() carries no query string, so a plain
  // startsWith(href) could never match a tab link like
  // /backoffice/queue?tab=contributions: those rows never highlighted, and
  // "All queues" (the bare path) lit up for every queue view instead. For
  // the two paths whose sidebar rows differ only by ?tab=, active means
  // path AND tab agree (a bare-path row on those paths means "no tab").
  // Every other path keeps the original prefix match.
  const currentTab = searchParams.get('tab');
  const TABBED_PATHS = new Set(['/backoffice/queue', '/metrics']);
  function item(key: string, label: string, href: string, opts: Partial<WorkspaceNavItem> = {}): WorkspaceNavItem {
    const [hrefPath, hrefQuery] = href.split('?');
    const hrefTab = hrefQuery ? new URLSearchParams(hrefQuery).get('tab') : null;
    const active = href === '/backoffice' ? pathname === '/backoffice'
      : TABBED_PATHS.has(hrefPath) ? (pathname === hrefPath && (currentTab ?? null) === hrefTab)
      : !!pathname?.startsWith(hrefPath);
    return { key, label, href, icon: '·', active, ...opts };
  }

  const items: WorkspaceNavItem[] = [
    // Prompt 585 §A — the one badge in the whole dark sidebar allowed
    // outside the blue family: this is the aggregate total, not a per-item
    // count, so it gets --sb-danger red instead of --sb-badge blue.
    item('attention', 'Attention', '/backoffice', { icon: '⚑', badge: attentionTotal || undefined, badgeDanger: true }),

    // Prompt 598 §A — ONE navigation for Review. The Queue page's own tab
    // bar is gone; this is now the only place a queue is chosen, and
    // "All queues" is the landing that still shows every queue including
    // the empty ones. §A.2: a queue with nothing pending doesn't render
    // here at all — moving all ten queues into the sidebar unconditionally
    // would have made the column longer, which is the opposite of what was
    // asked ("o sidebar tem que ficar mais simples... para evitar o
    // scrolldown"). Each reappears by itself the moment it has an item.
    // The section's own aggregate badge always renders, so "calm" is
    // legible without opening anything. Deliberately NOT applied to
    // Accounts/Data/Insight/System — those are destinations, not work
    // queues; hiding them would be hiding navigation, not noise.
    item('review-all', 'All queues', '/backoffice/queue', {
      icon: '☰', group: 1, groupLabel: 'Review', groupMeta: reviewTotal > 0
        ? <span className="rounded-full bg-[var(--sb-active)] px-1.5 text-[10px] font-bold text-[var(--sb-text)]">{reviewTotal}</span> : undefined,
    }),
    ...(newInvestors ? [item('review-new', 'New investors', '/backoffice/queue?tab=new_investors', { icon: '☰', group: 1, badge: newInvestors })] : []),
    ...(contributions ? [item('review-contributions', 'Contributions', '/backoffice/queue?tab=contributions', { icon: '☰', group: 1, badge: contributions })] : []),
    ...(investorIdentity ? [item('review-identity', 'Investor identity', '/backoffice/queue?tab=identity', { icon: '☰', group: 1, badge: investorIdentity })] : []),
    ...(personClaims ? [item('review-claims', 'Person claims', '/backoffice/queue?tab=claims', { icon: '☰', group: 1, badge: personClaims })] : []),
    // Prompt 576 §3 — the label itself carries the deadline once it's
    // within a week. 598 §A.2 asked whether GDPR should stay pinned even
    // when empty; the recommendation there was no, and the approved design
    // says the same ("Deadline first — GDPR leads the board the moment it
    // isn't empty", which only means anything if an empty GDPR isn't
    // occupying a row). Following that: it appears the instant it has one.
    ...(gdpr ? [item('review-gdpr', gdprSlaDays !== null && gdprSlaDays <= 7 ? `GDPR — due in ${Math.max(gdprSlaDays, 0)}d` : 'GDPR',
      '/backoffice/queue?tab=gdpr', { icon: '☰', group: 1, badge: gdpr })] : []),
    // Prompt 601 §F — appears the instant a tech master's window passes
    // with no use; a person decides, the clock never revokes.
    ...(badgeLapse ? [item('review-badge-lapse', 'Tech master lapses', '/backoffice/queue?tab=badge_lapse', { icon: '☰', group: 1, badge: badgeLapse })] : []),
    ...(trustSafety === null || trustSafety > 0
      ? [item('review-trust', 'Trust & safety', '/backoffice/queue?tab=trust_safety', { icon: '☰', group: 1, badge: trustSafety || undefined })]
      : []),
    // Prompt 576 §2 only names Support as feeding Attention's aggregate
    // feed (Phase 2); it doesn't say where the existing ticket-list PAGE
    // itself lives. Review fits it best today — daily, decision-driven.
    // Same visibility rule as the queues above now that it's one nav.
    ...(supportBadge ? [item('review-support', 'Customer Support', '/backoffice/support', { icon: '☰', group: 1, badge: supportBadge })] : []),

    item('accounts-startups', 'Startups', '/backoffice/startups', { icon: '◉', group: 2, groupLabel: 'Accounts' }),
    item('accounts-investors', 'Investors', '/backoffice/investors', { icon: '◉', group: 2 }),
    item('accounts-plans', 'Plan requests', '/backoffice/plan-requests', { icon: '◉', group: 2, dimmed: true }),

    item('data-catalog', 'Catalog', '/backoffice/catalog', { icon: '▦', group: 3, groupLabel: 'Data' }),
    // Prompt 574 §D — real now: org_competitors grouped by market_companies,
    // read-only (no review action exists on that table anywhere — see
    // /api/backoffice/market-companies's own header). Not the same feature
    // as Review's "Competitor intel" tab, which tracks investor_investments.
    item('data-market', 'Market companies', '/backoffice/market-companies', { icon: '▦', group: 3 }),

    // Prompt 854 §B.1 — a new group, one insertion after Data rather than a
    // renumbering of Insight/System: runs are contiguous by ARRAY ORDER, and
    // group only has to differ from its neighbours', so group: 6 here is
    // fine even though 5 (System) comes later in the array.
    item('marketing-outreach', 'Startups / Ecosystems', '/backoffice/outreach', { icon: '✦', group: 6, groupLabel: 'Marketing' }),
    // Moved here from group 2 (Accounts) — same href, key renamed from
    // accounts-promo, dimmed dropped: promo codes are marketing, not account
    // administration, and it is no longer a footnote once it has its own
    // group.
    item('marketing-promo', 'Promo codes & offers', '/backoffice/promo-codes', { icon: '✦', group: 6 }),
    item('marketing-tree', 'Promo tree', '/backoffice/promo-tree', { icon: '✦', group: 6 }),

    item('insight-metrics', 'Metrics', '/metrics', { icon: '◆', group: 4, groupLabel: 'Insight' }),
    // Prompt 599 §1 — pointed at bare /metrics, so it opened the Overview
    // tab and looked identical to the Metrics row above it. Usage is a
    // real tab on that page; the page now reads ?tab= (case (a): the
    // destination existed, the link just didn't say which part).
    item('insight-usage', 'Usage', '/metrics?tab=usage', { icon: '◆', group: 4 }),
    item('insight-costs', 'AI costs', '/backoffice/costs', { icon: '◆', group: 4 }),
    // Prompt 852 §F — both directions of "no", each a real tab on /metrics
    // (same ?tab= mechanism Prompt 599 §1 established for Usage).
    item('insight-startup-decisions', 'Startup decisions', '/metrics?tab=startup-decisions', { icon: '◆', group: 4 }),
    item('insight-passes-over', 'Passes / Over', '/metrics?tab=passes-over', { icon: '◆', group: 4 }),
    // Prompt 572 §D — the placeholder above this comment used to say "no
    // page exists yet"; it does now (contribution-ranking route + this
    // page), read-only, separate from the Review queue's own decide-facts
    // page it links back to.
    item('insight-contrib-by-user', 'Contributions by user', '/backoffice/contributions', { icon: '◆', group: 4 }),

    // Prompt 576 Fase 2 — the unified 4-signal list (§7's format), one
    // level above the four individual detail pages it links out to.
    item('system-overview', 'Overview', '/backoffice/system', {
      icon: '●', group: 5, groupLabel: 'System',
      groupMeta: <span className={`inline-block h-[7px] w-[7px] rounded-full ${systemNominal === false ? 'bg-[var(--sb-danger)]' : 'bg-[var(--sb-success)]'}`} />,
    }),
    item('system-email', 'Email delivery', '/backoffice/email-delivery', { icon: '●', group: 5 }),
    item('system-gap', 'Gap engine health', '/backoffice/gap-engine-health', { icon: '●', group: 5 }),
    // Prompt 599 §1 — "Audit log" was an href-less placeholder (576 Fase 1)
    // while the data and a working panel both already existed, buried in
    // /metrics collapsed by default. It has its own page now.
    // "Migrations / ledger" is removed rather than kept dimmed: no page, no
    // API, nothing to open — the prompt's rule is that an entry which
    // promises and doesn't deliver is worse than an absence, and 598 §A
    // just spent effort making this column shorter. The ledger lives in
    // `npm run verify:migrations` today; a page is a separate build, not a
    // link to invent.
    item('system-audit', 'Audit log', '/backoffice/audit-log', { icon: '●', group: 5 }),
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
        collapsible
        theme="dark"
        beforeItems={
          // Prompt 585 §A — matches Navigation.dc.html's own operator strip:
          // no separate card surface (that was a third, uncatalogued dark
          // tone competing with --sb-bg), just a bottom border on the same
          // sidebar surface.
          <div className="mx-1.5 mt-1 flex flex-col gap-2 border-b border-[var(--sb-border)] px-1.5 pb-3 min-[1440px]:mx-3 min-[1440px]:px-1.5">
            <div className="flex items-center justify-center min-[1440px]:justify-between">
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--sb-text)]" title="Operator mode">
                <span aria-hidden>⛨</span> <span className="hidden min-[1440px]:inline">Operator mode</span>
              </span>
            </div>
            <Link href={fromPath} title={`Back to ${fromLabel}`}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-2.5 py-2 text-[12.5px] font-medium text-gray-900 transition hover:bg-gray-100 min-[1440px]:justify-start">
              <span aria-hidden>←</span> <span className="hidden min-[1440px]:inline">Back to {fromLabel}</span>
            </Link>
            {/* ⌘K keeps working globally (BackofficeSearch's own keydown
                listener) even with the trigger button hidden — nothing is
                lost by dropping the discoverability hint on the narrow rail. */}
            <div className="hidden min-[1440px]:block"><BackofficeSearch /></div>
          </div>
        }
        items={items}
        footer={
          <div className="flex items-center justify-center gap-2 min-[1440px]:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[var(--sb-accent)] text-[11px] font-bold text-white" title={me?.email ?? undefined}>{initials}</div>
              <div className="hidden min-w-0 min-[1440px]:block">
                <div className="truncate text-[12px] font-medium text-[var(--sb-text)]">{me?.email ?? '—'}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--sb-dim)]">Operator</div>
              </div>
            </div>
            <LogoutButton compact theme="dark" className="min-[1440px]:hidden shrink-0" />
            <LogoutButton theme="dark" className="hidden shrink-0 min-[1440px]:inline-block" />
          </div>
        }
      />
      {/* Prompt 582 §B.4 — min-w-0 overrides the flex item's default
          min-width:auto. Without it, a min-width floor anywhere in the
          page's content (e.g. the Catalog table's own floor, added so its
          card can scroll instead of squeezing text illegibly) inflates
          THIS flex item's own minimum size and forces the whole page to
          scroll horizontally — the exact classic flexbox trap, and
          invisible until a descendant actually has a real min-width to
          expose it. No effect on pages whose content already fits. */}
      {/* Prompt 589 — was a static ml-60 (240px), stale against both the
          585 default (300px) and, once the sidebar became resizable, any
          width the operator actually drags to: WorkspaceSidebar sets
          --sb-w on document.documentElement precisely so this SIBLING can
          read the live value too (a custom property set inline on the
          aside itself never reaches here — down the tree only, not
          sideways). Fallback matches WorkspaceSidebar's own DEFAULT_WIDTH,
          for the frame before that effect has run. */}
      <div className="min-w-0 flex-1 md:ml-16 min-[1440px]:ml-[var(--sb-w,300px)]">
        <WorkspaceHeader
          left={<div className="text-[15px] font-bold text-[#0E7490] md:hidden" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>{BRAND_NAME} · Back-office</div>}
          right={<span className="text-xs text-gray-300">Platform team console</span>}
        />
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
