'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { outboundCounts } from '@/lib/rules';
import { Tooltip } from '@/components/ui';
import { HelpSupportWidget } from '@/components/HelpSupportWidget';
import { useSupportUnreadCount } from '@/components/SupportTicketsPanel';
import { OnboardingProvider } from '@/lib/onboarding/OnboardingProvider';
import { WelcomeModal } from '@/components/onboarding/WelcomeModal';
import { W1Badge } from '@/components/onboarding/W1Badge';
import { DeveloperViewerFrame } from '@/components/DeveloperViewerFrame';
import { ReminderPopup } from '@/components/ReminderPopup';
import { InvestorInterestPopup } from '@/components/InvestorInterestPopup';
import { useBottomNavRef } from '@/lib/bottom-nav-context';
import { BRAND_NAME } from '@/lib/brand';
import { WorkspaceSidebar } from '@/components/workspace-shell/WorkspaceSidebar';
import { WorkspaceMobileNav } from '@/components/workspace-shell/WorkspaceMobileNav';
import { WorkspaceHeader } from '@/components/workspace-shell/WorkspaceHeader';
import { LogoutButton } from '@/components/workspace-shell/LogoutButton';
import type { WorkspaceNavItem } from '@/components/workspace-shell/types';

type Me = {
  authEnabled: boolean; user: { email?: string } | null; role: string;
  capabilities?: { ai: boolean; companyCanon: boolean; needsReviewAi: boolean; documentDetails: boolean; ndaSystem: boolean; entityContactFields: boolean; reviewRuns: boolean; permissionMatrix: boolean; documentOrdering: boolean; documentVersions: boolean; reawakening: boolean; planAccounts: boolean; billing: boolean };
  // Prompt 123 Block A — Developer Viewer session, if any.
  viewer?: { orgId: string; orgName: string | null } | null;
};

// Reorganisation batch, since revised: 11 items collapsed to separadores
// inside the page that absorbed them (see src/app/today, /dashboard,
// /settings), with 7 top-level entries left. Two corrections on top of the
// first pass: Plans & billing came back out to top-level (always-visible
// billing shouldn't be a tab click away), and Queue was dissolved — Needs
// review moved into /settings ("about {org}"), Outbox went back to being
// its own page. Review & Optimization still gates itself on the
// companyCanon capability, but one level down (Dashboard decides whether
// its own tab renders) — nothing here needs capability-based filtering.
//
// Prompt 94 — Today+Outbox merge into "Tasks" (Today/Warrants sub-tabs);
// Agenda splits back out to its own top-level item. Still 7 entries.
//
// The 6th item's label is set at render time (`about {org.name}`), not
// here — see aboutLabel below.
//
// Prompt 115 Block B — "Readiness & Train" promoted from a Dashboard
// separador to its own top-level entry, between Dashboard and Vault Data
// Room. Gated on the companyCanon capability (the same gate the old
// Dashboard tab used) via `requiresCapability` below — off means the entry
// doesn't render at all, same as the tab used to just not appear.
// P134-C — "Messages" added between Agenda and Dashboard: Sherlock
// messaging threads with investors on the Pipeline. Its unread badge is
// computed below from a real fetch (/api/founder/messages), not the local
// demo store — this feature has no demo-mode equivalent, same as the rest
// of the investor-workspace/messaging surface this session.
const NAV: { href: string; label: string; icon: string; requiresCapability?: 'companyCanon' }[] = [
  { href: '/pipeline', label: 'Pipeline', icon: '▤' },
  { href: '/tasks', label: 'Tasks', icon: '☀' },
  { href: '/agenda', label: 'Agenda', icon: '◔' },
  { href: '/messages', label: 'Messages', icon: '✉' },
  { href: '/dashboard', label: 'Dashboard', icon: '◈' },
  { href: '/readiness', label: 'Readiness & Train', icon: '◎', requiresCapability: 'companyCanon' },
  { href: '/documents', label: 'Vault Data Room', icon: '▣' },
  { href: '/settings', label: 'about your company', icon: '⋯' },
  { href: '/plans', label: 'Plans & billing', icon: '◇' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { db } = useStore();
  const caps = outboundCounts(db);
  const pendingRuns = db.runs.filter((r) => r.status === 'pending_review').length;
  const needsReviewCount = db.interactions.filter((i) => i.needs_review).length;
  const [me, setMe] = useState<Me | null>(null);
  // P134-C — unread Sherlock messaging threads, for the Messages nav badge.
  const [unreadMessages, setUnreadMessages] = useState(0);
  // Prompt 125 Block A — reports this nav's real rendered height (only
  // ever present on mobile, md:hidden) to ReportProblemWidget.
  const mobileNavRef = useBottomNavRef<HTMLElement>();

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false, user: null, role: 'none' }));
  }, []);

  useEffect(() => {
    fetch('/api/founder/messages').then((r) => r.json())
      .then((d) => setUnreadMessages((d.threads ?? []).filter((t: { unread: boolean }) => t.unread).length))
      .catch(() => setUnreadMessages(0));
  }, []);
  // Item 13 — the Messages nav badge used to count only deal_messages
  // threads; a support ticket with an unread admin reply is exactly the
  // same kind of "something's waiting on you" signal and now lives under
  // the same page's Support tab, so it counts toward the same badge.
  const unreadSupport = useSupportUnreadCount();

  // Dual-role (e.g. Nuno: founder of ablute_ AND platform admin) gets a
  // switcher into the fully separate back-office console (own layout/chrome
  // — see src/app/backoffice/layout.tsx). Founders without platform_admin
  // never see this at all, per BLOCO 3's "separar completamente" ask.
  const showBackofficeSwitcher = me?.role === 'developer';
  const aboutLabel = db.org.name ? `about ${db.org.name}` : 'about your company';
  // Hidden (not just disabled) while /api/me hasn't answered yet and after —
  // same "never a flash of appearing then disappearing" rule the old
  // Dashboard tab followed for this exact capability.
  const visibleNav = NAV.filter((n) => !n.requiresCapability || !!me?.capabilities?.[n.requiresCapability]);
  const capClass =
    caps.today >= caps.dailyCap || caps.week >= caps.weeklyCap ? 'text-[#B00000] font-semibold'
      : caps.today === caps.dailyCap - 1 || caps.week === caps.weeklyCap - 1 ? 'text-amber-600 font-semibold'
      : 'text-gray-400';

  // '/' is the public marketing landing, and the auth pages (login/signup/
  // forgot-password/reset-password) are now standalone frosted-glass screens
  // — none of them should show the sidebar/top bar (a visitor could otherwise
  // preview app chrome before ever signing in). All bring their own layout.
  // /contact joins this list too — it's the public Contact & Support form
  // (AuthShell-styled, same as login/signup) and must render standalone even
  // for a signed-in visitor who followed the landing footer link, not get
  // the founder app chrome wrapped around it.
  const isStandaloneAuthPage = path === '/login' || path === '/signup' || path === '/forgot-password' || path === '/reset-password' || path === '/set-password' || path === '/contact' || path === '/auth/confirm' || path === '/suspended';
  // /pair is the MatchDeal PWA (MD-08). It was missing from this list, so
  // the phone screen behind the QR code inherited the founder CRM chrome —
  // "ablute_" header, outreach caps pill, "+ Log interaction", and the
  // horizontally-scrolling CRM nav pinned over the deck. That is what made
  // it read as "sherlockdeal.com badly scaled" rather than as MatchDeal.
  // It owns its whole viewport and brings its own chrome; nothing from the
  // founder app belongs on top of it.
  //
  // Item 1 (Lote E) — /guest/[token] is the whole point of this bug class:
  // an anonymous visitor with a preview link must never see the founder
  // sidebar (Pipeline/Tasks/Agenda/…, "+ Log interaction") around it.
  // Caught live: without this, /guest rendered wrapped in Shell — page
  // title stayed the layout default, clicks landed on ghost nav elements
  // instead of the page's own CTA button, nothing about the flow worked.
  // "Claim this profile" (2026-08-07) — reached anonymously from
  // /investors; same reasoning as /guest just above.
  //
  // /invite/[token] (accept a team invitation) is opened by a brand-new
  // user with no session yet — same standalone centered-card layout as the
  // auth pages above, and was missing from this list for the same reason
  // /pair was: it renders fine on its own but inherits the founder sidebar
  // (wrong title, ghost nav links that 401/redirect for someone with no
  // org membership yet) when wrapped. Flagged separately from the /guest
  // fix above rather than folded in silently; fixed here.
  if (path === '/' || path === '/investors' || path === '/pair' || isStandaloneAuthPage || path?.startsWith('/guest') || path?.startsWith('/claim') || path?.startsWith('/invite') || path?.startsWith('/portal') || path?.startsWith('/backoffice')) return <>{children}</>;

  // Two item lists from the same `visibleNav`, not one: the sidebar and the
  // mobile bottom nav have always used slightly different active-match
  // rules (startsWith vs exact `path === n.href`), predating this refactor —
  // preserved rather than quietly unified.
  const navItem = (n: typeof visibleNav[number], active: boolean): WorkspaceNavItem => {
    const isAbout = n.href === '/settings';
    const badge = n.href === '/tasks' && pendingRuns > 0 ? pendingRuns
      : n.href === '/messages' && (unreadMessages + unreadSupport) > 0 ? unreadMessages + unreadSupport
      : isAbout && needsReviewCount > 0 ? needsReviewCount
      : undefined;
    return {
      key: n.href, href: n.href, icon: n.icon, active, badge,
      emphasize: isAbout, tourId: n.href === '/readiness' ? 'nav-readiness' : undefined,
      label: isAbout ? aboutLabel : n.label,
    };
  };
  const sidebarItems = visibleNav.map((n) => navItem(n, n.href === '/' ? path === '/' : !!path?.startsWith(n.href)));
  const mobileNavItems = visibleNav.map((n) => navItem(n, path === n.href));

  return (
    <OnboardingProvider>
    {me?.viewer && <DeveloperViewerFrame orgId={me.viewer.orgId} orgName={me.viewer.orgName} />}
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      <WorkspaceSidebar
        brandName={BRAND_NAME}
        subtitle="Investor Relations"
        items={sidebarItems}
        afterItems={
          <>
            <div className="px-3 pt-3">
              <HelpSupportWidget source="founder_app" />
            </div>
            {showBackofficeSwitcher && (
              <>
                <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-gray-300">Platform</div>
                <Tooltip text="Switch to the platform team's console — catalog curation, cross-org queues, no founder pipeline data." side="right" block>
                  <Link href="/backoffice"
                    className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13.5px] text-gray-700 transition hover:bg-gray-100">
                    <span className="w-4 text-center text-gray-400">◉</span> Back-office →
                  </Link>
                </Tooltip>
                {/* Prompt 122 Block A (F0.5) — Metrics promoted out of the
                    Back-office console into this sidebar, immediately below
                    the Back-office link, same platform-admin gate. */}
                <Link href="/metrics"
                  className={`mt-0.5 flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition ${
                    path?.startsWith('/metrics') ? 'bg-[#0E7490] font-medium text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <span className={`w-4 text-center ${path?.startsWith('/metrics') ? '' : 'text-gray-400'}`}>◆</span> Metrics
                </Link>
              </>
            )}
          </>
        }
        footer={
          me?.user ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-gray-700">{me.user.email}</div>
                <div className="text-[10px] uppercase tracking-wide text-[#0E7490]">{me.role}</div>
              </div>
              <LogoutButton className="shrink-0" />
            </div>
          ) : (
            <div className="px-2">
              <div className="text-[11px] font-medium text-gray-500">Seed Round 2026 · €1.3M</div>
              <div className="text-[10px] text-gray-300">{me?.authEnabled === false ? 'Demo mode — data in this browser' : ''}</div>
            </div>
          )
        }
      />

      <div className="flex-1 md:ml-60">
        <WorkspaceHeader
          matchDeal={{ kind: 'startup', tooltip: 'Connect the MatchDeal app — swipe-based matching with investors.' }}
          left={
            <>
              <div className="text-[15px] font-bold text-[#0E7490] md:hidden" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>{db.org.name || BRAND_NAME}</div>
              <div className="hidden items-center gap-2 md:flex">
                <span className="text-sm text-gray-300">Outreach discipline, enforced</span>
              </div>
            </>
          }
          right={
            <>
              <W1Badge />
              <Tooltip text="Outbound messages sent today and this week, against your daily/weekly discipline caps." side="bottom">
                <span className={`rounded-full border border-gray-100 bg-white px-3 py-1 text-xs ${capClass}`}>
                  Today {caps.today}/{caps.dailyCap} · Week {caps.week}/{caps.weeklyCap}
                </span>
              </Tooltip>
              <Tooltip text="Record a new outbound or inbound interaction with an investor." side="bottom">
                <Link href="/log" className="rounded-xl bg-[#0E7490] px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c637b]">
                  + Log interaction
                </Link>
              </Tooltip>
            </>
          }
        />
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>

      <WorkspaceMobileNav ref={mobileNavRef} items={mobileNavItems} />

      <WelcomeModal />
      <ReminderPopup />
      <InvestorInterestPopup />
    </div>
    </OnboardingProvider>
  );
}
