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
import { resolveUserPlan } from '@/lib/plan-server';
import { planEntitlements, WATSON_DRAFT_QUOTA } from '@/lib/plans';
import { stripeConfigured } from '@/lib/stripe-env';

export async function GET(req: NextRequest) {
  const capabilities = {
    ai: !!process.env.ANTHROPIC_API_KEY,
    companyCanon: await companyCanonAvailable(),
    needsReviewAi: await needsReviewAiAvailable(),
    documentDetails: await documentDetailsAvailable(),
    ndaSystem: await ndaSystemAvailable(),
    entityContactFields: await entityContactFieldsAvailable(),
    reviewRuns: await reviewRunsAvailable(),
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

  return NextResponse.json({ authEnabled: true, user: { id: user.id, email: user.email }, role, orgRole, plan, entitlements, capabilities, watson, viewer });
}
