'use client';
// BLOCO 3 — the back-office console gets its OWN chrome, completely
// separate from the founder Shell (src/components/shell.tsx early-returns
// bare children for this route). Zero founder nav items, dark "PLATFORM"
// header so a dual-role user (Nuno: founder of ablute_ AND platform admin)
// never confuses which view they're in. Client-side redirect here is a UX
// nicety only — the real 403 is enforced server-side in middleware.ts and
// independently in every /api/backoffice/* route (requirePlatformAdmin()).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  { href: '/backoffice', label: 'Hoje' },
  { href: '/backoffice/queue', label: 'Fila' },
  { href: '/backoffice/catalog', label: 'Catálogo' },
  { href: '/backoffice/startups', label: 'Startups' },
  { href: '/backoffice/metrics', label: 'Métricas' },
];

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ authEnabled: boolean; role: string; orgRole?: string | null } | null>(null);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false, role: 'none' }));
  }, []);

  useEffect(() => {
    if (me && me.authEnabled && me.role !== 'developer') router.replace('/');
  }, [me, router]);

  if (me?.authEnabled && me.role !== 'developer') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">403 — platform admin only.</div>;
  }

  return (
    <div className="min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      <header className="border-b border-gray-800 bg-gray-900 px-4 py-3 md:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-[17px] font-bold leading-none tracking-tight text-white" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
              connect<span className="text-cyan-400">B</span>
            </div>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-300">Platform</span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => {
              const active = n.href === '/backoffice' ? path === '/backoffice' : path?.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                    active ? 'bg-white text-gray-900' : 'text-gray-300 hover:bg-white/10'}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          {me?.orgRole && (
            <Link href="/" className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-white/10">
              ← ablute_ (founder)
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
    </div>
  );
}
