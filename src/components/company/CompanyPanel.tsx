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
import { useSearchParams } from 'next/navigation';
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
import { InvestorQACard, RoundUpdatesCard, SoftCommitsCard } from './InvestorEngagementCards';
import { StartupAxisClassifications } from './StartupAxisClassifications';
import { CompanySubMenu, type CompanySection } from './CompanySubMenu';
import { SETTINGS_HEADER_OFFSET_PX } from './settings-layout';
import { COMPLETENESS_FIELDS, type CompletenessField } from '@/lib/companyCompleteness';

const SECTIONS: CompanySection[] = [
  { key: 'identity', label: 'Identity', anchorId: 'settings-identity' },
  { key: 'team', label: 'Team', anchorId: 'settings-team' },
  { key: 'round', label: 'Round', anchorId: 'settings-round' },
  { key: 'previous-funding', label: 'Previous funding', anchorId: 'settings-previous-funding' },
  { key: 'traction', label: 'Traction metrics', anchorId: 'settings-traction' },
  { key: 'facts', label: 'Facts & Clarifications', anchorId: 'settings-facts' },
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
  // Prompt 394 §2 — sections used to all mount at once (scroll-and-anchor);
  // now only ONE renders at a time, true tabs. `active` was previously
  // local state inside CompanySubMenu, inferred from scroll position via an
  // IntersectionObserver rooted on `contentEl` — that observer never fired,
  // because the WINDOW scrolls this page, not `contentEl` itself, so the
  // sidebar's highlighted item was permanently stuck on "Identity". Lifted
  // here and now the single source of truth: a click sets it directly, no
  // inference needed.
  const [active, setActive] = useState<string>(SECTIONS[0].key);

  // Prompt 377 §B — direct navigation to e.g. /settings#settings-round (the
  // existing external links from OverviewPanel/TodayPanel/RoadmapCard) has
  // to land in the right section. Prompt 394 §2 — since only the active
  // section is mounted, the hash must first pick WHICH section to activate
  // (matched against SECTIONS' own anchorId), then scroll once it has
  // rendered — a plain scrollIntoView on mount no longer works because the
  // target doesn't exist in the DOM until `active` says so.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash) return;
    // Prompt 379 §A — when the URL also carries a `?flash=<field>`, that
    // field is the MORE PRECISE instruction and owns both the section
    // choice and the scroll (handled below and by the page). Without this
    // guard both effects run and this one, being last, would win with a
    // coarser "top of the section" target instead of the exact field.
    if (new URLSearchParams(window.location.search).get('flash')) return;
    const anchorId = window.location.hash.slice(1);
    const section = SECTIONS.find((s) => s.anchorId === anchorId);
    if (section) setActive(section.key);
  }, []);

  // Prompt 394 §2 — once the target section has actually mounted (its `id`
  // now exists), scroll to it. Runs on every `active` change, including
  // clicks — a fresh section is short and starts right under the sticky
  // header already, but this keeps a consistent landing spot regardless of
  // how much the previous section had scrolled the page.
  useEffect(() => {
    if (!contentEl) return;
    document.getElementById(SECTIONS.find((s) => s.key === active)?.anchorId ?? '')?.scrollIntoView({ block: 'start' });
  }, [active, contentEl]);

  // Prompt 379 §A / Prompt 394 §2 — `?flash=<completenessFieldId>` names a
  // FIELD, not a section, but with true tabs the field's element only
  // exists in the DOM once its own section is active. Reads the raw query
  // param directly, NOT the `flashId` prop: the page's own flash effect
  // only sets that prop once `document.getElementById(fieldId)` already
  // finds the element — a deadlock with true tabs, since that element can't
  // exist until this switches the section first. COMPLETENESS_FIELDS
  // already records which card/section owns each field id (identity/team/
  // round).
  const flashParam = useSearchParams().get('flash');
  useEffect(() => {
    if (!flashParam) return;
    const field = COMPLETENESS_FIELDS.find((f) => f.id === flashParam);
    if (field) setActive(field.card);
  }, [flashParam]);

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
        <CompanySubMenu sections={SECTIONS} active={active} onSelect={setActive} />
      </div>

      {/* Prompt 394 §2 — true tabs: only the active section mounts. `id` +
          scroll-margin-top stay on each (still the hash/flash landing
          target); `data-tour-id` moved to the sidebar's own buttons
          (CompanySubMenu) since only ONE of these divs exists at a time —
          the tour needs an anchor that's always resolvable. */}
      <div ref={setContentEl} className="space-y-4">
        {active === 'identity' && (
          <div id="settings-identity" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
            <IdentityCard canEdit={canEdit} missing={missing} flashId={flashId} />
          </div>
        )}

        {active === 'team' && (
          <div id="settings-team" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
            <StartupTeamCard canEdit={canEdit} missing={missing} flashId={flashId} />
          </div>
        )}

        {active === 'round' && (
          <div id="settings-round" className="space-y-4" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
            <RoundCard canEdit={canEdit} missing={missing} flashId={flashId} />
            <RoundUpdatesCard />
            <SoftCommitsCard />
          </div>
        )}

        {active === 'previous-funding' && (
          <div id="settings-previous-funding" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
            {canEdit && <PreviousFundingCard />}
          </div>
        )}

        {active === 'traction' && (
          <div id="settings-traction" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
            <TractionCard canEdit={canEdit} />
          </div>
        )}

        {active === 'facts' && (
          <div id="settings-facts" className="space-y-4" style={{ scrollMarginTop: SETTINGS_HEADER_OFFSET_PX }}>
            <Card title="Facts & Clarifications"><CompanyFactsPanel /></Card>
            <InvestorQACard />
            <StartupAxisClassifications />
            <DemoResetCard />
          </div>
        )}
      </div>

      <div className="lg:sticky lg:top-[var(--settings-header-offset)] lg:overflow-y-auto lg:[max-height:calc(100vh-var(--settings-header-offset)-1rem)]"
        style={{ '--settings-header-offset': `${SETTINGS_HEADER_OFFSET_PX}px` } as React.CSSProperties}>
        <BadgesCard canEdit={canEdit} orgId={db.org.id} />
      </div>
    </div>
  );
}
