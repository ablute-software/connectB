'use client';
// Prompt 294 — backoffice redesigned as its own app: a fixed left sidebar
// replaces the single-row top nav (BLOCO 3's original shell), which had
// no room left to grow and no hierarchy between daily tools and
// once-a-quarter ones. Built on the published mockup
// (https://claude.ai/code/artifact/44abb39a-04d4-478e-9368-0e0d82f8fb6b,
// "Main.dc.html"/"Costs.dc.html" artboards) — icons/copy/structure lifted
// directly from that source rather than reinvented, per the prompt's own
// "decisão já tomada, não é para parar a meio a perguntar" instruction.
//
// Auth/redirect logic (below) is untouched from the original shell — this
// prompt is presentation only. Built on its own branch (backoffice-
// redesign) per the prompt's explicit request, not merged here.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogoLockup } from '@/components/Logo';
import { useUsageHeartbeat } from '@/lib/use-usage-heartbeat';

type IconSvg = React.ReactNode;

// Prompt 294 — every path copied verbatim from the mockup's own inline
// icon set (Costs.dc.html script block), not redrawn freehand, so the
// sidebar's visual language matches the approved design exactly.
function Icon({ children }: { children: IconSvg }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const ICONS = {
  today: <Icon><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Icon>,
  queue: <Icon><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" /></Icon>,
  catalog: <Icon><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></Icon>,
  investors: <Icon><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Icon>,
  startups: <Icon><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></Icon>,
  support: <Icon><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Icon>,
  costs: <Icon><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></Icon>,
  promo: <Icon><path d="M20.59 13.41 11 22l-9-9L11 3l9.59 9.59a2 2 0 0 1 0 2.82z" /><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" /></Icon>,
  plans: <Icon><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Icon>,
};

// Prompt 294 §Pedido 3 — grouping by measured frequency, not the mockup's
// fixed split verbatim: Queue is the review inbox a developer opens
// repeatedly through the day (contributions/candidates/submissions/claims/
// fraud/etc. all live there), arguably more often than Today's own
// dashboard — kept first in the primary group for that reason. Catalog/
// Investors/Startups/Support are the other daily-use surfaces. AI Costs,
// Promo Codes, and Plan Requests are genuinely occasional (checked
// weekly/monthly, not multiple times a day) — the mockup's own split,
// kept as-is since nothing here suggested a different order was truer.
const PRIMARY_NAV = [
  { href: '/backoffice', label: 'Today', icon: ICONS.today },
  { href: '/backoffice/queue', label: 'Queue', icon: ICONS.queue },
  { href: '/backoffice/catalog', label: 'Catalog', icon: ICONS.catalog },
  { href: '/backoffice/investors', label: 'Investors', icon: ICONS.investors },
  { href: '/backoffice/startups', label: 'Startups', icon: ICONS.startups },
  { href: '/backoffice/support', label: 'Support', icon: ICONS.support },
];
const SECONDARY_NAV = [
  { href: '/backoffice/costs', label: 'AI Costs', icon: ICONS.costs },
  { href: '/backoffice/promo-codes', label: 'Promo Codes & Offers', icon: ICONS.promo },
  { href: '/backoffice/plan-requests', label: 'Plan Requests', icon: ICONS.plans },
];

function initialsFor(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ authEnabled: boolean; role: string; orgRole?: string | null; user?: { email: string } } | null>(null);
  const [supportBadge, setSupportBadge] = useState(0);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false, role: 'none' }));
  }, []);

  // Prompt 295 §1 — separate context from the founder shell's own 'crm'
  // heartbeat: a dual-role account (Nuno) genuinely uses two different
  // shells, and this table should be able to tell them apart.
  useUsageHeartbeat({ context: 'backoffice', enabled: me?.authEnabled === true && me?.role === 'developer' });

  useEffect(() => {
    if (me?.authEnabled === false || me?.role !== 'developer') return;
    fetch('/api/backoffice/support').then((r) => r.json()).then((body) => {
      if (body.ok) setSupportBadge(body.counts.navBadge as number);
    }).catch(() => {});
  }, [me]);

  useEffect(() => {
    if (me && me.authEnabled && me.role !== 'developer') router.replace('/pipeline');
  }, [me, router]);

  if (me?.authEnabled && me.role !== 'developer') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">403 — platform admin only.</div>;
  }

  function isActive(href: string) {
    return href === '/backoffice' ? path === '/backoffice' : path?.startsWith(href);
  }

  const email = me?.user?.email ?? '';

  return (
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      {/* Sidebar — fixed width, dark gradient, matches the mockup's own
          Main.dc.html/Costs.dc.html sidebar exactly. */}
      <aside className="flex w-[236px] min-w-[236px] flex-col p-3.5" style={{ background: 'linear-gradient(180deg,#111827 0%,#0b1220 100%)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 px-2 pb-5 pt-1.5">
          <LogoLockup size={30} accentClassName="text-[#22D3EE]" />
        </div>

        <nav className="flex flex-col gap-0.5">
          {PRIMARY_NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-semibold transition ${
                  active ? 'bg-[rgba(34,211,238,0.12)] text-white ring-1 ring-[rgba(34,211,238,0.25)]' : 'text-[#cbd2db] hover:bg-white/[0.08]'}`}>
                <span className={active ? 'text-[#22D3EE]' : 'text-[#8b95a3]'}>{n.icon}</span>
                <span className="flex-grow">{n.label}</span>
                {n.href === '/backoffice/support' && supportBadge > 0 && (
                  <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{supportBadge}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="my-4 mx-1.5 h-px bg-white/[0.08]" />
        <div className="px-2.5 pb-2 text-[10px] font-bold uppercase tracking-wide text-[#5b6472]">Occasional</div>
        <nav className="flex flex-col gap-px">
          {SECONDARY_NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-[12.5px] font-medium transition ${
                  active ? 'bg-[rgba(34,211,238,0.12)] text-white ring-1 ring-[rgba(34,211,238,0.25)]' : 'text-[#8b95a3] hover:bg-white/[0.08]'}`}>
                <span className={active ? 'text-[#22D3EE]' : 'text-[#6b7383]'}>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-grow" />

        {email && (
          <div className="flex items-center gap-2.5 border-t border-white/[0.08] pl-2 pt-3">
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#0E7490] text-[11px] font-bold text-white">
              {initialsFor(email)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-gray-200">{email}</div>
              <Link href="/pipeline" className="text-[11px] text-[#7dd3e0] hover:underline">← Founder view</Link>
            </div>
          </div>
        )}
      </aside>

      <main className="min-w-0 flex-grow p-4 md:p-8">{children}</main>
    </div>
  );
}
