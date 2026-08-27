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
import { AccessGrantedPanel } from './AccessGrantedPanel';
import { InvestorPlansPanel } from './InvestorPlansPanel';
import { EvaluationToolsPanel } from './EvaluationToolsPanel';
import { InvestorDashboardPanel } from './InvestorDashboardPanel';
import { MessagesPanel, useInvestorMessagesUnreadCount } from './MessagesPanel';
// Prompt 340 Block C — My Network reuses the founder side's OWN component
// wholesale (same 6/7-section nav, same /api/network/* endpoints) rather
// than a second implementation: NetworkPageContent already branches on
// state.myActorKind === 'investor' throughout (referral candidates,
// follow-on section, group-kind options), and its one founder-only call
// (updateOrg, the network_discoverable toggle) is already gated behind
// myActorKind === 'founder' — see that file's own Suggestions card — so it
// never fires for an investor session. useStore() itself is safe anywhere
// in the app (StoreProvider wraps the root layout unconditionally).
// Prompt 406 §A — imports the component directly from where it now lives
// (src/components/network/NetworkPageContent.tsx, not the page.tsx route,
// which Next's typegen forbids from taking custom props) so this shell can
// pass viewerKind="investor" and reframe the page without forking it.
import { NetworkPageContent } from '@/components/network/NetworkPageContent';
import { IDENTITY_BADGE_CLASS, IDENTITY_BADGE_LABEL, type IdentityStatus } from '@/lib/investor-identity';
import { OnboardingProvider } from '@/lib/onboarding/OnboardingProvider';
import { PageTour } from '@/components/onboarding/PageTour';
import { LampButton } from '@/components/onboarding/LampButton';
import { WorkspaceSidebar } from '@/components/workspace-shell/WorkspaceSidebar';
import { WorkspaceMobileNav } from '@/components/workspace-shell/WorkspaceMobileNav';
import { WorkspaceHeader } from '@/components/workspace-shell/WorkspaceHeader';
import { LogoutButton } from '@/components/workspace-shell/LogoutButton';
import { EmptyState } from '@/components/workspace-shell/EmptyState';
import type { WorkspaceNavItem } from '@/components/workspace-shell/types';
import { BRAND_NAME } from '@/lib/brand';
import { SupportTicketsPanel, useSupportUnreadCount } from '@/components/SupportTicketsPanel';
import { InvestorActionsPanel, useInvestorActions } from '@/components/investor-workspace/InvestorActionsPanel';
import { InvestorReminderPopup } from '@/components/portal/InvestorReminderPopup';

// Prompt 337 — 'archive' is no longer its own tab: ArchivePanel's content
// moved into PipelinePanel as an "Archived" filter (same content, same
// component, just reached a different way — see PipelinePanel's own
// comment). The Tab union drops it; nothing else references 'archive' as
// a tab value anymore.
// Prompt 340 — adds 'dashboard' (Group 4), 'network' and 'messages' (Group
// 3), filling the slots the Prompt 337 comment below already reserved.
export type Tab = 'pipeline' | 'actions' | 'about' | 'access' | 'agenda' | 'plans' | 'evaluation' | 'support' | 'dashboard' | 'network' | 'messages';

const COMPLETENESS_GATE = 50;

// Prompt 121 §2.1 — the investor shell never had the tour/tooltip system at
// all (confirmed: zero data-tour-id/tour references before this). Copies
// the founder side's own per-tab-guide pattern (documents/page.tsx's
// guide_documents/guide_people_access split) rather than inventing a tour
// that spans multiple tabs at once — anchors only resolve against the
// current DOM, so a guide can't reach across tabs that aren't mounted.
const TOUR_KEY_BY_TAB: Partial<Record<Tab, string>> = {
  pipeline: 'guide_investor_pipeline', about: 'guide_investor_about', access: 'guide_investor_access', plans: 'guide_investor_plans',
  // Prompt 340 — dashboard/agenda/messages get their own short guide.
  // Prompt 406 §C — network now points at its own guide_investor_network:
  // the anchors (data-tour-id) are identical DOM ids, same component, but
  // the copy needs the investor's own framing (Follow-on/Referrals read
  // founder-only otherwise) and a step for the new Scout requests nav item.
  dashboard: 'guide_investor_dashboard', agenda: 'guide_investor_agenda', messages: 'guide_investor_messages', network: 'guide_investor_network',
};

export function InvestorWorkspaceShell({
  entityName, startupCard, sessionLabel, openStartup, onOpenStartup, onBackToPipeline,
  initialTab, initialEvaluationOrgId,
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
  // P134-B — the dossier's "Equity calculator" header shortcut deep-links
  // here via /portal?tab=evaluation&orgId=…; PortalPage reads those query
  // params once and passes them down as the initial values below (lazy
  // useState initializers, so this only ever affects the FIRST render —
  // switching tabs manually afterward behaves exactly as before).
  initialTab?: Tab;
  initialEvaluationOrgId?: string | null;
}) {
  const [tab, setTab] = useState<Tab>(() => initialTab ?? 'pipeline');
  // P131-B — set when a Pipeline card's "Ownership calculator" shortcut is
  // clicked, so Evaluation tools opens with that startup already selected
  // instead of the investor having to find it again in a dropdown.
  // P134-A — the Pipeline row no longer has its own calculator shortcut
  // (removed per the redesign); this is now seeded only from the dossier
  // header's deep link (initialEvaluationOrgId, via /portal?tab=evaluation&orgId=…).
  const [evaluationTargetOrgId] = useState<string | null>(() => initialEvaluationOrgId ?? null);
  // Prompt 345 Block E — compareIds/showComparison/goToPipelineComparison
  // (Prompt 169 §B) removed: the comparator moved into EvaluationToolsPanel
  // itself (its own local state now — no more need to survive a trip
  // across tabs, since it never leaves this one anymore).
  const [pct, setPct] = useState<number | null>(null);
  const [investorFirmName, setInvestorFirmName] = useState<string | null>(null);
  // Identity verification Fase B (prompt 64), Bloco 1 — the badge lives in
  // the sidebar rather than repeated separately in About/Pipeline/Archive's
  // own headers: it's visible on every tab that way (a superset of what
  // the prompt asked for) for a fraction of the wiring three separate
  // fetches would need.
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus | null>(null);
  // Prompt 156 — migration 0156. null = not yet confirmed; a real
  // timestamp once the investor has explicitly confirmed their thesis data
  // and unlocked the Pipeline.
  const [pipelineConfirmedAt, setPipelineConfirmedAt] = useState<string | null>(null);
  const [confirmingPipeline, setConfirmingPipeline] = useState(false);
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
      setPipelineConfirmedAt(d.linked ? d.pipelineConfirmedAt ?? null : null);
    }).catch(() => {});
  }, []);

  async function confirmPipeline() {
    setConfirmingPipeline(true);
    try {
      const res = await fetch('/api/portal/pipeline/confirm', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (body?.ok) setPipelineConfirmedAt(body.pipelineConfirmedAt as string);
    } finally {
      setConfirmingPipeline(false);
    }
  }

  const aboutLabel = investorFirmName ? `About ${investorFirmName}` : 'About your firm';
  const gateOpen = pct != null && pct >= COMPLETENESS_GATE;
  // Item 13 — investor side never had a support-tickets surface at all
  // (only the founder shell's "Help & support" widget submits one); this
  // is the read/reply half, same panel the founder Messages page's new
  // Support tab uses.
  const unreadSupport = useSupportUnreadCount();

  // Prompt 216 §C — badge e lista da MESMA chamada (o mecanismo que matou
  // o bug 182: uma fonte, não duas): o shell monta o hook uma vez, o badge
  // lê count, e o painel recebe o resultado inteiro como prop.
  const investorActions = useInvestorActions();

  // Prompt 343 — Nuno's own final regrouping, replacing Prompt 337's:
  // 1: About alone · 2: Data room/Pipeline · 3: Dashboard/Evaluation tools ·
  // 4: Actions required/Agenda · 5: My Network/Messages · 6: Plans/Support.
  // MatchDeal is deliberately NOT a nav item — it only ever lives in the
  // QR-pairing header affordance (WorkspaceHeader's matchDeal prop, below)
  // per Nuno's explicit decision. 'archive' is gone as a tab — see
  // PipelinePanel's own "Archived" filter.
  const messagesUnread = useInvestorMessagesUnreadCount();

  const NAV: { key: Tab; label: string; icon: string; group: number }[] = [
    { key: 'about', label: aboutLabel, icon: '⋯', group: 1 },
    // Prompt 337/338 — renamed from "Access granted": grows into the full
    // read-only mirror of the founder's own Vault Data Room in Prompt 338.
    { key: 'access', label: 'Data room', icon: '⚿', group: 2 },
    { key: 'pipeline', label: 'Pipeline', icon: '▤', group: 2 },
    // Prompt 340 Block A — own-data-only funnel/agenda/follow-on summary.
    { key: 'dashboard', label: 'Dashboard', icon: '▥', group: 3 },
    // P131-B — Ownership calculator (promoted from a per-card button to a
    // real page) + Equity simulator, structured to grow with more tools.
    { key: 'evaluation', label: 'Evaluation tools', icon: '⚖', group: 3 },
    { key: 'actions', label: 'Actions required', icon: '⚑', group: 4 },
    { key: 'agenda', label: 'Agenda', icon: '◔', group: 4 },
    // Prompt 340 Block C/D.
    { key: 'network', label: 'My Network', icon: '⇄', group: 5 },
    { key: 'messages', label: 'Messages', icon: '✉', group: 5 },
    { key: 'plans', label: 'Plans & billing', icon: '◈', group: 6 },
    { key: 'support', label: 'Support', icon: '☎', group: 6 },
  ];

  const tourKey = TOUR_KEY_BY_TAB[tab];
  // Same item list drives both the desktop sidebar and the mobile bottom
  // nav — unlike shell.tsx's founder side, active-state here is always
  // `tab === key` regardless of which one is rendering, so there's no need
  // for two separately-computed arrays.
  const navItems: WorkspaceNavItem[] = NAV.map((n) => ({
    key: n.key, icon: n.icon, label: n.label, group: n.group,
    active: tab === n.key, emphasize: n.key === 'about',
    badge: n.key === 'support' && unreadSupport > 0 ? unreadSupport
      : n.key === 'actions' && investorActions.count > 0 ? investorActions.count
      : n.key === 'messages' && messagesUnread > 0 ? messagesUnread : undefined,
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
        groupStyle="cards"
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
              {/* Prompt 121 §2.1 / Prompt 141 — the lamp lives in the header
                  (persistent across every tab) rather than next to each
                  tab's own title, since this header is the one element
                  common to all of them; resolves to this tab's guide,
                  empty-state ("No page guide here yet") on tabs that don't
                  have one (Agenda/Archive) rather than hiding itself,
                  since Help & support is still reachable either way. */}
              <LampButton tourKeys={tourKey ? [tourKey] : []} supportSource="investor_portal" />
            </>
          }
        />
        {/* BUG-03 — this <main> used to cap every tab at max-w-3xl (768px),
            which Tailwind's viewport-based `lg:` breakpoint doesn't know
            about: a 4-column grid inside 768px would squeeze each card to
            ~183px. Only the Plans tab needs the wider container; every
            other tab keeps the original width unchanged. */}
        {/* Prompt 340 — 'network' joins 'plans' in the wide container: it
            mounts NetworkPageContent, which assumes the founder shell's own
            max-w-6xl content column (aside + flex-1 layout). */}
        {/* Prompt 345 §D.1 — Pipeline joins plans/network in the wide
            container: PipelinePanel dropped its own max-w-2xl (672px),
            same family as the founder Pipeline's real content width. */}
        {/* Prompt 405 §A.1 — Evaluation tools joins the wide container too:
            its own two-column layout (sticky startup picker + tools, see
            EvaluationToolsPanel.tsx) needs the room; max-w-3xl left a large
            empty gap on wide screens with the picker repeated in every tool
            instead. */}
        <main className={`mx-auto p-4 md:p-8 ${tab === 'plans' || tab === 'network' || tab === 'pipeline' || tab === 'evaluation' ? 'max-w-6xl' : 'max-w-3xl'}`}>
          {tab === 'pipeline' && (
            !gateOpen ? (
              <EmptyState
                message="Complete your investor profile to start receiving startups matched to your thesis."
                action={{ label: 'Go to About', onClick: () => setTab('about') }}
              />
            ) : openStartup ? (
              <div>
                <button onClick={onBackToPipeline} className="mb-3 text-xs text-gray-400 hover:underline">← Back to Pipeline</button>
                {startupCard}
              </div>
            ) : !pipelineConfirmedAt ? (
              // Prompt 156 — crossing the completeness gate above used to
              // flip straight into a live, already-populated Pipeline with
              // no moment where the investor confirms their thesis data is
              // what they meant to match against. Mirrors the startup
              // side's own confirm step (pipeline/page.tsx's
              // EmptyCompanyBlock) — same idea, investor-specific copy.
              <div className="flex min-h-[50vh] items-center justify-center">
                <div className="mx-auto max-w-[420px] text-center">
                  <div className="mx-auto mb-5 flex h-[80px] w-[80px] items-center justify-center rounded-full bg-gray-50 text-3xl">🔍</div>
                  <h2 className="mb-2 text-lg font-semibold text-gray-900">Congratulations — we have enough to show you your best-matched startups</h2>
                  <p className="mb-5 text-sm text-gray-500">
                    Confirm your investor profile is accurate before you unlock — the match uses this data as it stands right now.
                    If something&apos;s wrong, fix it first: you won&apos;t get a fresh match until your plan&apos;s monthly renewal.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button disabled={confirmingPipeline} onClick={() => void confirmPipeline()}
                      className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
                      {confirmingPipeline ? 'Unlocking…' : 'Confirm and unlock my Pipeline'}
                    </button>
                    <button onClick={() => setTab('about')}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      Let me check my profile first
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <PipelinePanel onOpenStartup={onOpenStartup} />
            )
          )}
          {tab === 'actions' && <InvestorActionsPanel actions={investorActions} />}
          {tab === 'about' && <InvestorProfilePanel onCompletenessChange={setPct} onEntityNameChange={setInvestorFirmName} onIdentityStatusChange={setIdentityStatus} />}
          {tab === 'access' && <AccessGrantedPanel />}
          {tab === 'evaluation' && <EvaluationToolsPanel initialOrgId={evaluationTargetOrgId} />}
          {tab === 'agenda' && <InvestorAgendaPanel />}
          {tab === 'support' && <SupportTicketsPanel />}
          {tab === 'plans' && <InvestorPlansPanel />}
          {tab === 'dashboard' && <InvestorDashboardPanel />}
          {tab === 'messages' && <MessagesPanel />}
          {tab === 'network' && <NetworkPageContent viewerKind="investor" />}
        </main>
      </div>
      {/* Prompt 127 Bloco A (addenda §3) — this workspace never had a mobile
          nav at all before: below ~768px there was no way to switch tabs,
          full stop. Same navItems the sidebar uses. */}
      <WorkspaceMobileNav items={navItems} />
      <InvestorReminderPopup />
    </div>
    </OnboardingProvider>
  );
}
