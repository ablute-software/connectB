'use client';
// Company tab redesign — orchestrates the completeness bar + the five
// cards, in the spec's order: Identity, Team, Round, Company facts (moved
// to the end of its own group), Outreach settings (last, most operational).
// Capability-gated on companyProfile (migration 0037): until applied, falls
// back to the old Organisation card unchanged — never a broken form.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { can, type OrgRole } from '@/lib/permissions';
import { OrganisationCard } from '@/components/OrganisationCard';
import { CompanyFactsPanel } from '@/components/CompanyFactsPanel';
import { calcCompanyCompleteness } from '@/lib/companyCompleteness';
import { CompletenessBar } from './CompletenessBar';
import { IdentityCard } from './IdentityCard';
import { StartupTeamCard } from './StartupTeamCard';
import { RoundCard } from './RoundCard';
import { TractionCard } from './TractionCard';
import { OutreachSettingsCard } from './OutreachSettingsCard';
import { DataroomChecklistCard } from './DataroomChecklistCard';
import { InvestorDecisionsCard, InvestorQACard, RoundUpdatesCard, SoftCommitsCard } from './InvestorEngagementCards';

function DemoResetCard() {
  const { resetDemo } = useStore();
  if (authEnabled) return null;
  return (
    <Card title="Demo data">
      <button onClick={() => { if (window.confirm('Reset all demo data to the seeded pipeline?')) resetDemo(); }}
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
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => {
      setOrgRole(me.orgRole ?? null);
      setCompanyProfile(!!me.capabilities?.companyProfile);
    }).catch(() => setCompanyProfile(false));
  }, []);

  const canEdit = !authEnabled || can(orgRole, 'manage_org_settings');

  if (companyProfile === null) return <p className="text-sm text-gray-400">Loading…</p>;

  if (!companyProfile) {
    return (
      <div className="max-w-3xl space-y-4">
        <p className="text-xs text-gray-400">
          The redesigned Identity/Team/Round profile activates once migration 0037 is applied. Here's what's editable today.
        </p>
        <OrganisationCard />
        <Card title="Company facts"><CompanyFactsPanel /></Card>
        <DemoResetCard />
      </div>
    );
  }

  const { pct, missing } = calcCompanyCompleteness(db.org, db.companyPeople);

  return (
    <div className="max-w-3xl space-y-4">
      <div data-tour-id="settings-completeness">
        <CompletenessBar pct={pct} missing={missing} orgId={db.org.id} onFlash={setFlashId} />
      </div>
      <div data-tour-id="settings-identity">
        <IdentityCard canEdit={canEdit} missing={missing} flashId={flashId} />
      </div>
      <StartupTeamCard canEdit={canEdit} missing={missing} flashId={flashId} />
      <div data-tour-id="settings-round">
        <RoundCard canEdit={canEdit} missing={missing} flashId={flashId} />
      </div>
      <div data-tour-id="settings-traction">
        <TractionCard canEdit={canEdit} />
      </div>
      <DataroomChecklistCard />
      <InvestorDecisionsCard />
      <SoftCommitsCard />
      <RoundUpdatesCard />
      <InvestorQACard />
      <Card title="Company facts"><CompanyFactsPanel /></Card>
      <OutreachSettingsCard canEdit={canEdit} />
      <DemoResetCard />
    </div>
  );
}
