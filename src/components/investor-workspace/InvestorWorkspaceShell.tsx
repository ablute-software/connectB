'use client';
// Investor Workspace shell (prompt 57), Bloco 1. Mirrors the founder-side
// Shell.tsx visual pattern (sidebar, same border/spacing/active-state
// classes) — a genuinely separate component, not a shared one, since the
// two audiences' nav items don't overlap at all and forcing one shared
// component to serve both would need capability branching throughout.
import { useEffect, useState } from 'react';
import { InvestorProfilePanel } from './InvestorProfilePanel';
import { PipelinePanel } from './PipelinePanel';
import { InvestorAgendaPanel } from './InvestorAgendaPanel';
import { InvestorTodayPanel } from './InvestorTodayPanel';
import { ArchivePanel } from './ArchivePanel';
import { MatchDealPairingModal } from '@/components/matchdeal/MatchDealPairingModal';
import { InvestorPlansPanel } from './InvestorPlansPanel';
import { browserClient } from '@/lib/supabase';
import { IDENTITY_BADGE_CLASS, IDENTITY_BADGE_LABEL, type IdentityStatus } from '@/lib/investor-identity';

type Tab = 'pipeline' | 'about' | 'agenda' | 'today' | 'archive' | 'plans';

const COMPLETENESS_GATE = 50;

export function InvestorWorkspaceShell({
  entityName, startupCard, sessionLabel, openStartup, onOpenStartup, onBackToPipeline,
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
  // rebuilds it. Prompt 121 §2.3 — reflects whichever org PortalPage last
  // fetched via onOpenStartup(orgId), not a single fixed startup anymore.
  startupCard: React.ReactNode;
  sessionLabel: React.ReactNode;
  // Prompt 121 §2.3 — which-org-is-open now lives in PortalPage (it owns
  // the `real` fetch these props ultimately drive), not as local state
  // here: opening a DIFFERENT card needs the parent to refetch, so this
  // shell can no longer just flip a local boolean.
  openStartup: boolean;
  onOpenStartup: (orgId: string) => void;
  onBackToPipeline: () => void;
}) {
  const [tab, setTab] = useState<Tab>('pipeline');
  const [pct, setPct] = useState<number | null>(null);
  const [investorFirmName, setInvestorFirmName] = useState<string | null>(null);
  // Identity verification Fase B (prompt 64), Bloco 1 — the badge lives in
  // the sidebar rather than repeated separately in About/Pipeline/Archive's
  // own headers: it's visible on every tab that way (a superset of what
  // the prompt asked for) for a fraction of the wiring three separate
  // fetches would need.
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus | null>(null);
  const [showMatchDeal, setShowMatchDeal] = useState(false);
  // Top bar activity counter (Bloco 1) — reuses Today's own item list rather
  // than a second aggregation query; a plain count, not a kind-by-kind
  // breakdown, since Today's items already vary in shape per kind and this
  // bar is meant to be a glance, not a summary.
  const [todayCount, setTodayCount] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/portal/today').then((r) => r.json()).then((d) => setTodayCount((d.items ?? []).length)).catch(() => setTodayCount(null));
  }, []);

  const aboutLabel = investorFirmName ? `About ${investorFirmName}` : 'About your firm';
  const gateOpen = pct != null && pct >= COMPLETENESS_GATE;

  const NAV: { key: Tab; label: string; icon: string }[] = [
    { key: 'pipeline', label: 'Pipeline', icon: '▤' },
    { key: 'about', label: aboutLabel, icon: '⋯' },
    { key: 'agenda', label: 'Agenda', icon: '◔' },
    { key: 'today', label: 'Today', icon: '☀' },
    { key: 'archive', label: 'Archive', icon: '▣' },
    { key: 'plans', label: 'Plans & billing', icon: '◈' },
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
        <div className="border-t border-gray-100 px-4 py-3">
          {identityStatus && (
            <span className={`mb-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${IDENTITY_BADGE_CLASS[identityStatus]}`}>
              {IDENTITY_BADGE_LABEL[identityStatus]}
            </span>
          )}
          {sessionLabel}
          {/* BUG-01 — founder shell has always had this; the investor
              shell never did (confirmed by screenshot). Same
              signOut()-then-redirect pattern shell.tsx uses. */}
          <button
            onClick={async () => { try { await browserClient().auth.signOut(); } catch { /* ignore */ } window.location.href = '/login'; }}
            className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50">
            Log out
          </button>
        </div>
      </aside>

      <div className="flex-1 md:ml-60">
        <style>{`
          @keyframes sd-header-shine { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
          @keyframes sd-matchdeal-cycle {
            0%, 20%    { background-color: #3B82F6; }
            33.33%     { background-color: #22C55E; }
            53.33%     { background-color: #22C55E; }
            66.66%     { background-color: #F97316; }
            86.66%     { background-color: #F97316; }
            100%       { background-color: #3B82F6; }
          }
          .sd-matchdeal-shine { animation: sd-header-shine 2.6s ease-in-out infinite; }
          .sd-matchdeal-cycle { animation: sd-matchdeal-cycle 9s ease-in-out infinite; }
        `}</style>
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white/85 px-4 py-2.5 backdrop-blur md:justify-end md:px-8">
          {/* Prompt 90 item 2 — the sidebar (with the only Log out button)
              is `hidden md:flex`: below the md breakpoint there was no way
              to sign out at all, not an intermittent bug but a 100%
              reproducible gap below ~768px. This header, unlike the
              sidebar, already renders at every width, so it's the natural
              place for a mobile-only way out — md:hidden so desktop still
              uses the sidebar's own button, not a duplicate. */}
          <button
            onClick={async () => { try { await browserClient().auth.signOut(); } catch { /* ignore */ } window.location.href = '/login'; }}
            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50 md:hidden"
          >
            Log out
          </button>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowMatchDeal(true)} title="Connect the MatchDeal app — swipe-based matching with startups."
              className="sd-matchdeal-cycle relative flex items-center gap-1.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-[0_10px_24px_rgba(34,197,94,.4)] sm:px-3">
              <span aria-hidden="true" className="sd-matchdeal-shine pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
              <span aria-hidden="true" className="relative text-base leading-none">🤝</span>
              <span className="relative hidden sm:inline">MatchDeal</span>
            </button>
            <span title="Items on your Today tab — new matches, meetings, answers, and closing rounds."
              className="rounded-full border border-gray-100 bg-white px-3 py-1 text-xs text-gray-500">
              {todayCount == null ? 'Today —' : `Today ${todayCount} update${todayCount === 1 ? '' : 's'}`}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl p-4 md:p-8">
          {tab === 'pipeline' && (
            gateOpen ? (
              openStartup ? (
                <div>
                  <button onClick={onBackToPipeline} className="mb-3 text-xs text-gray-400 hover:underline">← Back to Pipeline</button>
                  {startupCard}
                </div>
              ) : (
                <PipelinePanel onOpenStartup={onOpenStartup} />
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
          {tab === 'about' && <InvestorProfilePanel onCompletenessChange={setPct} onEntityNameChange={setInvestorFirmName} onIdentityStatusChange={setIdentityStatus} />}
          {tab === 'agenda' && <InvestorAgendaPanel />}
          {tab === 'today' && <InvestorTodayPanel />}
          {tab === 'archive' && <ArchivePanel />}
          {tab === 'plans' && <InvestorPlansPanel />}
        </main>
      </div>
      {showMatchDeal && <MatchDealPairingModal kind="investor" onClose={() => setShowMatchDeal(false)} />}
    </div>
  );
}
