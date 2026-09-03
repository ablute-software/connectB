// Prompt 526 Part B / Prompt 548 — the shell every guest screen shares.
//
// 526 gave it three preview links and a blurred, inert imitation of the rest
// of the workspace. That imitation was hand-typed, so it rotted: it still
// said "Access granted" two prompts after the product renamed that entry to
// "Data room", and it was missing Dashboard, Actions required, My Network
// and Messages. A guest could click nothing, and what they could not click
// was not even the product as it exists.
//
// 548 makes the sidebar the real one: it renders INVESTOR_NAV — the same
// list the authenticated InvestorWorkspaceShell builds its own nav from — so
// the two cannot drift again. Every entry is a live link. Nothing here is
// frosted; the frost belongs on the CONTENT of each preview, which is where
// the gate actually is.
//
// This is a standalone shell rather than the authenticated one because
// InvestorWorkspaceShell assumes a real session in several places. What it
// shares with it is the list, not the machinery.
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { INVESTOR_NAV } from '@/lib/investor-nav';
import { guestNavHref } from '@/lib/guest-previews';

export function GuestPreviewShell({ active, token, title, subtitle, children }: {
  /** The nav key of the screen being shown; 'access' on the share itself. */
  active: string;
  /** Present when the visitor came from a real share — it buys them the way back. */
  token?: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  // Without a token there is no Data room to return to, so that entry is
  // absent rather than dead (guestNavHref returns null for it).
  const entries = INVESTOR_NAV
    .map((n) => ({ ...n, href: guestNavHref(n.key, token) }))
    .filter((n): n is typeof n & { href: string } => n.href !== null);

  return (
    <div className="min-h-screen bg-gray-50">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-100 bg-white md:flex">
        <div className="px-6 pb-3 pt-6">
          <div className="text-[26px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            {BRAND_NAME}
          </div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300">Investor Workspace</div>
        </div>

        <nav className="mt-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {entries.map((n, i) => (
            <div key={n.key}>
              {/* A separator wherever the group changes — the same grouping
                  the real workspace draws. */}
              {i > 0 && entries[i - 1].group !== n.group && <div className="my-1.5 border-t border-gray-100" />}
              <Link href={n.href}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] ${
                  n.key === active ? 'bg-[#E8F4F8] font-medium text-[#0E7490]' : 'text-gray-600 hover:bg-gray-50'}`}>
                <span className="w-4 text-center">{n.icon}</span>
                <span>{n.label}</span>
              </Link>
            </div>
          ))}
        </nav>
      </aside>

      <main className="md:pl-60">
        {/* Prompt 548 Part 5 — the sidebar is md-only, so on a phone a guest
            had nothing to click at all. Same entries, same order, as a
            scrollable strip. No drawer, no new component library. */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white md:hidden">
          <div className="px-4 pb-2 pt-4 text-[22px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            {BRAND_NAME}
          </div>
          <nav aria-label="Investor workspace" className="flex gap-1.5 overflow-x-auto px-4 pb-2.5">
            {entries.map((n) => (
              <Link key={n.key} href={n.href}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                  n.key === active ? 'bg-[#0E7490] font-medium text-white' : 'bg-gray-100 text-gray-600'}`}>
                <span>{n.icon}</span>
                <span>{n.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="mx-auto max-w-4xl p-6">
          <header className="mb-4">
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
            <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
          </header>
          {children}
          <p className="mt-6 text-center text-xs text-gray-400">
            This is a preview of {BRAND_NAME} for investors. No startup&apos;s data is shown here.
          </p>
        </div>
      </main>
    </div>
  );
}
