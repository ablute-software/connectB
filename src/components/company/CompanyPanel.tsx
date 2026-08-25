'use client';
// Company tab redesign — orchestrates the seven sections: Identity, Team,
// Round, Previous funding, Traction metrics, Facts & Clarifications, My
// data room. Capability-gated on companyProfile (migration 0037): until
// applied, falls back to the old Organisation card unchanged — never a
// broken form.
//
// Prompt 377 §B — CompletenessBar, canEdit and the completeness `missing`
// list are now owned by the PAGE (settings/page.tsx), not this panel: the
// page's own header (title/link, VisibilityToggle, main tab bar) became
// `position: sticky` so it stops scrolling away, and CompletenessBar joined
// it there (per the prompt's own layout spec) — since they now live in the
// same sticky block, computing completeness once at the page level and
// passing it down here avoids two independent `/api/me`/completeness
// computations silently drifting. This is `position: sticky` within the
// normal page flow, not a `position: fixed` overlay — CLAUDE.md's
// createPortal rule for full-viewport overlays doesn't apply here.
//
// The sub-menu and the badges column are BOTH `position: sticky` at the
// SAME top offset as the page header's own sticky block (SETTINGS_HEADER_OFFSET_PX,
// kept in one place and imported by both files so the two can never drift
// apart) — the content column has no special CSS of its own; it scrolls
// with the page like anything else, which is exactly what "only the
// content column scrolls" means once the other three are pinned via sticky.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/confirm';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { OrganisationCard } from '@/components/OrganisationCard';
import { CompanyFactsPanel } from '@/components/CompanyFactsPanel';
import { IdentityCard } from './IdentityCard';
import { BadgesCard } from './BadgesCard';
import { StartupTeamCard } from './StartupTeamCard';
import { RoundCard } from './RoundCard';
import { PreviousFundingCard } from '@/components/PreviousFundingCard';
import { TractionCard } from './TractionCard';
import { DataroomChecklistCard } from './DataroomChecklistCard';
import { InvestorQACard, RoundUpdatesCard, SoftCommitsCard } from './InvestorEngagementCards';
import { StartupAxisClassifications } from './StartupAxisClassifications';
import { CompanySubMenu, type CompanySection } from './CompanySubMenu';
import { SETTINGS_HEADER_OFFSET_PX } from './settings-layout';
import type { CompletenessField } from '@/lib/companyCompleteness';

const SECTIONS: CompanySection[] = [
  { key: 'identity', label: 'Identity', anchorId: 'settings-identity' },
  { key: 'team', label: 'Team', anchorId: 'settings-team' },
  { key: 'round', label: 'Round', anchorId: 'settings-round' },
  { key: 'previous-funding', label: 'Previous funding', anchorId: 'settings-previous-funding' },
  { key: 'traction', label: 'Traction metrics', anchorId: 'settings-traction' },
  { key: 'facts', label: 'Facts & Clarifications', anchorId: 'settings-facts' },
  { key: 'data-room', label: 'My data room', anchorId: 'settings-data-room' },
];

function DemoResetCard() {
  const { resetDemo } = useStore();
  const confirm = useConfirm();
  if (authEnabled) return null;
  return (
    <Card title="Demo data">
      <button onClick={async () => { if (await confirm({ message: 'Reset all demo data to the seeded pipeline?', destructive: true })) resetDemo(); }}
        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-[#B00000] hover:bg-red-50">
        Reset demo to seed
      </button>
      <p className="mt-2 text-xs text-gray-400">This workspace runs on local browser storage for now. Connecting a real database later replaces this with production data.</p>
    </Card>
  );
}

export function CompanyPanel({ canEdit, companyProfileAvailable, missing, flashId }: {
  canEdit: boolean; companyProfileAvailable: boolean | null; missing: CompletenessField[]; flashId: string | null;
}) {
  const { db } = useStore();
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);

  // Prompt 377 §B — direct navigation to e.g. /settings#settings-round (the
  // existing external links from OverviewPanel/TodayPanel/RoadmapCard) has
  // to land in the right section even though sections now live below a
  // sticky header rather than at the top of the page's own scroll — the
  // browser's native on-load hash-scroll still works here (this IS the
  // page's own scroll container, nothing nested), but a fresh navigation
  // can race the page's own async data load, so this re-checks once the
  // content column itself is mounted.
  useEffect(() => {
    if (!contentEl || typeof window === 'undefined' || !window.location.hash) return;
    const id = window.location.hash.slice(1);
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [contentEl]);

  if (companyProfileAvailable === null) return <p className="text-sm text-gray-400">Loading…</p>;

  // Prompt 357 §C1 — Badges & awards moves out of the vertical flow into a
  // fixed right-hand column, in the space that was previously just dead
  // white margin (max-w-3xl on a page with much more room) — same sticky-
  // contained-column pattern as the Track & Evaluate sidebar (352/356):
  // reserved grid space, sticky WITHIN its own column (never escaping it),
  // its own max-height + internal scroll so a long badge list can't grow
  // past the viewport. Below `lg`, it drops into the normal vertical flow
  // (no responsive column story needed at that width). Both branches below
  // share this same wrapper — only the left column's content differs.
  if (!companyProfileAvailable) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:max-w-5xl lg:grid-cols-[1fr_300px] lg:items-start">
        <div className="space-y-4">
          <p className="text-xs text-gray-400">
            The redesigned Identity/Team/Round profile activates once migration 0037 is applied. Here&apos;s what&apos;s editable today.
          </p>
          <OrganisationCard />
          <Card title="Company facts & Clarifications"><CompanyFactsPanel /></Card>
          <StartupAxisClassifications />
          <DemoResetCard />
        </div>
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <BadgesCard canEdit={canEdit} orgId={db.org.id} />
        </div>
      </div>
    );
  }

  return (
    // Prompt 377 §B — sub-menu (left, sticky) · content (middle, the only
    // column that visibly scrolls, since it's the only one WITHOUT its own
    // sticky/overflow rules) · badges (right, sticky, unchanged behavior
    // from before this prompt). Below `lg`, all three fall back to plain
    // stacked flow — a fixed left sub-menu makes no sense on a narrow
    // screen, so CompanySubMenu itself renders as a horizontal scrolling
    // chip row there instead (see that component).
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[160px_1fr_300px] lg:items-start">
      {/* Prompt 377 §B — the sticky offset is a CSS variable, not a plain
          inline style, precisely so it only ever takes effect through the
          `lg:`-prefixed classes below (top/max-height inline styles applied
          unconditionally would also clip/shift the mobile chip-row layout,
          which never uses sticky/overflow at all). */}
      <div className="lg:sticky lg:top-[var(--settings-header-offset)] lg:overflow-y-auto lg:[max-height:calc(100vh-var(--settings-header-offset)-1rem)]"
        style={{ '--settings-header-offset': `${SETTINGS_HEADER_OFFSET_PX}px` } as React.CSSProperties}>
        <CompanySubMenu sections={SECTIONS} scrollRoot={contentEl} />
      </div>

      {/* Prompt 377 §B — scroll-margin-top on every section anchor, not just
          a JS scroll-offset calculation: this way EVERY way a section can be
          reached (CompanySubMenu's own scrollIntoView, a native #hash
          landing, the browser's own back/forward restoring a scroll
          position) lands below the sticky header instead of underneath it,
          with no separate offset math to keep in sync at each call site. */}
      <div ref={setContentEl} className="space-y-4">
        <div id="settings-identity" data-tour-id="settings-identity" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
          <IdentityCard canEdit={canEdit} missing={missing} flashId={flashId} />
        </div>

        <div id="settings-team" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
          <StartupTeamCard canEdit={canEdit} missing={missing} flashId={flashId} />
        </div>

        <div id="settings-round" data-tour-id="settings-round" className="space-y-4" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
          <RoundCard canEdit={canEdit} missing={missing} flashId={flashId} />
          <RoundUpdatesCard />
          <SoftCommitsCard />
        </div>

        <div id="settings-previous-funding" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
          {canEdit && <PreviousFundingCard />}
        </div>

        <div id="settings-traction" data-tour-id="settings-traction" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
          <TractionCard canEdit={canEdit} />
        </div>

        <div id="settings-facts" className="space-y-4" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
          <Card title="Facts & Clarifications"><CompanyFactsPanel /></Card>
          <InvestorQACard />
          <StartupAxisClassifications />
          <DemoResetCard />
        </div>

        <div id="settings-data-room" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
          <DataroomChecklistCard />
        </div>
      </div>

      <div className="lg:sticky lg:top-[var(--settings-header-offset)] lg:overflow-y-auto lg:[max-height:calc(100vh-var(--settings-header-offset)-1rem)]"
        style={{ '--settings-header-offset': `${SETTINGS_HEADER_OFFSET_PX}px` } as React.CSSProperties}>
        <BadgesCard canEdit={canEdit} orgId={db.org.id} />
      </div>
    </div>
  );
}
