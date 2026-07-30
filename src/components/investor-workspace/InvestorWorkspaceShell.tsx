'use client';
// Investor Workspace shell (prompt 57), Bloco 1. Mirrors the founder-side
// Shell.tsx visual pattern (sidebar, same border/spacing/active-state
// classes) — a genuinely separate component, not a shared one, since the
// two audiences' nav items don't overlap at all and forcing one shared
// component to serve both would need capability branching throughout.
import { useState } from 'react';
import { InvestorProfilePanel } from './InvestorProfilePanel';

type Tab = 'pipeline' | 'about' | 'agenda' | 'today' | 'archive';

const COMPLETENESS_GATE = 50;

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="mt-16 text-center text-sm text-gray-400">
      <p className="text-lg font-semibold text-gray-300">{label}</p>
      <p className="mt-1">Coming soon.</p>
    </div>
  );
}

export function InvestorWorkspaceShell({
  entityName, startupCard, sessionLabel,
}: {
  // The startup shown in the Pipeline tab (ablute_ today) — NOT the
  // investor's own firm. Kept as a separate concept from the About tab's
  // label, which comes from the investor's own linked catalog entity
  // (fetched inside InvestorProfilePanel, not known by this shell until
  // it reports back via onEntityNameChange).
  entityName: string | null;
  // The existing snapshot + ticket selector + data room content (built in
  // Prompt 54) — rendered as-is inside the Pipeline tab once a card is
  // opened. Prompts 55/56 extend that same screen; this shell never
  // rebuilds it.
  startupCard: React.ReactNode;
  sessionLabel: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('pipeline');
  const [pct, setPct] = useState<number | null>(null);
  const [openStartup, setOpenStartup] = useState(false);
  const [investorFirmName, setInvestorFirmName] = useState<string | null>(null);

  const aboutLabel = investorFirmName ? `About ${investorFirmName}` : 'About your firm';
  const gateOpen = pct != null && pct >= COMPLETENESS_GATE;

  const NAV: { key: Tab; label: string; icon: string }[] = [
    { key: 'pipeline', label: 'Pipeline', icon: '▤' },
    { key: 'about', label: aboutLabel, icon: '⋯' },
    { key: 'agenda', label: 'Agenda', icon: '◔' },
    { key: 'today', label: 'Today', icon: '☀' },
    { key: 'archive', label: 'Archive', icon: '▣' },
  ];

  return (
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-100 bg-white md:flex">
        <div className="px-6 pb-3 pt-6">
          <div className="text-[26px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            Sherlock Deal
          </div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300">Investor Workspace</div>
        </div>
        <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.map((n) => (
            <button key={n.key} onClick={() => setTab(n.key)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] transition ${
                tab === n.key ? 'bg-[#0E7490] font-medium text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span className={`w-4 text-center ${tab === n.key ? '' : 'text-gray-400'}`}>{n.icon}</span>
              <span className={n.key === 'about' ? 'font-semibold tracking-wide' : undefined}>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="border-t border-gray-100 px-4 py-3">{sessionLabel}</div>
      </aside>

      <div className="flex-1 md:ml-60">
        <main className="mx-auto max-w-3xl p-4 md:p-8">
          {tab === 'pipeline' && (
            gateOpen ? (
              openStartup ? (
                <div>
                  <button onClick={() => setOpenStartup(false)} className="mb-3 text-xs text-gray-400 hover:underline">← Back to Pipeline</button>
                  {startupCard}
                </div>
              ) : (
                <div className="space-y-3">
                  <h1 className="text-lg font-bold text-gray-900">Pipeline</h1>
                  <button onClick={() => setOpenStartup(true)}
                    className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left transition hover:border-[#0E7490]">
                    <div className="text-sm font-semibold text-gray-900">{entityName ?? 'ablute_'}</div>
                    <div className="mt-0.5 text-xs text-gray-400">Open data room →</div>
                  </button>
                </div>
              )
            ) : (
              <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
                <p className="text-sm text-gray-600">Complete your investor profile to start receiving startups matched to your thesis.</p>
                <button onClick={() => setTab('about')} className="mt-4 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
                  Go to About
                </button>
              </div>
            )
          )}
          {tab === 'about' && <InvestorProfilePanel onCompletenessChange={setPct} onEntityNameChange={setInvestorFirmName} />}
          {tab === 'agenda' && <ComingSoon label="Agenda" />}
          {tab === 'today' && <ComingSoon label="Today" />}
          {tab === 'archive' && <ComingSoon label="Archive" />}
        </main>
      </div>
    </div>
  );
}
