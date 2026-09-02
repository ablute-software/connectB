// Prompt 536 §2/§3 — the founder-triggered catalog delivery, moved off the
// client.
//
// WHAT WENT WRONG, in production, measured (Krohnsty, 2026-09-02):
//
//   13:22:55  founder clicks "Unlock my pipeline"
//   13:22:56  client-side unlockPack() reads catalog_effective_quota() = 3
//             and delivers 3 investors
//   13:26:20  the profile gate completes; catalog_quota rises to 8
//   ...       the other 5 slots are unreachable until the monthly cron
//
// Two different definitions of "profile complete" were racing. The BUTTON
// appeared at calcCompanyCompleteness() >= 70%; the QUOTA only grew at
// isProfileGateComplete() (nine specific fields). The founder crossed the
// first while the second was still false, so the unlock read the seed quota
// of 3, delivered 3, and then unlockPack's own `prev.unlocks.some(u =>
// u.pack_id === packId)` guard refused ever to run again — a one-shot fired
// at the worst possible moment.
//
// THE SHAPE OF THE FIX, and why it is a route rather than a patched client
// function:
//
//   raise the floor  ->  read the quota  ->  deliver the difference
//
// all inside ONE server request, in that order. The client cannot do this:
// it reads a quota that a later request will change, and it cannot make the
// raise and the read atomic with respect to each other. Moving it here also
// puts the entities/catalog_deliveries inserts in one awaited sequence
// (catalog-delivery-core.ts) instead of three parallel fire-and-forget
// persist() calls, which is the second, independent bug of the same
// incident — see that file's header for the foreign-key race it closes.
//
// Delivery is a TOP-UP, not a one-time unlock (§3): "deliver up to quota",
// idempotent, callable again whenever the quota grows. Re-running it when
// nothing is owed is a no-op returning delivered: 0, not an error. The
// pack_unlocks row stays as history only — it no longer gates anything.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { isProfileGateComplete, missingProfileGateFields } from '@/lib/pipeline-unlock';
import { computeVisiblePipelineSize, raiseCatalogQuotaFloor } from '@/lib/pipeline-unlock-server';
import { deliverCatalogMatches } from '@/lib/catalog-delivery-core';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  // A developer viewing someone else's org read-only must never spend that
  // org's quota. Unlike the GET route, which only needs this around its one
  // stamp write, the whole of this route is a write.
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  const orgId = member?.org_id as string | undefined;
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: org } = await admin.from('orgs').select('*').eq('id', orgId).maybeSingle();
  if (!org) return NextResponse.json({ ok: false, error: 'Org not found.' }, { status: 404 });

  // §1 — ONE definition of complete, and it is this one. The 70% bar never
  // decides whether investors get delivered.
  if (!isProfileGateComplete(org)) {
    return NextResponse.json({
      ok: false, gateComplete: false, missing: missingProfileGateFields(org),
      error: 'Complete your company profile first.',
    }, { status: 409 });
  }

  // Idempotent stamp, same as the GET route: the gate is complete, so the
  // month counter must start from a real anchor even if the founder never
  // loaded the page between completing the profile and clicking.
  if (!org.profile_completed_at) {
    await admin.from('orgs').update({ profile_completed_at: new Date().toISOString() }).eq('id', orgId);
  }

  // RAISE, then READ — in this order, in this request. This single ordering
  // is what makes the 3-instead-of-8 impossible: whatever the founder has
  // earned by the moment they click is already in catalog_quota before the
  // quota is read.
  const { catalogQuotaTarget } = await computeVisiblePipelineSize(admin, orgId);
  await raiseCatalogQuotaFloor(admin, orgId, catalogQuotaTarget);

  // Through the FOUNDER's session, not the service-role client, and
  // deliberately: catalog_effective_quota() carries the
  // is_ablute_developer() bypass (migration 0166) and its own
  // is_org_member() check, both of which evaluate against the caller. Under
  // the service role is_org_member() is false and the RPC returns 0 — the
  // quota would read as zero and nothing would ever be delivered.
  const { data: quotaData } = await sb.rpc('catalog_effective_quota', { check_org: orgId });
  const quota = typeof quotaData === 'number' ? quotaData : 0;

  // Only non-exempt rows count, in lockstep with
  // trg_catalog_deliveries_enforce_quota (migration 0171). An investor's own
  // organic interest (quota_exempt = true) was never the founder's spend.
  const { count: deliveredCount } = await admin
    .from('catalog_deliveries').select('catalog_id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('quota_exempt', false);

  const pLimit = Math.max(0, quota - (deliveredCount ?? 0));
  if (pLimit === 0) {
    return NextResponse.json({ ok: true, gateComplete: true, delivered: 0, quota, alreadyDelivered: deliveredCount ?? 0, deliverable: 0 });
  }

  // via_pack is history only now (§3): if a Starter pack exists we still
  // record which one the founder came through, because that is a true fact
  // about the delivery — it just no longer decides whether the delivery may
  // happen.
  const body = await req.json().catch(() => ({}));
  const packId = typeof (body as { packId?: unknown }).packId === 'string' ? (body as { packId: string }).packId : null;

  const { delivered, error } = await deliverCatalogMatches(admin, orgId, pLimit, packId);

  if (packId && delivered > 0) {
    // After the deliveries, not in parallel with them. Failure here loses a
    // history row, never an investor, so it does not fail the request — but
    // it is logged rather than swallowed.
    const { error: unlockErr } = await admin.from('pack_unlocks')
      .insert({ org_id: orgId, pack_id: packId, unlocked_at: new Date().toISOString() });
    if (unlockErr) console.error('[pipeline-unlock/deliver] pack_unlocks insert failed:', unlockErr.message);
  }

  const { count: after } = await admin
    .from('catalog_deliveries').select('catalog_id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('quota_exempt', false);

  return NextResponse.json({
    ok: !error, gateComplete: true, delivered, quota,
    alreadyDelivered: after ?? 0, deliverable: Math.max(0, quota - (after ?? 0)),
    error: error ?? undefined,
  }, { status: error ? 500 : 200 });
}
