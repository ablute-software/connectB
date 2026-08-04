// Batch 3 B — edit Organisation data. The orgs table's RLS update policy is
// owner-only (0001), but the founder decision is owner+admin can edit, so
// this route enforces the role itself (via permissions.ts, the same matrix
// the UI uses) and writes with the service-role client. Server-side
// enforcement, not just a hidden button — a non-owner/admin POST is rejected
// here regardless of what the UI shows.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { type OrgRole } from '@/lib/permissions';
import { loadOrgMatrix } from '@/lib/org-matrix-server';
import { canWithMatrix } from '@/lib/org-permissions';
import { patchTouchesArchiveRelevantFields, regenerateNowSummary } from '@/lib/startup-snapshot';
import { calcCompanyCompleteness } from '@/lib/companyCompleteness';
import { logEvent } from '@/lib/analytics-events';

// Only these columns are editable here — never plan/credits/id/bcc_email.
// Company tab redesign (migration 0037) added everything from legal_name
// down — capability-gated client-side (the Company panel hides the fields
// until companyProfileAvailable), but this whitelist itself doesn't need to
// gate: `orgs.update` on a column that doesn't exist yet just errors, same
// as any other pre-migration write, and the UI never sends those keys until
// the probe says yes.
const EDITABLE = [
  'name', 'sender_email', 'website', 'sector', 'stage', 'round_target_eur', 'country', 'one_liner', 'daily_cap', 'weekly_cap',
  'legal_name', 'logo_url', 'hq_city', 'postal_code', 'founded_year', 'description', 'sectors',
  'employee_count', 'founder_count_override', 'stage_other',
  'round_raising', 'round_secured_eur', 'round_instruments', 'round_instrument_other', 'round_valuation_eur',
  'round_runway_months', 'round_target_close_date', 'round_use_of_funds', 'round_flexible', 'round_flexible_note',
  // Prompt 115 Block E (migration 0111, propose-only) — the client only ever
  // includes this key once /api/me's roundValuationBasis capability is true
  // (RoundCard.tsx), same "probe gates what's sent" discipline as everything
  // else in this whitelist.
  'round_valuation_basis',
  // Investor Workspace Fase 1 (prompt 54) — Zona 1 snapshot round data.
  'round_min_ticket_eur', 'round_runway_post_months',
  // Prompt 85 Correction 1 (migration 0082).
  'current_phase', 'revenue_eur', 'primary_contact_person_id',
  // P104 #7 — free-text "Other" sector, kept separate from `sectors` (the
  // fixed-taxonomy picks) so matching can treat it distinctly (see
  // sector-taxonomy.ts / SectorPicker.tsx).
  'sectors_other',
] as const;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgRole = member.role as OrgRole;

  const admin = createClient(url, service, { auth: { persistSession: false } });
  // The org's configured matrix (batch 3 C) is the source of truth; it falls
  // back to the built-in defaults (owner+admin) when unconfigured / pre-0026.
  const matrix = await loadOrgMatrix(admin, member.org_id as string);
  if (!canWithMatrix(matrix, orgRole, 'org_editing')) {
    return NextResponse.json({ ok: false, error: 'Your role can’t edit organisation settings.' }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k];
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });

  const { error } = await admin.from('orgs').update(patch).eq('id', member.org_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Archive "Now" regeneration (prompt 60) — fact-triggered, not periodic.
  // Awaited (not fire-and-forget): a serverless function can be frozen the
  // instant its response is sent, so an un-awaited background call has no
  // reliability guarantee here. This only runs when the patch touches an
  // archive-relevant field AND at least one org has archived this startup,
  // so the added latency on a founder's save is both rare and cheap — a
  // single short AI call, never blocking on every save.
  if (patchTouchesArchiveRelevantFields(patch)) {
    await regenerateNowSummary(admin, member.org_id as string).catch(() => {});
  }

  // SherlockDeal_Metricas_BackOffice_V1, Section 6.1 indicator 3/6 — a
  // "when did this org first reach 80% complete" milestone, since
  // calcCompanyCompleteness has no stored history of its own (see
  // migration "org_activation_milestones"). Checked on every save, not
  // just ones that touch a completeness-relevant field, since the same
  // field whitelist (EDITABLE above) already covers everything the
  // formula reads — cheap to re-check, not worth a second whitelist that
  // could drift out of sync with the first.
  const { data: freshOrg } = await admin.from('orgs').select('*').eq('id', member.org_id).single();
  if (freshOrg && !freshOrg.profile_reached_80_at) {
    const { data: people } = await admin.from('company_people').select('*').eq('org_id', member.org_id);
    const { pct } = calcCompanyCompleteness(freshOrg, people ?? []);
    if (pct >= 80) {
      const reachedAt = new Date().toISOString();
      await admin.from('orgs').update({ profile_reached_80_at: reachedAt }).eq('id', member.org_id);
      await logEvent(admin, {
        organizationId: member.org_id as string, organizationType: 'startup', eventType: 'profile_completeness_reached',
        eventTimestamp: reachedAt, planAtEventTime: freshOrg.plan, countryAtEventTime: freshOrg.country, sectorAtEventTime: freshOrg.sector,
        result: '80', sourceOfAction: 'manual',
      });
    }
  }

  return NextResponse.json({ ok: true });
}
