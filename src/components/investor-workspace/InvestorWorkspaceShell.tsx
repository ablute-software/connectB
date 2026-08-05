'use client';
// Investor Workspace shell (prompt 57), Bloco 1. Mirrors the founder-side
// Shell.tsx visual pattern (sidebar, same border/spacing/active-state
// classes) — a genuinely separate component, not a shared one, since the
// two audiences' nav items don't overlap at all and forcing one shared
// component to serve both would need capability branching throughout.
import { useEffect, useState } from 'react';
import { InvestorProfilePanel, type ProfileResponse } from './InvestorProfilePanel';
import { PipelinePanel } from './PipelinePanel';
import { InvestorAgendaPanel } from './InvestorAgendaPanel';
import { InvestorTodayPanel } from './InvestorTodayPanel';
import { ArchivePanel } from './ArchivePanel';
import { AccessGrantedPanel } from './AccessGrantedPanel';
import { InvestorPlansPanel } from './InvestorPlansPanel';
import { EvaluationToolsPanel } from './EvaluationToolsPanel';
import { IDENTITY_BADGE_CLASS, IDENTITY_BADGE_LABEL, type IdentityStatus } from '@/lib/investor-identity';
import { OnboardingProvider } from '@/lib/onboarding/OnboardingProvider';
import { PageTour } from '@/components/onboarding/PageTour';
import { PageGuideButton } from '@/components/onboarding/PageGuideButton';
import { WorkspaceSidebar } from '@/components/workspace-shell/WorkspaceSidebar';
import { WorkspaceMobileNav } from '@/components/workspace-shell/WorkspaceMobileNav';
import { WorkspaceHeader } from '@/components/workspace-shell/WorkspaceHeader';
import { LogoutButton } from '@/components/workspace-shell/LogoutButton';
import { EmptyState } from '@/components/workspace-shell/EmptyState';
import type { WorkspaceNavItem } from '@/components/workspace-shell/types';
import { BRAND_NAME } from '@/lib/brand';

type Tab = 'pipeline' | 'about' | 'access' | 'agenda' | 'today' | 'archive' | 'plans' | 'evaluation';

const COMPLETENESS_GATE = 50;

// Prompt 121 §2.1 — the investor shell never had the tour/tooltip system at
// all (confirmed: zero data-tour-id/tour references before this). Copies
// the founder side's own per-tab-guide pattern (documents/page.tsx's
// guide_documents/guide_people_access split) rather than inventing a tour
// that spans multiple tabs at once — anchors only resolve against the
// current DOM, so a guide can't reach across tabs that aren't mounted.
const TOUR_KEY_BY_TAB: Partial<Record<Tab, string>> = {
  pipeline: 'guide_investor_pipeline', about: 'guide_investor_about', access: 'guide_investor_access', plans: 'guide_investor_plans',
};

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
  // P131-B — set when a Pipeline card's "Ownership calculator" shortcut is
  // clicked, so Evaluation tools opens with that startup already selected
  // instead of the investor having to find it again in a dropdown.
  const [evaluationTargetOrgId, setEvaluationTargetOrgId] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [investorFirmName, setInvestorFirmName] = useState<string | null>(null);
  // Identity verification Fase B (prompt 64), Bloco 1 — the badge lives in
  // the sidebar rather than repeated separately in About/Pipeline/Archive's
  // own headers: it's visible on every tab that way (a superset of what
  // the prompt asked for) for a fraction of the wiring three separate
  // fetches would need.
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus | null>(null);
  // Top bar activity counter (Bloco 1) — reuses Today's own item list rather
  // than a second aggregation query; a plain count, not a kind-by-kind
  // breakdown, since Today's items already vary in shape per kind and this
  // bar is meant to be a glance, not a summary.
  const [todayCount, setTodayCount] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/portal/today').then((r) => r.json()).then((d) => setTodayCount((d.items ?? []).length)).catch(() => setTodayCount(null));
  }, []);

  // Bug fix (2026-08-05) — pct/investorFirmName/identityStatus used to be
  // filled ONLY by InvestorProfilePanel, which only ever mounts once the
  // About tab is selected. Since the initial tab is always 'pipeline', pct
  // stayed null on first render for every investor, every session — a
  // 100%-complete profile still hit the "Complete your investor profile"
  // gate below until the investor happened to click About once. This shell
  // now fetches the same endpoint itself on mount, independent of which tab
  // is active; InvestorProfilePanel still does its own fetch when it
  // mounts (unchanged), it's just no longer the only source of this state.
  useEffect(() => {
    fetch('/api/portal/investor-profile').then((r) => r.json()).then((d: ProfileResponse) => {
      if (d.completeness != null) setPct(d.completeness);
      setInvestorFirmName(d.linked ? d.entityName ?? null : null);
      setIdentityStatus(d.linked ? d.identityStatus ?? null : null);
    }).catch(() => {});
  }, []);

  const aboutLabel = investorFirmName ? `About ${investorFirmName}` : 'About your firm';
  const gateOpen = pct != null && pct >= COMPLETENESS_GATE;

  const NAV: { key: Tab; label: string; icon: string }[] = [
    { key: 'pipeline', label: 'Pipeline', icon: '▤' },
    { key: 'about', label: aboutLabel, icon: '⋯' },
    // Prompt 121 §2.5 — new entry; access to documents used to live only
    // inside the Pipeline tab's startup card, with no page of its own.
    { key: 'access', label: 'Access granted', icon: '⚿' },
    // P131-B — Ownership calculator (promoted from a per-card button to a
    // real page) + Equity simulator, structured to grow with more tools.
    { key: 'evaluation', label: 'Evaluation tools', icon: '⚖' },
    { key: 'agenda', label: 'Agenda', icon: '◔' },
    { key: 'today', label: 'Today', icon: '☀' },
    { key: 'archive', label: 'Archive', icon: '▣' },
    { key: 'plans', label: 'Plans & billing', icon: '◈' },
  ];

  const tourKey = TOUR_KEY_BY_TAB[tab];
  // Same item list drives both the desktop sidebar and the mobile bottom
  // nav — unlike shell.tsx's founder side, active-state here is always
  // `tab === key` regardless of which one is rendering, so there's no need
  // for two separately-computed arrays.
  const navItems: WorkspaceNavItem[] = NAV.map((n) => ({
    key: n.key, icon: n.icon, label: n.label,
    active: tab === n.key, emphasize: n.key === 'about',
    onSelect: () => setTab(n.key),
  }));

  return (
    <OnboardingProvider>
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      {tourKey && <PageTour pageKey={tourKey} />}
      <WorkspaceSidebar
        brandName={BRAND_NAME}
        subtitle="Investor Workspace"
        items={navItems}
        footer={
          <>
            {identityStatus && (
              <span className={`mb-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${IDENTITY_BADGE_CLASS[identityStatus]}`}>
                {IDENTITY_BADGE_LABEL[identityStatus]}
              </span>
            )}
            {sessionLabel}
            {/* BUG-01 — founder shell has always had this; the investor
                shell never did (confirmed by screenshot). Same
                signOut()-then-redirect pattern shell.tsx uses. */}
            <LogoutButton className="mt-2 w-full" />
          </>
        }
      />

      <div className="flex-1 md:ml-60">
        <WorkspaceHeader
          desktopAlign="end"
          matchDeal={{ kind: 'investor', tooltip: 'Connect the MatchDeal app — swipe-based matching with startups.' }}
          left={
            /* Prompt 90 item 2 — the sidebar (with the only Log out button)
               is `hidden md:flex`: below the md breakpoint there was no way
               to sign out at all, not an intermittent bug but a 100%
               reproducible gap below ~768px. This header, unlike the
               sidebar, already renders at every width, so it's the natural
               place for a mobile-only way out — md:hidden so desktop still
               uses the sidebar's own button, not a duplicate. */
            <LogoutButton className="md:hidden" />
          }
          right={
            <>
              <span title="Items on your Today tab — new matches, meetings, answers, and closing rounds."
                className="rounded-full border border-gray-100 bg-white px-3 py-1 text-xs text-gray-500">
                {todayCount == null ? 'Today —' : `Today ${todayCount} update${todayCount === 1 ? '' : 's'}`}
              </span>
              {/* Prompt 121 §2.1 — the "?" lives in the header (persistent
                  across every tab) rather than next to each tab's own title,
                  since this header is the one element common to all of them;
                  only rearms the current tab's guide, hidden on tabs that
                  don't have one yet (Agenda/Today/Archive). */}
              {tourKey && <PageGuideButton pageKey={tourKey} />}
            </>
          }
        />
        {/* BUG-03 — this <main> used to cap every tab at max-w-3xl (768px),
            which Tailwind's viewport-based `lg:` breakpoint doesn't know
            about: a 4-column grid inside 768px would squeeze each card to
            ~183px. Only the Plans tab needs the wider container; every
            other tab keeps the original width unchanged. */}
        <main className={`mx-auto p-4 md:p-8 ${tab === 'plans' ? 'max-w-6xl' : 'max-w-3xl'}`}>
          {tab === 'pipeline' && (
            gateOpen ? (
              openStartup ? (
                <div>
                  <button onClick={onBackToPipeline} className="mb-3 text-xs text-gray-400 hover:underline">← Back to Pipeline</button>
                  {startupCard}
                </div>
              ) : (
                <PipelinePanel onOpenStartup={onOpenStartup}
                  onOpenEvaluationTool={(orgId) => { setEvaluationTargetOrgId(orgId); setTab('evaluation'); }} />
              )
            ) : (
              <EmptyState
                message="Complete your investor profile to start receiving startups matched to your thesis."
                action={{ label: 'Go to About', onClick: () => setTab('about') }}
              />
            )
          )}
          {tab === 'about' && <InvestorProfilePanel onCompletenessChange={setPct} onEntityNameChange={setInvestorFirmName} onIdentityStatusChange={setIdentityStatus} />}
          {tab === 'access' && <AccessGrantedPanel />}
          {tab === 'evaluation' && <EvaluationToolsPanel initialOrgId={evaluationTargetOrgId} />}
          {tab === 'agenda' && <InvestorAgendaPanel />}
          {tab === 'today' && <InvestorTodayPanel />}
          {tab === 'archive' && <ArchivePanel />}
          {tab === 'plans' && <InvestorPlansPanel />}
        </main>
      </div>
      {/* Prompt 127 Bloco A (addenda §3) — this workspace never had a mobile
          nav at all before: below ~768px there was no way to switch tabs,
          full stop. Same navItems the sidebar uses. */}
      <WorkspaceMobileNav items={navItems} />
    </div>
    </OnboardingProvider>
  );
}
