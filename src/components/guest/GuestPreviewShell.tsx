'use client';
// Prompt 526 Part B — the frame the three preview screens share.
//
// NAVIGATION, per the original request's section 13: a guest who arrives from
// one email CTA must be able to move between the three areas without being
// thrown back to where they landed. So the sidebar here is NOT the fully
// decorative one from /guest/[token] — the three preview links are REAL and
// clickable, and only the rest of the workspace stays behind glass. Only
// genuinely protected areas (real data) are locked; moving between previews
// is free.
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { PREVIEWS, type PreviewKey } from '@/lib/guest-previews';
import { FrostedContent } from './FrostedOverlay';

// The workspace items a guest cannot reach at all. Decorative only — same
// treatment as /guest/[token]'s sidebar, and deliberately NOT links.
const LOCKED_NAV = [
  { icon: '⋯', label: 'About your firm' }, { icon: '⚿', label: 'Access granted' },
  { icon: '◔', label: 'Agenda' }, { icon: '▣', label: 'Archive' },
  { icon: '☎', label: 'Support' }, { icon: '◈', label: 'Plans & billing' },
];

export function GuestPreviewShell({ active, children }: { active: PreviewKey; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-100 bg-white md:flex">
        <div className="px-6 pb-3 pt-6">
          <div className="text-[26px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            {BRAND_NAME}
          </div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300">Investor Workspace</div>
        </div>

        <nav className="mt-1 space-y-0.5 px-3">
          {PREVIEWS.map((p) => (
            <Link key={p.key} href={p.href}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] ${
                p.key === active ? 'bg-[#0E7490]/10 font-semibold text-[#0E7490]' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span className="w-4 text-center">{p.icon}</span>
              <span>{p.label}</span>
            </Link>
          ))}
        </nav>

        {/* Everything below the line is out of reach until there is an
            account — shown, blurred, so the guest can see the shape of what
            they would get rather than a truncated menu. */}
        <div className="mx-3 my-3 border-t border-gray-100" />
        <FrostedContent className="flex-1">
          <nav className="space-y-0.5 px-3 pb-4">
          {LOCKED_NAV.map((n) => (
            <div key={n.label} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-gray-600">
              <span className="w-4 text-center text-gray-400">{n.icon}</span>
              <span>{n.label}</span>
            </div>
          ))}
          </nav>
        </FrostedContent>
      </aside>

      <main className="flex-1 px-4 py-6 md:ml-60 md:px-8">
        <div className="mx-auto max-w-5xl">
          {/* Mobile: the sidebar is hidden below md, so the three links need
              somewhere else to live or the guest is stuck on one preview. */}
          <nav className="mb-4 flex gap-2 md:hidden">
            {PREVIEWS.map((p) => (
              <Link key={p.key} href={p.href}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  p.key === active ? 'border-[#0E7490] bg-[#0E7490]/10 text-[#0E7490]' : 'border-gray-200 text-gray-600'}`}>
                {p.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </main>
    </div>
  );
}
