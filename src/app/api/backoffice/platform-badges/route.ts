// Prompt 601 §C — platform badges are granted BY HAND by a platform admin:
// cohort statuses, never computed. Every action here is gated by
// requirePlatformAdmin() and leaves an admin_audit_log line with who, to
// whom, when and why — the same bar 584 set, for the same reason: this
// gives rights that are worth money.
//
//   GET                       every row (active, lapsed and revoked), with the
//                             org name and, for tech masters, the window state
//   POST { action: 'grant' }  { orgId, badge, justification, freeUntil?, freeTier? }
//   POST { action: 'revoke' } { id, reason }
//   POST { action: 'keep' }   { id }  — a lapse reviewed by a person: the status
//                             stays, the row leaves the queue
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { platformBadgesAvailable } from '@/lib/platform-badges-capability';
import {
  applyBadgeCouponToOrgSubscription, orgUsageSummary, removeSubscriptionDiscount, toBadgeRow, PLATFORM_BADGE_COLUMNS,
} from '@/lib/platform-badges-server';
import {
  BADGE_LABEL, MANUAL_BADGES, PIONEER_MIN_DISCOUNT_PCT, TECH_MASTER_FREE_TIER, rightsText, techMasterWindow,
  type PlatformBadgeKey,
} from '@/lib/platform-badges';
import { PLAN_TIERS } from '@/lib/plans';
import type { PlanTier } from '@/lib/types';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  if (!(await platformBadgesAvailable())) return NextResponse.json({ ok: true, available: false, badges: [] });

  const lapsedOnly = new URL(req.url).searchParams.get('lapsed') === '1';
  let q = admin.from('platform_badges').select(`${PLATFORM_BADGE_COLUMNS}, orgs(name, is_test, is_internal, stripe_subscription_id)`).order('granted_at', { ascending: false });
  if (lapsedOnly) q = q.is('revoked_at', null).not('lapsed_at', 'is', null);
  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const now = new Date();
  const usageByOrg = new Map<string, Awaited<ReturnType<typeof orgUsageSummary>>>();
  const badges = [];
  for (const raw of (data ?? []) as unknown as (Parameters<typeof toBadgeRow>[0] & { org_id: string; orgs: { name: string; is_test: boolean; is_internal: boolean; stripe_subscription_id: string | null } | null })[]) {
    const row = toBadgeRow(raw);
    let usage = null;
    let window = null;
    if (row.badge === 'tech_master' && !row.revokedAt) {
      if (!usageByOrg.has(raw.org_id)) usageByOrg.set(raw.org_id, await orgUsageSummary(admin, raw.org_id));
      usage = usageByOrg.get(raw.org_id)!;
      window = techMasterWindow(row, usage.lastUse, now);
    }
    badges.push({
      id: row.id, orgId: raw.org_id, orgName: raw.orgs?.name ?? '(unknown org)', orgIsTest: !!(raw.orgs?.is_test || raw.orgs?.is_internal),
      hasSubscription: !!raw.orgs?.stripe_subscription_id,
      badge: row.badge, label: BADGE_LABEL[row.badge], rights: rightsText(row, now),
      grantedAt: row.grantedAt, grantedBy: raw.granted_by, justification: row.justification,
      freeTier: row.freeTier, freeUntil: row.freeUntil, discountPct: row.discountPct, stripeCouponApplied: raw.stripe_coupon_applied,
      revokedAt: row.revokedAt, revokeReason: raw.revoke_reason,
      lapsedAt: row.lapsedAt, lapseReviewedAt: row.lapseReviewedAt, lastWarningPct: row.lastWarningPct,
      usage, window,
    });
  }
  return NextResponse.json({ ok: true, available: true, badges });
}

type Body = {
  action?: 'grant' | 'revoke' | 'keep';
  orgId?: string; badge?: string; justification?: string; freeUntil?: string | null; freeTier?: string | null;
  id?: string; reason?: string;
};

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await platformBadgesAvailable())) return NextResponse.json({ ok: false, error: 'Migration 0337 is not applied.' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as Body;
  const now = new Date();

  if (body.action === 'grant') {
    const badge = body.badge as PlatformBadgeKey;
    if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
    if (!MANUAL_BADGES.includes(badge)) {
      return NextResponse.json({ ok: false, error: 'Only tech master and pioneer are granted by hand; the others are computed (Phase 2).' }, { status: 400 });
    }
    const justification = (body.justification ?? '').trim();
    if (justification.length < 8) return NextResponse.json({ ok: false, error: 'A justification is required (why this org, which cohort).' }, { status: 400 });

    const { data: org } = await admin.from('orgs').select('id, name').eq('id', body.orgId).maybeSingle();
    if (!org) return NextResponse.json({ ok: false, error: 'No org with that id.' }, { status: 404 });
    const { data: existing } = await admin.from('platform_badges').select('id').eq('org_id', body.orgId).eq('badge', badge).is('revoked_at', null).maybeSingle();
    if (existing) return NextResponse.json({ ok: false, error: `${org.name} already holds ${BADGE_LABEL[badge]}.` }, { status: 409 });

    let freeTier: PlanTier | null = null;
    let freeUntil: string | null = null;
    let discountPct: number | null = null;
    if (badge === 'tech_master') {
      freeTier = TECH_MASTER_FREE_TIER;
    } else {
      discountPct = PIONEER_MIN_DISCOUNT_PCT;
      if (body.freeUntil) {
        const d = new Date(body.freeUntil);
        if (Number.isNaN(d.getTime()) || d <= now) return NextResponse.json({ ok: false, error: 'freeUntil must be a future date.' }, { status: 400 });
        freeUntil = d.toISOString();
        const tier = (body.freeTier ?? TECH_MASTER_FREE_TIER) as PlanTier;
        if (!PLAN_TIERS.includes(tier)) return NextResponse.json({ ok: false, error: 'Invalid free tier.' }, { status: 400 });
        freeTier = tier;
      }
    }

    const { data: inserted, error } = await admin.from('platform_badges').insert({
      org_id: body.orgId, badge, granted_by: userId, justification, free_tier: freeTier, free_until: freeUntil, discount_pct: discountPct,
    }).select(PLATFORM_BADGE_COLUMNS).single();
    if (error || !inserted) return NextResponse.json({ ok: false, error: error?.message ?? 'Insert failed.' }, { status: 500 });

    // §E — the right reaches the invoice: a live subscription is discounted
    // now; with no subscription there is nothing to charge and checkout is
    // blocked for as long as the status makes the plan free.
    const row = toBadgeRow(inserted as unknown as Parameters<typeof toBadgeRow>[0]);
    const stripe = await applyBadgeCouponToOrgSubscription(admin, body.orgId, row, now);

    await logAdminAction(admin, {
      adminUserId: userId, action: 'platform_badge_granted', subjectType: 'org', subjectId: body.orgId,
      detail: { badge, orgName: org.name, justification, freeTier, freeUntil, discountPct, rights: rightsText(row, now), stripe },
    });
    return NextResponse.json({ ok: true, id: inserted.id, stripe });
  }

  if (body.action === 'revoke') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const reason = (body.reason ?? '').trim();
    if (reason.length < 4) return NextResponse.json({ ok: false, error: 'A reason is required.' }, { status: 400 });
    const { data: raw } = await admin.from('platform_badges').select(`${PLATFORM_BADGE_COLUMNS}, orgs(name, stripe_subscription_id)`).eq('id', body.id).maybeSingle();
    if (!raw) return NextResponse.json({ ok: false, error: 'No such badge row.' }, { status: 404 });
    if (raw.revoked_at) return NextResponse.json({ ok: false, error: 'Already revoked.' }, { status: 409 });
    const orgInfo = raw.orgs as unknown as { name: string; stripe_subscription_id: string | null } | null;

    const { error } = await admin.from('platform_badges').update({ revoked_at: now.toISOString(), revoked_by: userId, revoke_reason: reason }).eq('id', body.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    let stripe: { ok: boolean; error?: string } | null = null;
    if (raw.stripe_coupon_applied && orgInfo?.stripe_subscription_id) {
      stripe = await removeSubscriptionDiscount(orgInfo.stripe_subscription_id);
    }
    await admin.from('tasks').update({ done: true }).eq('org_id', raw.org_id).eq('source', 'platform_badge_tech_master').eq('done', false);

    await logAdminAction(admin, {
      adminUserId: userId, action: 'platform_badge_revoked', subjectType: 'org', subjectId: raw.org_id as string,
      detail: { badge: raw.badge, orgName: orgInfo?.name ?? null, reason, wasLapsed: !!raw.lapsed_at, stripe },
    });
    return NextResponse.json({ ok: true, stripe });
  }

  if (body.action === 'keep') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const { data: raw } = await admin.from('platform_badges').select('id, org_id, badge, lapsed_at, orgs(name)').eq('id', body.id).maybeSingle();
    if (!raw) return NextResponse.json({ ok: false, error: 'No such badge row.' }, { status: 404 });
    if (!raw.lapsed_at) return NextResponse.json({ ok: false, error: 'This status is not in lapse.' }, { status: 409 });
    const { error } = await admin.from('platform_badges').update({ lapse_reviewed_at: now.toISOString(), lapse_reviewed_by: userId }).eq('id', body.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await logAdminAction(admin, {
      adminUserId: userId, action: 'platform_badge_lapse_reviewed', subjectType: 'org', subjectId: raw.org_id as string,
      detail: { badge: raw.badge, orgName: (raw.orgs as unknown as { name: string } | null)?.name ?? null, lapsedAt: raw.lapsed_at, decision: 'keep' },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'action must be grant, revoke or keep.' }, { status: 400 });
}
