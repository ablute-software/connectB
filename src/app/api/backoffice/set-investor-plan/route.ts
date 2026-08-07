// Item 11 — investor-side mirror of /api/backoffice/set-plan (startups).
// plan_tier lives per matchdeal_investor_members seat on matchdeal_profiles
// (kind='investor'), not on one org-level column like orgs.plan — this
// applies the same tier to every ACTIVE seat of the firm at once, since the
// backoffice UI already displays/edits plan as one firm-level value (see
// investorOrgRows()'s own "first member with a value" convention). Reject
// is the same route with tier = the firm's current plan: no real change,
// but plan_tier_requested/plan_tier_requested_at still clear — a rejected
// request that stays pending is the exact bug item 11 reported.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { BRAND_NAME, APP_URL } from '@/lib/brand';

const MATCHDEAL_TIERS = ['tier_a', 'tier_b', 'tier_c'] as const;
type MatchdealTier = (typeof MATCHDEAL_TIERS)[number];
const TIER_NAME: Record<MatchdealTier, string> = { tier_a: 'Pro Scout', tier_b: 'Ace Spotter', tier_c: 'The Legendary Sleuth' };

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { entityId, tier } = await req.json() as { entityId?: string; tier?: string };
  if (!entityId) return NextResponse.json({ ok: false, error: 'Missing entityId.' }, { status: 400 });
  if (!tier || !MATCHDEAL_TIERS.includes(tier as MatchdealTier)) {
    return NextResponse.json({ ok: false, error: 'Invalid plan tier.' }, { status: 400 });
  }

  const { data: members } = await admin.from('matchdeal_investor_members')
    .select('id, user_id').eq('catalog_entity_id', entityId).eq('status', 'active');
  const memberIds = (members ?? []).map((m) => m.id as string);
  if (memberIds.length === 0) return NextResponse.json({ ok: false, error: 'No active seats for this firm.' }, { status: 404 });

  const { data: profilesBefore } = await admin.from('matchdeal_profiles')
    .select('plan_tier').eq('kind', 'investor').in('membership_id', memberIds).limit(1);
  const previousTier = (profilesBefore?.[0]?.plan_tier as MatchdealTier | undefined) ?? null;

  const { error } = await admin.from('matchdeal_profiles')
    .update({ plan_tier: tier, plan_tier_requested: null, plan_tier_requested_at: null })
    .eq('kind', 'investor').in('membership_id', memberIds);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'set_investor_plan', subjectType: 'catalog_entity', subjectId: entityId,
    detail: { previousTier, tier },
  });

  // Item 11 step 4 — notify the investor of the result, same primitives
  // Lote A's notifyInvestorAccessDecision uses (sendTransactionalEmail +
  // transactionalTemplate, resendConfigured gate), applied to every active
  // seat's user since the plan is firm-wide. Best-effort: a failed send
  // never undoes the plan change already committed above.
  let notifyFailed = false;
  if (resendConfigured) {
    const emails: string[] = [];
    for (const m of members ?? []) {
      const { data } = await admin.auth.admin.getUserById(m.user_id as string);
      if (data?.user?.email) emails.push(data.user.email);
    }
    const approved = previousTier !== tier;
    const heading = approved ? `Your ${BRAND_NAME} plan is now ${TIER_NAME[tier as MatchdealTier]}` : 'Your plan-change request was not approved';
    const body = approved
      ? `Your plan-change request has been applied — you're now on ${TIER_NAME[tier as MatchdealTier]}.`
      : `We reviewed your plan-change request and are keeping your account on ${TIER_NAME[previousTier ?? (tier as MatchdealTier)]} for now. Reply to this email if you have questions.`;
    const results = await Promise.all(emails.map((to) => sendTransactionalEmail({
      to, subject: heading,
      html: transactionalTemplate({ heading, body, ctaLabel: 'Open your workspace', ctaUrl: `${APP_URL}/plans` }),
    })));
    notifyFailed = emails.length === 0 || results.every((r) => !r.sent);
  } else {
    notifyFailed = true;
  }

  return NextResponse.json({ ok: true, notifyFailed });
}
