'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { outboundCounts } from '@/lib/rules';
import { browserClient } from '@/lib/supabase';

type Me = { authEnabled: boolean; user: { email?: string } | null; role: string };

const NAV: { href: string; label: string; icon: string; section?: string }[] = [
  { href: '/', label: 'Pipeline', icon: '▤', section: 'Workspace' },
  { href: '/today', label: 'Today', icon: '☀' },
  { href: '/agenda', label: 'Agenda', icon: '▦' },
  { href: '/dashboard', label: 'Dashboard', icon: '◔' },
  { href: '/documents', label: 'Data Room', icon: '▣', section: 'Sharing' },
  { href: '/packs', label: 'Packs', icon: '◈', section: 'Growth' },
  { href: '/outbox', label: 'Outbox', icon: '✉', section: 'Automation' },
  { href: '/automations', label: 'Automations', icon: '⚙' },
  { href: '/backoffice', label: 'Back-office', icon: '◉', section: 'Platform' },
  { href: '/settings', label: 'Settings', icon: '⋯' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { db } = useStore();
  const caps = outboundCounts(db);
  const pendingRuns = db.runs.filter((r) => r.status === 'pending_review').length;
  const pendingSubs = db.submissions.filter((s) => s.status === 'pending_review').length;
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false, user: null, role: 'none' }));
  }, []);

  async function logout() {
    try { await browserClient().auth.signOut(); } catch { /* ignore */ }
    window.location.href = '/login';
  }

  // Developers see the platform back-office; founders don't.
  const showBackoffice = !me?.authEnabled || me?.role === 'developer';
  const capClass =
    caps.today >= caps.dailyCap || caps.week >= caps.weeklyCap ? 'text-[#B00000] font-semibold'
      : caps.today === caps.dailyCap - 1 || caps.week === caps.weeklyCap - 1 ? 'text-amber-600 font-semibold'
      : 'text-gray-400';

  if (path?.startsWith('/portal')) return <>{children}</>;

  return (
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-100 bg-white md:flex">
        <div className="px-6 pb-3 pt-6">
          <div className="text-[26px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            connect<span className="text-[#22D3EE]">B</span>
          </div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300">Investor CRM</div>
        </div>
        <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.filter((n) => n.href !== '/backoffice' || showBackoffice).map((n) => {
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
                  {n.href === '/backoffice' && pendingSubs > 0 && (
                    <span className="ml-auto rounded-full bg-gray-900 px-1.5 text-[10px] font-bold text-white">{pendingSubs}</span>
                  )}
                </Link>
              </React.Fragment>
            );
          })}
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
          <div className="text-[15px] font-bold text-[#0E7490] md:hidden" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>ablute_</div>
          <div className="hidden items-center gap-2 md:flex">
            <span className="text-sm text-gray-300">Outreach discipline, enforced</span>
          </div>
          <div className="flex items-center gap-4">
            <span className={`rounded-full border border-gray-100 bg-white px-3 py-1 text-xs ${capClass}`}>
              Today {caps.today}/{caps.dailyCap} · Week {caps.week}/{caps.weeklyCap}
            </span>
            <Link href="/log" className="rounded-xl bg-[#0E7490] px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c637b]">
              + Log interaction
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-gray-100 bg-white py-1.5 md:hidden">
        {NAV.slice(0, 5).map((n) => (
          <Link key={n.href} href={n.href} className={`px-2 py-1 text-xs ${path === n.href ? 'font-semibold text-[#0E7490]' : 'text-gray-400'}`}>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
