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

export async function GET() {
  const capabilities = {
    ai: !!process.env.ANTHROPIC_API_KEY,
    companyCanon: await companyCanonAvailable(),
    needsReviewAi: await needsReviewAiAvailable(),
    documentDetails: await documentDetailsAvailable(),
    ndaSystem: await ndaSystemAvailable(),
  };
  if (!authEnabled) return NextResponse.json({ authEnabled: false, user: null, role: 'none', capabilities });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ authEnabled: true, user: null, role: 'none', capabilities });
  const [role, orgRole] = await Promise.all([
    resolveRole(user.id, user.email, sb),
    getOrgRole(user.id, sb),
  ]);
  return NextResponse.json({ authEnabled: true, user: { id: user.id, email: user.email }, role, orgRole, capabilities });
}
