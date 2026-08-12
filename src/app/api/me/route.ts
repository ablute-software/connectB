// Returns the current user + resolved role, for the client shell to adapt
// navigation. Also the single source of truth for feature availability —
// `capabilities` mirrors exactly what the AI routes (/api/compose,
// /api/ai-review) check server-side, so the UI never has to guess or
// duplicate that logic (and never inspects env vars client-side).
import { NextResponse, type NextRequest } from 'next/server';
import { serverClient, resolveRole, getOrgRole, authEnabled } from '@/lib/supabase-server';
import { readViewerSession } from '@/lib/developer-viewer';
import { companyCanonAvailable } from '@/lib/company-canon';
import { needsReviewAiAvailable } from '@/lib/needs-review-ai';
import { documentDetailsAvailable, ndaSystemAvailable } from '@/lib/data-room-capability';
import { entityContactFieldsAvailable } from '@/lib/entity-contact-capability';
import { reviewRunsAvailable } from '@/lib/review-capability';
import { reviewClarificationsAvailable } from '@/lib/review-clarifications-capability';
import { companyRoadmapAvailable } from '@/lib/company-roadmap-capability';
import { permissionMatrixAvailable } from '@/lib/permission-matrix-capability';
import { documentOrderingAvailable } from '@/lib/document-ordering-capability';
import { documentVersionsAvailable } from '@/lib/document-versions-capability';
import { reawakeningAvailable } from '@/lib/reawakening-capability';
import { planAccountsAvailable } from '@/lib/plan-accounts-capability';
import { companyProfileAvailable } from '@/lib/company-profile-capability';
import { roundValuationBasisAvailable } from '@/lib/round-valuation-basis-capability';
import { aiReviewHistoryFieldsAvailable } from '@/lib/ai-review-history-capability';
import { aiReviewIsTestMarkerAvailable } from '@/lib/ai-review-test-marker-capability';
import { accessRequestsAvailable, guestGrantTokenAvailable } from '@/lib/access-requests-capability';
import { ecosystemFactsAvailable } from '@/lib/ecosystem-facts-capability';
import { vaultPinOwnerManagedAvailable } from '@/lib/vault-pin-owner-managed-capability';
import { taskRemindersAvailable } from '@/lib/task-reminders-capability';
import { resolveUserPlan } from '@/lib/plan-server';
import { planEntitlements, WATSON_DRAFT_QUOTA, REVIEW_QUOTA } from '@/lib/plans';
import { stripeConfigured } from '@/lib/stripe-env';
import { pioneerBadgeAvailable } from '@/lib/pioneer-capability';

export async function GET(req: NextRequest) {
  const capabilities = {
    ai: !!process.env.ANTHROPIC_API_KEY,
    companyCanon: await companyCanonAvailable(),
    needsReviewAi: await needsReviewAiAvailable(),
    documentDetails: await documentDetailsAvailable(),
    ndaSystem: await ndaSystemAvailable(),
    entityContactFields: await entityContactFieldsAvailable(),
    reviewRuns: await reviewRunsAvailable(),
    reviewClarifications: await reviewClarificationsAvailable(),
    companyRoadmap: await companyRoadmapAvailable(),
    permissionMatrix: await permissionMatrixAvailable(),
    documentOrdering: await documentOrderingAvailable(),
    documentVersions: await documentVersionsAvailable(),
    reawakening: await reawakeningAvailable(),
    planAccounts: await planAccountsAvailable(),
    billing: stripeConfigured(),
    companyProfile: await companyProfileAvailable(),
    roundValuationBasis: await roundValuationBasisAvailable(),
    aiReviewHistoryFields: await aiReviewHistoryFieldsAvailable(),
    aiReviewIsTestMarker: await aiReviewIsTestMarkerAvailable(),
    accessRequests: await accessRequestsAvailable(),
    guestGrantToken: await guestGrantTokenAvailable(),
    ecosystemFacts: await ecosystemFactsAvailable(),
    vaultPinOwnerManaged: await vaultPinOwnerManagedAvailable(),
    taskReminders: await taskRemindersAvailable(),
  };
  if (!authEnabled) return NextResponse.json({ authEnabled: false, user: null, role: 'none', capabilities });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ authEnabled: true, user: null, role: 'none', capabilities });
  const [role, orgRole, { orgId, plan }] = await Promise.all([
    resolveRole(user.id, user.email, sb, user.email_confirmed_at),
    getOrgRole(user.id, sb),
    resolveUserPlan(user.id, sb),
  ]);
  // Plans & Account batch — the plan half of the entitlement gate. The client
  // uses `entitlements` to show/hide gated UI; the server re-checks it at each
  // write path (e.g. the compose route), so this is display-truth, not the
  // enforcement point. Platform admins (role 'developer') get full access.
  const entitlements = planEntitlements(plan, role === 'developer');
  // Prompt 161 §C — permanent, independent of `plan`/`entitlements` above
  // (a downgrade never clears it). Display-truth for the Plans & billing
  // badge and the "Invite other founders" referral section's visibility
  // gate; the referral codes themselves are re-fetched from their own
  // route, not carried here.
  let pioneerBadge = false;
  if (orgId && await pioneerBadgeAvailable()) {
    const { data: orgRow } = await sb.from('orgs').select('pioneer_badge').eq('id', orgId).maybeSingle();
    pioneerBadge = !!orgRow?.pioneer_badge;
  }
  // Prompt 106 §B — Watson drafts-left, for the "/log" card. Display-truth
  // only, same as `entitlements` above; /api/compose re-checks and is the
  // real enforcement point. Not resolved for the platform org (unlimited).
  let watson: { quota: number; used: number; remaining: number; resetAt: string } | null = null;
  const watsonQuota = WATSON_DRAFT_QUOTA[plan];
  if (orgId && role !== 'developer' && watsonQuota > 0) {
    const { data: statusRow } = await sb.rpc('watson_drafts_status', { p_org_id: orgId, p_quota: watsonQuota });
    const status = (statusRow as { used: number; remaining: number; reset_at: string }[] | null)?.[0];
    if (status) watson = { quota: watsonQuota, used: status.used, remaining: status.remaining, resetAt: status.reset_at };
  }
  // Prompt 166 §B — investability-review monthly quota (REVIEW_QUOTA in
  // plans.ts), display-truth for the "X of Y reviews used this month" line
  // in ReviewPanel.tsx; /api/review/investability re-checks and is the real
  // enforcement point. null quota (motherfunding, unlimited) deliberately
  // resolves reviewQuota to null too — nothing to show for an unlimited
  // plan. Not resolved for the platform org, same as watson above.
  let reviewQuota: { quota: number; used: number; remaining: number; resetsAt: string } | null = null;
  const reviewMonthlyQuota = REVIEW_QUOTA[plan];
  if (orgId && role !== 'developer' && reviewMonthlyQuota !== null) {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const { count } = await sb.from('review_runs').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).gte('created_at', startOfMonth.toISOString());
    const used = count ?? 0;
    reviewQuota = { quota: reviewMonthlyQuota, used, remaining: Math.max(reviewMonthlyQuota - used, 0), resetsAt: nextMonth.toISOString() };
  }
  // Prompt 123 Block A — Developer Viewer. Only ever resolved for a
  // session that ALSO currently resolves as 'developer' — a stale cookie
  // on a session that no longer is one (e.g. platform_admins row removed)
  // never surfaces a viewer org, same non-trust-the-cookie-alone rule
  // assertNotViewer() follows.
  let viewer: { orgId: string; orgName: string | null } | null = null;
  if (role === 'developer') {
    const session = readViewerSession(req);
    if (session) {
      const { data: org } = await sb.from('orgs').select('name').eq('id', session.orgId).maybeSingle();
      viewer = { orgId: session.orgId, orgName: org?.name ?? null };
    }
  }

  return NextResponse.json({ authEnabled: true, user: { id: user.id, email: user.email }, role, orgRole, plan, entitlements, capabilities, watson, reviewQuota, viewer, pioneerBadge });
}
