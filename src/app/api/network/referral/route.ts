// Prompt 318 — My Network 3/9. GET: referrals involving the caller (sent,
// received as the referred startup needing to consent first, received as
// the target once B has consented), pre-filtered through
// referralsVisibleToTarget so a pending_referred_consent row never reaches
// the target's own response, not even to prove it exists. POST: send one.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, resolveActorDisplays, resolveInvestorCatalogEntityIdForActor } from '@/lib/network-db';
import { createReferral, readReferralsInvolvingActor, resolveReferralEligibility } from '@/lib/network-referrals-db';
import { getActiveFollowOnPairs } from '@/lib/network-followon-db';
import { effectiveReferralState, referralReputation, referralsVisibleToTarget, referralCarriesFollowOnBadge, shapeFollowOnPayload } from '@/lib/network';

async function actorAndAdmin(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  if (!(await networkAvailable())) return { error: NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' }) };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return { error: NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 }) };
  return { admin, actor };
}

export async function GET(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, actor } = resolved;

  const raw = await readReferralsInvolvingActor(admin, actor.actorId, actor.orgId ?? null);
  const now = new Date();
  const visible = raw.filter((r) => {
    if (r.targetActorId === actor.actorId) return referralsVisibleToTarget([r], actor.actorId).length > 0;
    return true; // sender and referred-startup views always see their own row (referredOrgId is the caller's own org for that branch)
  });

  const actorIds = new Set<string>();
  for (const r of visible) { actorIds.add(r.referrerActorId); actorIds.add(r.targetActorId); }
  const displays = await resolveActorDisplays(admin, [...actorIds]);

  // Prompt 319 Pedido C.2 — the follow-on badge propagates onto a referral
  // ONLY from the same signaling investor about the same startup
  // (referralCarriesFollowOnBadge), masked exactly like the dossier's own
  // copy (shapeFollowOnPayload) before it ever reaches this response.
  const investorReferrerActorIds = [...actorIds].filter((id) => displays.get(id)?.kind === 'investor');
  const investorCatalogEntityIdByActorId = new Map(
    await Promise.all(investorReferrerActorIds.map(async (id) => [id, await resolveInvestorCatalogEntityIdForActor(admin, id)] as const)),
  );
  const activeFollowOnPairs = await getActiveFollowOnPairs(admin, [...new Set(visible.map((r) => r.referredOrgId))]);

  const shaped = visible.map((r) => {
    const referrerInvestorCatalogEntityId = investorCatalogEntityIdByActorId.get(r.referrerActorId) ?? null;
    const carries = referralCarriesFollowOnBadge({ referrerInvestorCatalogEntityId, referredOrgId: r.referredOrgId, activeSignals: activeFollowOnPairs });
    const matchingSignal = carries ? activeFollowOnPairs.find((s) => s.investorCatalogEntityId === referrerInvestorCatalogEntityId && s.orgId === r.referredOrgId) : undefined;
    return {
      ...r,
      effectiveState: effectiveReferralState({ ...r, referredDecidedAt: r.referredDecidedAt ?? null }, now),
      referrerName: displays.get(r.referrerActorId)?.name ?? 'Someone in your network',
      targetName: displays.get(r.targetActorId)?.name ?? 'Investor',
      isMineAsReferrer: r.referrerActorId === actor.actorId,
      isMineAsTarget: r.targetActorId === actor.actorId,
      isMineAsReferred: actor.orgId != null && r.referredOrgId === actor.orgId,
      followOn: matchingSignal ? shapeFollowOnPayload(true, matchingSignal.visibility, matchingSignal.investorName) : { active: false as const },
    };
  });

  const reputation = referralReputation(raw.filter((r) => r.referrerActorId === actor.actorId), actor.actorId);
  const eligibility = await resolveReferralEligibility(admin, actor.actorId, actor.kind === 'investor' ? 'investor' : 'founder');
  return NextResponse.json({ ok: true, referrals: shaped, reputation, eligibility });
}

export async function POST(req: Request) {
  const resolved = await actorAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, actor } = resolved;

  const body = await req.json().catch(() => ({})) as { referredOrgId?: string; targetActorId?: string; message?: string };
  if (!body.referredOrgId || !body.targetActorId || !body.message?.trim()) {
    return NextResponse.json({ ok: false, error: 'Missing referredOrgId, targetActorId, or message.' }, { status: 400 });
  }

  const targetDisplay = (await resolveActorDisplays(admin, [body.targetActorId])).get(body.targetActorId);
  const result = await createReferral(admin, {
    referrerActorId: actor.actorId,
    referrerIsInvestor: actor.kind === 'investor',
    referredOrgId: body.referredOrgId,
    targetActorId: body.targetActorId,
    targetIsInvestor: targetDisplay?.kind === 'investor',
    message: body.message.trim(),
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, referral: result.referral });
}
