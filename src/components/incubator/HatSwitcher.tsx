'use client';
// Prompt I-01 §B.4 — the minimal hat switcher: no new page, no stored
// preference. Each shell shows links to the OTHER workspaces this account can
// open (from /api/me's `hats`). Landing order stays decideRole's
// (founder > incubator > investor); this only makes the rest reachable.
import Link from 'next/link';
import { useEffect, useState } from 'react';

export interface Hats { founder: boolean; incubator: boolean; investor: boolean }
type Hat = keyof Hats;

const TARGETS: Record<Hat, { href: string; label: string }> = {
  founder: { href: '/pipeline', label: 'Founder workspace' },
  incubator: { href: '/ecosystem', label: 'Ecosystem workspace' },
  investor: { href: '/portal', label: 'Investor portal' },
};

export function HatSwitcher({ current, hats: given, tone = 'light' }: { current: Hat; hats?: Hats | null; tone?: 'light' | 'dark' }) {
  const [hats, setHats] = useState<Hats | null>(given ?? null);
  useEffect(() => {
    if (given !== undefined) { setHats(given); return; }
    fetch('/api/me').then((r) => r.json()).then((me) => setHats(me?.hats ?? null)).catch(() => setHats(null));
  }, [given]);

  const others = (Object.keys(TARGETS) as Hat[]).filter((h) => h !== current && hats?.[h]);
  if (others.length === 0) return null;
  return (
    <div className="px-1 pt-3" data-testid="hat-switcher">
      <div className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest ${tone === 'dark' ? 'text-gray-500' : 'text-gray-300'}`}>Switch to</div>
      {others.map((h) => (
        <Link key={h} href={TARGETS[h].href}
          className="mb-1 flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13.5px] text-gray-700 transition hover:bg-gray-100">
          <span className="w-4 text-center text-gray-400">⇄</span> {TARGETS[h].label}
        </Link>
      ))}
    </div>
  );
}
