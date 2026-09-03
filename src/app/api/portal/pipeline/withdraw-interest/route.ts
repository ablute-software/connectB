// Prompt 345 Block B — "Withdraw interest". A narrow reversal of an
// 'interested' decision, allowed ONLY while canWithdrawInterest's window is
// still open (see investor-interest-withdrawal.ts for the fail-closed
// predicate). This is NOT a reopen of AP-06 — a Pass stays permanently
// final, and an Interested that the founder has already acted on in any of
// the tracked ways is just as final. The window check runs here, server-
// side, on every call — a hidden client-side button is never the real
// security boundary.
//
// The card's own "can I still withdraw" hint comes from getPipelineWaves
// itself (investor-pipeline.ts's own canWithdrawInterest field, computed at
// Pipeline-load time — P134-A's own rule is that expanding a card never
// fetches, so this can't be a lazy per-card GET here). POST below
// re-verifies the exact same window from scratch regardless of what the
// client believes — the button being shown is never the real security
// boundary.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId, resolveInvestorProfile } from '@/lib/portal-access';
import { canWithdrawInterest, resolveWithdrawWindowSignals } from '@/lib/investor-interest-withdrawal';
import { assertNotViewer } from '@/lib/developer-viewer';

async function resolveStatus(admin: SupabaseClient, userId: string, email: string, orgId: string) {
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, userId);
  if (!investorCatalogEntityId) return { ok: false as const, status: 403, error: 'No linked investor organization.' };

  const { data: decision } = await admin.from('investor_relationship_decisions').select('decision, decided_at')
    .eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  if (!decision || decision.decision !== 'interested') {
    return { ok: false as const, status: 404, error: 'No expressed interest to withdraw here.' };
  }

  // AP-14 — the decision is org-level; the withdraw window's own signals
  // (a grant created for ANY teammate) must check the same team-email set
  // decide_investor_relationship itself uses, not just the caller's email.
  const { data: teamRows } = await admin.from('matchdeal_investor_members').select('user_id')
    .eq('catalog_entity_id', investorCatalogEntityId).eq('status', 'active');
  const teamEmails = await Promise.all((teamRows ?? []).map(async (r) => {
    const { data } = await admin.auth.admin.getUserById(r.user_id as string);
    return data?.user?.email ?? null;
  }));
  const investorEmails = [...new Set([email, ...teamEmails.filter((e): e is string => !!e)])];

  const signals = await resolveWithdrawWindowSignals(admin, {
    orgId, investorCatalogEntityId, decidedAt: decision.decided_at as string, investorEmails,
  });
  return { ok: true as const, investorCatalogEntityId, canWithdraw: canWithdrawInterest(signals) };
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  const orgId = body.orgId;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  const investorProfile = await resolveInvestorProfile(admin, user.id);
  if (!investorProfile) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const result = await resolveStatus(admin, user.id, email, orgId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  if (!result.canWithdraw) {
    return NextResponse.json({ ok: false, error: 'The founder has already responded — this can no longer be withdrawn.' }, { status: 403 });
  }
  const investorCatalogEntityId = result.investorCatalogEntityId;

  const { error: deleteError } = await admin.from('investor_relationship_decisions').delete()
    .eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).eq('decision', 'interested');
  if (deleteError) return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 });

  // Legacy per-user swipe cleanup, same pattern as the archive route's own
  // reopen — Pipeline's card status derives from this table too, when there
  // is no investor_relationship_decisions row.
  const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id')
    .eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  if (startupProfile) {
    await admin.from('matchdeal_swipes').delete()
      .eq('actor_profile_id', investorProfile.id).eq('target_profile_id', startupProfile.id).eq('direction', 'like');
  }

  // Void the founder's own "an investor is interested" signal — the whole
  // point of this feature: a withdrawn-in-time interest must not leave
  // something on the founder's side implying it's still live. Deleted
  // outright (not just marked done) so it doesn't read as "resolved" —
  // it never existed as far as the founder's workspace is concerned now.
  const { data: delivery } = await admin.from('catalog_deliveries').select('entity_id')
    .eq('org_id', orgId).eq('catalog_id', investorCatalogEntityId).maybeSingle();
  if (delivery?.entity_id) {
    await admin.from('tasks').delete()
      .eq('org_id', orgId).eq('entity_id', delivery.entity_id as string).eq('source', 'investor_interest').eq('done', false);
  }

  return NextResponse.json({ ok: true });
}
