// Prompt 123 Block C.3 — Investors tab: real REGISTERED investor accounts
// (catalog_entities that actually have ≥1 matchdeal_investor_members seat),
// distinct from the existing /api/backoffice/investors (global catalog
// stats — entities that were merely imported/enriched, most of which were
// never touched by a real signed-up user; see P124's own 358-vs-~8 flag).
//
// "Firm-level account" = catalog_entities row; matchdeal_investor_members
// are its seats (same shape as orgs/org_members for startups). Plan tier
// lives per-membership on matchdeal_profiles (kind='investor') — the
// OWNER's tier is taken as the firm's, same convention already used by
// investorOrgRows() (backoffice-metrics.ts), which this route reuses rather
// than recomputing seats/plan tier/verification separately.
//
// Several columns the prompt asks for have no real event source yet
// (Access requested, Size of Visible Pipeline for an investor — a
// different formula than pipeline-unlock.ts's startup-side one, never
// specified for investors — Startups comparisons, AI assistance). Per the
// prompt's own instruction for "Files viewed" ("a coluna nasce '—' com
// tooltip... não inventar dados retroactivos"), the same treatment applies
// to all of them here — returned as `null`, not a fabricated number.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { investorOrgRows } from '@/lib/backoffice-metrics';
import { accountModerationAvailable } from '@/lib/account-moderation-capability';
import { isRegisteredInvestorAccount } from '@/lib/investor-account-filter';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [orgRows, { data: members }, moderationAvailable] = await Promise.all([
    investorOrgRows(admin),
    admin.from('matchdeal_investor_members').select('id, catalog_entity_id, user_id, status, created_at').eq('status', 'active'),
    accountModerationAvailable(),
  ]);

  const userIdsByEntity = new Map<string, string[]>();
  const registeredAtByEntity = new Map<string, string>();
  for (const m of members ?? []) {
    const entityId = m.catalog_entity_id as string;
    userIdsByEntity.set(entityId, [...(userIdsByEntity.get(entityId) ?? []), m.user_id as string]);
    const createdAt = m.created_at as string;
    const earliest = registeredAtByEntity.get(entityId);
    if (!earliest || createdAt < earliest) registeredAtByEntity.set(entityId, createdAt);
  }

  // last_sign_in_at + email both live on auth.users — one bulk listUsers()
  // call, same pattern as /api/backoffice/startups.
  const lastSignInByUser = new Map<string, string | null>();
  const emailByUser = new Map<string, string>();
  let page = 1;
  for (;;) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) break;
    for (const u of data.users) { lastSignInByUser.set(u.id, u.last_sign_in_at ?? null); if (u.email) emailByUser.set(u.id, u.email); }
    if (data.users.length < 200) break;
    page++;
  }

  const now = Date.now();
  const monthAgo = new Date(now - MONTH_MS).toISOString();

  const { data: catalogEntities } = await admin.from('catalog_entities').select('id, moderation_status, moderation_quarantine_until');
  const moderationByEntity = new Map((catalogEntities ?? []).map((c) => [c.id as string, c]));

  // Prompt 123 §C.4 — a catalog entity only becomes a registered account
  // (shows here) once a real user's first active membership row exists;
  // seatsLinked is investorOrgRows()'s own count of exactly that. This is
  // the backoffice-side half of the P120-A/P121-2.7 "new sign-up wiring"
  // contract — see investor-account-filter.test.ts for the regression test.
  const accounts = orgRows.filter((r) => isRegisteredInvestorAccount(r.seatsLinked));
  const result = await Promise.all(accounts.map(async (r) => {
    const userIds = userIdsByEntity.get(r.entityId) ?? [];
    const emails = userIds.map((id) => emailByUser.get(id)).filter(Boolean) as string[];
    const lastLogins = userIds.map((id) => lastSignInByUser.get(id)).filter(Boolean) as string[];
    const lastLogin = lastLogins.length ? lastLogins.sort().at(-1)! : null;

    let accessGrantedLastMonth = 0;
    let filesViewedLastMonth = 0;
    let interactedOrgIds = new Set<string>();
    if (emails.length > 0) {
      const [{ data: grants }, { data: views }] = await Promise.all([
        admin.from('access_grants').select('org_id, granted_at').in('grantee_email', emails),
        admin.from('document_views').select('org_id, viewed_at').in('viewer_email', emails).gte('viewed_at', monthAgo),
      ]);
      accessGrantedLastMonth = (grants ?? []).filter((g) => (g.granted_at as string) >= monthAgo).length;
      filesViewedLastMonth = (views ?? []).length;
      interactedOrgIds = new Set((grants ?? []).map((g) => g.org_id as string));
    }

    const daysSinceLogin = lastLogin ? (now - new Date(lastLogin).getTime()) / (24 * 60 * 60 * 1000) : Infinity;
    const status: 'active' | 'quiet' | 'inactive' =
      (filesViewedLastMonth > 0 && daysSinceLogin < 14) || daysSinceLogin < 7 ? 'active' : daysSinceLogin < 30 ? 'quiet' : 'inactive';

    const moderation = moderationByEntity.get(r.entityId);

    return {
      entityId: r.entityId, name: r.name, planTier: r.planTier,
      // Item 11 — pass-through from investorOrgRows(); see that function's
      // own comment for why "first member with a value" is the convention.
      planTierRequested: r.planTierRequested, planTierRequestedAt: r.planTierRequestedAt,
      registrationDate: registeredAtByEntity.get(r.entityId) ?? null,
      seats: r.seatsLinked,
      // Prompt 497 — the plan's own seat allowance next to the count, so
      // "5 seats" reads as 5-of-5 or 5-of-2 rather than a bare number.
      seatLimit: r.seatLimit, seatsOverLimit: r.seatsOverLimit,
      // % Completeness: only a BINARY is_complete exists for investor
      // profiles today (migration 0105's trigger) — no weighted score like
      // companyCompleteness.ts's startup-side one. Rendered as-is, not
      // inflated into a fake percentage.
      complete: r.verified,
      // Prompt 183 §A — the tri-state value for the new Verification badge;
      // see investorOrgRows()'s own comment for why this route's filter now
      // includes pending/rejected accounts that have real seats.
      verificationStatus: r.verificationStatus,
      lastLogin, status,
      accessGrantedLastMonth,
      filesViewedLastMonth,
      startupsInteractedWith: interactedOrgIds.size,
      moderationStatus: moderationAvailable ? (moderation?.moderation_status ?? 'active') : 'active',
      moderationQuarantineUntil: moderationAvailable ? (moderation?.moderation_quarantine_until ?? null) : null,
      // Not tracked today — flagged, not invented (see this file's header).
      logsLast7Days: null as number | null,
      accessRequestedLastMonth: null as number | null,
      visiblePipelineSize: null as number | null,
      startupComparisonsLastMonth: null as number | null,
      aiAssistanceLastMonth: null as number | null,
      isInternal: r.isInternal,
    };
  }));

  return NextResponse.json({ ok: true, accounts: result, moderationAvailable });
}
