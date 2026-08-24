'use client';
// Company tab redesign — orchestrates the completeness bar + the five
// cards, in the spec's order: Identity, Team, Round, Company facts (moved
// to the end of its own group), Outreach settings (last, most operational).
// Capability-gated on companyProfile (migration 0037): until applied, falls
// back to the old Organisation card unchanged — never a broken form.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/confirm';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { can, type OrgRole } from '@/lib/permissions';
import { OrganisationCard } from '@/components/OrganisationCard';
import { CompanyFactsPanel } from '@/components/CompanyFactsPanel';
import { calcCompanyCompleteness } from '@/lib/companyCompleteness';
import { CompletenessBar } from './CompletenessBar';
import { IdentityCard } from './IdentityCard';
import { BadgesCard } from './BadgesCard';
import { PhotosMediaCard } from './PhotosMediaCard';
import { MiniPitchCard } from './MiniPitchCard';
import { StartupTeamCard } from './StartupTeamCard';
import { RoundCard } from './RoundCard';
import { PreviousFundingCard } from '@/components/PreviousFundingCard';
import { TractionCard } from './TractionCard';
import { DataroomChecklistCard } from './DataroomChecklistCard';
import { InvestorQACard, RoundUpdatesCard, SoftCommitsCard } from './InvestorEngagementCards';
import { StartupAxisClassifications } from './StartupAxisClassifications';

// Prompt 359 Block A — RoadmapCard is GONE from here: the roadmap is now
// its own top-level "Roadmap" tab (settings/page.tsx), not a card in this
// vertical flow. This is the mini-preview the prompt asks for in its place
// — one line, a link out, nothing this panel needs to keep rendering the
// canvas itself for.
function RoadmapMiniPreview({ available }: { available: boolean }) {
  const { db } = useStore();
  if (!available) return null;
  const total = db.roadmapEvents.length;
  const done = db.roadmapEvents.filter((e) => e.status === 'done').length;
  return (
    <Card title="Roadmap">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {total === 0 ? 'No events yet.' : `${done} done · ${total - done} planned`}
        </p>
        <Link href="/settings?tab=roadmap" className="text-xs font-medium text-[#0E7490] hover:underline">
          View roadmap →
        </Link>
      </div>
    </Card>
  );
}

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

export function CompanyPanel() {
  const { db } = useStore();
  const [orgRole, setOrgRole] = useState<OrgRole | null>(null);
  const [companyProfile, setCompanyProfile] = useState<boolean | null>(null);
  const [roadmapAvailable, setRoadmapAvailable] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => {
      setOrgRole(me.orgRole ?? null);
      setCompanyProfile(!!me.capabilities?.companyProfile);
      setRoadmapAvailable(!!me.capabilities?.roadmapEvents);
    }).catch(() => setCompanyProfile(false));
  }, []);

  const canEdit = !authEnabled || can(orgRole, 'manage_org_settings');

  if (companyProfile === null) return <p className="text-sm text-gray-400">Loading…</p>;

  // Prompt 357 §C1 — Badges & awards moves out of the vertical flow into a
  // fixed right-hand column, in the space that was previously just dead
  // white margin (max-w-3xl on a page with much more room) — same sticky-
  // contained-column pattern as the Track & Evaluate sidebar (352/356):
  // reserved grid space, sticky WITHIN its own column (never escaping it),
  // its own max-height + internal scroll so a long badge list can't grow
  // past the viewport. Below `lg`, it drops into the normal vertical flow
  // (no responsive column story needed at that width). Both branches below
  // share this same wrapper — only the left column's content differs.
  if (!companyProfile) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:max-w-5xl lg:grid-cols-[1fr_300px] lg:items-start">
        <div className="space-y-4">
          <p className="text-xs text-gray-400">
            The redesigned Identity/Team/Round profile activates once migration 0037 is applied. Here&apos;s what&apos;s editable today.
          </p>
          <OrganisationCard />
          <PhotosMediaCard canEdit={canEdit} />
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

  const { pct, missing } = calcCompanyCompleteness(db.org, db.companyPeople);

  return (
    <div className="grid grid-cols-1 gap-4 lg:max-w-5xl lg:grid-cols-[1fr_300px] lg:items-start">
      <div className="space-y-4">
        <div data-tour-id="settings-completeness">
          <CompletenessBar pct={pct} missing={missing} orgId={db.org.id} onFlash={setFlashId} />
        </div>
        <RoadmapMiniPreview available={roadmapAvailable} />
        <div id="settings-identity" data-tour-id="settings-identity">
          <IdentityCard canEdit={canEdit} missing={missing} flashId={flashId} />
        </div>
        <StartupTeamCard canEdit={canEdit} missing={missing} flashId={flashId} />
        <PhotosMediaCard canEdit={canEdit} />
        <div id="settings-round" data-tour-id="settings-round">
          <RoundCard canEdit={canEdit} missing={missing} flashId={flashId} />
          {/* Prompt 212 §B.3 — logo a seguir a ronda actual, porque a pergunta
              que o founder faz e "quanto ja levantei" vs "quanto estou a
              levantar", e as duas tem de estar lado a lado para nao voltarem a
              confundir-se. */}
          {canEdit && <PreviousFundingCard />}
        </div>
        <MiniPitchCard canEdit={canEdit} />
        <div data-tour-id="settings-traction">
          <TractionCard canEdit={canEdit} />
        </div>
        <DataroomChecklistCard />
        {/* Prompt 327 Pedido A — InvestorDecisionsCard/InterestLevelRequestsCard/
            OutreachSettingsCard moved to the Dashboard Overview tab: they're
            operational RESULTS of the Sherlock relationship, not facts the
            company declares about itself. SoftCommitsCard/RoundUpdatesCard/
            InvestorQACard stayed here for now (not named in the request) —
            flagged in the report as arguably sharing the same characteristic. */}
        <SoftCommitsCard />
        <RoundUpdatesCard />
        <InvestorQACard />
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
