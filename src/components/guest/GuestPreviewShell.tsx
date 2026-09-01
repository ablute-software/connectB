// Prompt 526 Part B — the shell the three preview pages share.
//
// Section 13 of the original request: a guest must be able to move between the
// three preview areas without being thrown back to wherever the email dropped
// them. These are standalone pages rather than the authenticated
// InvestorWorkspaceShell (which assumes a real session in several places), so
// the cheapest way to honour that is a sidebar whose three preview entries are
// REAL links to each other. Only the genuinely gated areas stay frosted;
// navigating between previews is free.
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';

export type PreviewKey = 'pipeline' | 'watson' | 'bars';

export const PREVIEW_NAV: { key: PreviewKey; icon: string; label: string }[] = [
  { key: 'pipeline', icon: '▤', label: 'Pipeline' },
  { key: 'watson', icon: '◈', label: 'Ask Watson' },
  { key: 'bars', icon: '⚖', label: 'Evaluation tools' },
];

// Decorative only, exactly like /guest/[token]'s own sidebar: no hrefs, no
// active state. These are the parts of the workspace a guest genuinely cannot
// reach, so unlike the three above they stay blurred and inert.
const LOCKED_NAV = [
  { icon: '⋯', label: 'About your firm' }, { icon: '⚿', label: 'Access granted' },
  { icon: '◔', label: 'Agenda' }, { icon: '▣', label: 'Archive' },
  { icon: '☎', label: 'Support' }, { icon: '◇', label: 'Plans & billing' },
];

export function GuestPreviewShell({ active, title, subtitle, children }: {
  active: PreviewKey;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-100 bg-white md:flex">
        <div className="px-6 pb-3 pt-6">
          <div className="text-[26px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            {BRAND_NAME}
          </div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300">Investor Workspace</div>
        </div>

        <nav className="mt-1 space-y-0.5 px-3">
          {PREVIEW_NAV.map((n) => (
            <Link key={n.key} href={`/guest/preview/${n.key}`}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] ${
                n.key === active ? 'bg-[#E8F4F8] font-medium text-[#0E7490]' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span className="w-4 text-center">{n.icon}</span>
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>

        <div className="pointer-events-none mt-1 flex-1 select-none space-y-0.5 px-3 pb-4 opacity-50 blur-[1.5px]" aria-hidden="true">
          {LOCKED_NAV.map((n) => (
            <div key={n.label} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-gray-600">
              <span className="w-4 text-center text-gray-400">{n.icon}</span>
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      </aside>

      <main className="md:pl-60">
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
