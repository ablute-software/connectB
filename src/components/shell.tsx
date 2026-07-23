'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { outboundCounts } from '@/lib/rules';
import { browserClient } from '@/lib/supabase';
import { Tooltip } from '@/components/ui';

type Me = {
  authEnabled: boolean; user: { email?: string } | null; role: string;
  capabilities?: { ai: boolean; companyCanon: boolean; needsReviewAi: boolean; documentDetails: boolean; ndaSystem: boolean; entityContactFields: boolean; reviewRuns: boolean; permissionMatrix: boolean; documentOrdering: boolean; documentVersions: boolean; reawakening: boolean; planAccounts: boolean; billing: boolean };
};

const NAV: { href: string; label: string; icon: string; section?: string; requiresCapability?: 'companyCanon' }[] = [
  { href: '/', label: 'Pipeline', icon: '▤', section: 'Workspace' },
  { href: '/today', label: 'Today', icon: '☀' },
  { href: '/agenda', label: 'Agenda', icon: '▦' },
  { href: '/dashboard', label: 'Dashboard', icon: '◔' },
  // Batch 3 A — the /company route is now "Review & Optimization": AI
  // review, deck/one-pager review, the startup's market benchmarking, and
  // the investability ranking. Still gated on the companyCanon capability
  // (migration 0020) since the ranking grounds on confirmed canon facts.
  { href: '/company', label: 'Review & Optimization', icon: '◆', requiresCapability: 'companyCanon' },
  { href: '/documents', label: 'Data Room', icon: '▣', section: 'Sharing' },
  { href: '/import', label: 'Import history', icon: '⇪' },
  { href: '/needs-review', label: 'Needs review', icon: '◑' },
  { href: '/packs', label: 'Packs', icon: '◈', section: 'Growth' },
  { href: '/outbox', label: 'Outbox', icon: '✉', section: 'Automation' },
  // Automations moved INTO Settings (batch 3 A); the /automations route
  // still works for direct links but is no longer a top-level nav item.
  { href: '/settings', label: 'Settings', icon: '⋯' },
  // Plans & Account batch — visible to everyone (free plans especially, to
  // upgrade). Not capability-gated: the page degrades gracefully pre-migration.
  { href: '/plans', label: 'Planos e conta', icon: '◇' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { db } = useStore();
  const caps = outboundCounts(db);
  const pendingRuns = db.runs.filter((r) => r.status === 'pending_review').length;
  const needsReviewCount = db.interactions.filter((i) => i.needs_review).length;
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false, user: null, role: 'none' }));
  }, []);

  async function logout() {
    try { await browserClient().auth.signOut(); } catch { /* ignore */ }
    window.location.href = '/login';
  }

  // Dual-role (e.g. Nuno: founder of ablute_ AND platform admin) gets a
  // switcher into the fully separate back-office console (own layout/chrome
  // — see src/app/backoffice/layout.tsx). Founders without platform_admin
  // never see this at all, per BLOCO 3's "separar completamente" ask.
  const showBackofficeSwitcher = me?.role === 'developer';
  const visibleNav = NAV.filter((n) => !n.requiresCapability || !!me?.capabilities?.[n.requiresCapability]);
  const capClass =
    caps.today >= caps.dailyCap || caps.week >= caps.weeklyCap ? 'text-[#B00000] font-semibold'
      : caps.today === caps.dailyCap - 1 || caps.week === caps.weeklyCap - 1 ? 'text-amber-600 font-semibold'
      : 'text-gray-400';

  if (path?.startsWith('/portal') || path?.startsWith('/backoffice')) return <>{children}</>;

  return (
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-100 bg-white md:flex">
        <div className="px-6 pb-3 pt-6">
          <div className="text-[26px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            connect<span className="text-[#22D3EE]">B</span>
          </div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300">Investor Relations</div>
        </div>
        <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {visibleNav.map((n) => {
            const active = n.href === '/' ? path === '/' : path?.startsWith(n.href);
            return (
              <React.Fragment key={n.href}>
                {n.section && (
                  <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-gray-300">{n.section}</div>
                )}
                <Link href={n.href}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition ${
                    active ? 'bg-[#0E7490] font-medium text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <span className={`w-4 text-center ${active ? '' : 'text-gray-400'}`}>{n.icon}</span> {n.label}
                  {n.href === '/outbox' && pendingRuns > 0 && (
                    <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-white">{pendingRuns}</span>
                  )}
                  {n.href === '/needs-review' && needsReviewCount > 0 && (
                    <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-white">{needsReviewCount}</span>
                  )}
                </Link>
              </React.Fragment>
            );
          })}
          {showBackofficeSwitcher && (
            <>
              <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-gray-300">Platform</div>
              <Tooltip text="Switch to the platform team's console — catalog curation, cross-org queues, no founder pipeline data." side="right" block>
                <Link href="/backoffice"
                  className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13.5px] text-gray-700 transition hover:bg-gray-100">
                  <span className="w-4 text-center text-gray-400">◉</span> Back-office →
                </Link>
              </Tooltip>
            </>
          )}
        </nav>
        <div className="border-t border-gray-100 px-4 py-3">
          {me?.user ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-gray-700">{me.user.email}</div>
                <div className="text-[10px] uppercase tracking-wide text-[#0E7490]">{me.role}</div>
              </div>
              <button onClick={logout} className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50">Log out</button>
            </div>
          ) : (
            <div className="px-2">
              <div className="text-[11px] font-medium text-gray-500">Seed Round 2026 · €1.3M</div>
              <div className="text-[10px] text-gray-300">{me?.authEnabled === false ? 'Demo mode — data in this browser' : ''}</div>
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 md:ml-60">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/85 px-4 py-2.5 backdrop-blur md:px-8">
          <div className="text-[15px] font-bold text-[#0E7490] md:hidden" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>{db.org.name || 'connectB'}</div>
          <div className="hidden items-center gap-2 md:flex">
            <span className="text-sm text-gray-300">Outreach discipline, enforced</span>
          </div>
          <div className="flex items-center gap-4">
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
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-gray-100 bg-white py-1.5 md:hidden">
        {visibleNav.slice(0, 5).map((n) => (
          <Link key={n.href} href={n.href} className={`px-2 py-1 text-xs ${path === n.href ? 'font-semibold text-[#0E7490]' : 'text-gray-400'}`}>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
