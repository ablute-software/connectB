// Returns the current user + resolved role, for the client shell to adapt
// navigation. Also the single source of truth for feature availability —
// `capabilities` mirrors exactly what the AI routes (/api/compose,
// /api/ai-review) check server-side, so the UI never has to guess or
// duplicate that logic (and never inspects env vars client-side).
import { NextResponse } from 'next/server';
import { serverClient, resolveRole, getOrgRole, authEnabled } from '@/lib/supabase-server';
import { companyCanonAvailable } from '@/lib/company-canon';
import { needsReviewAiAvailable } from '@/lib/needs-review-ai';
import { documentDetailsAvailable, ndaSystemAvailable } from '@/lib/data-room-capability';
import { entityContactFieldsAvailable } from '@/lib/entity-contact-capability';
import { reviewRunsAvailable } from '@/lib/review-capability';
import { permissionMatrixAvailable } from '@/lib/permission-matrix-capability';
import { documentOrderingAvailable } from '@/lib/document-ordering-capability';
import { planAccountsAvailable } from '@/lib/plan-accounts-capability';
import { resolveUserPlan } from '@/lib/plan-server';
import { planEntitlements } from '@/lib/plans';

export async function GET() {
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
    planAccounts: await planAccountsAvailable(),
  };
  if (!authEnabled) return NextResponse.json({ authEnabled: false, user: null, role: 'none', capabilities });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ authEnabled: true, user: null, role: 'none', capabilities });
  const [role, orgRole, { plan }] = await Promise.all([
    resolveRole(user.id, user.email, sb),
    getOrgRole(user.id, sb),
    resolveUserPlan(user.id, sb),
  ]);
  // Plans & Account batch — the plan half of the entitlement gate. The client
  // uses `entitlements` to show/hide gated UI; the server re-checks it at each
  // write path (e.g. the compose route), so this is display-truth, not the
  // enforcement point. Platform admins (role 'developer') get full access.
  const entitlements = planEntitlements(plan, role === 'developer');
  return NextResponse.json({ authEnabled: true, user: { id: user.id, email: user.email }, role, orgRole, plan, entitlements, capabilities });
}
