// Prompt I-01 — demo-mode data for the incubator screens (no Supabase env:
// `npm run dev:verify`, previews). Read-only illustration, never written
// anywhere; every name is a zz-test fixture name, so a screenshot can never
// be mistaken for real data.
export const DEMO_INCUBATOR = {
  member: { id: 'demo-member-owner', role: 'owner' as const, email: 'gestora@zz-test-incubadora-braga.pt' },
  incubator: {
    id: 'demo-incubator', name: 'zz-test-incubadora-braga', slug: 'zz-test-incubadora-braga', kind: 'municipal',
    website: 'https://zz-test-incubadora-braga.example', country: 'PT', city: 'Braga', logo_url: null,
    description: 'Demo incubator (demo mode).', is_test: true, alsoInvests: true,
  },
};

export const DEMO_PORTFOLIO = {
  relationships: [
    {
      relationship_id: 'demo-rel-1', org_id: 'demo-org-1', startup_name: 'zz-test-startup-alfa', sector: 'Healthtech', stage: 'seed',
      cohort_id: 'demo-cohort-a', cohort_name: 'Cohort 2026-A', status: 'active', sharing_level: 1,
      manager_member_id: 'demo-member-owner', manager_name: 'Demo Manager', started_at: '2026-09-15T10:00:00Z', has_live_access: true,
    },
    {
      relationship_id: 'demo-rel-2', org_id: 'demo-org-2', startup_name: 'zz-test-startup-beta', sector: null, stage: null,
      cohort_id: 'demo-cohort-a', cohort_name: 'Cohort 2026-A', status: 'paused', sharing_level: 2,
      manager_member_id: null, manager_name: null, started_at: '2026-09-01T10:00:00Z', has_live_access: false,
    },
  ],
  invites: [
    { id: 'demo-inv-1', email: 'founder@zz-test-startup-gama.pt', startup_name: 'zz-test-startup-gama', sector: 'Fintech', website: null,
      cohort_id: 'demo-cohort-a', status: 'invited', sent_at: '2026-09-29T09:00:00Z', last_sent_at: '2026-09-29T09:00:00Z', send_count: 1,
      token_expires_at: '2026-10-29T09:00:00Z', created_at: '2026-09-29T09:00:00Z' },
  ],
  cohorts: [{ id: 'demo-cohort-a', name: 'Cohort 2026-A', starts_on: '2026-09-01', ends_on: '2027-02-28', archived_at: null }],
};

export const DEMO_TEAM = [
  { member_id: 'demo-member-owner', user_id: 'demo-user-1', email: 'gestora@zz-test-incubadora-braga.pt', full_name: 'Demo Manager', title: 'Programme director', role: 'owner', status: 'active', accepted_at: '2026-09-10T10:00:00Z', created_at: '2026-09-10T10:00:00Z' },
  { member_id: 'demo-member-2', user_id: null, email: 'gestor2@zz-test-incubadora-braga.pt', full_name: null, title: null, role: 'manager', status: 'invited', accepted_at: null, created_at: '2026-09-28T10:00:00Z' },
];

export const DEMO_FOUNDER_PROGRAMS = {
  relationships: [
    {
      relationship_id: 'demo-rel-1', org_id: 'demo-org-1', incubator_id: 'demo-incubator', incubator_name: 'zz-test-incubadora-braga',
      incubator_logo_url: null, incubator_kind: 'municipal', incubator_also_invests: true, cohort_name: 'Cohort 2026-A',
      status: 'active', sharing_level: 1, public_badge: true, started_at: '2026-09-15T10:00:00Z', graduated_at: null,
      ended_at: null, ended_by: null, end_reason: null,
    },
  ],
  accessLog: [] as { id: string; relationship_id: string; incubator_name: string; member_name: string; surface: string; target_id: string | null; viewed_at: string }[],
};

export const DEMO_INVITE_PREVIEW = {
  ok: true, status: 'invited', invitedEmailMasked: 'fo…@zz-test-startup-gama.pt',
  incubator: { name: 'zz-test-incubadora-braga', logoUrl: null, kind: 'municipal', alsoInvests: true },
  cohortName: 'Cohort 2026-A', voucher: null,
  stub: { startupName: 'zz-test-startup-gama', sector: 'Fintech', website: 'https://zz-test-startup-gama.example' },
};
